import type { Action, ActionData, Move } from '../sim/commands'
import { MAX_PITCH } from '../sim/constants'
import { isRecipeId } from '../sim/crafting'
import type { PlayerId, SimEvent, TargetRef } from '../sim/events'
import type { Combat } from '../sim/interaction'
import { INVENTORY_SIZE, ITEM_NAMES, SLOT_COUNT, type InventoryState, type ItemId } from '../sim/inventory'
import type { Player, Vec3 } from '../sim/player'
import type { PropPlacement } from '../sim/props'
import { STRUCTURE_KINDS, type StructureKind } from '../sim/structures'
import type { Connection, SimState } from '../sim/Simulation'

/**
 * Versión del protocolo y de la simulación. Se sube a mano cuando cambia cualquiera de los dos: el servidor
 * rechaza un `hello` de otra versión y descarta una isla guardada con otra. CI falla si un PR toca src/sim,
 * este archivo, server/ o package-lock.json sin subirla (scripts/check-protocol-version.sh).
 */
export const PROTOCOL_VERSION = 15

/** Códigos de sala: 5 caracteres sin los que se confunden (0/O, 1/I/L). */
export const ROOM_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
export const ROOM_CODE_LENGTH = 5
const ROOM_CODE = new RegExp(`^[${ROOM_ALPHABET}]{${ROOM_CODE_LENGTH}}$`)
export const isRoomCode = (code: unknown): code is string => typeof code === 'string' && ROOM_CODE.test(code)

/** Jugadores en el mundo (no `gone`) a la vez. */
export const MAX_PLAYERS = 8
/** Huecos que guarda una isla (con los `gone`): con más se descarta el `gone` más antiguo. */
export const MAX_SEATS = 16
/** Tamaño máximo de un mensaje del cliente, medido con `string.length` (cota superior en UTF-16). */
export const MAX_MESSAGE = 4096
export const MAX_NAME = 16
/** `Move` por `cmds`: los nuevos más los no confirmados. */
export const MAX_MOVES = 10
/** Un `Move` compactado se repite como mucho estos ticks (2 s). */
export const MAX_MOVE_REPEAT = 120
export const MAX_ACTIONS = 32
/** RTT máximo que se acepta en `cmds` (ms). */
export const MAX_RTT = 60_000
/** Caracteres de un mensaje de chat. */
export const MAX_CHAT = 120
const MAX_TOKEN = 64

/** Códigos de cierre del WebSocket. */
export const CloseCode = {
  Normal: 1000,
  /** El cliente es de otra versión (ver `reject.v`). */
  Version: 4000,
  /** La partida se ha abierto en otra pestaña con el mismo token: esta no se reconecta. */
  OtherTab: 4001,
  RoomDeleted: 4002,
  RoomFull: 4003,
  /** Se ha agotado la cuota gratuita del servidor. */
  Quota: 4004,
  /** Mensaje inválido o demasiados mensajes. */
  Invalid: 4005,
} as const

/** Texto plano que mandan los clientes en pausa para que no se cierre el socket (§5.2). */
export const PING = 'ping'
export const PONG = 'pong'

// --- Cliente → servidor ---

export interface Hello {
  type: 'hello'
  v: number
  /** Sello de tiempo del cliente (ms): vuelve en `welcome` para medir el RTT. */
  t: number
  intent: 'create' | 'join'
  room: string
  name: string
  /** El de una visita anterior a esta sala: recupera el hueco. */
  token?: string
  /** Distinto en cada pestaña: separa una reconexión de una pestaña duplicada. */
  tab: string
}

/** Un `Move` que se repite igual durante `n` ticks (por defecto 1), para compactar los ratos quieto. */
export type MoveMsg = Move & { n?: number }

export interface Cmds {
  type: 'cmds'
  t: number
  moves: MoveMsg[]
  actions: Action[]
  /** El RTT que mide el cliente (ms, redondeado): la sala lo reparte para la lista de jugadores. */
  rtt?: number
}

export interface Resync {
  type: 'resync'
}

/** Un mensaje de chat: la sala lo reparte a todos (también a quien lo manda) como `chat`. */
export interface Say {
  type: 'say'
  text: string
}

/**
 * Los trucos de `__debug` en red (solo en desarrollo: la sala de producción cierra el socket con 4005).
 * Se aplican al llegar, fuera del bucle; lo que emiten sale en el siguiente `ev`.
 */
