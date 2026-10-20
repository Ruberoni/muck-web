import {
  CloseCode,
  cm,
  MAX_PLAYERS,
  MAX_SEATS,
  parseClientMessage,
  PING,
  PONG,
  PROTOCOL_VERSION,
  type Cmds,
  type EnemySnap,
  type Hello,
  type PickupSnap,
  type PlayerSnap,
  type RejectReason,
  type ServerMessage,
  type Snap,
  type WorldState,
  type You,
} from '../src/net/protocol'
import { missingMove, MOVE_REPEAT, type Action, type Move, type PlayerCommands } from '../src/sim/commands'
import { STEP } from '../src/sim/constants'
import type { PlayerId, SimEvent } from '../src/sim/events'
import { generatePropPlacements, type PropPlacement } from '../src/sim/props'
import { Simulation, type PlayerSlot, type SimState } from '../src/sim/Simulation'

// --- Lo que la sala necesita de la plataforma (Durable Object, Node o los tests) ---

/** El extremo del servidor de un socket. */
export interface Conn {
  send(data: string): void
  close(code: number, reason?: string): void
}

/** Un único blob por sala (en la DO, una fila de SQLite). Síncrono, como el almacenamiento de la DO. */
export interface Storage {
  load(): string | null
  save(blob: string): void
  clear(): void
}

export interface Clock {
  /** ms */
  now(): number
}

export type TimerId = number

/** `every` es el bucle (solo mientras corre); `at` es la alarma de mantenimiento (una a la vez). */
export interface Scheduler {
  every(ms: number, fn: () => void): TimerId
  at(time: number, fn: () => void): TimerId
  cancel(id: TimerId): void
}

export interface Random {
  /** Token secreto de un hueco. */
  token(): string
  /** Semilla de sesión de la simulación. */
  seed(): number
}

export interface RoomDeps {
  storage: Storage
  clock: Clock
  scheduler: Scheduler
  random: Random
}

export class MemoryStorage implements Storage {
  blob: string | null = null
  load() {
    return this.blob
  }
  save(blob: string) {
    this.blob = blob
  }
  clear() {
    this.blob = null
  }
}

// --- Tiempos ---

const TICK_RATE = Math.round(1 / STEP)
/** Vuelta del bucle: avanza los ticks que tocan (normalmente 3) y manda `ev` y `snap`. */
export const LOOP_MS = 50
/** Sin `cmds` durante este tiempo, un jugador pasa a ausente. */
export const ABSENT_MS = 2000
export const SAVE_MS = 10_000
/** Un ausente durante tanto tiempo (pestaña olvidada) pasa a `gone`. */
export const FORGOTTEN_MS = 10 * 60_000
/** Una isla sin nadie conectado se borra a las 24 h. */
export const ISLAND_TTL_MS = 24 * 3600_000
export { MOVE_REPEAT }
/** Un `Move` para más de tantos ticks por delante del servidor se ignora (2 s). */
export const MAX_AHEAD = 2 * TICK_RATE
/** Ticks por vuelta como mucho: si el proceso se atrasa más, el reloj se rebasa en vez de recuperar. */
const MAX_CATCHUP = 30
/** Token bucket de mensajes por socket. */
const RATE = 60
const BURST = 120

/** Un hueco en la isla: un jugador que estuvo o está, reconocible por su token. */
interface Seat {
  token: string
  id: PlayerId
  name: string
  tab: string
  /** null: desconectado (`gone`). */
  conn: Conn | null
  /** Cuándo llegó el último `cmds` (o el `hello`) y su `t`. */
  lastCmdsAt: number
  lastT: number
  /** Cuándo se desconectó, para descartar el `gone` más antiguo. */
  lastSeen: number
  /** `Move` recibidos por tick y acciones aún no aplicadas, por `seq`. */
  moves: Map<number, Move>
  actions: Action[]
  /** Último `Move` aplicado y cuántas veces seguidas se ha repetido. */
  last: Move
  repeated: number
  ackTick: number
  ackSeq: number
  slack: number
  bucket: number
  bucketAt: number
}

