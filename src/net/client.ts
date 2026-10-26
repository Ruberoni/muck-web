import type { Clock } from '../../server/room'
import type { ActionData, Move } from '../sim/commands'
import { ENEMY_DEF, STATION_RANGE, STEP } from '../sim/constants'
import type { EnemyData } from '../sim/enemies'
import type { PlayerId, SimEvent, TargetRef } from '../sim/events'
import type { ItemId } from '../sim/inventory'
import type { Pickup } from '../sim/pickups'
import { resetProp } from '../sim/props'
import type { Connection } from '../sim/Simulation'
import { Simulation } from '../sim/Simulation'
import { stationNear, structureSpot } from '../sim/structures'
import { QUIET_SEND_MS, SEND_MS, TickClock } from './clock'
import { InterpBuffer, Interpolator, PresentationQueue, type Shown } from './interp'
import { Predictor } from './predict'
import {
  MAX_ACTIONS,
  MAX_MESSAGE,
  MAX_MOVE_REPEAT,
  MAX_MOVES,
  MAX_RTT,
  PING,
  PONG,
  PROTOCOL_VERSION,
  ServerDecoder,
  type Cmds,
  type DevOp,
  type EnemySnap,
  type Hello,
  type MoveMsg,
  type PickupSnap,
  type PlayerSnap,
  type Reject,
  type WorldState,
} from './protocol'
import type { MoveInput } from './session'
import type { Transport } from './transport'

/** Con quién y cómo se entra en la sala (lo del `hello` que no es la versión ni el sello). */
export type ClientHello = Pick<Hello, 'intent' | 'room' | 'name' | 'token' | 'tab'>

export type ClientState = 'connecting' | 'online' | 'closed'

/** Algo que avisar en el HUD: alguien entra o sale, alguien escribe en el chat o la isla guardada se ha descartado. */
export type Notice =
  | { type: 'join' | 'leave'; id: PlayerId; name: string }
  | { type: 'chat'; id: PlayerId; name: string; text: string }
  | { type: 'islandReset' }

/**
 * Quien se va y vuelve antes de esto (una reconexión tras un corte) no se avisa: ni "se ha ido" ni "se ha unido".
 * Así, una marcha de verdad se avisa con este retraso.
 */
export const LEAVE_GRACE_MS = 10_000

/** Lo que se dibuja de otro jugador además de su pose. */
export interface RemotePlayer {
  item: ItemId | null
  health: number
  alive: boolean
  connection: Connection
  /** Su RTT (ms), como lo dice la sala. */
  ping: number
}

export interface RemoteEnemy {
  hp: number
}

/** Un objeto del suelo del espejo: se dibuja con sus muestras de `movingPickups` (quieto, en la última). */
interface MirrorPickup {
  pickup: Pickup
  samples: InterpBuffer<boolean>
  spawnTick: number
  /** Tick en que lo recogieron: deja de dibujarse cuando el render llega a él. */
  goneAt: number | null
}

/** Ticks entre dos `snap` (una vuelta del bucle de la sala). */
const SNAP_TICKS = 3
/** El giro de un objeto que cae no viaja (es del azar del servidor): sale del id. */
const spinOf = (id: number) => (id * 2.39996) % (2 * Math.PI)

/** Lo que el jugador local ya ha presentado al predecirlo: el servidor se lo repite, pero no se presenta otra vez. */
const PREDICTED = new Set<SimEvent['type']>(['playerSwing', 'playerAte', 'playerCrafted', 'playerPlaced'])

/** Un evento que trata del jugador `me` (lo que le pasa o lo que ha provocado), o del mundo entero. */
function concerns(e: SimEvent, me: PlayerId): boolean {
  if ('by' in e) return e.by === me
  switch (e.type) {
    case 'playerSwing':
    case 'playerAte':
    case 'playerCrafted':
    case 'playerPlaced':
    case 'playerHurt':
    case 'playerDied':
    case 'playerRespawn':
      return e.id === me
    case 'clockSet':
    case 'worldReset':
    case 'gameOver':
    case 'gameOverCancelled':
      return true
    default:
      return false
  }
}

/** Ticks entre el `Move` más viejo y el más nuevo de un envío normal a 20 Hz (con frames lentos, algo más). */
const MAX_SPAN = 6
/** Muerto (espectador): `cmds` a 1 Hz, para no contar como ausente y que el mundo siga hasta que reaparezca (§5.2). */
export const SPECTATOR_SEND_MS = 1000

