import type { ActionData } from '../sim/commands'
import type { PlayerId, SimEvent } from '../sim/events'
import type { PlayerSlot, Simulation } from '../sim/Simulation'
import type { Vec3 } from '../sim/player'
import { botMove, driveClient } from './bot'
import { NetClient, type ClientHello } from './client'
import { cleanName, CloseCode, ROOM_ALPHABET, ROOM_CODE_LENGTH, type DevOp, type Reject } from './protocol'
import { onVersionReject, reloadFor, versionAccepted } from './reload'
import type { MoveInput, Session } from './session'
import { explainClose, NEW_VERSION, OLD_SERVER_RETRY_MS, RECONNECT_FOR_MS, reconnectDelay, SERVER_UPDATING, shouldReconnect } from './status'
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

/** `reconnecting`: se ha cortado y se está volviendo a entrar con el mismo token; `lost`: no hay vuelta atrás. */
export type NetStatus = 'online' | 'reconnecting' | 'lost'

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

/** Por qué no se pudo entrar en `room`, para mostrarlo en el lobby. */
export function failureMessage(error: unknown, room: string, url = SERVER_URL): Promise<string> {
  if (!url) return Promise.resolve('Este build no tiene servidor de multijugador.')
  if (error instanceof NetError) return explainClose(error.reject, error.code, room, url)
  return Promise.resolve(String(error))
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
 *
 * Si se corta (`reconnecting`), vuelve a entrar con el mismo token y la misma pestaña, con esperas crecientes durante
 * un minuto: el NetClient nuevo sustituye al viejo y `generation` sube (Game rehace la vista). En pausa espera a
 * `wake` para reintentar. Si al volver la sala es de otra versión, recarga la página (servidor más nuevo) o espera a
 * que se actualice (más viejo), ver `versionAction`. Si la sala lo rechaza o el corte no tiene arreglo (otra
 * pestaña…), `lost`.
 */
export class NetSession implements Session {
  readonly networked = true
  status: NetStatus = 'online'
  /** Por qué se cortó la conexión, para el HUD (al perderla; tras preguntar a `/status` si hace falta). */
  closeReason: string | null = null
  /** Sube cada vez que un NetClient nuevo sustituye al anterior (al reconectar). */
  generation = 0
  /** Reconectando, si se espera algo más que la red (una versión nueva, que se actualice el servidor): para el HUD. */
  waitReason: string | null = null
  private pinger: ReturnType<typeof setInterval> | null = null
  private devWaits: { sentAt: number; until: number; resolve: () => void }[] = []
  private suspended = false
  private leaving = false
  private attempt = 0
  private reconnectSince = 0
  private retry: ReturnType<typeof setTimeout> | null = null
  /** Desde cuándo (Date.now()) el servidor es más viejo que el cliente al reconectar. */
  private oldServerSince: number | null = null
  private cancelReload: (() => void) | null = null
  /** Un intento de volver a entrar en marcha: `wake` no lanza otro en paralelo. */
  private connecting = false

  private constructor(
    public client: NetClient,
    public transport: WebSocketTransport,
    readonly room: string,
    /** El nombre propio (como lo guarda la sala). */
    readonly name: string,
    private url: string,
  ) {
    this.watch(client)
  }

  /** Entra en la sala `room` (o la crea) con el token guardado de una visita anterior, si lo hay. */
  static async open(intent: 'create' | 'join', room: string, name: string, url = SERVER_URL): Promise<NetSession> {
    const token = loadToken(room)
    const clean = cleanName(name) ?? ''
    const { client, transport } = await connectClient({ intent, room, name: clean, tab: TAB, ...(token ? { token } : {}) }, url)
    saveToken(room, client.token!)
    versionAccepted()
    return new NetSession(client, transport, room, clean, url)
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

  /** Conexión perdida sin vuelta atrás. */
  get closed(): boolean {
    return this.status === 'lost'
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
      const done = echo > wait.sentAt || now >= wait.until || this.status !== 'online'
      if (done) wait.resolve()
      return !done
    })
    return this.client.render()
  }

  /** La isla es del servidor: no se reinicia desde aquí (con todos muertos lo hace él). */
  reset() {}

  suspend() {
    this.suspended = true
    this.client.suspend()
    this.pinger ??= setInterval(() => this.client.ping(), PING_MS)
  }

  wake() {
    this.suspended = false
    if (this.pinger !== null) clearInterval(this.pinger)
    this.pinger = null
    this.client.wake()
    // Con una recarga por versión pendiente no se reintenta: el mismo cliente volvería a ser rechazado.
    if (this.status === 'reconnecting' && this.retry === null && !this.connecting && this.cancelReload === null) this.startReconnecting()
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
    this.leaving = true
    if (this.pinger !== null) clearInterval(this.pinger)
    if (this.retry !== null) clearTimeout(this.retry)
    this.pinger = this.retry = null
    this.cancelReload?.()
    this.cancelReload = null
    for (const wait of this.devWaits) wait.resolve()
    this.devWaits = []
    this.client.close()
  }

  private watch(client: NetClient) {
    client.onchange = () => {
      if (client !== this.client || client.state !== 'closed' || this.leaving) return
      if (!shouldReconnect(client.rejected, client.closeCode)) return this.lose(client.rejected, client.closeCode)
      this.status = 'reconnecting'
      // En pausa (o con la pestaña olvidada) no hace falta volver ya: al reanudar.
      if (!this.suspended) this.startReconnecting()
    }
  }

  private startReconnecting() {
    this.attempt = 0
    this.reconnectSince = performance.now()
    this.scheduleRetry()
  }

  private scheduleRetry() {
    this.retry = setTimeout(() => {
      this.retry = null
      void this.reconnect()
    }, reconnectDelay(this.attempt++))
  }

  private async reconnect() {
    if (this.leaving || this.status !== 'reconnecting') return
    const { room, name, url } = this
    const token = this.client.token
    this.connecting = true
    try {
      const { client, transport } = await connectClient({ intent: 'join', room, name, tab: TAB, ...(token ? { token } : {}) }, url)
      if (this.leaving) return client.close()
      this.adopt(client, transport)
    } catch (error) {
      if (this.leaving) return
      const reject = error instanceof NetError ? error.reject : null
      const code = error instanceof NetError ? error.code : null
      if (reject?.reason === 'version') return this.onVersion(reject)
      if (shouldReconnect(reject, code) && performance.now() - this.reconnectSince < RECONNECT_FOR_MS) this.scheduleRetry()
      else this.lose(reject, code)
    } finally {
      this.connecting = false
    }
  }

  /** Al volver a entrar, la sala es de otra versión: recargar, esperar a que se actualice o darlo por perdido. */
  private onVersion(reject: Reject) {
    const action = onVersionReject(reject.v, this.oldServerSince)
    switch (action) {
      case 'reload':
      case 'reload-later':
        this.waitReason = NEW_VERSION
        this.cancelReload?.()
        this.cancelReload = reloadFor(reject.v!, action === 'reload-later')
        return
      case 'retry':
        this.oldServerSince ??= Date.now()
        this.waitReason = SERVER_UPDATING
        // El servidor contesta: el minuto de reintentos por cortes cuenta desde ahora.
        this.reconnectSince = performance.now()
        if (this.retry !== null) clearTimeout(this.retry)
        this.retry = setTimeout(() => {
          this.retry = null
          void this.reconnect()
        }, OLD_SERVER_RETRY_MS)
        return
      case 'lost':
        return this.lose(reject, CloseCode.Version)
    }
  }

  /** Un NetClient nuevo, ya dentro de la sala, sustituye al cortado. */
  private adopt(client: NetClient, transport: WebSocketTransport) {
    saveToken(this.room, client.token!)
    versionAccepted()
    this.oldServerSince = null
    this.waitReason = null
    transport.latency = this.transport.latency
    transport.jitter = this.transport.jitter
    for (const wait of this.devWaits) wait.resolve()
    this.devWaits = []
    this.client = client
    this.transport = transport
    this.status = 'online'
    this.generation++
    this.watch(client)
    if (this.suspended) client.suspend()
  }

  private lose(reject: Reject | null, code: number | null) {
    this.status = 'lost'
    this.waitReason = null
    this.closeReason = 'Sin conexión con el servidor.'
    explainClose(reject, code, this.room, this.url).then((reason) => (this.closeReason = reason))
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
