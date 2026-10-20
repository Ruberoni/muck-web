import type { Action, ActionData, Move } from '../sim/commands'
import { MAX_PITCH } from '../sim/constants'
import { RECIPES } from '../sim/crafting'
import type { PlayerId, SimEvent, TargetRef } from '../sim/events'
import type { Combat } from '../sim/interaction'
import { SLOT_COUNT, type InventoryState, type ItemId } from '../sim/inventory'
import type { Player, Vec3 } from '../sim/player'
import type { PropPlacement } from '../sim/props'
import type { Connection, SimState } from '../sim/Simulation'

/**
 * Versión del protocolo y de la simulación. Se sube a mano cuando cambia cualquiera de los dos: el servidor
 * rechaza un `hello` de otra versión y descarta una isla guardada con otra. CI falla si un PR toca src/sim,
 * este archivo, server/ o package-lock.json sin subirla (scripts/check-protocol-version.sh).
 */
export const PROTOCOL_VERSION = 1

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
}

export interface Resync {
  type: 'resync'
}

export type ClientMessage = Hello | Cmds | Resync

// --- Servidor → cliente ---

/** Tu estado completo al final de un tick: con él el cliente reconcilia su predicción. Sin redondear. */
export interface You {
  player: Player
  inventory: InventoryState
  combat: Combat
  hotbarFull: boolean
  alive: boolean
  appliedSeq: number
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
export interface WorldState extends Pick<SimState, 'tick' | 'worldStartTick' | 'props' | 'enemies' | 'pickups' | 'campfires'> {
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
  placements: PropPlacement[]
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
  you: You
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

export type ServerMessage = Welcome | Reject | Snap | Ev | StateMsg | Join | Leave

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
  return { type: 'cmds', t: raw.t, moves, actions }
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
    case 'craft':
      if (!isInt(a.recipe, 0, RECIPES.length - 1)) return null
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

/** Redondeo a cm (y a centésimas de radián) de lo que se manda de los demás. */
export const cm = (x: number) => Math.round(x * 100) / 100
