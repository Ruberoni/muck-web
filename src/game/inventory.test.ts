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

  it('remove resta, falla si no hay bastantes y libera la casilla al llegar a 0', () => {
    const inv = new Inventory()
    inv.add('wood', 2)
    inv.add('berry', 2)
    expect(inv.remove('berry', 3)).toBe(false)
    expect(inv.remove('berry', 1)).toBe(true)
    expect(inv.count('berry')).toBe(1)
    expect(inv.slots).toEqual(['wood', 'berry'])
    expect(inv.remove('berry', 1)).toBe(true)
    expect(inv.count('berry')).toBe(0)
    expect(inv.slots).toEqual(['wood'])
    expect(inv.remove('berry', 1)).toBe(false)
  })

  it('clear vacía cantidades y casillas', () => {
    const inv = new Inventory()
    let changes = 0
    inv.onChange(() => changes++)
    inv.add('stone', 3)
    inv.clear()
    expect(inv.count('stone')).toBe(0)
    expect(inv.slots).toEqual([])
    expect(changes).toBe(2)
  })
})