const sameAim = (a: TargetRef | null | undefined, b: TargetRef | null | undefined) => a === b || (!!a && !!b && a.kind === b.kind && a.id === b.id)
const sameMove = (a: Omit<Move, 'tick'>, b: Omit<Move, 'tick'>) => a.buttons === b.buttons && a.yaw === b.yaw && a.pitch === b.pitch

/** `Move` seguidos e iguales en uno con `n`. */
export function compactMoves(moves: readonly Move[]): MoveMsg[] {
  const out: MoveMsg[] = []
  for (const move of moves) {
    const last = out.at(-1)
    const n = last?.n ?? 1
    if (last && last.tick + n === move.tick && n < MAX_MOVE_REPEAT && sameMove(last, move) && sameAim(last.aim, move.aim)) last.n = n + 1
    else out.push({ ...move })
  }
  for (const move of out) if (move.n === 1) delete move.n
  return out
}

/**
 * `cmds` como texto que cabe en MAX_MESSAGE (uno más largo hace que la sala expulse): como mucho MAX_ACTIONS
 * acciones y, si aun así no cabe, sin las últimas (la sala no se salta ningún `seq`). Las que se quedan fuera
 * siguen sin confirmar: cada envío repite desde la última confirmada, así que salen cuando el servidor confirme
 * las anteriores (~1 RTT), ya tarde para su tick (una corrección). Con las cotas reales no pasa (client.test.ts).
 * Por si acaso, sin acciones se quitan también los `Move` más viejos (el servidor rellena los que faltan).
 */
export function encodeCmds(cmds: Cmds): string {
  const actions = cmds.actions.slice(0, MAX_ACTIONS)
  const moves = [...cmds.moves]
  let data = JSON.stringify({ ...cmds, moves, actions })
  while (data.length > MAX_MESSAGE && (actions.length || moves.length > 1)) {
    if (actions.length) actions.pop()
    else moves.shift()
    data = JSON.stringify({ ...cmds, moves, actions })
  }
  return data
}

/**
 * El cliente en red sin DOM ni three: habla con la sala por un Transport, predice al jugador local, interpola a
 * los demás y a los enemigos y decide cuándo enviar. NetSession lo envuelve para Game.
 *
 * Cada frame: `advance()` dice cuántos ticks predecir, `step(move, actions)` predice cada uno y `flush()` envía
 * si toca: a 20 Hz mientras el jugador hace algo; a 4 Hz cuando está quieto (botones sueltos, sin girar ni
 * acciones pendientes) y ya ha enviado ese `Move` quieto, así el servidor repite justo ese; al volver a moverse,
 * en el acto. Muerto, a 1 Hz (keepalive del espectador). Después, `render()` pone el espejo en el tick de render y da
 * los eventos que toca presentar.
 *
 * `sim` es un espejo de la partida para dibujarla y predecir: los props y las estructuras se actualizan con los eventos
 * en cuanto llegan (la predicción choca con lo que hay de verdad); los enemigos, los objetos del suelo y el reloj
 * del día están en el tick de render (lo que se ve), y el único jugador es el local, el predicho.
 * Cada `Move` lleva `aim`: lo que el jugador tiene delante en el espejo, con los enemigos como se ven.
 */
