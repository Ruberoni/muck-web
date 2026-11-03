import { describe, expect, it } from 'vitest'
import { changesSlots, hotbarSlotOf } from './inventoryScreen'

describe('pantalla de inventario', () => {
  it('cada número nombra su casilla de la hotbar', () => {
    expect(hotbarSlotOf('Digit1')).toBe(0)
    expect(hotbarSlotOf('Digit9')).toBe(8)
    expect(hotbarSlotOf('Digit0')).toBeNull()
    expect(hotbarSlotOf('KeyQ')).toBeNull()
    expect(hotbarSlotOf('Numpad1')).toBeNull()
  })

  it('solo se manda un intercambio que cambia algo', () => {
    const slots = ['wood', null, 'stone', null] as const
    expect(changesSlots(slots, 0, 2)).toBe(true)
    expect(changesSlots(slots, 0, 1)).toBe(true)
    expect(changesSlots(slots, 1, 3)).toBe(false)
    expect(changesSlots(slots, 2, 2)).toBe(false)
  })
})
