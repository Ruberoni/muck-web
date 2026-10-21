import { DurableObject } from 'cloudflare:workers'
import { CloseCode, isRoomCode, PING, PONG, PROTOCOL_VERSION } from '../src/net/protocol'
import { Room, type Conn, type Scheduler, type Storage, type TimerId } from './room'

/**
 * El servidor en Cloudflare: un Worker que recibe `GET /room/:code` y pasa el WebSocket a la Durable Object de esa
 * sala (`getByName(code)`), que es la que ejecuta la `Room`. Toda la lógica está en room.ts; aquí solo se traduce la
 * plataforma: Hibernation API, el blob en una fila de SQLite y la alarma de mantenimiento.
 */

export interface Env {
  ROOMS: DurableObjectNamespace<RoomObject>
  /** "1" en `npm run dev:server`: acepta también localhost y las IP privadas de `vite --host`. */
  ALLOW_LOCAL?: string
}

const ORIGINS = ['https://ruberoni.github.io']
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/

/** `Origin` no es autenticación (las salas son privadas por código): solo evita que otras webs usen el servidor. */
export function allowedOrigin(origin: string | null, allowLocal: boolean): boolean {
  if (!origin) return false
  return ORIGINS.includes(origin) || (allowLocal && LOCAL_ORIGIN.test(origin))
}

const CORS = { 'Access-Control-Allow-Origin': '*' }

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)
    // Para que el cliente distinga "cuota agotada" de "red caída" cuando el socket se cierra con 1006 (§5.3).
    if (url.pathname === '/status') return Response.json({ ok: true, v: PROTOCOL_VERSION }, { headers: CORS })

    const code = /^\/room\/([^/]+)$/.exec(url.pathname)?.[1]
    if (!code || !isRoomCode(code)) return new Response('Not found', { status: 404 })
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected WebSocket', { status: 426 })
    if (!allowedOrigin(request.headers.get('Origin'), env.ALLOW_LOCAL === '1')) return new Response('Forbidden', { status: 403 })

    try {
      return await env.ROOMS.getByName(code).fetch(request)
    } catch (error) {
      // El navegador no ve el estado HTTP de un upgrade fallido (solo 1006): se acepta el socket y se cierra con un código.
      const quota = /limit|quota|exceeded/i.test(String(error))
      return closedSocket(quota ? CloseCode.Quota : 1011, quota ? 'cuota agotada' : 'error del servidor')
    }
  },
} satisfies ExportedHandler<Env>

function closedSocket(code: number, reason: string): Response {
  const [client, server] = Object.values(new WebSocketPair())
  server.accept()
  server.close(code, reason)
  return new Response(null, { status: 101, webSocket: client })
}

/** Lo que cada socket guarda en sí mismo (`serializeAttachment`) para sobrevivir a la hibernación. */
interface Attachment {
  code: string
  /** Tras el `welcome`: su hueco. */
  token?: string
  tab?: string
}

