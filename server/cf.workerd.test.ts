import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestHarness, type TestHarness } from 'wrangler'
import { CloseCode, PROTOCOL_VERSION, type Hello, type ServerMessage } from '../src/net/protocol'
import { Simulation } from '../src/sim/Simulation'
import { ABSENT_MS, ISLAND_TTL_MS } from './room'

/**
 * Humo de server/cf.ts en workerd (el runtime de Cloudflare), con el test harness de wrangler: Worker, upgrade,
 * `Origin`, la sala en la DO, persistencia en SQLite, restauración tras expulsar o hibernar la DO y la alarma.
 * La lógica de la sala ya la prueban los tests de room.ts; aquí solo la traducción a la plataforma.
 */

const ORIGIN = 'https://ruberoni.github.io'
let server: TestHarness
let codes = 0

/** Un código nuevo por test: cada uno tiene su DO. */
function newCode() {
  return `TEST${'23456789ABCDEFGHJKMNPQRSTUVWXYZ'[codes++]}`
}

beforeAll(async () => {
  server = createTestHarness({ workers: [{ configPath: new URL('./wrangler.jsonc', import.meta.url) }] })
  await server.listen()
})

afterAll(async () => {
  await server?.close()
})

type Of<T extends ServerMessage['type']> = Extract<ServerMessage, { type: T }>
type Socket = { accept(): void; send(data: string): void; close(code?: number): void; addEventListener(type: string, fn: (e: any) => void): void }

/** Un cliente por WebSocket real contra el Worker. */
class Client {
  readonly msgs: ServerMessage[] = []
  readonly raw: string[] = []
  closed: number | null = null
  private waiters: (() => void)[] = []

  private constructor(
    readonly code: string,
    private ws: Socket,
  ) {
    ws.addEventListener('message', (e) => {
      const data = String(e.data)
      this.raw.push(data)
      if (data.startsWith('{')) this.msgs.push(JSON.parse(data) as ServerMessage)
      this.wake()
    })
    ws.addEventListener('close', (e) => {
      this.closed = e.code
      this.wake()
    })
  }

  static async open(code: string, origin = ORIGIN) {
    const res = await server.fetch(`/room/${code}`, { headers: { Upgrade: 'websocket', Origin: origin } })
    const ws = (res as unknown as { webSocket: Socket | null }).webSocket
    expect(res.status).toBe(101)
    ws!.accept()
    return new Client(code, ws!)
  }

  send(msg: unknown) {
    this.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }

  hello(intent: Hello['intent'], extra: Partial<Hello> = {}) {
    this.send({ type: 'hello', v: PROTOCOL_VERSION, t: 0, intent, room: this.code, name: 'Ana', tab: 'a', ...extra })
  }

  cmds(tick: number) {
    this.send({ type: 'cmds', t: Date.now(), moves: [{ tick, buttons: 0, yaw: 0, pitch: 0 }], actions: [] })
  }

  close() {
    this.ws.close(1000)
  }

  last<T extends ServerMessage['type']>(type: T): Of<T> | undefined {
    return this.msgs.filter((m): m is Of<T> => m.type === type).at(-1)
  }

