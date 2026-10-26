import { describe, expect, it } from 'vitest'
import type { ActionData } from '../sim/commands'
import { NO_STATIONS, RECIPES, recipeById, type CraftWorld, type Recipe, type RecipeId } from '../sim/crafting'
import { Inventory, type ItemId } from '../sim/inventory'
import { Structures } from '../sim/structures'
import { CLIENT_STATION_RANGE, clientCraftWorld, CRAFT_MANY, RECIPE_GROUPS, recipeStatus, sendableActions } from './recipes'

const POS = { x: 0, y: 0, z: 0 }
const recipe = (id: RecipeId) => recipeById(id)!
const inventoryWith = (items: Partial<Record<ItemId, number>>, size?: number) => {
  const inventory = new Inventory(size)
  for (const [item, amount] of Object.entries(items) as [ItemId, number][]) inventory.add(item, amount)
  return inventory
}
const craftAction = (id: RecipeId): ActionData => ({ kind: 'craft', recipe: id })
const NEAR_ALL: CraftWorld = { nearStation: () => true }
// Una receta de mesa más barata, para probar el motivo sin depender del coste real.
const atWorkbench: Recipe = { ...recipe('stone_axe'), cost: [{ item: 'stone', amount: 1 }] }

describe('recetas en la pantalla de inventario', () => {
  it('todas las recetas salen una vez, agrupadas por estación y sin grupos vacíos', () => {
    const listed = RECIPE_GROUPS.flatMap((g) => g.recipes)
    expect(listed).toHaveLength(RECIPES.length)
    expect(new Set(listed)).toEqual(new Set(RECIPES))
    expect(RECIPE_GROUPS.every((g) => g.recipes.length > 0 && g.recipes.every((r) => r.station === g.station))).toBe(true)
    expect(RECIPE_GROUPS.map((g) => g.title)).toEqual(['Sin estación', 'Mesa de trabajo', 'Horno', 'Yunque'])
    expect(RECIPE_GROUPS.map((g) => g.recipes.map((r) => r.id))).toEqual([
      ['wood_axe', 'wood_pickaxe', 'campfire', 'workbench'],
      ['stone_axe', 'stone_pickaxe', 'furnace', 'anvil'],
      ['iron_bar', 'mithril_bar'],
      ['iron_axe', 'iron_pickaxe', 'mithril_axe', 'mithril_pickaxe'],
    ])
  })

  it('con todo, se puede y no hay motivo', () => {
    const status = recipeStatus(inventoryWith({ wood: 5 }), recipe('wood_axe'), NO_STATIONS, POS)
    expect(status).toEqual({ available: true, reason: null, cost: [{ item: 'wood', amount: 5, have: 5 }] })
  })

  it('dice lo que falta, en singular si es una sola unidad', () => {
    expect(recipeStatus(inventoryWith({ wood: 3, stone: 3 }), recipe('stone_axe'), NEAR_ALL, POS)).toEqual({
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
    // El horno y el yunque, con su nombre.
    expect(recipeStatus(inventoryWith({ iron_ore: 1, wood: 1 }), recipe('iron_bar'), NO_STATIONS, POS).reason).toBe('Necesitas un horno cerca')
    expect(recipeStatus(inventoryWith({ iron_bar: 3 }), recipe('iron_pickaxe'), NO_STATIONS, POS).reason).toBe(
      'Faltan 2 madera de abedul · Necesitas un yunque cerca',
    )
    expect(recipeStatus(inventoryWith({ mithril_ore: 1, wood: 1 }), recipe('mithril_bar'), NO_STATIONS, POS).reason).toBe(
      'Falta 1 madera · Necesitas un horno cerca',
    )
    expect(recipeStatus(inventoryWith({ mithril_bar: 3, dark_wood: 2 }), recipe('mithril_axe'), NEAR_ALL, POS).available).toBe(true)
  })

  it('con el inventario lleno y sin que se libere una casilla, "Inventario lleno"', () => {
    // 2 casillas: madera (sobra) y piedra; el hacha no cabe.
    const full = inventoryWith({ wood: 4, stone: 6 }, 2)
    expect(recipeStatus(full, recipe('stone_axe'), NEAR_ALL, POS)).toMatchObject({ available: false, reason: 'Inventario lleno' })
    // Si se gasta toda la madera, su casilla queda libre: sí cabe.
    expect(recipeStatus(inventoryWith({ wood: 3, stone: 6 }, 2), recipe('stone_axe'), NEAR_ALL, POS).available).toBe(true)
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

describe('estaciones vistas desde el cliente', () => {
  it('el cliente da la mesa por cercana con algo menos de alcance que la simulación', () => {
    const structures = new Structures()
    const world = clientCraftWorld(() => structures.list)
    const inventory = inventoryWith({ wood: 3, stone: 5 })
    const at = (x: number) => ({ x, y: 0, z: 0 })
    const send = (x: number) => sendableActions([craftAction('stone_axe')], inventory, world, at(x))
    // Sin mesa no se manda; la lista se lee en cada llamada, así que la mesa nueva cuenta al momento.
    expect(send(0)).toEqual([])
    structures.place({ x: 0, y: 5, z: 0, valid: true }, 'workbench')
    const edge = structures.list[0].radius + CLIENT_STATION_RANGE
    expect(send(edge)).toEqual([craftAction('stone_axe')])
    // Entre los 3,3 m del cliente y los 3,5 de la simulación, el cliente ya no lo intenta.
    expect(send(edge + 0.1)).toEqual([])
    expect(recipeStatus(inventory, recipe('stone_axe'), world, at(edge + 0.1)).reason).toBe('Necesitas una mesa de trabajo cerca')
  })
})
