import { buttonsInput, Btn, type Action, type Move } from './commands'
import { Campfires, campfireSpot, type CampfiresState, type CampfireSpot } from './campfires'
import { resolveCircle } from './collision'
import { BERRY_FOOD, PLAYER_RADIUS, STEP } from './constants'
import { craft, RECIPES } from './crafting'
import { Enemies, type EnemiesState } from './enemies'
import { EventLog, LOCAL_PLAYER, type PlayerId, type SimEvent } from './events'
import { Interaction } from './interaction'
import { Inventory, type InventoryState } from './inventory'
import { Pickups, type PickupsState } from './pickups'
import { createPlayer, stepPlayer, teleportPlayer, type Player, type PlayerEnv } from './player'
import { createPropWorld, generatePropPlacements, growBerries, type PropPlacement, type PropWorld } from './props'
import { mulberry32, type Rng } from './random'
import { eat, isDead, stepSurvival } from './survival'
import { DAY_LENGTH, DayClock, euclideanModulo, START_PHASE } from './world/daycycle'
import { heightAt, ROCK_LEVEL, SAND_LEVEL } from './world/terrain'

const SPAWN_CLEARANCE = 3

/** Un jugador en la simulación: su cuerpo, su inventario y lo que lleva aplicado de sus acciones. */
export interface PlayerSlot {
  id: PlayerId
  player: Player
  inventory: Inventory
  /** Está encima de algo que no cabe en la hotbar. */
  hotbarFull: boolean
  alive: boolean
  /** `seq` de la última acción aplicada: las de `seq` menor o igual se descartan. */
  appliedSeq: number
  spawn: { x: number; z: number }
}

/** Todo lo que cambia durante la partida, como datos (ver Simulation.toJSON). */
export interface SimState {
  tick: number
  worldStartTick: number
  rng: number
  /** Solo los props que difieren de como se generaron. */
  props: { id: number; hp: number; alive: boolean; regrowLeft: number }[]
  enemies: EnemiesState
  pickups: PickupsState
  campfires: CampfiresState
  combat: { cooldown: number; pendingSwing: boolean }
  player: {
    id: PlayerId
    player: Player
    inventory: InventoryState
    hotbarFull: boolean
    alive: boolean
    appliedSeq: number
    spawn: { x: number; z: number }
  }
}

const copyPlayer = (p: Player): Player => ({ ...p, pos: { ...p.pos }, prev: { ...p.prev }, vel: { ...p.vel } })

/**
 * La partida sin three.js ni DOM: isla, reloj, enemigos, objetos del suelo, fogatas y un jugador (PR 8: N).
 * Avanza con `step(move, actions)` y devuelve lo que ha pasado como eventos; la vista, el HUD y el sonido
 * solo leen su estado y sus eventos. Determinista para una misma semilla y unos mismos comandos.
 */
export class Simulation {
  readonly world: PropWorld
  readonly clock = new DayClock()
  readonly campfires: Campfires
  readonly enemies: Enemies
  readonly pickups: Pickups
  readonly interaction: Interaction
  readonly slot: PlayerSlot
  readonly env: PlayerEnv
  /** Azar de la simulación (enemigos, objetos que caen). */
  private rng: Rng
  /** Lo que pasa en cada paso, sellado con su tick. Lo emitido fuera de un paso sale con el siguiente. */
  private events = new EventLog()
  /** Tick en el que empezó el día 1: el reloj sale de `tick - worldStartTick`. */
  private worldStartTick = 0
  private spot: CampfireSpot = { x: 0, y: 0, z: 0, valid: false }

  constructor(seed: number, placements: readonly PropPlacement[] = generatePropPlacements()) {
    this.rng = mulberry32(seed)
    const world = createPropWorld(placements)
    this.world = world
    const { emit } = this.events
    this.campfires = new Campfires(emit)
    this.enemies = new Enemies([world.grid, this.campfires.grid], this.rng, emit)
    this.pickups = new Pickups([world.grid, this.campfires.grid], this.rng, emit)
    const inventory = new Inventory()
    this.interaction = new Interaction(world, inventory, this.pickups, this.enemies, emit)
    this.env = {
      heightAt,
      collide: (pos) => {
        const props = resolveCircle(pos, PLAYER_RADIUS, world.grid)
        return resolveCircle(pos, PLAYER_RADIUS, this.campfires.grid) || props
      },
    }
    const spawn = findSpawn(world)
    this.slot = {
      id: LOCAL_PLAYER,
      player: createPlayer(this.env, spawn.x, spawn.z),
      inventory,
      hotbarFull: false,
      alive: true,
      appliedSeq: 0,
      spawn,
    }
  }

