import type { Clock } from '../../server/room'
import { campfireSpot } from '../sim/campfires'
import { CAMPFIRE_RADIUS } from '../sim/constants'
import type { ActionData, Move } from '../sim/commands'
import type { PlayerId, SimEvent, TargetRef } from '../sim/events'
import type { ItemId } from '../sim/inventory'
import { resetProp } from '../sim/props'
import type { Connection } from '../sim/Simulation'
import { Simulation } from '../sim/Simulation'
import { QUIET_SEND_MS, SEND_MS, TickClock } from './clock'
import { Interpolator, PresentationQueue } from './interp'
import { Predictor } from './predict'
import {
  MAX_ACTIONS,
  MAX_MOVE_REPEAT,
  MAX_MOVES,
  PROTOCOL_VERSION,
  type EnemySnap,
  type Hello,
  type MoveMsg,
  type PlayerSnap,
  type Reject,
  type ServerMessage,
  type WorldState,
} from './protocol'
import type { MoveInput } from './session'
import type { Transport } from './transport'

/** Con quién y cómo se entra en la sala (lo del `hello` que no es la versión ni el sello). */
export type ClientHello = Pick<Hello, 'intent' | 'room' | 'name' | 'token' | 'tab'>

export type ClientState = 'connecting' | 'online' | 'closed'

/** Lo que se dibuja de otro jugador además de su pose. */
export interface RemotePlayer {
  item: ItemId | null
  health: number
  alive: boolean
  connection: Connection
}

export interface RemoteEnemy {
  hp: number
}

/** Ticks entre el `Move` más viejo y el más nuevo de un envío normal a 20 Hz (con frames lentos, algo más). */
const MAX_SPAN = 6

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
 * El cliente en red sin DOM ni three: habla con la sala por un Transport, predice al jugador local, interpola a
 * los demás y a los enemigos y decide cuándo enviar. NetSession (PR 12) lo envuelve para Game.
 *
 * Cada frame: `advance()` dice cuántos ticks predecir, `step(move, actions)` predice cada uno y `flush()` envía
 * si toca: a 20 Hz mientras el jugador hace algo; a 4 Hz cuando está quieto (botones sueltos, sin girar ni
 * acciones pendientes) y ya ha enviado ese `Move` quieto, así el servidor repite justo ese; al volver a moverse,
 * en el acto. A los demás se les dibuja en `renderTick()`.
 *
 * `sim` es un espejo con la isla y el jugador local: los props y las fogatas se actualizan con los eventos en
 * cuanto llegan (la predicción choca con lo que hay de verdad); enemigos, objetos del suelo y el reloj del día
 * aún no (PR 12).
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

  constructor(
    private transport: Transport,
    private time: Clock,
    private hello: ClientHello,
  ) {
    transport.onmessage = (data) => this.receive(data)
    transport.onclose = (code) => {
      this.state = 'closed'
      this.closeCode = code
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
    if (!(this.quiet && !quiet) && now - this.lastSentAt < (quiet ? QUIET_SEND_MS : SEND_MS)) return
    // Los nuevos y los no confirmados; los que el reloj se saltó no (el servidor los rellena igual).
    const moves = compactMoves(predictor.history.filter((h) => !h.filled && h.move.tick > this.ackTick).map((h) => h.move)).slice(-MAX_MOVES)
    this.send({ type: 'cmds', t: now, moves, actions: actions.slice(0, MAX_ACTIONS) })
    // El margen solo dice algo del ritmo en los envíos normales: no en el primero tras estar quieto ni tras un tirón.
    const span = this.lastSent && !this.quiet ? newest.tick - this.lastSent.tick - 1 : null
    this.clock.sent(now, quiet || span === null || span > MAX_SPAN ? null : span)
    this.lastSentAt = now
    this.lastSent = newest
    this.quiet = quiet
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
    this.players.clear()
    this.enemies.clear()
    this.send({ type: 'resync' })
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
    const msg = JSON.parse(data) as ServerMessage
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
          canPlace: (p) => campfireSpot(p.pos, p.yaw, [sim.world.grid, sim.campfires.grid]).valid,
        })
        this.predictor.start(msg.serverTick, msg.you)
        this.clock.sync(now, msg.serverTick, msg)
        this.ackTick = msg.serverTick
        this.ackSeq = msg.you.appliedSeq
        for (const p of msg.state.players) this.names.set(p.id, p.name)
        this.pushRemote(msg.state.tick, msg.state.players, msg.state.enemies.list)
        this.state = 'online'
        break
      }
      case 'reject':
        this.rejected = msg
        break
      case 'snap':
        this.ackTick = Math.max(this.ackTick, msg.ackTick)
        this.ackSeq = Math.max(this.ackSeq, msg.ackSeq)
        if (!this.active) break
        this.clock.onSnap(now, msg)
        this.predictor!.reconcile(msg.tick, msg.you)
        this.pushRemote(msg.tick, msg.players, msg.enemies)
        break
      case 'ev':
        for (const e of msg.list) this.applyEvent(e)
        if (this.active) this.presentation.push(msg.list)
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
        break
      case 'leave':
        break
    }
  }

  private pushRemote(tick: number, players: readonly PlayerSnap[], enemies: readonly EnemySnap[]) {
    this.players.push(
      tick,
      players.map(({ id, pos, yaw, pitch, item, health, alive, connection }) => ({ id, pose: { ...pos, yaw, pitch }, data: { item, health, alive, connection } })),
    )
    this.enemies.push(
      tick,
      enemies.map(({ id, pos, yaw, hp }) => ({ id, pose: { x: pos.x, y: 0, z: pos.z, yaw, pitch: 0 }, data: { hp } })),
    )
  }

  /** La isla del espejo como dice un estado completo: props generados más los que difieren, y las fogatas. */
  private applyWorld(state: WorldState) {
    const sim = this.sim!
    for (const prop of sim.world.props) resetProp(prop)
    for (const { id, hp, alive, regrowLeft } of state.props) Object.assign(sim.world.props[id], { hp, alive, regrowLeft })
    sim.campfires.load(state.campfires)
  }

  /** La capa de estado de un evento: lo que cambia la isla del espejo, al llegar. */
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
      case 'campfirePlaced': {
        const { list, nextId } = sim.campfires.save()
        list.push({ id: e.id, x: e.x, y: e.y, z: e.z, rotY: e.rotY, radius: CAMPFIRE_RADIUS, alive: true })
        sim.campfires.load({ list, nextId: Math.max(nextId, e.id + 1) })
        break
      }
      case 'worldReset':
        for (const prop of sim.world.props) resetProp(prop)
        sim.campfires.clear()
        break
    }
  }
}
