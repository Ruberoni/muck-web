import type { ActionData } from '../sim/commands'
import { canCraft, craft, RECIPES, recipeById, type CraftWorld, type Recipe } from '../sim/crafting'
import { Inventory, ITEM_NAMES, type ItemId } from '../sim/inventory'
import type { Vec3 } from '../sim/player'
import { stationNear, type Structure, type StructureKind } from '../sim/structures'

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

export const STATION_NAMES: Record<StructureKind, string> = { campfire: 'Fogata', workbench: 'Mesa de trabajo', furnace: 'Horno', anvil: 'Yunque', lighthouse: 'Faro', distiller: 'Destilador', totem: 'Tótem', plane: 'Avión', grave: 'Tumba', merchant: 'Mercader' }
const STATION_NEEDED: Record<StructureKind, string> = {
  campfire: 'Necesitas una fogata cerca',
  workbench: 'Necesitas una mesa de trabajo cerca',
  furnace: 'Necesitas un horno cerca',
  anvil: 'Necesitas un yunque cerca',
  lighthouse: 'Necesitas un faro cerca',
  distiller: 'Necesitas un destilador cerca',
  totem: 'Necesitas un tótem cerca',
  plane: 'Necesitas el avión cerca',
  grave: 'Necesitas la tumba cerca',
  merchant: 'Necesitas el mercader cerca',
}

/** Estaciones que se abren con clic derecho: las de procesar muestran sus ranuras; la mesa y el yunque, sus recetas. */
const OPENABLE: ReadonlySet<StructureKind> = new Set(['campfire', 'furnace', 'distiller', 'workbench', 'anvil', 'merchant'])
/** Medio ángulo del cono de la mirada dentro del que se abre (en horizontal). */
const AIM_COS = Math.cos((40 * Math.PI) / 180)

/**
 * La estación que se tiene delante para abrirla: a `range` o menos de su borde y dentro del cono de la mirada (`yaw`),
 * la más centrada. Pegado a ella, cualquier dirección vale.
 */
export function aimedStation(structures: readonly Structure[], pos: Vec3, yaw: number, range: number): Structure | null {
  // forward = (-sin(yaw), -cos(yaw))
  const fx = -Math.sin(yaw)
  const fz = -Math.cos(yaw)
  let best: Structure | null = null
  let bestCos = -Infinity
  for (const s of structures) {
    if (!OPENABLE.has(s.kind)) continue
    const dx = s.x - pos.x
    const dz = s.z - pos.z
    const distance = Math.hypot(dx, dz)
    if (distance - s.radius > range) continue
    const cos = distance < s.radius + 0.5 ? 1 : (dx * fx + dz * fz) / distance
    if (cos < AIM_COS || cos <= bestCos) continue
    best = s
    bestCos = cos
  }
  return best
}

/**
 * La estación de procesar (fogata, horno, destilador) más cercana a `range` o menos de su borde: la que enseña sus
 * ranuras al abrir el inventario con Tab o E a su lado, sin tener que mirarla.
 */
export function nearestProcessor(structures: readonly Structure[], pos: Vec3, range: number): Structure | null {
  let best: Structure | null = null
  let bestGap = Infinity
  for (const s of structures) {
    if (!s.station && !s.shop) continue
    const gap = Math.hypot(s.x - pos.x, s.z - pos.z) - s.radius
    if (gap > range || gap >= bestGap) continue
    best = s
    bestGap = gap
  }
  return best
}

export interface RecipeGroup {
  station: StructureKind | null
  title: string
  recipes: readonly Recipe[]
}

/** Las recetas por estación, en el orden de `RECIPES` (sin los grupos que aún no tienen ninguna). */
export const RECIPE_GROUPS: readonly RecipeGroup[] = ([null, 'campfire', 'workbench', 'furnace', 'anvil', 'distiller'] as const)
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
    // Ponerse algo puede liberar una casilla, y quitárselo, ocuparla.
    if (action.kind === 'equip') scratch.equip(action.slot)
    if (action.kind === 'unequip') scratch.unequip(action.which)
    // Lo tirado antes en el mismo paso ya no está para fabricar.
    if (action.kind === 'drop') {
      const item = scratch.slots[action.slot]
      if (item) scratch.remove(item, action.all ? scratch.count(item) : 1)
    }
    if (action.kind !== 'craft') return true
    const recipe = recipeById(action.recipe)
    return !!recipe && canCraftHere(scratch, recipe, world, pos) && craft(scratch, recipe)
  })
}
