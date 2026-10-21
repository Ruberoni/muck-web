import type { ActionData } from '../sim/commands'
import type { PlayerId, SimEvent } from '../sim/events'
import type { PlayerSlot, Simulation } from '../sim/Simulation'
import type { Vec3 } from '../sim/player'
import { botMove, driveClient } from './bot'
import { NetClient, type ClientHello } from './client'
import { ROOM_ALPHABET, ROOM_CODE_LENGTH, type DevOp, type Reject } from './protocol'
import type { MoveInput, Session } from './session'
import { WebSocketTransport } from './transport'

/** El Worker (`wss://…`, sin ruta). En desarrollo, el de `npm run dev:server`. */
export const SERVER_URL: string = import.meta.env.VITE_SERVER_URL || (import.meta.env.DEV ? 'ws://localhost:8787' : '')

/** En pausa, un `ping` cada tanto para que la plataforma no cierre el socket (§5.2). */
const PING_MS = 30_000
/** Un truco de `__debug` se da por aplicado al volver el siguiente `snap`, o como mucho tras este tiempo. */
const DEV_TIMEOUT_MS = 3000
const BOT_FRAME_MS = 16

const randomId = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(12)))).replace(/\+/g, '-').replace(/\//g, '_')

/** Distinto en cada pestaña (no se guarda): separa una reconexión de una pestaña duplicada. */
const TAB = randomId()

export function randomRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ROOM_CODE_LENGTH))
  return [...bytes].map((b) => ROOM_ALPHABET[b % ROOM_ALPHABET.length]).join('')
}

// El token de cada sala, para recuperar el hueco al volver al enlace. Sin almacenamiento, se entra como nuevo.
const tokenKey = (room: string) => `muck-web:token:${room}`
function loadToken(room: string): string | undefined {
  try {
    return localStorage.getItem(tokenKey(room)) ?? undefined
  } catch {
    return undefined
  }
}
function saveToken(room: string, token: string) {
  try {
    localStorage.setItem(tokenKey(room), token)
  } catch {
    // Sin almacenamiento: la próxima vez entrará como un jugador nuevo.
  }
}

/** No se pudo entrar en la sala: rechazada (`reject`) o cerrada antes del `welcome`. */
export class NetError extends Error {
  constructor(
    message: string,
    readonly reject: Reject | null,
    readonly code: number | null,
  ) {
    super(message)
  }
}

/** Un NetClient conectado a la sala por WebSocket, ya con su `welcome`. */
async function connectClient(hello: ClientHello, url: string): Promise<{ client: NetClient; transport: WebSocketTransport }> {
  if (!url) throw new NetError('sin servidor (VITE_SERVER_URL)', null, null)
  const transport = new WebSocketTransport(new WebSocket(`${url}/room/${hello.room}`))
  const client = new NetClient(transport, { now: () => performance.now() }, hello)
  try {
    await transport.opened
  } catch (error) {
    throw new NetError(String(error), null, client.closeCode)
  }
  await new Promise<void>((resolve, reject) => {
    client.onchange = () => {
      if (client.state === 'online') resolve()
      else reject(new NetError(client.rejected ? `rechazada: ${client.rejected.reason}` : `cerrada (${client.closeCode})`, client.rejected, client.closeCode))
    }
    client.connect()
  })
  client.onchange = null
  return { client, transport }
}

/**
 * La partida en red para Game: envuelve un NetClient conectado por WebSocket. `sim` es el espejo del cliente y
 * `slot` el jugador predicho. A diferencia de LocalSession, el ritmo lo marca el reloj de red: cada frame
 * `advance()` dice cuántos ticks predecir con `step`, `flush()` envía y `render()` deja el espejo listo para dibujar.
 * En pausa (`suspend`) deja de predecir y de enviar, y manda un `ping` cada 30 s; al volver (`wake`) pide el estado.
 */
export class NetSession implements Session {
  readonly networked = true
  private pinger: ReturnType<typeof setInterval> | null = null
  private devWaits: { sentAt: number; until: number; resolve: () => void }[] = []