export type DevOp =
  | { op: 'give'; item: ItemId; amount: number }
  | { op: 'teleport'; x: number; z: number; yaw: number; pitch: number }
  | { op: 'setVitals'; health?: number; hunger?: number }
  | { op: 'spawnEnemy'; x: number; z: number }
  /** Delante de (x, z) mirando a `yaw`; sin (x, z), desde donde está el jugador, y sin `yaw`, hacia donde mira. */
  | { op: 'placeStructure'; kind: StructureKind; x?: number; z?: number; yaw?: number }
  | { op: 'setPhase'; phase: number }

export type Dev = { type: 'dev' } & DevOp

export type ClientMessage = Hello | Cmds | Resync | Say | Dev

// --- Servidor → cliente ---

/** Tu estado completo al final de un tick: con él el cliente reconcilia su predicción. Sin redondear. */
export interface You {
  player: Player
  inventory: InventoryState
  combat: Combat
  inventoryFull: boolean
  alive: boolean
  /** Muerto: tick en que reaparece (ver `Simulation`). */
  respawnAt: number | null
  appliedSeq: number
}

/** El jugador sin la orientación ni `prev`: lo que reconcilia la predicción (la orientación la decide el ratón). */
export type PlayerState = Omit<Player, 'yaw' | 'pitch' | 'prev'>

/** `you` de un `snap`, ya leído: sin la orientación ni `prev` del jugador. */
export interface SnapYou extends Omit<You, 'player'> {
  player: PlayerState
}

/** Otro jugador, como se ve desde fuera (sin inventario). Posiciones en cm. */
export interface PlayerSnap {
  id: PlayerId
  pos: Vec3
  yaw: number
  pitch: number
  item: ItemId | null
  health: number
  alive: boolean
  connection: Connection
  /** El último RTT que contó (ms); 0 si aún no ha dicho ninguno. */
  ping: number
}

export interface EnemySnap {
  id: number
  pos: { x: number; z: number }
  yaw: number
  hp: number
}

/** Un objeto del suelo que se ha movido desde el último `snap` (cayendo o atraído por el imán). */
export interface PickupSnap {
  id: number
  pos: Vec3
  grounded: boolean
}

/** El mundo entero, sin el azar ni los inventarios de los demás: lo que necesita un cliente para empezar. */
export interface WorldState extends Pick<SimState, 'tick' | 'worldStartTick' | 'props' | 'enemies' | 'pickups' | 'structures'> {
  /** Los demás jugadores en el mundo. */
  players: (PlayerSnap & { name: string })[]
}

export interface Welcome {
  type: 'welcome'
  id: PlayerId
  token: string
  /** El `t` del `hello` y los ms que el servidor lo retuvo. */
  t: number
  held: number
  serverTick: number
  worldStartTick: number
  /** Las colocaciones de la isla: así los ids coinciden aunque el motor del cliente difiera en los últimos bits. */
  placements: readonly PropPlacement[]
  state: WorldState
  you: You
  /** La isla guardada era de otra versión y se ha empezado una nueva con el mismo código. */
  islandReset?: true
}

export type RejectReason = 'version' | 'full' | 'not-found' | 'exists' | 'invalid'

export interface Reject {
  type: 'reject'
  reason: RejectReason
  /** Con `version`: la del servidor, para saber si recargar (es más nueva) o esperar (es más antigua). */
  v?: number
}

export interface Snap {
  type: 'snap'
  tick: number
  /** El `t` del último `cmds` y los ms que pasaron desde que llegó hasta este envío. */
  t: number
  held: number
  /** Último tick de `Move` y última `seq` de `Action` recibidos: se pueden dejar de reenviar. */
  ackTick: number
  ackSeq: number
  /** Ticks de margen que tenía el último `Move` al llegar (negativo: llegó tarde). */
  slack: number
  you: SnapYou
  players: PlayerSnap[]
  enemies: EnemySnap[]
  movingPickups: PickupSnap[]
}

/** Eventos de la simulación, fiables y en orden. En cada vuelta del bucle van antes que el `snap`. */
export interface Ev {
  type: 'ev'
  list: SimEvent[]
}