  /** Último tick simulado. */
  get tick() {
    return this.events.tick
  }

  /**
   * Un tick: aplica el `Move` y las acciones de ese tick y avanza el mundo. Devuelve sus eventos.
   * Elegir casilla y fabricar van antes de moverse; golpear, colocar y comer, en el mismo punto del paso
   * que antes de haber comandos.
   */
  step(move: Move, actions: readonly Action[]): SimEvent[] {
    this.events.tick++
    const { slot, interaction } = this
    const { player, inventory } = slot
    player.yaw = move.yaw
    player.pitch = move.pitch

    let swing = false
    let place = false
    let eatBerry = false
    for (const action of [...actions].sort((a, b) => a.seq - b.seq)) {
      if (action.seq <= slot.appliedSeq) continue
      slot.appliedSeq = action.seq
      switch (action.kind) {
        case 'select':
          inventory.select(action.slot)
          break
        case 'craft':
          this.craft(action.recipe)
          break
        case 'swing':
          swing = true
          break
        case 'place':
          place = true
          break
        case 'eat':
          eatBerry = true
          break
      }
    }

    stepPlayer(player, buttonsInput(move.buttons), this.env, STEP)
    this.syncClock()
    const damage = this.enemies.step(STEP, player.pos, this.clock.phase, this.clock.day)
    if (damage > 0) {
      player.health = Math.max(0, player.health - damage)
      this.events.emit({ type: 'playerHurt', id: slot.id, dmg: damage })
    }
    // Desde la posición simulada (no interpolada): golpear no depende del framerate.
    interaction.updateTarget(player)
    // Con la fogata en la mano el clic la coloca en vez de golpear, y no queda ningún golpe pendiente.
    const placing = inventory.selectedItem === 'campfire'
    if (placing) interaction.pendingSwing = false
    growBerries(this.world.props, STEP, this.events.emit)
    interaction.step(STEP, !placing && (move.buttons & Btn.Attack) !== 0, !placing && swing)
    if (placing && place) this.placeCampfire()
    slot.hotbarFull = this.pickups.step(STEP, player.pos, inventory).full

    if (eatBerry) this.eatBerry()
    stepSurvival(player, STEP)
    if (isDead(player)) {
      slot.alive = false
      this.events.emit({ type: 'playerDied', id: slot.id })
    }
    return this.events.drain()
  }

  /** Fabrica la receta por índice (el de su tecla menos 1). */
  craft(index: number): boolean {
    const recipe = RECIPES[index]
    const ok = recipe ? craft(this.slot.inventory, recipe) : false
    if (ok) this.events.emit({ type: 'playerCrafted', id: this.slot.id, recipe: index })
    return ok
  }

  /** Partida nueva: inventario vacío, isla restaurada, reloj al principio y jugador en el punto de aparición. */
  reset() {
    // Lo que quedara por presentar es de la partida anterior.
    this.events.drain()
    const { slot } = this
    slot.inventory.clear()
    this.interaction.reset()
    this.enemies.reset()
    this.pickups.clear()
    this.campfires.clear()
    slot.hotbarFull = false
    slot.alive = true
    Object.assign(slot.player, createPlayer(this.env, slot.spawn.x, slot.spawn.z))
    this.worldStartTick = this.tick
    this.syncClock()
    this.events.emit({ type: 'worldReset', worldStartTick: this.worldStartTick })
  }

  /** Salta a una hora del día actual (0 = amanecer), redondeada al tick. */
  setPhase(phase: number) {
    const cycles = START_PHASE + this.clock.elapsed / DAY_LENGTH
    const elapsed = (Math.floor(cycles) + euclideanModulo(phase, 1) - START_PHASE) * DAY_LENGTH
    this.worldStartTick = this.tick - Math.round(elapsed / STEP)
    this.syncClock()
    this.events.emit({ type: 'clockSet', worldStartTick: this.worldStartTick })
  }