  private constructor(
    readonly client: NetClient,
    readonly transport: WebSocketTransport,
    readonly room: string,
  ) {}

  /** Entra en la sala `room` (o la crea) con el token guardado de una visita anterior, si lo hay. */
  static async open(intent: 'create' | 'join', room: string, name: string, url = SERVER_URL): Promise<NetSession> {
    const token = loadToken(room)
    const { client, transport } = await connectClient({ intent, room, name, tab: TAB, ...(token ? { token } : {}) }, url)
    saveToken(room, client.token!)
    return new NetSession(client, transport, room)
  }

  /** Crea una sala con un código nuevo (otro si ya existe). */
  static async create(name: string, url = SERVER_URL): Promise<NetSession> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await NetSession.open('create', randomRoomCode(), name, url)
      } catch (error) {
        if (!(error instanceof NetError && error.reject?.reason === 'exists') || attempt >= 4) throw error
      }
    }
  }

  get sim(): Simulation {
    return this.client.sim!
  }

  get me(): PlayerId {
    return this.client.id
  }

  get slot(): PlayerSlot {
    return this.client.predictor!.slot
  }

  /** Fracción del tick siguiente, para dibujar al jugador predicho entre dos ticks. */
  get alpha(): number {
    return this.client.clock.alpha
  }

  /** Corrección pendiente de la última reconciliación: se suma al dibujar al jugador local. */
  get offset(): Vec3 {
    return this.client.predictor!.offset
  }

  get closed(): boolean {
    return this.client.state === 'closed'
  }

  advance(): number {
    return this.client.advance()
  }

  step(move: MoveInput, actions: readonly ActionData[]): SimEvent[] {
    return this.client.step(move, actions)
  }

  flush() {
    this.client.flush()
  }

  render(): { own: SimEvent[]; remote: SimEvent[] } {
    const now = performance.now()
    const echo = this.client.lastEcho
    this.devWaits = this.devWaits.filter((wait) => {
      const done = echo > wait.sentAt || now >= wait.until || this.closed
      if (done) wait.resolve()
      return !done
    })
    return this.client.render()
  }

  /** La isla es del servidor: no se reinicia desde aquí (con todos muertos lo hará él, PR 14). */
  reset() {}

  suspend() {
    this.client.suspend()
    this.pinger ??= setInterval(() => this.client.ping(), PING_MS)
  }

  wake() {
    if (this.pinger !== null) clearInterval(this.pinger)
    this.pinger = null
    this.client.wake()
  }

  /**
   * Un truco de `__debug` en el servidor. Se cumple cuando vuelve el `snap` de un envío posterior: para entonces la
   * sala ya lo había aplicado y la predicción lo ha recogido (o al cabo de 3 s, si no se está enviando).
   */
  dev(op: DevOp): Promise<void> {
    const sentAt = performance.now()
    this.client.dev(op)
    return new Promise((resolve) => this.devWaits.push({ sentAt, until: sentAt + DEV_TIMEOUT_MS, resolve }))
  }

  close() {
    if (this.pinger !== null) clearInterval(this.pinger)
    this.pinger = null
    for (const wait of this.devWaits) wait.resolve()
    this.devWaits = []
    this.client.close()
  }
}

export interface Bot {
  readonly id: PlayerId
  readonly client: NetClient
  stop(): void
}

/** Otro jugador en la misma pestaña, sin pantalla, que anda en círculos (`__debug.net.addBot`): para probar sin otro navegador. */
export async function startBot(room: string, name: string, url = SERVER_URL): Promise<Bot> {
  const { client } = await connectClient({ intent: 'join', room, name, tab: randomId() }, url)
  const timer = setInterval(() => driveClient(client, (tick) => botMove(tick, client.id)), BOT_FRAME_MS)
  return {
    id: client.id,
    client,
    stop() {
      clearInterval(timer)
      client.close()
    },
  }
}