/** Estado completo: respuesta a `resync` y al reanudar el bucle tras pararlo. */
export interface StateMsg {
  type: 'state'
  tick: number
  worldStartTick: number
  state: WorldState
  you: You
}

export interface Join {
  type: 'join'
  id: PlayerId
  name: string
}

export interface Leave {
  type: 'leave'
  id: PlayerId
  name: string
}

export interface Chat {
  type: 'chat'
  id: PlayerId
  name: string
  text: string
}

/** Los mensajes del servidor ya leídos (un `snap` llega en `SnapWire` y lo lee `ServerDecoder`). */
export type ServerMessage = Welcome | Reject | Snap | Ev | StateMsg | Join | Leave | Chat

// --- `snap` en el cable ---

/**
 * El `snap` tal como viaja, 20 veces por segundo a cada jugador: los demás, los enemigos y los objetos que se mueven
 * en tuplas en vez de objetos con claves, y `you` sin la orientación ni `prev` y sin el inventario si no ha cambiado
 * desde el último que se le mandó (en `welcome`, `state` o un `snap`; el socket es fiable y ordenado).
 */
export interface SnapWire extends Omit<Snap, 'you' | 'players' | 'enemies' | 'movingPickups'> {
  you: Omit<SnapYou, 'inventory'> & { inventory?: InventoryState }
  players: PlayerTuple[]
  enemies: EnemyTuple[]
  movingPickups: PickupTuple[]
}

/** `[id, x, y, z, yaw, pitch, item, health, vivo (1/0), ausente (1/0), ping]`: solo van los que están en el mundo. */
export type PlayerTuple = [PlayerId, number, number, number, number, number, ItemId | null, number, 0 | 1, 0 | 1, number]
/** `[id, x, z, yaw, hp]` */
export type EnemyTuple = [number, number, number, number, number]
/** `[id, x, y, z, en el suelo (1/0)]` */
export type PickupTuple = [number, number, number, number, 0 | 1]

export const playerTuple = (p: PlayerSnap): PlayerTuple => [
  p.id,
  p.pos.x,
  p.pos.y,
  p.pos.z,
  p.yaw,
  p.pitch,
  p.item,
  p.health,
  p.alive ? 1 : 0,
  p.connection === 'absent' ? 1 : 0,
  p.ping,
]
export const enemyTuple = (e: EnemySnap): EnemyTuple => [e.id, e.pos.x, e.pos.z, e.yaw, e.hp]
export const pickupTuple = (p: PickupSnap): PickupTuple => [p.id, p.pos.x, p.pos.y, p.pos.z, p.grounded ? 1 : 0]

/**
 * Lee lo que llega del servidor por un socket. Recuerda el último inventario propio que le llegó, para los `snap`
 * que no lo traen: hay que pasarle todos los mensajes, en orden, también los que luego se ignoran.
 */
export class ServerDecoder {
  private inventory: InventoryState | null = null

  decode(data: string): ServerMessage {
    const msg = JSON.parse(data) as Exclude<ServerMessage, Snap> | SnapWire
    switch (msg.type) {
      case 'welcome':
      case 'state':
        this.inventory = msg.you.inventory
        return msg
      case 'snap': {
        const inventory = msg.you.inventory ?? this.inventory
        if (!inventory) throw new Error('snap sin inventario antes de welcome')
        this.inventory = inventory
        return {
          ...msg,
          you: { ...msg.you, inventory },
          players: msg.players.map(([id, x, y, z, yaw, pitch, item, health, alive, absent, ping]) => ({
            id,
            pos: { x, y, z },
            yaw,
            pitch,
            item,
            health,
            alive: alive === 1,
            connection: absent === 1 ? 'absent' : 'present',
            ping,
          })),
          enemies: msg.enemies.map(([id, x, z, yaw, hp]) => ({ id, pos: { x, z }, yaw, hp })),
          movingPickups: msg.movingPickups.map(([id, x, y, z, grounded]) => ({ id, pos: { x, y, z }, grounded: grounded === 1 })),
        }
      }
      default:
        return msg
    }
  }
}

// --- Validación ---

export type Parsed = { ok: true; msg: ClientMessage } | { ok: false; /** Un `hello` de otra versión. */ version?: number }

const INVALID: Parsed = { ok: false }

