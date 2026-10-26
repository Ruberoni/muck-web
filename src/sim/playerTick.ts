import { buttonsInput, Btn, type PlayerCommands } from './commands'
import { BERRY_FOOD, STEP } from './constants'
import { craft, recipeById, type CraftWorld, type RecipeId } from './crafting'
import type { Emit, TargetRef } from './events'
import { startSwing, type Fighter } from './interaction'
import { stepPlayer, type Player, type PlayerEnv } from './player'
import { placeableOf } from './structures'
import { eat, stepSurvival } from './survival'

// La parte de un tick que toca solo al jugador y que el cliente predice: acciones sobre su inventario,
// movimiento, espera entre golpes, comer y hambre. `Simulation.step` la ejecuta por trozos alrededor de lo que
// pasa en el mundo (enemigos, golpes, objetos del suelo); `predictPlayer` la ejecuta de una vez, sin mundo.

/**
 * Lo que la parte propia del tick necesita de un jugador (un PlayerSlot lo cumple): su cuerpo, inventario,
 * golpes, si está vivo y lo que lleva aplicado de sus acciones.
 */
export interface Actor extends Fighter {
  player: Player
  alive: boolean
  /** `seq` de la última acción aplicada: las de `seq` menor o igual se descartan. */
  appliedSeq: number
}

/** Lo que el jugador quiere hacer en este paso además de moverse. */
export interface Intent {
  /** Lo que el cliente dice tener delante; sin él (un jugador), lo calcula la simulación. */
  aim: TargetRef | null | undefined
  attack: boolean
  swing: boolean
  place: boolean
  eat: boolean
}

/**
 * Aplica una vez y en orden de `seq` las acciones nuevas: elegir casilla, mover casillas y fabricar en el acto;
 * golpear, colocar y comer se devuelven para su momento del paso. Las de un muerto se descartan.
 */
export function applyActions(actor: Actor, command: PlayerCommands | undefined, world: CraftWorld, emit: Emit): Intent {
  const move = command?.move
  const intent: Intent = { aim: move?.aim, attack: ((move?.buttons ?? 0) & Btn.Attack) !== 0, swing: false, place: false, eat: false }
  if (!command) return intent
  for (const action of [...command.actions].sort((a, b) => a.seq - b.seq)) {
    if (action.seq <= actor.appliedSeq) continue
    actor.appliedSeq = action.seq
    if (!actor.alive) continue
    switch (action.kind) {
      case 'select':
        actor.inventory.select(action.slot)
        break
      case 'move':
        actor.inventory.move(action.from, action.to)
        break
      case 'craft':
        craftRecipe(actor, action.recipe, world, emit)
        break
      case 'swing':
        intent.swing = true
        break
      case 'place':
        intent.place = true
        break
      case 'eat':
        intent.eat = true
        break
    }
  }
  return intent
}

/**
 * Fabrica la receta `id` si hay ingredientes y, si la pide, su estación al alcance. La posición es la del final
 * del tick anterior (las acciones se aplican antes de moverse), igual en la simulación y en la predicción.
 */
export function craftRecipe(actor: Actor, id: RecipeId, world: CraftWorld, emit: Emit): boolean {
  const recipe = recipeById(id)
  if (!recipe) return false
  if (recipe.station !== null && !world.nearStation(recipe.station, actor.player.pos)) return false
  if (!craft(actor.inventory, recipe)) return false
  emit({ type: 'playerCrafted', id: actor.id, recipe: id })
  return true
}

/** Orienta al jugador como dice su `Move` (sin él, mira a donde miraba) y lo mueve un paso. */
export function movePlayer(actor: Actor, command: PlayerCommands | undefined, env: PlayerEnv) {
  const { player } = actor
  if (command) {
    player.yaw = command.move.yaw
    player.pitch = command.move.pitch
  }
  stepPlayer(player, buttonsInput(command?.move.buttons ?? 0), env, STEP)
}

/**
 * Lo que hacen las manos en este paso: si empieza un golpe y si toca colocar lo que se lleva. Con algo colocable
 * en la mano (PLACEABLE_DEFS) el clic lo coloca en vez de golpear, y no queda ningún golpe pendiente.
 */
export function useHands(actor: Actor, intent: Intent): { swing: boolean; place: boolean } {
  const placing = placeableOf(actor.inventory.selectedItem) !== null
  if (placing) actor.combat.pendingSwing = false
  const swing = startSwing(actor.combat, STEP, !placing && intent.attack, !placing && intent.swing)
  return { swing, place: placing && intent.place }
}

/** Final del paso del jugador: comer y hambre (morir lo decide la simulación). */
export function finishPlayerTick(actor: Actor, intent: Intent, emit: Emit) {
  if (intent.eat) eatBerry(actor, emit)
  stepSurvival(actor.player, STEP)
}

function eatBerry(actor: Actor, emit: Emit) {
  const { inventory, player, id } = actor
  if (inventory.count('berry') === 0 || !eat(player, BERRY_FOOD)) return
  inventory.remove('berry', 1)
  emit({ type: 'playerAte', id })
}

/** Lo que la predicción necesita del mundo del cliente: `nearStation` mira las estaciones de su espejo. */
export interface PredictWorld extends CraftWorld {
  env: PlayerEnv
  /** Si una estructura de radio `radius` colocada desde aquí caería en un sitio válido (structureSpot contra las rejillas del cliente). */
  canPlace(player: Player, radius: number): boolean
  emit: Emit
}

/**
 * Un tick del jugador del cliente sin tocar el mundo: lo mismo que hace `Simulation.step` con él, salvo lo que
 * depende de los demás (daño de enemigos, golpes que aciertan, recogidas y bayas) y sin consumir el azar.
 * `place` gasta lo que se coloca si el sitio es válido, pero no crea la estructura: la crea el servidor y llega en su evento.
 * Emite lo que el jugador hace (golpe con el objetivo que dice tener delante, fabricar, comer, colocar).
 * Devuelve si empieza un golpe.
 */
export function predictPlayer(actor: Actor, command: PlayerCommands | undefined, world: PredictWorld): boolean {
  const intent = applyActions(actor, command, world, world.emit)
  if (!actor.alive) return false
  movePlayer(actor, command, world.env)
  const hands = useHands(actor, intent)
  if (hands.swing) world.emit({ type: 'playerSwing', id: actor.id, item: actor.inventory.selectedItem, target: intent.aim ?? null })
  const placed = hands.place ? placeableOf(actor.inventory.selectedItem) : null
  if (placed && world.canPlace(actor.player, placed.radius)) {
    const item = actor.inventory.selectedItem!
    world.emit({ type: 'playerPlaced', id: actor.id, item })
    actor.inventory.remove(item, 1)
  }
  finishPlayerTick(actor, intent, world.emit)
  return hands.swing
}