/** Lo que se guarda de una sala: la simulación y los huecos, en un único blob. */
interface RoomBlob {
  schema: number
  sim: SimState
  seats: { token: string; id: PlayerId; name: string; lastSeen: number }[]
  /** Desde cuándo no hay nadie conectado (null: hay alguien). */
  emptySince: number | null
}

/**
 * Una sala: una isla y sus jugadores. Agnóstica de plataforma: la DO (PR 11) le pasa los sockets y los mensajes,
 * y ella habla solo a través de Conn, Storage, Clock, Scheduler y Random.
 *
 * - `hello` → `welcome` (o `reject` y cierre). `cmds` llena el buffer por tick de cada jugador; el bucle aplica
 *   en cada tick su `Move` (o repite el último, §4.1) y las acciones que tocan, y manda `ev` antes que `snap`.
 * - Sin `cmds` durante 2 s un jugador pasa a `absent`; con todos ausentes el bucle se para y la isla se guarda.
 *   El siguiente `cmds` lo reanuda sin recuperar el tiempo parado y manda `state` a todos.
 * - Al cerrarse un socket su jugador pasa a `gone` (sale del mundo) y conserva el hueco con su token.
 */
export class Room {
  /** null: la sala no tiene isla (no se ha creado o se ha borrado). */
  sim: Simulation | null = null
  readonly placements: PropPlacement[]
  private seats = new Map<string, Seat>()
  /** Sockets abiertos: con su hueco o, hasta el `hello`, sin él. */
  private conns = new Map<Conn, Seat | null>()
  /** Sockets que la sala ya ha cerrado: lo que siga llegando de ellos (ya iba de camino) se ignora. */
  private closed = new WeakSet<Conn>()
  private loop: TimerId | null = null
  private saver: TimerId | null = null
  private alarm: TimerId | null = null
  /** El reloj del bucle: el tick `baseTick` cayó en `baseTime`. */
  private baseTick = 0
  private baseTime = 0
  private emptySince: number | null = null
  /** La isla guardada era de otra versión y se descartó: avisar a quien vuelva. */
  private discardedOldIsland = false
  /** Pickups que se movieron en esta vuelta del bucle (los quietos no se repiten en `snap`). */
  private movedPickups = new Set<number>()

  constructor(
    readonly code: string,
    private deps: RoomDeps,
  ) {
    this.placements = generatePropPlacements()
    this.restore()
  }

  // --- Entrada desde la plataforma ---

  /** Un mensaje de un socket (el primero debe ser `hello`). */
  message(conn: Conn, data: string) {
    if (data === PING) {
      conn.send(PONG)
      return
    }
    if (this.closed.has(conn)) return
    if (!this.conns.has(conn)) this.conns.set(conn, null)
    if (!this.allow(conn)) return
    const parsed = parseClientMessage(data)
    const seat = this.conns.get(conn) ?? null
    if (!parsed.ok) {
      if (parsed.version !== undefined && !seat) this.reject(conn, 'version', CloseCode.Version)
      else this.kick(conn)
      return
    }
    const { msg } = parsed
    if (msg.type === 'hello') {
      if (seat) this.kick(conn)
      else this.hello(conn, msg)
    } else if (!seat || !this.sim) {
      this.kick(conn)
    } else if (msg.type === 'cmds') {
      this.cmds(seat, msg)
    } else {
      this.send(conn, { type: 'state', ...this.fullState(seat) })
    }
  }

  /** El socket se ha cerrado (lo cerrara quien lo cerrara). */
  disconnect(conn: Conn) {
    const seat = this.conns.get(conn)
    this.conns.delete(conn)
    if (!seat || seat.conn !== conn) return
    this.leave(seat)
  }

  /**
   * Tras hibernar, la plataforma conserva los sockets pero la sala se ha creado de nuevo desde el blob:
   * vuelve a unir un socket a su hueco. Queda ausente hasta que mande `cmds`.
   */
  adopt(conn: Conn, token: string, tab: string): boolean {
    const seat = this.seats.get(token)
    if (!this.sim || !seat || seat.conn) return false
    this.attach(seat, conn, tab, 'absent')
    this.scheduleAlarm()
    return true
  }

