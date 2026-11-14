import { describe, expect, it } from 'vitest'
import { Daze, DAZE_TIME } from './daze'

describe('aturdimiento en pantalla', () => {
  it('se nota fuerte al empezar, se va pasando y a DAZE_TIME ya no queda nada', () => {
    const daze = new Daze()
    expect(daze.update(0.016).amount).toBe(0)
    daze.start()
    const first = daze.update(0.05).amount
    expect(first).toBeGreaterThan(0.9)
    const later = daze.update(DAZE_TIME / 2).amount
    expect(later).toBeLessThan(first)
    expect(later).toBeGreaterThan(0)
    const end = daze.update(DAZE_TIME)
    expect(end.amount).toBe(0)
    expect(Math.abs(end.roll) + Math.abs(end.sway)).toBe(0)
  })

  it('otra flecha lo vuelve a empezar', () => {
    const daze = new Daze()
    daze.start()
    daze.update(DAZE_TIME * 0.8)
    daze.start()
    expect(daze.update(0.016).amount).toBeGreaterThan(0.9)
  })
})
