import type { ActionData } from '../sim/commands'
import { EAT_KEY } from '../sim/constants'
import { cycleSlot, SLOT_COUNT, type ItemId } from '../sim/inventory'
import { CLICK, RIGHT_CLICK } from './input'

/** Teclas que abren la pantalla de inventario jugando (y la cierran, desde la pantalla). */
export const INVENTORY_KEYS: ReadonlySet<string> = new Set(['Tab', 'KeyE'])
/** Abre la misma pantalla con las recetas a la vista (y también la cierra). */
export const RECIPES_KEY = 'KeyC'

/** Qué se quiere ver al abrir la pantalla de inventario. */
export type InventoryFocus = 'slots' | 'recipes'

/** Lo que hace falta saber de un paso para traducir sus pulsaciones en acciones (sin DOM ni Game). */
export interface KeyStep {
  /** Teclas pulsadas en el paso (por e.code, más CLICK y RIGHT_CLICK). */
  presses: ReadonlySet<string>
  /** Pasos de rueda (positivo hacia abajo). */
  wheel: number
  /** La casilla elegida y lo que hay en cada una. */
  selected: number
  slots: readonly (ItemId | null)[]
  /** Si el clic golpea (no lo hace con `attackOverride` de debug, que golpea manteniendo). */
  clickSwings: boolean
}

/**
 * Acciones de las pulsaciones de un paso, detrás de las ya encoladas (`queued`, de `__debug` o de la pantalla de
 * inventario). Los números y la rueda eligen casilla. El clic coloca la fogata si es lo que queda en la mano y, si
 * no, golpea. Devuelve también si se pide abrir la pantalla de inventario: Tab o E, en las casillas, o C, en las
 * recetas (null, si no). Fabricar se hace desde la pantalla.
 */
export function stepActions(queued: readonly ActionData[], k: KeyStep): { actions: ActionData[]; inventory: InventoryFocus | null } {
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
  if (k.presses.has(CLICK)) {
    if (slots[selected] === 'campfire') actions.push({ kind: 'place' })
    else if (k.clickSwings) actions.push({ kind: 'swing' })
  }
  if (k.presses.has(EAT_KEY) || k.presses.has(RIGHT_CLICK)) actions.push({ kind: 'eat' })
  const inventory = k.presses.has(RECIPES_KEY) ? 'recipes' : [...INVENTORY_KEYS].some((code) => k.presses.has(code)) ? 'slots' : null
  return { actions, inventory }
}