  /** La alarma de la plataforma: cierra ausentes olvidados y borra la isla sin nadie al cabo de 24 h. */
  housekeep() {
    const now = this.deps.clock.now()
    this.alarm = null
    for (const seat of this.seats.values()) {
      if (seat.conn && this.slotOf(seat).connection === 'absent' && now - seat.lastCmdsAt >= FORGOTTEN_MS) {
        this.close(seat.conn, CloseCode.Normal)
      }
    }
    if (this.sim && this.emptySince !== null && now - this.emptySince >= ISLAND_TTL_MS) this.deleteIsland()
    this.scheduleAlarm()
  }

  // --- Mensajes ---

  private hello(conn: Conn, msg: Hello) {
    if (msg.room !== this.code) return this.reject(conn, 'invalid', CloseCode.Invalid)
    if (!this.sim) {
      // Si se descartó una isla de otra versión, quien vuelve con el enlace empieza una nueva con el mismo código.
      if (msg.intent === 'join' && !this.discardedOldIsland) return this.reject(conn, 'not-found', CloseCode.Normal)
      this.sim = new Simulation(this.deps.random.seed(), this.placements)
    } else if (msg.intent === 'create') {
      return this.reject(conn, 'exists', CloseCode.Normal)
    }
    const sim = this.sim
    let seat = msg.token ? this.seats.get(msg.token) : undefined
    const reconnecting = seat?.conn != null
    if (seat?.conn) {
      // Misma pestaña: reconexión tras un corte, el socket nuevo sustituye al viejo.
      // Otra pestaña: se queda el hueco y la vieja se cierra con 4001 y no se reconecta.
      const old = seat.conn
      this.conns.delete(old)
      this.closed.add(old)
      old.close(seat.tab === msg.tab ? CloseCode.Normal : CloseCode.OtherTab, 'sustituida')
      seat.conn = null
    } else if (sim.inWorld().length >= MAX_PLAYERS) {
      return this.reject(conn, 'full', CloseCode.RoomFull)
    }
    // Volvía con un token de la isla descartada: avisarle de que es una isla nueva.
    const islandReset = this.discardedOldIsland && msg.token !== undefined && !seat
    if (!seat) seat = this.newSeat()
    seat.name = msg.name || `Jugador ${seat.id + 1}`
    if (!this.loop) this.resume()
    this.attach(seat, conn, msg.tab, 'present')
    seat.lastT = msg.t
    this.send(conn, {
      type: 'welcome',
      id: seat.id,
      token: seat.token,
      t: msg.t,
      held: 0,
      serverTick: sim.tick,
      worldStartTick: sim.startTick,
      placements: this.placements,
      state: this.worldState(seat.id),
      you: you(this.slotOf(seat)),
      ...(islandReset ? { islandReset: true as const } : {}),
    })
    if (!reconnecting) this.broadcast({ type: 'join', id: seat.id, name: seat.name }, seat)
    this.scheduleAlarm()
  }

  private cmds(seat: Seat, msg: Cmds) {
    const sim = this.sim!
    const now = this.deps.clock.now()
    seat.lastCmdsAt = now
    seat.lastT = msg.t
    if (this.slotOf(seat).connection === 'absent') {
      sim.setConnection(seat.id, 'present')
      this.scheduleAlarm()
    }
    if (!this.loop) this.resume()

    let newest = -Infinity
    for (const move of msg.moves) {
      const n = move.n ?? 1
      const lastTick = move.tick + n - 1
      newest = Math.max(newest, lastTick)
      seat.ackTick = Math.max(seat.ackTick, lastTick)
      for (let tick = move.tick; tick <= lastTick; tick++) {
        // Los de ticks ya simulados se descartan (la reconciliación corrige); los muy adelantados, también.
        if (tick <= sim.tick || tick > sim.tick + MAX_AHEAD) continue
        seat.moves.set(tick, { tick, buttons: move.buttons, yaw: move.yaw, pitch: move.pitch, ...(move.aim !== undefined ? { aim: move.aim } : {}) })
      }
    }
    if (newest > -Infinity) seat.slack = newest - sim.tick

    for (const action of [...msg.actions].sort((a, b) => a.seq - b.seq)) {
      if (action.seq <= seat.ackSeq) continue
      seat.ackSeq = action.seq
      seat.actions.push(action)
    }
  }

  // --- Bucle ---

