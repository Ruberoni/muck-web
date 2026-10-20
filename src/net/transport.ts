import type { Clock, Conn, Scheduler, TimerId } from '../../server/room'

/**
 * El extremo del cliente de una conexión con la sala: lo que NetSession (PR 12) usará, sea un WebSocket
 * o la sala en memoria de los tests.
 */
export interface Transport {
  send(data: string): void
  close(code?: number): void
  onmessage: ((data: string) => void) | null
  /** Se llama una vez, cierre quien cierre. */
  onclose: ((code: number) => void) | null
}

/** Lo que una conexión en memoria necesita de la sala (Room lo cumple). */
export interface Endpoint {
  message(conn: Conn, data: string): void
  disconnect(conn: Conn): void
}

/**
 * Reloj y temporizadores manuales: el tiempo solo avanza con `advance`, que ejecuta en orden lo que vence.
 * Sirve de Clock y Scheduler para la sala y para los transportes en los tests.
 */
export class ManualTime implements Clock, Scheduler {
  private time = 0
  private nextId = 1
  private timers = new Map<TimerId, { due: number; every: number; fn: () => void }>()

  constructor(start = 0) {
    this.time = start
  }

  now() {
    return this.time
  }

  every(ms: number, fn: () => void): TimerId {
    const id = this.nextId++
    this.timers.set(id, { due: this.time + ms, every: ms, fn })
    return id
  }

  at(time: number, fn: () => void): TimerId {
    const id = this.nextId++
    this.timers.set(id, { due: time, every: 0, fn })
    return id
  }

  cancel(id: TimerId) {
    this.timers.delete(id)
  }

  /** Avanza `ms` ejecutando lo que vence por orden de vencimiento (y de creación si empatan). */
  advance(ms: number) {
    const end = this.time + ms
    for (;;) {
      let next: [TimerId, { due: number; every: number; fn: () => void }] | null = null
      for (const entry of this.timers) if (entry[1].due <= end && (!next || entry[1].due < next[1].due)) next = entry
      if (!next) break
      const [id, timer] = next
      this.time = Math.max(this.time, timer.due)
      if (timer.every > 0) timer.due += timer.every
      else this.timers.delete(id)
      timer.fn()
    }
    this.time = end
  }
}

/** Retraso de cada mensaje: `latency` ± `jitter` ms, sin desordenarse (como TCP). */
export interface Lag {
  latency: number
  jitter: number
  rng?: () => number
}

const NO_LAG: Lag = { latency: 0, jitter: 0 }

/**
 * Conexión en memoria con la sala, con latencia y jitter en cada sentido. Los mensajes llegan en orden;
 * `stall(ms)` retiene los dos sentidos un rato (una ráfaga). Sin retraso, cada mensaje llega en el siguiente
 * `advance` del reloj, nunca dentro de la llamada que lo envía.
 */
export class LaggyTransport implements Transport {
  onmessage: ((data: string) => void) | null = null
  onclose: ((code: number) => void) | null = null
  /** El extremo del servidor, el que recibe la sala. */
  readonly conn: Conn
  private open = true
  private closeNotified = false
  private lastAt = { server: 0, client: 0 }

  constructor(
    private room: Endpoint,
    private time: Clock & Scheduler,
    private lag: Lag = NO_LAG,
  ) {
    this.conn = {
      send: (data) => {
        if (this.open) this.later('client', () => this.onmessage?.(data))
      },
      close: (code) => this.shut(code),
    }
  }

  send(data: string) {
    if (this.open) this.later('server', () => this.room.message(this.conn, data))
  }

  close(code: number = 1000) {
    this.shut(code)
  }

  /** Retiene lo que viaje en los dos sentidos durante `ms`. */
  stall(ms: number) {
    const until = this.time.now() + ms
    this.lastAt.server = Math.max(this.lastAt.server, until)
    this.lastAt.client = Math.max(this.lastAt.client, until)
  }

  /** Cierre desde cualquiera de los dos lados: los dos se enteran, después de lo que ya iba de camino. */
  private shut(code: number) {
    if (!this.open) return
    this.open = false
    this.later('server', () => this.room.disconnect(this.conn))
    this.later('client', () => {
      if (this.closeNotified) return
      this.closeNotified = true
      this.onclose?.(code)
    })
  }

  private later(to: 'server' | 'client', fn: () => void) {
    const { latency, jitter, rng = Math.random } = this.lag
    const delay = Math.max(0, latency + (rng() * 2 - 1) * jitter)
    const at = Math.max(this.time.now() + delay, this.lastAt[to])
    this.lastAt[to] = at
    this.time.at(at, fn)
  }
}
