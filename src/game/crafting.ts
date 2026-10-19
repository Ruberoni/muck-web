import type { Inventory, ItemId } from './inventory'

export interface Recipe {
  result: ItemId
  cost: { item: ItemId; amount: number }[]
}

// El orden es el de las teclas 1–4 con el menú de crafteo abierto.
export const RECIPES: Recipe[] = [
  { result: 'wood_axe', cost: [{ item: 'wood', amount: 5 }] },
  { result: 'wood_pickaxe', cost: [{ item: 'wood', amount: 5 }] },
  { result: 'stone_axe', cost: [{ item: 'wood', amount: 3 }, { item: 'stone', amount: 5 }] },
  { result: 'stone_pickaxe', cost: [{ item: 'wood', amount: 3 }, { item: 'stone', amount: 5 }] },
]

export function canCraft(inventory: Inventory, recipe: Recipe): boolean {
  if (!recipe.cost.every(({ item, amount }) => inventory.has(item, amount))) return false
  // Con la hotbar llena aún cabe si algún ingrediente se agota y libera su casilla.
  return inventory.canAdd(recipe.result) || recipe.cost.some(({ item, amount }) => inventory.count(item) === amount)
}

/** Gasta los ingredientes y añade el resultado. Devuelve false sin tocar nada si no se puede. */
export function craft(inventory: Inventory, recipe: Recipe): boolean {
  if (!canCraft(inventory, recipe)) return false
  for (const { item, amount } of recipe.cost) inventory.remove(item, amount)
  inventory.add(recipe.result, 1)
  return true
}