export class NetClient {
  state: ClientState = 'connecting'
  id: PlayerId = -1
  token: string | undefined
  /** Por qué rechazó la sala la entrada, y el código con el que se cerró la conexión. */
  rejected: Reject | null = null
  closeCode: number | null = null
  sim: Simulation | null = null
  predictor: Predictor | null = null
  readonly clock = new TickClock()
  readonly players = new Interpolator<RemotePlayer>()
  readonly enemies = new Interpolator<RemoteEnemy>()
  /** Eventos del servidor para presentarlos cuando el render llegue a su tick. */
  readonly presentation = new PresentationQueue<SimEvent>()
  readonly names = new Map<PlayerId, string>()
  /** Avisos pendientes de mostrar (`takeNotices`). */
  private notices: Notice[] = []
  /** Los que se han ido hace menos de LEAVE_GRACE_MS: si vuelven antes, no se avisa de nada. */
  private leaving = new Map<PlayerId, { notice: Notice; at: number }>()
  /** Recuerda el último inventario propio para los `snap` que no lo traen. */
  private decoder = new ServerDecoder()
  /** Los demás jugadores tal como se dibujan en el tick de render (lo pone `render`). */
  shownPlayers: Shown<RemotePlayer>[] = []
  /** Sube con cada estado completo (`welcome`, `state`): la vista de la isla se rehace entera. */
  worldVersion = 0
  /** El `t` del último `snap`: el servidor ya había recibido todo lo enviado antes de ese sello. */
  lastEcho = -Infinity
  /** Tras `welcome`, `reject` o el cierre. */
  onchange: (() => void) | null = null
  private ackTick = 0
  private ackSeq = 0
  private lastSentAt = -Infinity
  private lastSent: Move | null = null
  private quiet = false
  private suspended = false
  private awaitingState = false
  /** Siguiente tick que predecir en este frame. */
  private nextTick = 0
  private lastFrame = 0
  /** Eventos del servidor que tratan del jugador local: se presentan en cuanto llegan. */
  private own: SimEvent[] = []
  private worldStartTick = 0
  private mirrorEnemies = new Map<number, EnemyData>()
  private pickups = new Map<number, MirrorPickup>()

  constructor(
    private transport: Transport,
    private time: Clock,
    private hello: ClientHello,
  ) {
    transport.onmessage = (data) => this.receive(data)
    transport.onclose = (code) => {
      this.state = 'closed'
      this.closeCode = code
      this.onchange?.()
    }
  }

  connect() {
    const { intent, room, name, token, tab } = this.hello
    this.send({ type: 'hello', v: PROTOCOL_VERSION, t: this.time.now(), intent, room, name, tab, ...(token ? { token } : {}) })
  }

  /** Predice y envía con normalidad. */
  get active(): boolean {
    return this.state === 'online' && !this.suspended && !this.awaitingState
  }

  /** Ticks que hay que predecir ahora con `step`; 0 sin conexión, en pausa o esperando el estado. */
  advance(): number {
    const now = this.time.now()
    this.predictor?.decay(now - this.lastFrame)
    this.lastFrame = now
    if (!this.active) return 0
    const predictor = this.predictor!
    const due = this.clock.advance(now)
    // Los que el reloj se salta los rellena la predicción; los ya predichos (tras adoptar un estado) no se repiten.
    const first = Math.max(predictor.tick + 1, this.clock.tick - due + 1)
    this.nextTick = first
    return Math.max(0, this.clock.tick - first + 1)
  }

  /** Predice el siguiente tick con lo que hace el jugador; devuelve lo que ha hecho, para presentarlo ya. */
  step(move: MoveInput, actions: readonly ActionData[] = []): SimEvent[] {
    if (move.aim === undefined) move = { ...move, aim: this.aim(move) }
    return this.predictor!.step(this.nextTick++, move, actions)
  }

  /** Envía `cmds` si toca (ver la clase). */
  flush() {
    if (!this.active) return
    const now = this.time.now()
    const predictor = this.predictor!
    const newest = predictor.history.at(-1)?.move
    const actions = predictor.unsent(this.ackSeq)
    if (!newest || (newest === this.lastSent && actions.length === 0)) return
    // Quieto: todo lo predicho desde el último envío es igual a un último Move ya enviado y sin botones.
    const last = this.lastSent
    const quiet =
      !!last &&
      last.buttons === 0 &&
      predictor.history.every((h) => h.move.tick <= last.tick || sameMove(h.move, last)) &&
      actions.length === 0 &&
      !predictor.slot.combat.pendingSwing
    const interval = !predictor.slot.alive ? SPECTATOR_SEND_MS : quiet ? QUIET_SEND_MS : SEND_MS
    if (!(this.quiet && !quiet) && now - this.lastSentAt < interval) return
    // Los nuevos y los no confirmados; los que el reloj se saltó no (el servidor los rellena igual).
    const moves = compactMoves(predictor.history.filter((h) => !h.filled && h.move.tick > this.ackTick).map((h) => h.move)).slice(-MAX_MOVES)
    const rtt = Math.min(MAX_RTT, Math.round(this.clock.rtt))
    this.transport.send(encodeCmds({ type: 'cmds', t: now, moves, actions, ...(rtt > 0 ? { rtt } : {}) }))
    // El margen solo dice algo del ritmo en los envíos normales: no en el primero tras estar quieto ni tras un tirón.
    const span = this.lastSent && !this.quiet ? newest.tick - this.lastSent.tick - 1 : null
    this.clock.sent(now, quiet || span === null || span > MAX_SPAN ? null : span)
    this.lastSentAt = now
    this.lastSent = newest
    this.quiet = quiet
  }

