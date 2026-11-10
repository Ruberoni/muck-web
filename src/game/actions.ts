import type { ActionData } from '../sim/commands'
import { CONSUMABLE_DEFS } from '../sim/constants'
import { cycleSlot, SLOT_COUNT, type ItemId } from '../sim/inventory'
import { placeableOf } from '../sim/structures'
import { anyOf, codesOf, DEFAULT_BINDINGS, type Bindings } from './bindings'
import { withCtrl } from './input'

/** Si lo que se lleva en la mano se come. */
export const holdsFood = (item: ItemId | null | undefined) => !!item && CONSUMABLE_DEFS[item] !== undefined

/** Qué se quiere ver al abrir la pantalla de inventario. */
export type InventoryFocus = 'slots' | 'recipes'

/** Lo que hace falta saber de un paso para traducir sus pulsaciones en acciones (sin DOM ni Game). */
export interface KeyStep {
  /** Teclas pulsadas en el paso (por e.code, más los pseudo-códigos del ratón). */
  presses: ReadonlySet<string>
  /** Pasos de rueda (positivo hacia abajo). */
  wheel: number
  /** La casilla elegida y lo que hay en cada una. */
  selected: number
  slots: readonly (ItemId | null)[]
  /** Si el clic golpea (no lo hace con `attackOverride` de debug, que golpea manteniendo). */
  clickSwings: boolean
  /** Hay algo cerca que usar: su tecla actúa sobre ello en vez de abrir el inventario. */
  usable?: boolean
  /** Lleva escudo: el clic derecho bloquea en vez de comer, salvo con comida en la mano. */
  shield?: boolean
  /** Teclas asignadas; sin ellas, las de siempre. */
  bindings?: Bindings
}

/**
 * Acciones de las pulsaciones de un paso, detrás de las ya encoladas (`queued`, de `__debug` o de la pantalla de
 * inventario). Los números y la rueda eligen casilla. Lo asignado a golpear coloca lo que queda en la mano si es
 * colocable (la fogata) y, si no, golpea. Lo asignado a tirar suelta uno de lo que haya en la mano (con Ctrl, todo).
 * Devuelve también si se pide abrir la pantalla de inventario: su tecla o, sin nada que usar cerca, la de usar, en
 * las casillas, o la de recetas, en las recetas (null, si no). Fabricar se hace desde la pantalla.
 */
export function stepActions(queued: readonly ActionData[], k: KeyStep): { actions: ActionData[]; inventory: InventoryFocus | null } {
  const b = k.bindings ?? DEFAULT_BINDINGS
  const actions = [...queued]
  // La casilla que quedará elegida y lo que habrá en cada una tras las acciones encoladas (fabricar no se tiene en
  // cuenta: lo fabricado solo llega a la mano si cae justo en la casilla elegida, que estaba vacía).
  let selected = k.selected
  const slots = [...k.slots]
  for (const action of actions) {
    if (action.kind === 'select') selected = action.slot
    else if (action.kind === 'move') [slots[action.from], slots[action.to]] = [slots[action.to], slots[action.from]]
  }
  for (let i = 0; i < SLOT_COUNT; i++) {
    if (!k.presses.has(`Digit${i + 1}`)) continue
    actions.push({ kind: 'select', slot: i })
    selected = i
  }
  if (k.wheel) {
    selected = cycleSlot(selected, k.wheel)
    actions.push({ kind: 'select', slot: selected })
  }
  if (anyOf(k.presses, b.attack)) {
    if (placeableOf(slots[selected])) actions.push({ kind: 'place' })
    else if (k.clickSwings) actions.push({ kind: 'swing' })
  }
  if (anyOf(k.presses, b.eat) || (anyOf(k.presses, b.block) && !(k.shield && !holdsFood(slots[selected])))) actions.push({ kind: 'eat' })
  if (anyOf(k.presses, b.drop) && slots[selected]) {
    const all = codesOf(b.drop).some((code) => k.presses.has(withCtrl(code)))
    actions.push({ kind: 'drop', slot: selected, all })
  }
  const opensInventory = anyOf(k.presses, b.inventory) || (anyOf(k.presses, b.use) && !k.usable)
  const inventory = anyOf(k.presses, b.recipes) ? 'recipes' : opensInventory ? 'slots' : null
  return { actions, inventory }
}
