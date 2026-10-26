import type { ActionData } from '../sim/commands'
import { EAT_KEY } from '../sim/constants'
import { RECIPES } from '../sim/crafting'
import { cycleSlot, SLOT_COUNT, type ItemId } from '../sim/inventory'
import { CLICK, RIGHT_CLICK } from './input'

/** Teclas que abren la pantalla de inventario jugando (y la cierran, desde la pantalla). */
export const INVENTORY_KEYS: ReadonlySet<string> = new Set(['Tab', 'KeyE'])

/** Lo que hace falta saber de un paso para traducir sus pulsaciones en acciones (sin DOM ni Game). */
export interface KeyStep {
  /** Teclas pulsadas en el paso (por e.code, más CLICK y RIGHT_CLICK). */
  presses: ReadonlySet<string>
  /** Pasos de rueda (positivo hacia abajo). */
  wheel: number
  /** Si el panel de crafteo estaba abierto al empezar el paso. */
  crafting: boolean
  /** La casilla elegida y lo que hay en cada una. */
  selected: number
  slots: readonly (ItemId | null)[]
  /** Si el clic golpea (no lo hace con `attackOverride` de debug, que golpea manteniendo). */
  clickSwings: boolean
}

/**
 * Acciones de las pulsaciones de un paso, detrás de las ya encoladas (`queued`, de `__debug`). C abre o cierra
 * el crafteo; los números eligen casilla o, con el crafteo abierto, fabrican, pero solo recetas que existen: una
 * receta fuera de rango hace que la sala rechace el mensaje entero y expulse al jugador. La rueda mueve la casilla
 * elegida salvo con el crafteo abierto, donde se ignora. El clic coloca la fogata si es lo que queda en la mano y,
 * si no, golpea. Devuelve también si el crafteo queda abierto y si se pide abrir el inventario (Tab o E), que
 * cierra el crafteo.
 */
export function stepActions(queued: readonly ActionData[], k: KeyStep): { actions: ActionData[]; crafting: boolean; inventory: boolean } {
  const actions = [...queued]
  // La casilla que quedará elegida y lo que habrá en cada una tras las acciones encoladas (fabricar no se tiene en
  // cuenta: lo fabricado solo llega a la mano si cae justo en la casilla elegida, que estaba vacía).
  let selected = k.selected
  const slots = [...k.slots]
  for (const action of actions) {
    if (action.kind === 'select') selected = action.slot
    else if (action.kind === 'move') [slots[action.from], slots[action.to]] = [slots[action.to], slots[action.from]]
  }
  const crafting = k.presses.has('KeyC') ? !k.crafting : k.crafting
  for (let i = 0; i < SLOT_COUNT; i++) {
    if (!k.presses.has(`Digit${i + 1}`)) continue
    if (crafting) {
      if (i < RECIPES.length) actions.push({ kind: 'craft', recipe: RECIPES[i].id })
    } else {
      actions.push({ kind: 'select', slot: i })
      selected = i
    }
  }
  if (k.wheel && !crafting) {
    selected = cycleSlot(selected, k.wheel)
    actions.push({ kind: 'select', slot: selected })
  }
  if (k.presses.has(CLICK)) {
    if (slots[selected] === 'campfire') actions.push({ kind: 'place' })
    else if (k.clickSwings) actions.push({ kind: 'swing' })
  }
  if (k.presses.has(EAT_KEY) || k.presses.has(RIGHT_CLICK)) actions.push({ kind: 'eat' })
  const inventory = [...INVENTORY_KEYS].some((code) => k.presses.has(code))
  return { actions, crafting: crafting && !inventory, inventory }
}