type Obj = Record<string, unknown>
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x)
const isFiniteNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const isInt = (x: unknown, min: number, max: number): x is number => Number.isInteger(x) && (x as number) >= min && (x as number) <= max
const isId = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= MAX_TOKEN && /^[\w-]+$/.test(x)
// Sin caracteres de control (C0, DEL y C1).
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/

/** Nombre limpio, o null si no vale: hasta MAX_NAME caracteres sin caracteres de control. */
export function cleanName(name: unknown): string | null {
  if (typeof name !== 'string' || CONTROL.test(name)) return null
  const trimmed = name.trim()
  return trimmed.length <= MAX_NAME ? trimmed : null
}

/** Texto de chat limpio, o null si no vale: de 1 a MAX_CHAT caracteres sin caracteres de control. */
export function cleanChat(text: unknown): string | null {
  if (typeof text !== 'string' || CONTROL.test(text)) return null
  const trimmed = text.trim()
  return trimmed.length > 0 && trimmed.length <= MAX_CHAT ? trimmed : null
}

/**
 * Un mensaje del cliente, validado: tipos y tamaños, números finitos, pitch dentro de MAX_PITCH, casilla y receta
 * en rango. Devuelve objetos nuevos con solo los campos conocidos. La ventana de ticks la comprueba la sala.
 */
export function parseClientMessage(data: string): Parsed {
  if (data.length > MAX_MESSAGE) return INVALID
  let raw: unknown
  try {
    raw = JSON.parse(data)
  } catch {
    return INVALID
  }
  if (!isObj(raw)) return INVALID
  switch (raw.type) {
    case 'hello':
      return parseHello(raw)
    case 'cmds': {
      const msg = parseCmds(raw)
      return msg ? { ok: true, msg } : INVALID
    }
    case 'resync':
      return { ok: true, msg: { type: 'resync' } }
    case 'say': {
      const text = cleanChat(raw.text)
      return text ? { ok: true, msg: { type: 'say', text } } : INVALID
    }
    case 'dev': {
      const msg = parseDev(raw)
      return msg ? { ok: true, msg } : INVALID
    }
    default:
      return INVALID
  }
}

function parseHello(raw: Obj): Parsed {
  // La versión va primero: un cliente de otra versión puede mandar un `hello` con otra forma.
  if (!Number.isInteger(raw.v)) return INVALID
  if (raw.v !== PROTOCOL_VERSION) return { ok: false, version: raw.v as number }
  const name = cleanName(raw.name)
  if (!isFiniteNum(raw.t) || (raw.intent !== 'create' && raw.intent !== 'join') || !isRoomCode(raw.room)) return INVALID
  if (name === null || !isId(raw.tab) || (raw.token !== undefined && !isId(raw.token))) return INVALID
  const hello: Hello = { type: 'hello', v: raw.v, t: raw.t, intent: raw.intent, room: raw.room, name, tab: raw.tab }
  if (raw.token !== undefined) hello.token = raw.token
  return { ok: true, msg: hello }
}

function parseCmds(raw: Obj): Cmds | null {
  if (!isFiniteNum(raw.t) || !Array.isArray(raw.moves) || !Array.isArray(raw.actions)) return null
  if (raw.moves.length > MAX_MOVES || raw.actions.length > MAX_ACTIONS) return null
  const moves: MoveMsg[] = []
  for (const m of raw.moves) {
    const move = parseMove(m)
    if (!move) return null
    moves.push(move)
  }
  const actions: Action[] = []
  for (const a of raw.actions) {
    const action = parseAction(a)
    if (!action) return null
    actions.push(action)
  }
  if (raw.rtt !== undefined && !isInt(raw.rtt, 0, MAX_RTT)) return null
  const cmds: Cmds = { type: 'cmds', t: raw.t, moves, actions }
  if (raw.rtt !== undefined) cmds.rtt = raw.rtt
  return cmds
}

function parseMove(m: unknown): MoveMsg | null {
  if (!isObj(m) || !isInt(m.tick, 0, Number.MAX_SAFE_INTEGER) || !isInt(m.buttons, 0, 127)) return null
  if (!isFiniteNum(m.yaw) || !isFiniteNum(m.pitch) || Math.abs(m.pitch) > MAX_PITCH + 1e-9) return null
  if (m.n !== undefined && !isInt(m.n, 1, MAX_MOVE_REPEAT)) return null
  const move: MoveMsg = { tick: m.tick, buttons: m.buttons, yaw: m.yaw, pitch: m.pitch }
  if (m.n !== undefined) move.n = m.n
  if (m.aim !== undefined) {
    const aim = parseTarget(m.aim)
    if (aim === undefined) return null
    move.aim = aim
  }
  return move
}

