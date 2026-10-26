import { describe, expect, it } from 'vitest'
import { canCraft, craft, isRecipeId, RECIPE_IDS, RECIPES } from './crafting'
import { Inventory, type ItemId } from './inventory'

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

  it('la fogata cuesta madera y piedra', () => {
    const inv = new Inventory()
    inv.add('wood', 6)
    inv.add('stone', 2)
    expect(canCraft(inv, recipe('campfire'))).toBe(false)
    inv.add('stone', 1)
    expect(craft(inv, recipe('campfire'))).toBe(true)
    expect(inv.toJSON()).toEqual({ campfire: 1 })
  })

  it('con el inventario lleno solo se fabrica si un ingrediente se agota', () => {
    // Un inventario reducido: con los objetos que hay, el de 27 casillas no se llena.
    const inv = new Inventory(4)
    inv.add('wood', 10)
    for (let i = 1; i < 4; i++) inv.add(`item${i}` as ItemId, 1)
    expect(canCraft(inv, recipe('wood_axe'))).toBe(false)
    inv.remove('wood', 5)
    expect(craft(inv, recipe('wood_axe'))).toBe(true)
    expect(inv.slots[0]).toBe('wood_axe')
  })

  it('cada receta tiene un id distinto y solo esos ids son válidos', () => {
    expect(new Set(RECIPE_IDS).size).toBe(RECIPES.length)
    for (const id of RECIPE_IDS) expect(isRecipeId(id)).toBe(true)
    for (const bad of [0, 4, '', 'mithril_pickaxe', 'toString', '__proto__', null, undefined]) expect(isRecipeId(bad)).toBe(false)
  })
})
