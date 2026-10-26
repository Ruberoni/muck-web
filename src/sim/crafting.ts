import type { Inventory, ItemId } from './inventory'
import type { Vec3 } from './player'

/** Estaciones junto a las que se fabrican algunas recetas. */
export type StationKind = 'workbench' | 'furnace' | 'anvil'

/** Lo que fabricar necesita del mundo: si hay una estación de ese tipo al alcance desde `pos`. */
export interface CraftWorld {
  nearStation(kind: StationKind, pos: Vec3): boolean
}

/** Un mundo sin estaciones. */
export const NO_STATIONS: CraftWorld = { nearStation: () => false }

/** Identificador estable de una receta: es lo que viaja en `craft` y en `playerCrafted`. */
export type RecipeId =
  | 'wood_axe'
  | 'wood_pickaxe'
  | 'campfire'
  | 'workbench'
  | 'stone_axe'
  | 'stone_pickaxe'
  | 'furnace'
  | 'anvil'
  | 'iron_bar'
  | 'iron_axe'
  | 'iron_pickaxe'
  | 'mithril_bar'
  | 'mithril_axe'
  | 'mithril_pickaxe'

export interface Recipe {
  id: RecipeId
  result: ItemId
  cost: { item: ItemId; amount: number }[]
  /** Estación que hay que tener cerca; null, en cualquier sitio. */
  station: StationKind | null
}

// El orden solo sirve para la UI: es el de la columna de recetas de la pantalla de inventario.
export const RECIPES: readonly Recipe[] = [
  { id: 'wood_axe', result: 'wood_axe', cost: [{ item: 'wood', amount: 5 }], station: null },
  { id: 'wood_pickaxe', result: 'wood_pickaxe', cost: [{ item: 'wood', amount: 5 }], station: null },
  { id: 'campfire', result: 'campfire', cost: [{ item: 'wood', amount: 6 }, { item: 'stone', amount: 3 }], station: null },
  { id: 'workbench', result: 'workbench', cost: [{ item: 'wood', amount: 10 }], station: null },
  { id: 'stone_axe', result: 'stone_axe', cost: [{ item: 'wood', amount: 3 }, { item: 'stone', amount: 5 }], station: 'workbench' },
  { id: 'stone_pickaxe', result: 'stone_pickaxe', cost: [{ item: 'wood', amount: 3 }, { item: 'stone', amount: 5 }], station: 'workbench' },
  { id: 'furnace', result: 'furnace', cost: [{ item: 'stone', amount: 12 }, { item: 'wood', amount: 4 }], station: 'workbench' },
  { id: 'anvil', result: 'anvil', cost: [{ item: 'iron_bar', amount: 4 }, { item: 'stone', amount: 6 }], station: 'workbench' },
  // Fundir es instantáneo: una receta más, junto al horno.
  { id: 'iron_bar', result: 'iron_bar', cost: [{ item: 'iron_ore', amount: 1 }, { item: 'wood', amount: 1 }], station: 'furnace' },
  { id: 'mithril_bar', result: 'mithril_bar', cost: [{ item: 'mithril_ore', amount: 1 }, { item: 'wood', amount: 2 }], station: 'furnace' },
  { id: 'iron_axe', result: 'iron_axe', cost: [{ item: 'iron_bar', amount: 3 }, { item: 'birch_wood', amount: 2 }], station: 'anvil' },
  { id: 'iron_pickaxe', result: 'iron_pickaxe', cost: [{ item: 'iron_bar', amount: 3 }, { item: 'birch_wood', amount: 2 }], station: 'anvil' },
  { id: 'mithril_axe', result: 'mithril_axe', cost: [{ item: 'mithril_bar', amount: 3 }, { item: 'dark_wood', amount: 2 }], station: 'anvil' },
  { id: 'mithril_pickaxe', result: 'mithril_pickaxe', cost: [{ item: 'mithril_bar', amount: 3 }, { item: 'dark_wood', amount: 2 }], station: 'anvil' },
]

const BY_ID = new Map<string, Recipe>(RECIPES.map((r) => [r.id, r]))

export const RECIPE_IDS: readonly RecipeId[] = RECIPES.map((r) => r.id)

export const isRecipeId = (id: unknown): id is RecipeId => typeof id === 'string' && BY_ID.has(id)

export const recipeById = (id: RecipeId): Recipe | undefined => BY_ID.get(id)

export function canCraft(inventory: Inventory, recipe: Recipe): boolean {
  if (!recipe.cost.every(({ item, amount }) => inventory.has(item, amount))) return false
  // Con el inventario lleno aún cabe si algún ingrediente se agota y libera su casilla.
  return inventory.canAdd(recipe.result) || recipe.cost.some(({ item, amount }) => inventory.count(item) === amount)
}

/** Gasta los ingredientes y añade el resultado. Devuelve false sin tocar nada si no se puede. */
export function craft(inventory: Inventory, recipe: Recipe): boolean {
  if (!canCraft(inventory, recipe)) return false
  for (const { item, amount } of recipe.cost) inventory.remove(item, amount)
  inventory.add(recipe.result, 1)
  return true
}