  /** Espera hasta que se cumpla `ok` (o falla a los 5 s). */
  async until(ok: () => boolean, what = 'condición') {
    const end = Date.now() + 5000
    while (!ok()) {
      if (Date.now() > end) throw new Error(`Tiempo agotado esperando: ${what}`)
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve)
        setTimeout(resolve, 50)
      })
    }
  }

  async next<T extends ServerMessage['type']>(type: T): Promise<Of<T>> {
    const from = this.msgs.length
    await this.until(() => this.msgs.slice(from).some((m) => m.type === type), type)
    return this.msgs.slice(from).find((m): m is Of<T> => m.type === type)!
  }

  private wake() {
    for (const fn of this.waiters.splice(0)) fn()
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Guarda directamente una isla en el SQLite de la DO, como si la hubiera guardado ella, y la reinicia. */
async function seedIsland(code: string, blob: object) {
  const worker = server.getWorker()
  const sql = await worker.getDurableObjectStorage('RoomObject', { name: code })
  await sql.exec('CREATE TABLE IF NOT EXISTS island (id INTEGER PRIMARY KEY CHECK (id = 1), code TEXT NOT NULL, blob TEXT NOT NULL)')
  await sql.exec('INSERT OR REPLACE INTO island (id, code, blob) VALUES (1, ?, ?)', code, JSON.stringify(blob))
  await worker.evictDurableObject('RoomObject', { name: code, webSockets: 'close' })
}

describe('Worker', () => {
  it('/status da la versión del protocolo, con CORS', async () => {
    const res = await server.fetch('/status')
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(await res.json()).toEqual({ ok: true, v: PROTOCOL_VERSION })
  })

  it('rechaza rutas, códigos, peticiones sin upgrade y orígenes ajenos', async () => {
    const ws = { Upgrade: 'websocket', Origin: ORIGIN }
    expect((await server.fetch('/', { headers: ws })).status).toBe(404)
    expect((await server.fetch('/room/k7qx2', { headers: ws })).status).toBe(404)
    expect((await server.fetch('/room/K7QX2/x', { headers: ws })).status).toBe(404)
    expect((await server.fetch('/room/K7QX2', { headers: { Origin: ORIGIN } })).status).toBe(426)
    expect((await server.fetch('/room/K7QX2', { headers: { Upgrade: 'websocket', Origin: 'https://otra.web' } })).status).toBe(403)
    expect((await server.fetch('/room/K7QX2', { headers: { Upgrade: 'websocket' } })).status).toBe(403)
    // localhost solo con `npm run dev:server` (ALLOW_LOCAL=1).
    expect((await server.fetch('/room/K7QX2', { headers: { Upgrade: 'websocket', Origin: 'http://localhost:5173' } })).status).toBe(403)
  })
})

describe('Durable Object', () => {
  let code: string
  beforeEach(() => {
    code = newCode()
  })

  it('crea la sala, une a un segundo jugador y contesta al ping sin la sala', async () => {
    const ana = await Client.open(code)
    ana.hello('create')
    const welcome = await ana.next('welcome')
    expect(welcome.id).toBe(0)
    expect(welcome.placements.length).toBeGreaterThan(200)
    await ana.next('snap')

    const bea = await Client.open(code)
    bea.hello('join', { name: 'Bea', tab: 'b' })
    expect((await bea.next('welcome')).id).toBe(1)
    await ana.until(() => ana.last('join')?.name === 'Bea', 'join')

    ana.send('ping')
    await ana.until(() => ana.raw.includes('pong'), 'pong')

    // Otro `create` con el mismo código se rechaza; un `join` a una sala que no existe, también.
    const otra = await Client.open(code)
    otra.hello('create')
    expect(await otra.next('reject')).toEqual({ type: 'reject', reason: 'exists' })
    const nadie = await Client.open(newCode())
    nadie.hello('join')
    expect(await nadie.next('reject')).toEqual({ type: 'reject', reason: 'not-found' })

    // Los mensajes binarios y los inválidos cierran con 4005.
    bea.send({ type: 'cmds', moves: 'no' })
    await bea.until(() => bea.closed !== null, 'cierre')
    expect(bea.closed).toBe(CloseCode.Invalid)
    for (const c of [ana, otra, nadie]) c.close()
  })

  it('guarda la isla al irse el último y la recupera tras expulsar la DO', async () => {
    const ana = await Client.open(code)
    ana.hello('create')
    const { token } = await ana.next('welcome')
    const snap = await ana.next('snap')
    ana.cmds(snap.tick + 5)
    await sleep(200)
    const before = ana.last('snap')!.tick
    ana.close()
    await sleep(200)

    await server.getWorker().evictDurableObject('RoomObject', { name: code, webSockets: 'close' })

    const again = await Client.open(code)
    again.hello('join', { token })
    const welcome = await again.next('welcome')
    expect(welcome.id).toBe(0)
    expect(welcome.token).toBe(token)
    expect(welcome.islandReset).toBeUndefined()
    // La isla sigue donde se quedó (se guardó al salir), no empieza de cero.
    expect(welcome.serverTick).toBeGreaterThanOrEqual(before)
    again.close()
  })

  it('tras hibernar, el socket vuelve a su hueco y el siguiente cmds reanuda con un state', async () => {
    const ana = await Client.open(code)
    ana.hello('create')
    await ana.next('welcome')
    await ana.next('snap')
    // Sin cmds pasa a ausente, el bucle se para y la isla se guarda: la DO ya puede hibernar.
    await sleep(ABSENT_MS + 300)
    const stoppedAt = ana.last('snap')!.tick
    const count = ana.msgs.length
    await sleep(200)
    expect(ana.msgs.length).toBe(count)

    await server.getWorker().evictDurableObject('RoomObject', { name: code, webSockets: 'hibernate' })
    expect(ana.closed).toBeNull()

    ana.cmds(stoppedAt + 10)
    const state = await ana.next('state')
    expect(state.tick).toBe(stoppedAt)
    expect(state.you.alive).toBe(true)
    await ana.next('snap')
    ana.close()
  })

  it('descarta una isla guardada de otra versión', async () => {
    await seedIsland(code, { schema: PROTOCOL_VERSION - 1, sim: { lo: 'que sea' }, seats: [], emptySince: Date.now() })
    const ana = await Client.open(code)
    ana.hello('join', { token: 'token-de-la-isla-vieja' })
    const welcome = await ana.next('welcome')
    expect(welcome.islandReset).toBe(true)
    ana.close()
  })

  it('la alarma borra una isla sin nadie a las 24 h', async () => {
    const sim = new Simulation(7).toJSON()
    await seedIsland(code, { schema: PROTOCOL_VERSION, sim, seats: [], emptySince: Date.now() - ISLAND_TTL_MS - 1000 })
    // Al despertar, la DO restaura la isla y programa la alarma, que ya ha vencido.
    const ana = await Client.open(code)
    await sleep(500)
    ana.hello('join')
    expect(await ana.next('reject')).toEqual({ type: 'reject', reason: 'not-found' })

    // Una isla que lleva poco vacía sigue ahí.
    const fresh = newCode()
    await seedIsland(fresh, { schema: PROTOCOL_VERSION, sim, seats: [], emptySince: Date.now() })
    const bea = await Client.open(fresh)
    await sleep(500)
    bea.hello('join')
    expect((await bea.next('welcome')).serverTick).toBe(sim.tick)
    bea.close()
  })
})
