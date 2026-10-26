import type { ActionData } from '../sim/commands'
import { EAT_KEY } from '../sim/constants'
import { RECIPES } from '../sim/crafting'
import { cycleSlot, SLOT_COUNT, type ItemId } from '../sim/inventory'
import type { GameState } from './Game'
import { CLICK, RIGHT_CLICK } from './input'

/**
 * Estados en los que cuentan las pulsaciones de teclado: también muerto en una sala, donde Tab cambia a quién se
 * mira y Enter abre el chat. El clic y la rueda solo cuentan en `playing`.
 */
export const acceptsKeys = (state: GameState) => state === 'playing' || state === 'spectating'

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
 * si no, golpea. Devuelve también si el crafteo queda abierto.
 */
export function stepActions(queued: readonly ActionData[], k: KeyStep): { actions: ActionData[]; crafting: boolean } {
  const actions = [...queued]
  // La casilla que quedará elegida tras las acciones de este paso.
  let selected = k.selected
  for (const action of actions) if (action.kind === 'select') selected = action.slot
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
    if (k.slots[selected] === 'campfire') actions.push({ kind: 'place' })
    else if (k.clickSwings) actions.push({ kind: 'swing' })
  }
  if (k.presses.has(EAT_KEY) || k.presses.has(RIGHT_CLICK)) actions.push({ kind: 'eat' })
  return { actions, crafting }
}
