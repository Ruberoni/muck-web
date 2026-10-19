import { describe, expect, it } from 'vitest'
import { Inventory } from './inventory'

describe('Inventory', () => {
  it('suma cantidades y asigna casillas por orden de primera recogida', () => {
    const inv = new Inventory()
    let changes = 0
    inv.onChange(() => changes++)
    inv.add('stone', 3)
    inv.add('wood', 4)
    inv.add('stone', 3)
    expect(inv.count('stone')).toBe(6)
    expect(inv.count('wood')).toBe(4)
    expect(inv.slots).toEqual(['stone', 'wood'])
    expect(changes).toBe(3)
  })

  it('ignora cantidades no positivas', () => {
    const inv = new Inventory()
    inv.add('wood', 0)
    expect(inv.slots).toEqual([])
    expect(inv.count('wood')).toBe(0)
  })
})
