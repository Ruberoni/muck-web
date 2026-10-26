import type { ActionData } from '../sim/commands'
import { canCraft, craft, RECIPES, recipeById, type CraftWorld, type Recipe, type StationKind } from '../sim/crafting'
import { Inventory, ITEM_NAMES, type ItemId } from '../sim/inventory'
import type { Vec3 } from '../sim/player'
import { stationNear, type Structure } from '../sim/structures'

/** Cuántas veces fabrica Mayúsculas + clic (cada una es una acción `craft`, en el mismo paso). */
export const CRAFT_MANY = 5

/**
 * Alcance de las estaciones para el cliente: algo menos que STATION_RANGE (3,5 m en la simulación), para que una
 * pequeña diferencia de posición en el borde no acabe en un `craft` que el servidor rechaza y una corrección.
 */
export const CLIENT_STATION_RANGE = 3.3

/** El mundo de fabricar tal como lo ve el cliente: las estaciones de `structures()` con el alcance con margen. */
export const clientCraftWorld = (structures: () => readonly Structure[]): CraftWorld => ({
  nearStation: (kind, pos) => stationNear(structures(), kind, pos, CLIENT_STATION_RANGE),
})

const STATION_NAMES: Record<StationKind, string> = { workbench: 'Mesa de trabajo', furnace: 'Horno', anvil: 'Yunque' }
const STATION_NEEDED: Record<StationKind, string> = {
  workbench: 'Necesitas una mesa de trabajo cerca',
  furnace: 'Necesitas un horno cerca',
  anvil: 'Necesitas un yunque cerca',
}

export interface RecipeGroup {
  station: StationKind | null
  title: string
  recipes: readonly Recipe[]
}

/** Las recetas por estación, en el orden de `RECIPES` (sin los grupos que aún no tienen ninguna). */
export const RECIPE_GROUPS: readonly RecipeGroup[] = ([null, 'workbench', 'furnace', 'anvil'] as const)
  .map((station) => ({ station, title: station ? STATION_NAMES[station] : 'Sin estación', recipes: RECIPES.filter((r) => r.station === station) }))
  .filter((group) => group.recipes.length > 0)

/**
 * Si el cliente da la receta por buena aquí: lo mismo que comprueba `craftRecipe` en la simulación, con el mundo del
 * cliente (`world`, que mira las estaciones con algo de margen para no acabar en una corrección en el borde).
 */
export const canCraftHere = (inventory: Inventory, recipe: Recipe, world: CraftWorld, pos: Vec3) =>
  (recipe.station === null || world.nearStation(recipe.station, pos)) && canCraft(inventory, recipe)

export interface CostStatus {
  item: ItemId
  amount: number
  /** Lo que se tiene; si es menos que `amount`, el ingrediente sale en rojo. */
  have: number
}

export interface RecipeStatus {
  available: boolean
  /** Por qué no se puede fabricar; null si se puede. */
  reason: string | null
  cost: CostStatus[]
}

const lower = (item: ItemId) => ITEM_NAMES[item].toLowerCase()

/** Lo que muestra la fila de una receta: coste con lo que se tiene y, si no se puede fabricar, el motivo. */
export function recipeStatus(inventory: Inventory, recipe: Recipe, world: CraftWorld, pos: Vec3): RecipeStatus {
  const cost = recipe.cost.map(({ item, amount }) => ({ item, amount, have: inventory.count(item) }))
  const reasons: string[] = []
  const missing = cost.filter((c) => c.have < c.amount)
  if (missing.length) {
    const one = missing.length === 1 && missing[0].amount - missing[0].have === 1
    reasons.push(`${one ? 'Falta' : 'Faltan'} ${missing.map((c) => `${c.amount - c.have} ${lower(c.item)}`).join(' y ')}`)
  }
  if (recipe.station !== null && !world.nearStation(recipe.station, pos)) reasons.push(STATION_NEEDED[recipe.station])
  // Con todo lo demás en orden, solo queda que no quepa (hoy no puede pasar: hay más casillas que tipos).
  if (!reasons.length && !canCraft(inventory, recipe)) reasons.push('Inventario lleno')
  return { available: !reasons.length, reason: reasons.length ? reasons.join(' · ') : null, cost }
}

/**
 * Las acciones de un paso sin los `craft` que el cliente da por fallidos: se repasan en orden sobre una copia del
 * inventario (las anteriores del mismo paso cuentan), igual que las aplicará la simulación. Así Mayúsculas + clic
 * solo manda las que se pueden hacer y, con estaciones, el clic justo tras colocar una (antes de que el servidor la
 * confirme) no hace nada en vez de acabar en una corrección. `pos` es la posición con la que se aplicarán.
 */
export function sendableActions(actions: readonly ActionData[], inventory: Inventory, world: CraftWorld, pos: Vec3): ActionData[] {
  if (!actions.some((a) => a.kind === 'craft')) return [...actions]
  const scratch = new Inventory(inventory.slots.length)
  scratch.load(inventory.save())
  return actions.filter((action) => {
    // Hoy mover no cambia si cabe lo fabricado, pero se aplica igual para seguir a la simulación al pie de la letra.
    if (action.kind === 'move') scratch.move(action.from, action.to)
    if (action.kind !== 'craft') return true
    const recipe = recipeById(action.recipe)
    return !!recipe && canCraftHere(scratch, recipe, world, pos) && craft(scratch, recipe)
  })
}
