import { describe, expect, it } from 'vitest'
import type { ActionData } from '../sim/commands'
import { NO_STATIONS, RECIPES, recipeById, type CraftWorld, type Recipe, type RecipeId } from '../sim/crafting'
import { Inventory, type ItemId } from '../sim/inventory'
import { CRAFT_MANY, RECIPE_GROUPS, recipeStatus, sendableActions } from './recipes'

const POS = { x: 0, y: 0, z: 0 }
const recipe = (id: RecipeId) => recipeById(id)!
const inventoryWith = (items: Partial<Record<ItemId, number>>, size?: number) => {
  const inventory = new Inventory(size)
  for (const [item, amount] of Object.entries(items) as [ItemId, number][]) inventory.add(item, amount)
  return inventory
}
const craftAction = (id: RecipeId): ActionData => ({ kind: 'craft', recipe: id })
const NEAR_ALL: CraftWorld = { nearStation: () => true }
// Las recetas con estación llegan con sus PRs: para probar el motivo, una de mentira.
const atWorkbench: Recipe = { id: 'stone_axe', result: 'stone_axe', cost: [{ item: 'stone', amount: 1 }], station: 'workbench' }

describe('recetas en la pantalla de inventario', () => {
  it('todas las recetas salen una vez, agrupadas por estación y sin grupos vacíos', () => {
    const listed = RECIPE_GROUPS.flatMap((g) => g.recipes)
    expect(listed).toHaveLength(RECIPES.length)
    expect(new Set(listed)).toEqual(new Set(RECIPES))
    expect(RECIPE_GROUPS.every((g) => g.recipes.length > 0 && g.recipes.every((r) => r.station === g.station))).toBe(true)
    expect(RECIPE_GROUPS[0].title).toBe('Sin estación')
  })

  it('con todo, se puede y no hay motivo', () => {
    const status = recipeStatus(inventoryWith({ wood: 5 }), recipe('wood_axe'), NO_STATIONS, POS)
    expect(status).toEqual({ available: true, reason: null, cost: [{ item: 'wood', amount: 5, have: 5 }] })
  })

  it('dice lo que falta, en singular si es una sola unidad', () => {
    expect(recipeStatus(inventoryWith({ wood: 3, stone: 3 }), recipe('stone_axe'), NO_STATIONS, POS)).toEqual({
      available: false,
      reason: 'Faltan 2 piedra',
      cost: [
        { item: 'wood', amount: 3, have: 3 },
        { item: 'stone', amount: 5, have: 3 },
      ],
    })
    expect(recipeStatus(inventoryWith({ wood: 4 }), recipe('wood_axe'), NO_STATIONS, POS).reason).toBe('Falta 1 madera')
    expect(recipeStatus(new Inventory(), recipe('campfire'), NO_STATIONS, POS).reason).toBe('Faltan 6 madera y 3 piedra')
  })

  it('una receta de estación sin ella cerca lo dice, también junto a lo que falta', () => {
    expect(recipeStatus(inventoryWith({ stone: 1 }), atWorkbench, NO_STATIONS, POS).reason).toBe('Necesitas una mesa de trabajo cerca')
    expect(recipeStatus(new Inventory(), atWorkbench, NO_STATIONS, POS).reason).toBe('Falta 1 piedra · Necesitas una mesa de trabajo cerca')
    expect(recipeStatus(inventoryWith({ stone: 1 }), atWorkbench, NEAR_ALL, POS).available).toBe(true)
    // La estación se busca desde la posición del jugador.
    const seen: unknown[] = []
    recipeStatus(inventoryWith({ stone: 1 }), atWorkbench, { nearStation: (kind, pos) => (seen.push([kind, pos]), false) }, { x: 1, y: 2, z: 3 })
    expect(seen).toEqual([['workbench', { x: 1, y: 2, z: 3 }]])
  })

  it('con el inventario lleno y sin que se libere una casilla, "Inventario lleno"', () => {
    // 2 casillas: madera (sobra) y piedra; el hacha no cabe.
    const full = inventoryWith({ wood: 4, stone: 6 }, 2)
    expect(recipeStatus(full, recipe('stone_axe'), NO_STATIONS, POS)).toMatchObject({ available: false, reason: 'Inventario lleno' })
    // Si se gasta toda la madera, su casilla queda libre: sí cabe.
    expect(recipeStatus(inventoryWith({ wood: 3, stone: 6 }, 2), recipe('stone_axe'), NO_STATIONS, POS).available).toBe(true)
  })
})

describe('qué craft se mandan', () => {
  it('solo los que la predicción da por buenos, contando los anteriores del mismo paso', () => {
    const inventory = inventoryWith({ wood: 12 })
    const actions = Array.from({ length: CRAFT_MANY }, () => craftAction('wood_axe'))
    expect(sendableActions(actions, inventory, NO_STATIONS, POS)).toEqual([craftAction('wood_axe'), craftAction('wood_axe')])
    // El inventario de verdad no se toca.
    expect(inventory.count('wood')).toBe(12)
    expect(inventory.count('wood_axe')).toBe(0)
  })

  it('lo demás pasa tal cual y en orden; lo que gastan los craft anteriores del paso cuenta', () => {
    const inventory = inventoryWith({ wood: 5 })
    const actions: ActionData[] = [{ kind: 'select', slot: 3 }, craftAction('campfire'), { kind: 'move', from: 0, to: 20 }, craftAction('wood_pickaxe'), { kind: 'eat' }, craftAction('wood_axe')]
    expect(sendableActions(actions, inventory, NO_STATIONS, POS)).toEqual([{ kind: 'select', slot: 3 }, { kind: 'move', from: 0, to: 20 }, craftAction('wood_pickaxe'), { kind: 'eat' }])
  })

  it('una receta sin estación no pregunta por ninguna', () => {
    const world: CraftWorld = {
      nearStation: () => {
        throw new Error('no debería preguntar')
      },
    }
    expect(sendableActions([craftAction('wood_axe')], inventoryWith({ wood: 5 }), world, POS)).toEqual([craftAction('wood_axe')])
  })
})
