import type { Inventory, ItemId } from './inventory'
import type { Vec3 } from './player'
import type { StructureKind } from './structures'

/** Lo que fabricar necesita del mundo: si hay una estructura de ese tipo al alcance desde `pos`. */
export interface CraftWorld {
  nearStation(kind: StructureKind, pos: Vec3): boolean
  /** Si queda hueco en la cola de una estación de ese tipo al alcance (sin decirlo: lo hay). */
  hasRoom?(kind: StructureKind, pos: Vec3): boolean
  /** Pone el trabajo en la cola de la estación al alcance. */
  enqueue?(recipe: Recipe, pos: Vec3): void
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
  | 'cooked_meat'
  | 'berry_infusion'
  | 'wood_sword'
  | 'stone_sword'
  | 'iron_sword'
  | 'mithril_sword'
  | 'meteor_sword'
  | 'distiller'
  | 'oil'

export interface Recipe {
  id: RecipeId
  result: ItemId
  cost: { item: ItemId; amount: number }[]
  /** Estructura que hay que tener cerca (la fogata también cuenta como estación); null, en cualquier sitio. */
  station: StructureKind | null
  /**
   * Segundos que trabaja la estación: se carga, se puede ir uno y lo terminado queda junto a ella para quien pase. Sin
   * esto se fabrica al momento y va al inventario.
   */
  time?: number
}

// El orden solo sirve para la UI: es el de la columna de recetas de la pantalla de inventario.
export const RECIPES: readonly Recipe[] = [
  { id: 'wood_axe', result: 'wood_axe', cost: [{ item: 'wood', amount: 5 }], station: null },
  { id: 'wood_pickaxe', result: 'wood_pickaxe', cost: [{ item: 'wood', amount: 5 }], station: null },
  { id: 'campfire', result: 'campfire', cost: [{ item: 'wood', amount: 6 }, { item: 'stone', amount: 3 }], station: null },
  { id: 'workbench', result: 'workbench', cost: [{ item: 'wood', amount: 10 }], station: null },
  { id: 'wood_sword', result: 'wood_sword', cost: [{ item: 'wood', amount: 5 }], station: 'workbench' },
  { id: 'stone_axe', result: 'stone_axe', cost: [{ item: 'wood', amount: 3 }, { item: 'stone', amount: 5 }], station: 'workbench' },
  { id: 'stone_pickaxe', result: 'stone_pickaxe', cost: [{ item: 'wood', amount: 3 }, { item: 'stone', amount: 5 }], station: 'workbench' },
  { id: 'stone_sword', result: 'stone_sword', cost: [{ item: 'wood', amount: 3 }, { item: 'stone', amount: 2 }], station: 'workbench' },
  { id: 'furnace', result: 'furnace', cost: [{ item: 'stone', amount: 12 }, { item: 'wood', amount: 4 }], station: 'workbench' },
  { id: 'distiller', result: 'distiller', cost: [{ item: 'wood', amount: 8 }, { item: 'stone', amount: 4 }], station: 'workbench' },
  { id: 'anvil', result: 'anvil', cost: [{ item: 'iron_bar', amount: 4 }, { item: 'stone', amount: 6 }], station: 'workbench' },
  { id: 'iron_bar', result: 'iron_bar', cost: [{ item: 'iron_ore', amount: 1 }, { item: 'wood', amount: 1 }], station: 'furnace', time: 15 },
  { id: 'mithril_bar', result: 'mithril_bar', cost: [{ item: 'mithril_ore', amount: 1 }, { item: 'wood', amount: 2 }], station: 'furnace', time: 25 },
  { id: 'iron_axe', result: 'iron_axe', cost: [{ item: 'iron_bar', amount: 3 }, { item: 'birch_wood', amount: 2 }], station: 'anvil' },
  { id: 'iron_pickaxe', result: 'iron_pickaxe', cost: [{ item: 'iron_bar', amount: 3 }, { item: 'birch_wood', amount: 2 }], station: 'anvil' },
  { id: 'iron_sword', result: 'iron_sword', cost: [{ item: 'iron_bar', amount: 3 }, { item: 'birch_wood', amount: 2 }], station: 'anvil' },
  { id: 'mithril_axe', result: 'mithril_axe', cost: [{ item: 'mithril_bar', amount: 3 }, { item: 'dark_wood', amount: 2 }], station: 'anvil' },
  { id: 'mithril_pickaxe', result: 'mithril_pickaxe', cost: [{ item: 'mithril_bar', amount: 3 }, { item: 'dark_wood', amount: 2 }], station: 'anvil' },
  { id: 'mithril_sword', result: 'mithril_sword', cost: [{ item: 'mithril_bar', amount: 2 }, { item: 'dark_wood', amount: 2 }], station: 'anvil' },
  { id: 'meteor_sword', result: 'meteor_sword', cost: [{ item: 'meteor_fragment', amount: 3 }, { item: 'dark_wood', amount: 2 }], station: 'anvil' },
  { id: 'cooked_meat', result: 'cooked_meat', cost: [{ item: 'raw_meat', amount: 1 }], station: 'campfire', time: 10 },
  { id: 'berry_infusion', result: 'berry_infusion', cost: [{ item: 'berry', amount: 4 }], station: 'campfire', time: 15 },
  // Con carne cruda: compite con la comida.
  { id: 'oil', result: 'oil', cost: [{ item: 'raw_meat', amount: 1 }, { item: 'wood', amount: 2 }], station: 'distiller', time: 60 },
]

const BY_ID = new Map<string, Recipe>(RECIPES.map((r) => [r.id, r]))

export const RECIPE_IDS: readonly RecipeId[] = RECIPES.map((r) => r.id)

export const isRecipeId = (id: unknown): id is RecipeId => typeof id === 'string' && BY_ID.has(id)

export const recipeById = (id: RecipeId): Recipe | undefined => BY_ID.get(id)

export function canCraft(inventory: Inventory, recipe: Recipe): boolean {
  if (!recipe.cost.every(({ item, amount }) => inventory.has(item, amount))) return false
  // Lo que hace una estación no va al inventario.
  if (recipe.time !== undefined) return true
  // Con el inventario lleno aún cabe si algún ingrediente se agota y libera su casilla.
  return inventory.canAdd(recipe.result) || recipe.cost.some(({ item, amount }) => inventory.count(item) === amount)
}

/** Gasta los ingredientes y, si no lo hace una estación, añade el resultado. Devuelve false sin tocar nada si no se puede. */
export function craft(inventory: Inventory, recipe: Recipe): boolean {
  if (!canCraft(inventory, recipe)) return false
  for (const { item, amount } of recipe.cost) inventory.remove(item, amount)
  if (recipe.time === undefined) inventory.add(recipe.result, 1)
  return true
}
