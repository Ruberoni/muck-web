import { describe, expect, it } from 'vitest'
import { INTERP_TICKS, MAX_CATCHUP, SEND_MS, TICK_MS, TickClock } from './clock'

/** Un reloj sincronizado con un `welcome` del tick 100 que tardó 200 ms en ir y volver. */
function synced() {
  const clock = new TickClock()
  clock.sync(1200, 100, { t: 1000, held: 0 })
  return clock
}

describe('TickClock', () => {
  it('al sincronizar va por delante del servidor el lead y da de una vez los ticks que faltan', () => {
    const clock = synced()
    expect(clock.rtt).toBe(200)
    // El welcome salió del servidor hace ~100 ms (6 ticks).
    expect(clock.serverTick(1200)).toBeCloseTo(106)
    expect(clock.lead).toBeGreaterThan((100 + SEND_MS) / TICK_MS)
    const due = clock.advance(1200)
    expect(clock.tick).toBe(Math.floor(106 + clock.lead))
    expect(due).toBe(clock.tick - 100)
    // Después, un tick cada TICK_MS.
    expect(clock.advance(1200 + TICK_MS * 3)).toBe(3)
    expect(clock.renderTick(1200)).toBeCloseTo(100 - INTERP_TICKS)
  })

  it('acelera o frena un 5 % según el margen con que llegan los Move de 20 Hz', () => {
    const clock = synced()
    clock.advance(1200)
    let t = 1250
    const snap = (slack: number) => {
      clock.sent(t, 3)
      clock.onSnap(t + 200, { tick: 110, t, held: 0, slack })
      t += 50
    }
    for (let i = 0; i < 30; i++) snap(clock.targetMargin + 3 - 5)
    expect(clock.nudge).toBe(0.05)
    for (let i = 0; i < 60; i++) snap(clock.targetMargin + 3 + 5)
    expect(clock.nudge).toBe(-0.05)
    // Frenando, 100 ticks de tiempo son 95.
    const before = clock.tick
    clock.advance(1200 + TICK_MS * 100)
    expect(Math.abs(clock.tick - before - 95)).toBeLessThanOrEqual(1)
  })

  it('no ajusta con los envíos a 4 Hz ni con muestras repetidas', () => {
    const clock = synced()
    clock.advance(1200)
    const margin = clock.margin
    clock.sent(1300, null)
    clock.onSnap(1500, { tick: 110, t: 1300, held: 0, slack: -50 })
    clock.sent(1350, 3)
    clock.onSnap(1550, { tick: 113, t: 1350, held: 0, slack: 0 })
    clock.onSnap(1600, { tick: 116, t: 1350, held: 50, slack: 0 })
    // Solo cuenta la de 20 Hz, una vez.
    expect(clock.margin).toBeCloseTo(margin + (-3 - margin) * 0.1)
  })

  it('lejos del margen, salta hacia delante o espera sin avanzar', () => {
    const clock = synced()
    clock.advance(1200)
    const start = clock.tick
    // Los Move llegan 30 ticks tarde: salta.
    clock.sent(1300, 3)
    clock.onSnap(1500, { tick: 120, t: 1300, held: 0, slack: -27 })
    expect(clock.advance(1500)).toBeGreaterThan(30 - 1)
    const ahead = clock.tick
    expect(ahead - start).toBeGreaterThan(40)
    // Van 40 ticks sobrados: espera 40 ticks sin avanzar.
    clock.sent(1600, 3)
    clock.onSnap(1800, { tick: 140, t: 1600, held: 0, slack: clock.targetMargin + 3 + 40 })
    expect(clock.advance(1500 + TICK_MS * 39)).toBe(0)
    expect(clock.advance(1500 + TICK_MS * 42)).toBeGreaterThan(0)
  })

  it(`da como mucho ${MAX_CATCHUP} ticks por llamada y se salta el resto`, () => {
    const clock = synced()
    clock.advance(1200)
    const before = clock.tick
    expect(clock.advance(1200 + TICK_MS * 100)).toBe(MAX_CATCHUP)
    expect(clock.tick).toBe(before + 100)
  })
})
