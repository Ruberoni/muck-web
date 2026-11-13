import { buttonsInput, Btn, type ActionData, type PlayerCommands } from './commands'
import { CONSUMABLE_DEFS, STEP } from './constants'
import { craft, recipeById, type CraftWorld, type RecipeId } from './crafting'
import type { Emit, TargetRef } from './events'
import { startSwing, stepStrike, type Fighter } from './interaction'
import type { Inventory, ItemId } from './inventory'
import { stepPlayer, type Player, type PlayerEnv, type Vec3 } from './player'
import { placeableOf } from './structures'
import { eat, isDead, stepSurvival, useful } from './survival'

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
  /** La tecla de uso, mantenida. */
  use: boolean
  swing: boolean
  place: boolean
  eat: boolean
  /** Lo tirado en este paso, ya fuera del inventario: la simulación lo deja en el suelo (la predicción no). */
  drops: { item: ItemId; amount: number }[]
  /** Lo que mete o saca de las estaciones: lo hace la simulación, que tiene las estaciones (la predicción no). */
  stations: StationOp[]
  /** Lo que compra, vende o mejora en el mercader: también lo hace la simulación. */
  trades: TradeOp[]
}

export type StationOp = Omit<Extract<ActionData, { kind: 'station' }>, 'kind'>
/** Una compra, una venta o un nivel de una mejora en el mercader. */
export type TradeOp = Extract<ActionData, { kind: 'shop' }>

/**
 * Aplica una vez y en orden de `seq` las acciones nuevas: elegir casilla, mover casillas, fabricar y tirar en el
 * acto; golpear, colocar y comer se devuelven para su momento del paso. Las de un muerto se descartan.
 */
export function applyActions(actor: Actor, command: PlayerCommands | undefined, world: CraftWorld, emit: Emit): Intent {
  const move = command?.move
  const buttons = move?.buttons ?? 0
  const intent: Intent = { aim: move?.aim, attack: (buttons & Btn.Attack) !== 0, use: (buttons & Btn.Use) !== 0, swing: false, place: false, eat: false, drops: [], stations: [], trades: [] }
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
      case 'equip': {
        const item = actor.inventory.slots[action.slot]
        if (item && actor.inventory.equip(action.slot)) emit({ type: 'playerEquipped', id: actor.id, item })
        break
      }
      case 'unequip':
        if (actor.inventory.unequip(action.which)) emit({ type: 'playerEquipped', id: actor.id, item: null })
        break
      case 'craft':
        craftRecipe(actor, action.recipe, world, emit)
        break
      case 'station':
        intent.stations.push({ id: action.id, slot: action.slot, from: action.from, all: action.all })
        break
      case 'shop':
        intent.trades.push(action)
        break
      case 'drop': {
        const dropped = dropFromSlot(actor, action.slot, action.all, emit)
        if (dropped) intent.drops.push(dropped)
        break
      }
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
  const { pos } = actor.player
  if (recipe.station !== null && !world.nearStation(recipe.station, pos)) return false
  if (!craft(actor.inventory, recipe)) return false
  emit({ type: 'playerCrafted', id: actor.id, recipe: id })
  return true
}

/** Saca del inventario una unidad de la casilla `slot` (o la pila entera, con `all`); null si está vacía o no existe. */
export function dropFromSlot(actor: Actor, slot: number, all: boolean, emit: Emit): { item: ItemId; amount: number } | null {
  const item = actor.inventory.slots[slot]
  if (!item) return null
  const amount = all ? actor.inventory.count(item) : 1
  if (!actor.inventory.remove(item, amount)) return null
  emit({ type: 'playerDropped', id: actor.id, item, amount })
  return { item, amount }
}

/** Orienta al jugador como dice su `Move` (sin él, mira a donde miraba) y lo mueve un paso. Solo bloquea con escudo. */
export function movePlayer(actor: Actor, command: PlayerCommands | undefined, env: PlayerEnv) {
  const { player } = actor
  if (command) {
    player.yaw = command.move.yaw
    player.pitch = command.move.pitch
  }
  const input = buttonsInput(command?.move.buttons ?? 0)
  // Comiendo no se levanta el escudo.
  input.block &&= actor.inventory.equipped.shield !== null && player.eatLeft <= 0
  stepPlayer(player, input, env, STEP)
}

/**
 * Lo que hacen las manos en este paso: si empieza un golpe, si pega el que estaba en el aire y si toca colocar lo
 * que se lleva. Con algo colocable en la mano (PLACEABLE_DEFS) el clic lo coloca en vez de golpear, y no queda
 * ningún golpe pendiente.
 */
export function useHands(actor: Actor, intent: Intent): { swing: boolean; strike: boolean; place: boolean } {
  const item = actor.inventory.selectedItem
  const placing = placeableOf(item) !== null
  // Con el escudo arriba o comiendo no se golpea ni se coloca, y no queda ningún golpe pendiente para después.
  const eating = actor.player.eatLeft > 0
  const busy = placing || actor.player.blocking || eating
  if (busy) actor.combat.pendingSwing = false
  const strike = stepStrike(actor.combat, STEP, item, actor.player.blocking || eating)
  const swing = startSwing(actor.combat, STEP, !busy && intent.attack, !busy && intent.swing, item)
  return { swing, strike, place: placing && !actor.player.blocking && !eating && intent.place }
}