  /** Arranca el bucle rebasando el reloj: el siguiente tick es el último simulado + 1, sin recuperar lo parado. */
  private resume() {
    const { scheduler, clock } = this.deps
    const sim = this.sim!
    this.baseTick = sim.tick
    this.baseTime = clock.now()
    this.loop = scheduler.every(LOOP_MS, () => this.turn())
    this.saver = scheduler.every(SAVE_MS, () => this.save())
    // Los que ya estaban conectados recalculan su reloj desde un estado completo.
    for (const seat of this.connected()) this.send(seat.conn!, { type: 'state', ...this.fullState(seat) })
  }

  private stop() {
    const { scheduler } = this.deps
    if (this.loop !== null) scheduler.cancel(this.loop)
    if (this.saver !== null) scheduler.cancel(this.saver)
    this.loop = this.saver = null
    this.save()
    this.scheduleAlarm()
  }

  /** Una vuelta del bucle: ausencias, los ticks que tocan, y `ev` + `snap` a cada uno. */
  private turn() {
    const sim = this.sim!
    const now = this.deps.clock.now()
    let absent = false
    for (const seat of this.connected()) {
      if (this.slotOf(seat).connection === 'present' && now - seat.lastCmdsAt >= ABSENT_MS) {
        sim.setConnection(seat.id, 'absent')
        absent = true
      }
    }
    if (!this.connected().some((seat) => this.slotOf(seat).connection === 'present')) return this.stop()
    if (absent) this.scheduleAlarm()

    let due = this.baseTick + Math.floor(((now - this.baseTime) * TICK_RATE) / 1000 + 1e-6) - sim.tick
    if (due > MAX_CATCHUP) {
      due = MAX_CATCHUP
      this.baseTick = sim.tick + due
      this.baseTime = now
    }
    if (due <= 0) return
    const events: SimEvent[] = []
    this.movedPickups.clear()
    for (let i = 0; i < due; i++) events.push(...this.simulate())

    if (events.length) this.broadcast({ type: 'ev', list: events })
    const players = this.playerSnaps()
    const enemies: EnemySnap[] = sim.enemies.list.map((e) => ({ id: e.id, pos: { x: cm(e.pos.x), z: cm(e.pos.z) }, yaw: cm(e.yaw), hp: e.hp }))
    const movingPickups: PickupSnap[] = sim.pickups.list
      .filter((p) => this.movedPickups.has(p.id))
      .map((p) => ({ id: p.id, pos: { x: cm(p.pos.x), y: cm(p.pos.y), z: cm(p.pos.z) }, grounded: p.grounded }))
    for (const seat of this.connected()) {
      const snap: Snap = {
        type: 'snap',
        tick: sim.tick,
        t: seat.lastT,
        held: now - seat.lastCmdsAt,
        ackTick: seat.ackTick,
        ackSeq: seat.ackSeq,
        slack: seat.slack,
        you: you(this.slotOf(seat)),
        players: players.filter((p) => p.id !== seat.id),
        enemies,
        movingPickups,
      }
      this.send(seat.conn!, snap)
    }
  }

  /** Un tick: el `Move` de cada jugador en el mundo para ese tick (o el repetido) y sus acciones que tocan. */
  private simulate(): SimEvent[] {
    const sim = this.sim!
    const tick = sim.tick + 1
    const commands = new Map<PlayerId, PlayerCommands>()
    for (const seat of this.seats.values()) {
      if (this.slotOf(seat).connection === 'gone') continue
      let move = seat.moves.get(tick)
      seat.moves.delete(tick)
      if (move) {
        seat.last = move
        seat.repeated = 0
      } else {
        move = missingMove(seat.last, seat.repeated, tick)
        seat.repeated = Math.min(MOVE_REPEAT, seat.repeated + 1)
      }
      // En orden de seq y sin saltarse ninguna: las de su tick o anteriores (las que llegaron tarde, ahora).
      let ready = 0
      while (ready < seat.actions.length && seat.actions[ready].tick <= tick) ready++
      commands.set(seat.id, { move, actions: seat.actions.splice(0, ready) })
    }
    const events = sim.step(commands)
    for (const p of sim.pickups.list) {
      if (!p.grounded || p.pos.x !== p.prev.x || p.pos.y !== p.prev.y || p.pos.z !== p.prev.z) this.movedPickups.add(p.id)
    }
    return events
  }