  /**
   * Por frame, antes de dibujar: pone el espejo en el tick de render (demás jugadores, enemigos, objetos del suelo
   * y reloj del día) y devuelve los eventos que toca presentar: los del jugador local (salvo lo que ya presentó al
   * predecirlo) en cuanto llegan, y los demás cuando el render llega a su tick.
   */
  render(): { own: SimEvent[]; remote: SimEvent[] } {
    const own = this.own
    this.own = []
    const sim = this.sim
    if (!sim) return { own, remote: [] }
    const tick = this.renderTick()
    sim.clock.elapsed = (tick - this.worldStartTick) * STEP
    this.shownPlayers = this.players.sample(tick)
    this.syncEnemies(sim, this.enemies.sample(tick))
    this.syncPickups(sim, tick)
    return { own, remote: this.presentation.take(tick) }
  }

  /** Pestaña oculta o pausa: deja de predecir y de enviar (el servidor lo pasa a ausente). */
  suspend() {
    this.suspended = true
  }

  /** Al volver: descarta lo acumulado sin presentarlo y pide el estado completo antes de volver a predecir. */
  wake() {
    if (!this.suspended) return
    this.suspended = false
    if (this.state !== 'online') return
    this.awaitingState = true
    this.presentation.clear()
    this.own = []
    this.players.clear()
    this.enemies.clear()
    this.send({ type: 'resync' })
  }

  /** Un truco de `__debug` (solo lo acepta la sala de desarrollo). */
  dev(op: DevOp) {
    this.send({ type: 'dev', ...op })
  }

  /** En pausa: que la plataforma no cierre el socket por inactividad (la DO contesta sin despertarse). */
  ping() {
    if (this.state === 'online') this.transport.send(PING)
  }

  /** Un mensaje de chat (la sala lo devuelve a todos, también a este cliente). */
  say(text: string) {
    if (this.state === 'online') this.send({ type: 'say', text })
  }

  /** Los avisos desde la última vez, en orden de llegada (las marchas, pasado LEAVE_GRACE_MS). */
  takeNotices(): Notice[] {
    const now = this.time.now()
    for (const [id, { notice, at }] of this.leaving) {
      if (now - at < LEAVE_GRACE_MS) continue
      this.leaving.delete(id)
      this.notices.push(notice)
    }
    return this.notices.splice(0)
  }

  renderTick(): number {
    return this.clock.renderTick(this.time.now())
  }

  close() {
    this.transport.close()
  }

  private send(msg: object) {
    this.transport.send(JSON.stringify(msg))
  }

