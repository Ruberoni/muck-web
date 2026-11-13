import { describe, expect, it } from 'vitest'
import { countdownNumber } from './countdown'
import { pickTip, TIPS } from './tips'

describe('countdownNumber', () => {
  it('3, 2, 1 y luego a entrar', () => {
    expect(countdownNumber(0)).toBe(3)
    expect(countdownNumber(999)).toBe(3)
    expect(countdownNumber(1000)).toBe(2)
    expect(countdownNumber(2999)).toBe(1)
    expect(countdownNumber(3000)).toBeNull()
    expect(countdownNumber(60_000)).toBeNull()
    expect(countdownNumber(-50)).toBe(3)
  })
})

describe('pickTip', () => {
  it('siempre devuelve uno de la lista', () => {
    expect(pickTip(0)).toBe(TIPS[0])
    expect(pickTip(0.9999)).toBe(TIPS.at(-1))
    expect(pickTip(1)).toBe(TIPS.at(-1))
    expect(TIPS.length).toBeGreaterThanOrEqual(8)
  })
})