/** null es "nada delante"; undefined, inválido. */
function parseTarget(t: unknown): TargetRef | null | undefined {
  if (t === null) return null
  if (!isObj(t) || (t.kind !== 'prop' && t.kind !== 'enemy') || !isInt(t.id, 0, Number.MAX_SAFE_INTEGER)) return undefined
  return { kind: t.kind, id: t.id }
}

function parseAction(a: unknown): Action | null {
  if (!isObj(a) || !isInt(a.seq, 1, Number.MAX_SAFE_INTEGER) || !isInt(a.tick, 0, Number.MAX_SAFE_INTEGER)) return null
  let data: ActionData
  switch (a.kind) {
    case 'select':
      if (!isInt(a.slot, 0, SLOT_COUNT - 1)) return null
      data = { kind: 'select', slot: a.slot }
      break
    case 'move':
      if (!isInt(a.from, 0, INVENTORY_SIZE - 1) || !isInt(a.to, 0, INVENTORY_SIZE - 1)) return null
      data = { kind: 'move', from: a.from, to: a.to }
      break
    case 'craft':
      if (!isRecipeId(a.recipe)) return null
      data = { kind: 'craft', recipe: a.recipe }
      break
    case 'swing':
    case 'eat':
    case 'place':
      data = { kind: a.kind }
      break
    default:
      return null
  }
  return { ...data, seq: a.seq, tick: a.tick }
}

const ITEMS = Object.keys(ITEM_NAMES) as ItemId[]
const MAX_GIVE = 999
/** Vida y hambre de `setVitals`: de sobra para cualquier máximo. */
const MAX_VITAL = 1000

function parseDev(raw: Obj): Dev | null {
  const nums = (...keys: string[]) => keys.every((k) => isFiniteNum(raw[k]))
  switch (raw.op) {
    case 'give':
      if (!ITEMS.includes(raw.item as ItemId) || !isInt(raw.amount, 1, MAX_GIVE)) return null
      return { type: 'dev', op: 'give', item: raw.item as ItemId, amount: raw.amount }
    case 'teleport':
      if (!nums('x', 'z', 'yaw', 'pitch') || Math.abs(raw.pitch as number) > MAX_PITCH + 1e-9) return null
      return { type: 'dev', op: 'teleport', x: raw.x as number, z: raw.z as number, yaw: raw.yaw as number, pitch: raw.pitch as number }
    case 'setVitals': {
      const vital = (x: unknown) => x === undefined || (isFiniteNum(x) && x >= 0 && x <= MAX_VITAL)
      if (!vital(raw.health) || !vital(raw.hunger)) return null
      const dev: Dev = { type: 'dev', op: 'setVitals' }
      if (raw.health !== undefined) dev.health = raw.health as number
      if (raw.hunger !== undefined) dev.hunger = raw.hunger as number
      return dev
    }
    case 'spawnEnemy':
      return nums('x', 'z') ? { type: 'dev', op: 'spawnEnemy', x: raw.x as number, z: raw.z as number } : null
    case 'placeStructure': {
      const optional = (x: unknown) => x === undefined || isFiniteNum(x)
      // x y z van juntas: o las dos o ninguna.
      if (!STRUCTURE_KINDS.includes(raw.kind as StructureKind) || (raw.x === undefined) !== (raw.z === undefined)) return null
      if (!optional(raw.x) || !optional(raw.z) || !optional(raw.yaw)) return null
      const dev: Dev = { type: 'dev', op: 'placeStructure', kind: raw.kind as StructureKind }
      if (raw.x !== undefined) Object.assign(dev, { x: raw.x, z: raw.z })
      if (raw.yaw !== undefined) dev.yaw = raw.yaw as number
      return dev
    }
    case 'setPhase':
      return nums('phase') ? { type: 'dev', op: 'setPhase', phase: raw.phase as number } : null
    default:
      return null
  }
}

/** Redondeo a cm (y a centésimas de radián) de lo que se manda de los demás. */
export const cm = (x: number) => Math.round(x * 100) / 100