  teleport(x: number, z: number, yaw: number, pitch: number) {
    const { player } = this.slot
    teleportPlayer(player, this.env, x, z, yaw)
    player.pitch = pitch
  }

  /** Estado completo como datos JSON (sin referencias a la simulación): basta con él y la isla para seguir. */
  toJSON(): SimState {
    const { slot, interaction } = this
    return {
      tick: this.tick,
      worldStartTick: this.worldStartTick,
      rng: this.rng.state,
      props: this.world.props
        .filter((p) => p.hp !== p.maxHp || !p.alive || p.regrowLeft !== 0)
        .map(({ id, hp, alive, regrowLeft }) => ({ id, hp, alive, regrowLeft })),
      enemies: this.enemies.save(),
      pickups: this.pickups.save(),
      campfires: this.campfires.save(),
      combat: { cooldown: interaction.cooldown, pendingSwing: interaction.pendingSwing },
      player: {
        id: slot.id,
        player: copyPlayer(slot.player),
        inventory: slot.inventory.save(),
        hotbarFull: slot.hotbarFull,
        alive: slot.alive,
        appliedSeq: slot.appliedSeq,
        spawn: { ...slot.spawn },
      },
    }
  }

  /** Simulación a partir de `toJSON()`, sobre la misma isla. */
  static fromJSON(state: SimState, placements?: readonly PropPlacement[]): Simulation {
    const sim = new Simulation(0, placements)
    sim.load(state)
    return sim
  }

  private load(state: SimState) {
    this.events.tick = state.tick
    this.worldStartTick = state.worldStartTick
    this.syncClock()
    this.rng.state = state.rng
    for (const { id, hp, alive, regrowLeft } of state.props) Object.assign(this.world.props[id], { hp, alive, regrowLeft })
    this.enemies.load(state.enemies)
    this.pickups.load(state.pickups)
    this.campfires.load(state.campfires)
    this.interaction.cooldown = state.combat.cooldown
    this.interaction.pendingSwing = state.combat.pendingSwing
    const { slot } = this
    const saved = state.player
    slot.id = saved.id
    Object.assign(slot.player, copyPlayer(saved.player))
    slot.inventory.load(saved.inventory)
    slot.hotbarFull = saved.hotbarFull
    slot.alive = saved.alive
    slot.appliedSeq = saved.appliedSeq
    slot.spawn = { ...saved.spawn }
  }

  private syncClock() {
    this.clock.elapsed = (this.tick - this.worldStartTick) * STEP
  }

  private placeCampfire() {
    const { slot } = this
    const spot = campfireSpot(slot.player.pos, slot.player.yaw, [this.world.grid, this.campfires.grid], this.spot)
    if (!this.campfires.place(spot, slot.id)) return
    this.events.emit({ type: 'playerPlaced', id: slot.id })
    slot.inventory.remove('campfire', 1)
  }

  private eatBerry() {
    const { inventory, player, id } = this.slot
    if (inventory.count('berry') === 0 || !eat(player, BERRY_FOOD)) return
    inventory.remove('berry', 1)
    this.events.emit({ type: 'playerAte', id })
  }
}

/** Espiral desde el centro hasta el primer punto con hierba y sin props cerca. */
function findSpawn({ grid }: PropWorld) {
  const isClear = (x: number, z: number) => {
    for (const prop of grid.query(x, z, SPAWN_CLEARANCE + grid.maxRadius)) {
      if (Math.hypot(prop.x - x, prop.z - z) - prop.radius < SPAWN_CLEARANCE) return false
    }
    return true
  }
  for (let i = 0; i < 4000; i++) {
    const angle = i * 0.5
    const r = angle * 0.4
    const x = Math.cos(angle) * r
    const z = Math.sin(angle) * r
    const h = heightAt(x, z)
    if (h > SAND_LEVEL + 0.3 && h < ROCK_LEVEL && isClear(x, z)) return { x, z }
  }
  return { x: 0, z: 0 }
}