  private receive(data: string) {
    if (data === PONG) return
    const msg = this.decoder.decode(data)
    const now = this.time.now()
    switch (msg.type) {
      case 'welcome': {
        this.id = msg.id
        this.token = msg.token
        const sim = new Simulation(0, msg.placements)
        const slot = sim.addPlayer(msg.id)
        this.sim = sim
        this.applyWorld(msg.state)
        this.predictor = new Predictor(slot, {
          env: sim.env,
          canPlace: (p, radius) => structureSpot(p.pos, p.yaw, radius, [sim.world.grid, sim.structures.grid]).valid,
          // Como en la simulación: las estaciones del espejo, con el mismo alcance.
          nearStation: (kind, pos) => stationNear(sim.structures.list, kind, pos, STATION_RANGE),
        })
        this.predictor.start(msg.serverTick, msg.you)
        this.clock.sync(now, msg.serverTick, msg)
        this.ackTick = msg.serverTick
        this.ackSeq = msg.you.appliedSeq
        for (const p of msg.state.players) this.names.set(p.id, p.name)
        if (msg.islandReset) this.notices.push({ type: 'islandReset' })
        this.pushRemote(msg.state.tick, msg.state.players, msg.state.enemies.list)
        this.state = 'online'
        this.onchange?.()
        break
      }
      case 'reject':
        this.rejected = msg
        this.onchange?.()
        break
      case 'snap':
        this.ackTick = Math.max(this.ackTick, msg.ackTick)
        this.ackSeq = Math.max(this.ackSeq, msg.ackSeq)
        this.lastEcho = Math.max(this.lastEcho, msg.t)
        if (!this.active) break
        this.clock.onSnap(now, msg)
        this.predictor!.reconcile(msg.tick, msg.you)
        this.pushRemote(msg.tick, msg.players, msg.enemies)
        for (const p of msg.movingPickups) this.pushPickup(msg.tick, p)
        break
      case 'ev':
        for (const e of msg.list) this.applyEvent(e)
        if (!this.active) break
        for (const e of msg.list) {
          if (!concerns(e, this.id)) this.presentation.push([e])
          else if (!(PREDICTED.has(e.type) && 'id' in e && e.id === this.id)) this.own.push(e)
        }
        break
      case 'state':
        if (!this.sim) break
        this.applyWorld(msg.state)
        this.predictor!.reconcile(msg.tick, msg.you)
        this.clock.sync(now, msg.tick)
        this.awaitingState = false
        this.presentation.clear()
        this.players.clear()
        this.enemies.clear()
        this.pushRemote(msg.tick, msg.state.players, msg.state.enemies.list)
        break
      case 'join':
        this.names.set(msg.id, msg.name)
        // Ha vuelto enseguida: era un corte, no se avisa de nada.
        if (!this.leaving.delete(msg.id)) this.notices.push({ type: 'join', id: msg.id, name: msg.name })
        break
      case 'leave':
        this.leaving.set(msg.id, { notice: { type: 'leave', id: msg.id, name: msg.name }, at: now })
        break
      case 'chat':
        this.notices.push({ type: 'chat', id: msg.id, name: msg.name, text: msg.text })
        break
    }
  }

  /** Lo que tiene delante el jugador local con la orientación de `move`, contra el espejo (los enemigos como se ven). */
  private aim(move: MoveInput): TargetRef | null {
    const slot = this.predictor!.slot
    // `predictPlayer` le pone la misma orientación al moverlo.
    slot.player.yaw = move.yaw
    slot.player.pitch = move.pitch
    this.sim!.interaction.updateTarget(slot)
    const target = slot.target
    return target && { kind: target.kind === 'enemy' ? 'enemy' : 'prop', id: target.id }
  }

  private pushRemote(tick: number, players: readonly PlayerSnap[], enemies: readonly EnemySnap[]) {
    this.players.push(
      tick,
      players.map(({ id, pos, yaw, pitch, item, health, alive, connection, ping }) => ({
        id,
        pose: { ...pos, yaw, pitch },
        data: { item, health, alive, connection, ping },
      })),
    )
    this.enemies.push(
      tick,
      enemies.map(({ id, pos, yaw, hp }) => ({ id, pose: { x: pos.x, y: 0, z: pos.z, yaw, pitch: 0 }, data: { hp } })),
    )
  }

  /** Una posición de un objeto que se mueve. Si llevaba rato quieto, empieza a moverse desde el `snap` anterior, no desde entonces. */
  private pushPickup(tick: number, { id, pos, grounded }: PickupSnap) {
    const mirror = this.pickups.get(id)
    if (!mirror) return
    const last = mirror.samples.last
    if (last && last.tick < tick - SNAP_TICKS) mirror.samples.push(tick - SNAP_TICKS, last.pose, last.data)
    mirror.samples.push(tick, { ...pos, yaw: 0, pitch: 0 }, grounded)
  }

  /** Los enemigos del espejo, en el tick de render: los mismos objetos para el mismo id (el objetivo los compara). */
  private syncEnemies(sim: Simulation, shown: readonly Shown<RemoteEnemy>[]) {
    const { list } = sim.enemies
    list.length = 0
    for (const { id, pose, data } of shown) {
      let enemy = this.mirrorEnemies.get(id)
      if (!enemy) this.mirrorEnemies.set(id, (enemy = mirrorEnemy(id)))
      enemy.pos.x = enemy.prev.x = pose.x
      enemy.pos.z = enemy.prev.z = pose.z
      enemy.yaw = pose.yaw
      enemy.hp = data.hp
      list.push(enemy)
    }
    if (this.mirrorEnemies.size > list.length) {
      const seen = new Set(list.map((e) => e.id))
      for (const id of this.mirrorEnemies.keys()) if (!seen.has(id)) this.mirrorEnemies.delete(id)
    }
  }