  // --- Huecos ---

  private newSeat(): Seat {
    const sim = this.sim!
    // Como mucho MAX_SEATS huecos: se descarta el `gone` más antiguo.
    while (this.seats.size >= MAX_SEATS) {
      const oldest = [...this.seats.values()].filter((s) => !s.conn).sort((a, b) => a.lastSeen - b.lastSeen)[0]
      if (!oldest) break
      this.seats.delete(oldest.token)
      sim.removePlayer(oldest.id)
    }
    const slot = sim.addPlayer()
    sim.setConnection(slot.id, 'gone')
    const seat = blankSeat(this.deps.random.token(), slot.id, '', slot)
    this.seats.set(seat.token, seat)
    return seat
  }

  /** Une un socket a su hueco y deja el buffer limpio: las acciones siguen desde `appliedSeq`. */
  private attach(seat: Seat, conn: Conn, tab: string, connection: 'present' | 'absent') {
    const sim = this.sim!
    const slot = this.slotOf(seat)
    const now = this.deps.clock.now()
    Object.assign(seat, blankSeat(seat.token, seat.id, seat.name, slot), { conn, tab, lastCmdsAt: now, ackTick: sim.tick })
    this.conns.set(conn, seat)
    sim.setConnection(seat.id, connection)
    this.emptySince = null
  }

  private leave(seat: Seat) {
    const sim = this.sim!
    const now = this.deps.clock.now()
    seat.conn = null
    seat.lastSeen = now
    seat.moves.clear()
    seat.actions = []
    sim.setConnection(seat.id, 'gone')
    this.broadcast({ type: 'leave', id: seat.id, name: seat.name })
    if (this.connected().length === 0) {
      this.emptySince = now
      if (this.loop) this.stop()
      else this.save()
    }
    this.scheduleAlarm()
  }

  private connected(): Seat[] {
    return [...this.seats.values()].filter((s) => s.conn).sort((a, b) => a.id - b.id)
  }

  private slotOf(seat: Seat): PlayerSlot {
    return this.sim!.slot(seat.id)
  }

  // --- Persistencia ---

  private save() {
    if (!this.sim) return
    const blob: RoomBlob = {
      schema: PROTOCOL_VERSION,
      sim: this.sim.toJSON(),
      seats: [...this.seats.values()].map(({ token, id, name, lastSeen }) => ({ token, id, name, lastSeen })),
      emptySince: this.emptySince,
    }
    this.deps.storage.save(JSON.stringify(blob))
  }

  /** La isla guardada, si la hay y es de esta versión; si es de otra se descarta (sin migraciones). */
  private restore() {
    const raw = this.deps.storage.load()
    if (raw === null) return
    try {
      const blob = JSON.parse(raw) as RoomBlob
      if (blob?.schema !== PROTOCOL_VERSION) throw new Error('isla de otra versión')
      const sim = Simulation.fromJSON(blob.sim, this.placements)
      // Nadie está conectado hasta que vuelva (con `hello`) o la plataforma devuelva su socket (`adopt`).
      for (const slot of sim.players.values()) sim.setConnection(slot.id, 'gone')
      for (const { token, id, name, lastSeen } of blob.seats) {
        const seat = blankSeat(token, id, name, sim.slot(id))
        seat.lastSeen = lastSeen
        this.seats.set(token, seat)
      }
      this.sim = sim
      this.emptySince = blob.emptySince ?? this.deps.clock.now()
    } catch {
      // De otra versión o ilegible: sin migraciones, se empieza una isla nueva con el mismo código.
      this.seats.clear()
      this.deps.storage.clear()
      this.discardedOldIsland = true
      return
    }
    this.scheduleAlarm()
  }

  private deleteIsland() {
    this.sim = null
    this.seats.clear()
    this.emptySince = null
    this.deps.storage.clear()
  }

  /** Una sola alarma: el siguiente ausente olvidado o el borrado de la isla vacía. */
  private scheduleAlarm() {
    const { scheduler } = this.deps
    if (this.alarm !== null) scheduler.cancel(this.alarm)
    this.alarm = null
    if (!this.sim) return
    let due = Infinity
    for (const seat of this.connected()) {
      if (this.slotOf(seat).connection === 'absent') due = Math.min(due, seat.lastCmdsAt + FORGOTTEN_MS)
    }
    if (this.emptySince !== null) due = Math.min(due, this.emptySince + ISLAND_TTL_MS)
    if (due < Infinity) this.alarm = scheduler.at(due, () => this.housekeep())
  }

