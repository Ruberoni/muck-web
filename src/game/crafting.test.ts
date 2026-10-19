import { describe, expect, it } from 'vitest'
import { canCraft, craft, RECIPES } from './crafting'
import { Inventory, SLOT_COUNT, type ItemId } from './inventory'

const recipe = (result: ItemId) => RECIPES.find((r) => r.result === result)!

describe('crafteo', () => {
  it('gasta los ingredientes y añade la herramienta', () => {
    const inv = new Inventory()
    inv.add('wood', 8)
    inv.add('stone', 6)
    expect(craft(inv, recipe('stone_pickaxe'))).toBe(true)
    expect(inv.count('wood')).toBe(5)
    expect(inv.count('stone')).toBe(1)
    expect(inv.count('stone_pickaxe')).toBe(1)
  })

  it('sin ingredientes suficientes no toca nada', () => {
    const inv = new Inventory()
    inv.add('wood', 4)
    expect(canCraft(inv, recipe('wood_axe'))).toBe(false)
    expect(craft(inv, recipe('wood_axe'))).toBe(false)
    expect(inv.toJSON()).toEqual({ wood: 4 })
  })

  it('gastar toda la madera libera su casilla para la herramienta', () => {
    const inv = new Inventory()
    inv.add('wood', 5)
    expect(craft(inv, recipe('wood_axe'))).toBe(true)
    expect(inv.has('wood')).toBe(false)
    expect(inv.slots[0]).toBe('wood_axe')
  })

  it('con la hotbar llena solo se fabrica si un ingrediente se agota', () => {
    const inv = new Inventory()
    inv.add('wood', 10)
    for (let i = 1; i < SLOT_COUNT; i++) inv.add(`item${i}` as ItemId, 1)
    expect(canCraft(inv, recipe('wood_axe'))).toBe(false)
    inv.remove('wood', 5)
    expect(craft(inv, recipe('wood_axe'))).toBe(true)
    expect(inv.slots[0]).toBe('wood_axe')
  })
})
