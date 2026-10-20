import { describe, expect, it } from 'vitest'
import { mulberry32 } from './random'

describe('mulberry32', () => {
  it('da floats en [0, 1) y la misma secuencia con la misma semilla', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    for (let i = 0; i < 100; i++) {
      const x = a()
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
      expect(b()).toBe(x)
    }
  })

  it('reanuda la secuencia desde un estado guardado', () => {
    const rng = mulberry32(7)
    for (let i = 0; i < 10; i++) rng()
    const saved = JSON.parse(JSON.stringify({ state: rng.state })).state
    const expected = [rng(), rng(), rng()]
    const restored = mulberry32(0)
    restored.state = saved
    expect([restored(), restored(), restored()]).toEqual(expected)
  })

  it('normaliza la semilla a 32 bits sin signo', () => {
    expect(mulberry32(-1).state).toBe(0xffffffff)
    expect(mulberry32(-1)()).toBe(mulberry32(0xffffffff)())
  })
})
