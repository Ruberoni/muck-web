import { Btn, type ActionData } from '../sim/commands'
import { PROP_DEFS, TOOL_DEFS } from '../sim/constants'
import { canCraft, recipeById, type RecipeId } from '../sim/crafting'
import { SLOT_COUNT } from '../sim/inventory'
import type { PlayerSlot } from '../sim/Simulation'
import { canDamage } from '../sim/tiers'
import type { NetClient } from './client'
import type { MoveInput } from './session'

/**
 * Lo que hace un bot en cada tick: anda en círculos amplios, salta de vez en cuando y golpea lo que tenga
 * delante (así se ven su mano y sus golpes desde otro cliente). Sin azar: cada bot desfasado por su id.
 */
export function botMove(tick: number, id: number): MoveInput {
  const t = tick + id * 97
  return {
    buttons: Btn.Fwd | (t % 180 === 0 ? Btn.Jump : 0) | (t % 240 < 30 ? Btn.Attack : 0),
    yaw: t / 160,
    pitch: -0.1,
  }
}

/** Lo que el bot fabrica, en este orden, en cuanto tiene con qué (solo recetas sin estación: no coloca nada). */
export const BOT_RECIPES: readonly RecipeId[] = ['wood_axe', 'wood_pickaxe']

/** Un tick de un bot: su `Move` y las acciones de ese tick. */
export type BotStep = MoveInput & { actions: ActionData[] }

/**
 * Como `botMove`, pero mirando cómo le va (`slot`, el de su predicción): si tiene delante algo que puede romper, se
 * para a golpearlo con la mejor herramienta que lleve para eso; y fabrica lo de BOT_RECIPES que aún no tenga. Así
 * desde otro cliente se le ve talar, recoger y fabricar. Solo manda lo que su predicción da por bueno: nada que
 * la sala rechace ni que acabe en una corrección.
 */
export function botStep(tick: number, id: number, slot: PlayerSlot): BotStep {
  const move = botMove(tick, id)
  const { inventory, target } = slot
  const actions: ActionData[] = []
  const recipe = BOT_RECIPES.find((r) => !inventory.has(recipeById(r)!.result) && canCraft(inventory, recipeById(r)!))
  if (recipe) actions.push({ kind: 'craft', recipe })
  if (!slot.alive || !target || target.kind === 'enemy') return { ...move, actions }

  // La mejor herramienta de la hotbar para lo que tiene delante; si no lleva ninguna, sigue con lo que tenga.
  const family = PROP_DEFS[target.kind].tool
  let best = -1
  let bestTier = 0
  for (let i = 0; i < SLOT_COUNT; i++) {
    const item = inventory.slots[i]
    const tool = item ? TOOL_DEFS[item] : undefined
    if (tool && tool.family === family && tool.tier > bestTier) [best, bestTier] = [i, tool.tier]
  }
  if (best >= 0 && best !== inventory.selected) actions.push({ kind: 'select', slot: best })
  const held = best >= 0 ? inventory.slots[best] : inventory.selectedItem
  if (!canDamage(held, target.kind)) return { ...move, actions }
  return { buttons: Btn.Attack, yaw: move.yaw, pitch: move.pitch, actions }
}

/** Un frame de un cliente sin pantalla: predice los ticks que tocan con `script`, envía y pone el espejo al día. */
export function driveClient(client: NetClient, script: (tick: number) => MoveInput & { actions?: readonly ActionData[] }) {
  const ticks = client.advance()
  for (let i = 0; i < ticks; i++) {
    const { actions = [], ...move } = script(client.predictor!.tick + 1)
    client.step(move, actions)
  }
  client.flush()
  client.render()
}