/** La isla es una sola fila: el código de la sala y el blob de room.ts. La tabla se crea al guardar la primera vez. */
function savedIsland(sql: SqlStorage): { code: string; blob: string } | undefined {
  if (!sql.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'island'").toArray().length) return undefined
  return sql.exec<{ code: string; blob: string }>('SELECT code, blob FROM island').toArray()[0]
}

function saveIsland(sql: SqlStorage, code: string, blob: string) {
  sql.exec('CREATE TABLE IF NOT EXISTS island (id INTEGER PRIMARY KEY CHECK (id = 1), code TEXT NOT NULL, blob TEXT NOT NULL)')
  sql.exec('INSERT OR REPLACE INTO island (id, code, blob) VALUES (1, ?, ?)', code, blob)
}

/** Una sala. Se crea de nuevo tras hibernar, ser expulsada o redesplegar: el constructor la restaura. */
export class RoomObject extends DurableObject<Env> {
  private room: Room | null = null
  private conns = new Map<WebSocket, Conn>()
  private scheduler: AlarmScheduler

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    // Los clientes en pausa mandan `ping` cada 30 s: se contesta sin despertar a la DO (§5.2).
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG))
    this.scheduler = new AlarmScheduler(ctx.storage)

    // La isla vuelve del blob (con todos `gone`) y cada socket que siga abierto vuelve a su hueco, como ausente.
    const sockets = ctx.getWebSockets()
    const code = savedIsland(ctx.storage.sql)?.code ?? sockets.map((ws) => attachment(ws)?.code).find(isRoomCode)
    if (!code) return
    const room = this.roomFor(code)
    for (const ws of sockets) {
      const { token, tab } = attachment(ws) ?? {}
      // Sin token aún no había mandado `hello`: lo mandará y entrará como cualquiera.
      if (token === undefined) continue
      if (!room.adopt(this.conn(ws), token, tab ?? '')) this.conn(ws).close(CloseCode.RoomDeleted, 'sala borrada')
    }
  }

  async fetch(request: Request): Promise<Response> {
    const code = new URL(request.url).pathname.split('/').pop() ?? ''
    if (!isRoomCode(code)) return new Response('Not found', { status: 404 })
    this.roomFor(code)
    const [client, server] = Object.values(new WebSocketPair())
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({ code } satisfies Attachment)
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const conn = this.conn(ws)
    if (typeof message !== 'string') return conn.close(CloseCode.Invalid, 'solo texto')
    this.roomOf(ws)?.message(conn, message)
  }

  async webSocketClose(ws: WebSocket) {
    this.dropped(ws)
    // Completa el cierre si el runtime no lo ha hecho ya.
    try {
      ws.close(1000)
    } catch {
      // Ya cerrado.
    }
  }

  async webSocketError(ws: WebSocket) {
    this.dropped(ws)
  }

  async alarm() {
    this.scheduler.fired()
    this.room?.housekeep()
  }

  private dropped(ws: WebSocket) {
    const conn = this.conns.get(ws)
    this.conns.delete(ws)
    if (conn) this.room?.disconnect(conn)
  }

  private roomOf(ws: WebSocket): Room | null {
    const code = attachment(ws)?.code
    return this.room ?? (code ? this.roomFor(code) : null)
  }

  private roomFor(code: string): Room {
    if (this.room) return this.room
    const { sql } = this.ctx.storage
    const storage: Storage = {
      load: () => savedIsland(sql)?.blob ?? null,
      // El código va junto a la isla para que una alarma pueda recrear la sala sin ningún socket.
      save: (blob) => saveIsland(sql, code, blob),
      clear: () => void (savedIsland(sql) && sql.exec('DELETE FROM island')),
    }
    this.room = new Room(code, {
      storage,
      clock: { now: () => Date.now() },
      scheduler: this.scheduler,
      random: { token: randomToken, seed: () => crypto.getRandomValues(new Uint32Array(1))[0] },
      // Los trucos de `__debug` solo con `npm run dev:server`.
      dev: this.env.ALLOW_LOCAL === '1',
    })
    return this.room
  }

  /** El mismo `Conn` para el mismo socket: la sala los distingue por identidad. */
  private conn(ws: WebSocket): Conn {
    let conn = this.conns.get(ws)
    if (!conn) {
      conn = {
        send: (data) => ws.send(data),
        close: (code, reason) => {
          this.conns.delete(ws)
          try {
            ws.close(code, reason)
          } catch {
            // Ya cerrado.
          }
        },
        seated: (token, tab) => ws.serializeAttachment({ code: attachment(ws)?.code ?? '', token, tab } satisfies Attachment),
      }
      this.conns.set(ws, conn)
    }
    return conn
  }
}

function attachment(ws: WebSocket): Attachment | null {
  return ws.deserializeAttachment() as Attachment | null
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_')
}

const ALARM: TimerId = -1

/**
 * `every` → `setInterval` (solo con el bucle activo, que impide hibernar); `at` → la única alarma de la DO.
 * La sala cancela y vuelve a programar la alarma a menudo: se escribe una sola vez por turno y solo si cambia.
 */
class AlarmScheduler implements Scheduler {
  private wanted: number | null = null
  /** Lo que hay en el almacenamiento (undefined: no se sabe). */
  private stored: number | null | undefined = undefined
  private flushing = false

  constructor(private storage: DurableObjectStorage) {}

  every(ms: number, fn: () => void): TimerId {
    return setInterval(fn, ms) as unknown as TimerId
  }

  at(time: number): TimerId {
    this.wanted = time
    this.flush()
    return ALARM
  }

  cancel(id: TimerId) {
    if (id !== ALARM) return clearInterval(id)
    this.wanted = null
    this.flush()
  }

  /** La alarma ha saltado: ya no está en el almacenamiento. */
  fired() {
    this.stored = null
  }

  private flush() {
    if (this.flushing) return
    this.flushing = true
    queueMicrotask(() => {
      this.flushing = false
      if (this.wanted === this.stored) return
      this.stored = this.wanted
      void (this.wanted === null ? this.storage.deleteAlarm() : this.storage.setAlarm(this.wanted))
    })
  }
}