/**
 * Final del paso del jugador: comer y hambre (morir lo decide la simulación). Con la vida a 0 por un golpe de este
 * mismo paso ya no hace nada: ni comer ni regenerar devuelven a la vida. `warm`: si está al calor de una fogata
 * encendida (`warmAt`), que también cura.
 */
export function finishPlayerTick(actor: Actor, intent: Intent, emit: Emit, warm: boolean) {
  if (isDead(actor.player)) return
  stepEating(actor, emit)
  if (intent.eat && actor.player.eatLeft <= 0 && !actor.player.blocking && actor.combat.strikeLeft <= 0) startEating(actor, emit)
  stepSurvival(actor.player, STEP, warm)
}

/** Lo que se comería ahora: lo que se lleva en la mano, si es consumible; si no, una baya, si hay. */
export function nextFood(inventory: Inventory): ItemId | null {
  const held = inventory.selectedItem
  if (held && CONSUMABLE_DEFS[held]) return held
  return inventory.has('berry') ? 'berry' : null
}

/** Empieza a comer lo que toca (`nextFood`), si sirve de algo: tarda su `time`, y no se gasta hasta acabar. */
function startEating(actor: Actor, emit: Emit) {
  const { inventory, player, id } = actor
  const item = nextFood(inventory)
  const def = item && CONSUMABLE_DEFS[item]
  if (!item || !def || !useful(player, def)) return
  player.eatItem = item
  player.eatLeft = def.time
  emit({ type: 'playerEating', id, item, seconds: def.time })
}

/**
 * Lo que está comiendo, un paso: al acabar, si aún sirve, se lo come (el efecto y `playerAte`). Si cambia de casilla
 * (ya no es lo que se comería) o lo pierde, se queda sin comer y no lo gasta.
 */
function stepEating(actor: Actor, emit: Emit) {
  const { inventory, player, id } = actor
  if (player.eatLeft <= 0) return
  const item = player.eatItem
  if (!item || nextFood(inventory) !== item) return cancelEating(actor, emit)
  player.eatLeft -= STEP
  if (player.eatLeft > 1e-9) return
  player.eatLeft = 0
  player.eatItem = null
  if (!eat(player, CONSUMABLE_DEFS[item]!)) return emit({ type: 'playerEatCancelled', id })
  inventory.remove(item, 1)
  emit({ type: 'playerAte', id, item })
}

function cancelEating({ player, id }: Actor, emit: Emit) {
  player.eatLeft = 0
  player.eatItem = null
  emit({ type: 'playerEatCancelled', id })
}

/** Lo que la predicción necesita del mundo del cliente: `nearStation` mira las estaciones de su espejo. */
export interface PredictWorld extends CraftWorld {
  env: PlayerEnv
  /** Si una estructura de radio `radius` colocada desde aquí caería en un sitio válido (structureSpot contra las rejillas del cliente). */
  canPlace(player: Player, radius: number): boolean
  /** Si desde `pos` se está al calor de una fogata encendida en el tick `tick` (`warmAt` contra las estaciones del espejo). */
  warm(pos: Vec3, tick: number | undefined): boolean
  emit: Emit
}

/**
 * Un tick del jugador del cliente sin tocar el mundo: lo mismo que hace `Simulation.step` con él, salvo lo que
 * depende de los demás (daño de enemigos, golpes que aciertan, recogidas y bayas) y sin consumir el azar.
 * `place` gasta lo que se coloca si el sitio es válido, pero no crea la estructura: la crea el servidor y llega en su evento.
 * `drop` lo saca del inventario, pero no lo deja en el suelo: lo tira el servidor y llega en su `pickupSpawn`.
 * Emite lo que el jugador hace (golpe con el objetivo que dice tener delante, fabricar, tirar, comer, colocar).
 * Devuelve si empieza un golpe.
 */
export function predictPlayer(actor: Actor, command: PlayerCommands | undefined, world: PredictWorld): boolean {
  const intent = applyActions(actor, command, world, world.emit)
  if (!actor.alive) return false
  movePlayer(actor, command, world.env)
  const hands = useHands(actor, intent)
  if (hands.strike) world.emit({ type: 'playerStrike', id: actor.id, item: actor.inventory.selectedItem, target: intent.aim ?? null })
  if (hands.swing) world.emit({ type: 'playerSwing', id: actor.id, item: actor.inventory.selectedItem, target: intent.aim ?? null })
  const placed = hands.place ? placeableOf(actor.inventory.selectedItem) : null
  if (placed && world.canPlace(actor.player, placed.radius)) {
    const item = actor.inventory.selectedItem!
    world.emit({ type: 'playerPlaced', id: actor.id, item })
    actor.inventory.remove(item, 1)
  }
  finishPlayerTick(actor, intent, world.emit, world.warm(actor.player.pos, command?.move.tick))
  return hands.swing
}
