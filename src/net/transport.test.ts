import { describe, expect, it, vi } from 'vitest'
import type { Conn } from '../../server/room'
import { LaggyTransport, ManualTime, WebSocketTransport, type SocketLike } from './transport'

/** Una sala que devuelve cada mensaje y apunta los cierres. */
function echo(time: ManualTime) {
  const got: [number, string][] = []
  const closed: Conn[] = []
  const room = {
    message: (conn: Conn, data: string) => {
      got.push([time.now(), data])
      conn.send(`eco ${data}`)
    },
    disconnect: (conn: Conn) => void closed.push(conn),
  }
  return { room, got, closed }
}

describe('ManualTime', () => {
  it('ejecuta los temporizadores en orden de vencimiento, con el reloj en su hora', () => {
    const time = new ManualTime()
    const log: string[] = []
    time.every(50, () => log.push(`every ${time.now()}`))
    const cancelled = time.at(60, () => log.push('no'))
    time.at(75, () => log.push(`at ${time.now()}`))
    time.cancel(cancelled)
    time.advance(120)
    expect(log).toEqual(['every 50', 'at 75', 'every 100'])
    expect(time.now()).toBe(120)
  })
})

describe('LaggyTransport', () => {
  it('sin retraso entrega en el siguiente advance, no dentro de send', () => {
    const time = new ManualTime()
    const { room, got } = echo(time)
    const t = new LaggyTransport(room, time)
    const received: string[] = []
    t.onmessage = (d) => received.push(d)
    t.send('hola')
    expect(got).toEqual([])
    time.advance(0)
    expect(received).toEqual(['eco hola'])
  })

  it('con latencia y jitter, cada sentido tarda lo suyo y nada se desordena', () => {
    const time = new ManualTime()
    const { room, got } = echo(time)
    let i = 0
    const t = new LaggyTransport(room, time, { latency: 100, jitter: 30, rng: () => [0.9, 0.1, 0.5][i++ % 3] })
    const received: [number, string][] = []
    t.onmessage = (d) => received.push([time.now(), d])
    for (let k = 0; k < 20; k++) {
      t.send(String(k))
      time.advance(5)
    }
    time.advance(1000)
    expect(got.map(([, d]) => d)).toEqual(Array.from({ length: 20 }, (_, k) => String(k)))
    expect(received.map(([, d]) => d)).toEqual(Array.from({ length: 20 }, (_, k) => `eco ${k}`))
    expect(got[0][0]).toBeCloseTo(124, 6)
    for (const [at] of received) expect(at).toBeGreaterThanOrEqual(140)
    expect(received.at(-1)![0]).toBeLessThanOrEqual(95 + 2 * 130)
  })

  it('stall retiene los dos sentidos', () => {
    const time = new ManualTime()
    const { room, got } = echo(time)
    const t = new LaggyTransport(room, time, { latency: 10, jitter: 0 })
    t.stall(500)
    t.send('a')
    time.advance(400)
    expect(got).toEqual([])
    time.advance(100)
    expect(got).toEqual([[500, 'a']])
  })

  it('el cierre llega a los dos lados una vez, después de lo que ya iba de camino', () => {
    const time = new ManualTime()
    const { room, got, closed } = echo(time)
    const t = new LaggyTransport(room, time, { latency: 10, jitter: 0 })
    const log: string[] = []
    t.onmessage = (d) => log.push(d)
    t.onclose = (code) => log.push(`cerrado ${code}`)
    t.send('a')
    time.advance(10)
    t.conn.close(4001)
    t.conn.send('tarde')
    t.send('b')
    t.close()
    time.advance(100)
    expect(got.map(([, d]) => d)).toEqual(['a'])
    expect(log).toEqual(['eco a', 'cerrado 4001'])
    expect(closed).toEqual([t.conn])
  })
})

/** Llama a un manejador del socket falso (los del DOM esperan `this: WebSocket`). */
const fire = (handler: unknown, ev: object) => (handler as ((ev: object) => void) | null)?.(ev)

/** Un WebSocket falso: apunta lo que se envía y deja abrir, recibir y cerrar a mano. */
function fakeSocket() {
  const sent: string[] = []
  const socket = {
    readyState: 0,
    send: (data: string) => void sent.push(data),
    close: (code = 1000) => fire(socket.onclose, { code }),
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  } as { -readonly [K in keyof SocketLike]: SocketLike[K] }
  const open = () => {
    socket.readyState = 1
    fire(socket.onopen, {})
  }
  const receive = (data: string) => fire(socket.onmessage, { data })
  return { socket, sent, open, receive }
}

describe('WebSocketTransport', () => {
  it('abre, envía, recibe y avisa del cierre una vez', async () => {
    const { socket, sent, open, receive } = fakeSocket()
    const transport = new WebSocketTransport(socket)
    const got: string[] = []
    const closes: number[] = []
    transport.onmessage = (data) => got.push(data)
    transport.onclose = (code) => closes.push(code)
    open()
    await transport.opened
    transport.send('hola')
    receive('eco')
    expect(sent).toEqual(['hola'])
    expect(got).toEqual(['eco'])
    transport.close(4001)
    fire(socket.onclose, { code: 4001 })
    expect(closes).toEqual([4001])
  })

  it('opened falla si se cierra antes de abrirse', async () => {
    const { socket } = fakeSocket()
    const transport = new WebSocketTransport(socket)
    socket.close(1006)
    await expect(transport.opened).rejects.toThrow('1006')
  })

  it('con latencia retrasa los dos sentidos sin desordenar, y sin ella vuelve a ser inmediato', async () => {
    vi.useFakeTimers()
    try {
      const { socket, sent, open, receive } = fakeSocket()
      let now = 0
      const transport = new WebSocketTransport(socket, () => now)
      const got: string[] = []
      transport.onmessage = (data) => got.push(data)
      open()
      transport.latency = 100
      transport.jitter = 40
      for (let i = 0; i < 5; i++) {
        transport.send(`s${i}`)
        receive(`r${i}`)
      }
      expect(sent).toEqual([])
      now += 59
      vi.advanceTimersByTime(59)
      expect(sent).toEqual([])
      now += 100
      vi.advanceTimersByTime(100)
      expect(sent).toEqual(['s0', 's1', 's2', 's3', 's4'])
      expect(got).toEqual(['r0', 'r1', 'r2', 'r3', 'r4'])
      transport.latency = transport.jitter = 0
      transport.send('ya')
      expect(sent.at(-1)).toBe('ya')
    } finally {
      vi.useRealTimers()
    }
  })
})