  // --- Envío ---

  private worldState(me: PlayerId): WorldState {
    const sim = this.sim!
    const { tick, worldStartTick, props, enemies, pickups, campfires } = sim.toJSON()
    const names = new Map([...this.seats.values()].map((s) => [s.id, s.name]))
    const players = this.playerSnaps()
      .filter((p) => p.id !== me)
      .map((p) => ({ ...p, name: names.get(p.id) ?? '' }))
    return { tick, worldStartTick, props, enemies, pickups, campfires, players }
  }

  private fullState(seat: Seat) {
    const sim = this.sim!
    return { tick: sim.tick, worldStartTick: sim.startTick, state: this.worldState(seat.id), you: you(this.slotOf(seat)) }
  }

  /** Los jugadores en el mundo, como los ven los demás (sin inventario, en cm). */
  private playerSnaps(): PlayerSnap[] {
    return this.sim!.inWorld().map(({ id, player, inventory, alive, connection }) => ({
      id,
      pos: { x: cm(player.pos.x), y: cm(player.pos.y), z: cm(player.pos.z) },
      yaw: cm(player.yaw),
      pitch: cm(player.pitch),
      item: inventory.selectedItem,
      health: Math.round(player.health),
      alive,
      connection,
    }))
  }

  private send(conn: Conn, msg: ServerMessage) {
    conn.send(JSON.stringify(msg))
  }

  private broadcast(msg: ServerMessage, except?: Seat) {
    const data = JSON.stringify(msg)
    for (const seat of this.connected()) if (seat !== except) seat.conn!.send(data)
  }

  private reject(conn: Conn, reason: RejectReason, code: number) {
    this.send(conn, { type: 'reject', reason, ...(reason === 'version' ? { v: PROTOCOL_VERSION } : {}) })
    this.close(conn, code)
  }

  /** Mensaje inválido o exceso de mensajes. */
  private kick(conn: Conn) {
    this.close(conn, CloseCode.Invalid)
  }

  private close(conn: Conn, code: number) {
    const seat = this.conns.get(conn)
    this.conns.delete(conn)
    this.closed.add(conn)
    if (seat && seat.conn === conn) this.leave(seat)
    conn.close(code)
  }

  /** Token bucket por socket: ~60 mensajes/s con ráfagas de hasta 120. */
  private allow(conn: Conn): boolean {
    const seat = this.conns.get(conn)
    if (!seat) return true
    const now = this.deps.clock.now()
    seat.bucket = Math.min(BURST, seat.bucket + ((now - seat.bucketAt) * RATE) / 1000)
    seat.bucketAt = now
    if (seat.bucket < 1) {
      this.kick(conn)
      return false
    }
    seat.bucket--
    return true
  }
}

function blankSeat(token: string, id: PlayerId, name: string, slot: PlayerSlot): Seat {
  const { yaw, pitch } = slot.player
  return {
    token,
    id,
    name,
    tab: '',
    conn: null,
    lastCmdsAt: 0,
    lastT: 0,
    lastSeen: 0,
    moves: new Map(),
    actions: [],
    // Hasta el primer `Move`: quieto, mirando a donde miraba.
    last: { tick: 0, buttons: 0, yaw, pitch },
    repeated: MOVE_REPEAT,
    ackTick: 0,
    ackSeq: slot.appliedSeq,
    slack: 0,
    bucket: BURST,
    bucketAt: 0,
  }
}

/** Tu estado completo, sin redondear: la predicción reconcilia contra él. */
function you(slot: PlayerSlot): You {
  const { player } = slot
  return {
    player: { ...player, pos: { ...player.pos }, prev: { ...player.prev }, vel: { ...player.vel } },
    inventory: slot.inventory.save(),
    combat: { ...slot.combat },
    hotbarFull: slot.hotbarFull,
    alive: slot.alive,
    appliedSeq: slot.appliedSeq,
  }
}
