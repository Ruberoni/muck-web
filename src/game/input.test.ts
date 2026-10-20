import { describe, expect, it } from 'vitest'
import { WHEEL_GESTURE_GAP_MS, WHEEL_STEP_PX } from './constants'
import { attackRequested, CLICK, WheelStepper } from './input'

describe('WheelStepper', () => {
  it('cada muesca de ratón da un paso, también al girar rápido', () => {
    const w = new WheelStepper()
    expect([0, 30, 60, 90].map((t) => w.push(100, t))).toEqual([1, 1, 1, 1])
    expect(w.push(-120, 500)).toBe(-1)
  })

  it('tras una pausa el primer evento cuenta aunque sea pequeño', () => {
    const w = new WheelStepper()
    expect(w.push(4, 0)).toBe(1)
    expect(w.push(4, WHEEL_GESTURE_GAP_MS + 1)).toBe(1)
  })

  it('un trackpad da un paso cada WHEEL_STEP_PX seguidos', () => {
    const w = new WheelStepper()
    const steps = Array.from({ length: 21 }, (_, i) => w.push(10, i * 16))
    // El primero cuenta al empezar el gesto y luego uno por cada WHEEL_STEP_PX acumulados.
    expect(steps.filter((s) => s === 1).length).toBe(1 + Math.floor((20 * 10) / WHEEL_STEP_PX))
  })

  it('cambiar de sentido cuenta al momento y reset olvida el gesto', () => {
    const w = new WheelStepper()
    w.push(10, 0)
    expect(w.push(-10, 16)).toBe(-1)
    expect(w.push(-10, 32)).toBe(0)
    w.reset()
    expect(w.push(-10, 48)).toBe(-1)
    expect(w.push(0, 64)).toBe(0)
  })
})

describe('attackRequested', () => {
  it('un clic más corto que un paso también golpea', () => {
    // El botón ya está suelto cuando llega el paso, pero la pulsación sigue pendiente.
    expect(attackRequested(false, new Set([CLICK]))).toBe(true)
    expect(attackRequested(true, new Set())).toBe(true)
    expect(attackRequested(false, new Set(['KeyF']))).toBe(false)
  })
})