  /** Los objetos del suelo del espejo, en el tick de render: sin los aún por llegar ni los ya recogidos. */
  private syncPickups(sim: Simulation, tick: number) {
    const { list } = sim.pickups
    list.length = 0
    for (const [id, mirror] of this.pickups) {
      if (mirror.goneAt !== null && tick >= mirror.goneAt) {
        this.pickups.delete(id)
        continue
      }
      const at = mirror.samples.at(tick, undefined, false)
      if (!at) continue
      const { pickup } = mirror
      pickup.pos.x = pickup.prev.x = at.pose.x
      pickup.pos.y = pickup.prev.y = at.pose.y
      pickup.pos.z = pickup.prev.z = at.pose.z
      pickup.grounded = at.data
      pickup.age = Math.max(0, (tick - mirror.spawnTick) * STEP)
      mirror.samples.trim(tick)
      list.push(pickup)
    }
  }

  /** La isla del espejo como dice un estado completo: props generados más los que difieren, estructuras, objetos y reloj. */
  private applyWorld(state: WorldState) {
    const sim = this.sim!
    for (const prop of sim.world.props) resetProp(prop)
    for (const { id, hp, alive, regrowLeft } of state.props) Object.assign(sim.world.props[id], { hp, alive, regrowLeft })
    sim.structures.load(state.structures)
    this.worldStartTick = state.worldStartTick
    this.pickups.clear()
    for (const p of state.pickups.list) {
      const samples = new InterpBuffer<boolean>()
      // Desde siempre: los quietos se dibujan ya, sin esperar a que el render llegue al tick del estado.
      samples.push(0, { ...p.pos, yaw: 0, pitch: 0 }, p.grounded)
      this.pickups.set(p.id, { pickup: mirrorPickup(p.id, p.item, p.amount, p.spin), samples, spawnTick: state.tick - Math.round(p.age / STEP), goneAt: null })
    }
    this.worldVersion++
  }

  /** La capa de estado de un evento: lo que cambia el espejo, al llegar. */
  private applyEvent(e: SimEvent) {
    const sim = this.sim
    if (!sim) return
    switch (e.type) {
      case 'propHit':
      case 'berryTaken':
      case 'berryGrew':
        sim.world.props[e.id].hp = e.hp
        break
      case 'propDestroyed':
        sim.world.props[e.id].alive = false
        break
      case 'structurePlaced':
        sim.structures.add({ id: e.id, kind: e.kind, x: e.x, y: e.y, z: e.z, rotY: e.rotY })
        break
      case 'pickupSpawn':
        this.pickups.set(e.id, { pickup: mirrorPickup(e.id, e.item, e.amount, spinOf(e.id)), samples: new InterpBuffer(), spawnTick: e.tick, goneAt: null })
        break
      case 'pickupCollected': {
        const mirror = this.pickups.get(e.id)
        if (mirror) mirror.goneAt = e.tick
        break
      }
      case 'clockSet':
        this.worldStartTick = e.worldStartTick
        break
      case 'worldReset':
        for (const prop of sim.world.props) resetProp(prop)
        sim.structures.clear()
        this.pickups.clear()
        this.worldStartTick = e.worldStartTick
        break
    }
  }
}

/** Un enemigo del espejo: solo se dibuja y se apunta, así que basta con su pose y su vida. */
function mirrorEnemy(id: number): EnemyData {
  const hp = ENEMY_DEF.hp
  return {
    kind: 'enemy',
    id,
    pos: { x: 0, z: 0 },
    prev: { x: 0, z: 0 },
    yaw: 0,
    hp,
    maxHp: hp,
    alive: true,
    attackCooldown: 0,
    stagger: 0,
    knock: { x: 0, z: 0 },
    target: null,
    retarget: 0,
  }
}

function mirrorPickup(id: number, item: ItemId, amount: number, spin: number): Pickup {
  return { id, item, amount, pos: { x: 0, y: 0, z: 0 }, prev: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, grounded: false, age: 0, spin, claimedBy: null }
}
