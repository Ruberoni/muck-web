import type { PlayerCommands } from './commands'
import { resolveCircle, type Collider, type SpatialGrid } from './collision'
import type { CraftWorld, RecipeId } from './crafting'
import { DEATH_DROP_HEIGHT, ENEMY_DEFS, EYE_HEIGHT, GAME_OVER_DELAY, METEOR_RADIUS, PLAYER_RADIUS, RESPAWN_DAY_DELAY, RESPAWN_SHIELD, ROCK_SPEED, STATION_RANGE, STEP } from './constants'
import { Enemies, type EnemiesState } from './enemies'
import { EventLog, type PlayerId, type SimEvent } from './events'
import { createCombat, Interaction, type Combat } from './interaction'
import { Inventory, type InventoryState, type ItemId } from './inventory'
import { DEFAULT_RULES, DIFFICULTY_DEFS, type MatchEnd, type MatchResult, type MatchRules } from './match'
import { Pickups, type PickupsState } from './pickups'
import { createPlayer, teleportPlayer, type Player, type PlayerEnv } from './player'
import { aimedVelocity, Projectiles, type ProjectilesState } from './projectiles'
import { applyActions, craftRecipe, finishPlayerTick, movePlayer, useHands, type Actor, type Intent } from './playerTick'
import { createPropWorld, findSpawn, generatePropPlacements, growBerries, type PropPlacement, type PropWorld } from './props'
import { mulberry32, type Rng } from './random'
import { placeableOf, stationNear, Structures, structureSpot, type StructuresState, type StructureSpot } from './structures'
import { hurt, isDead } from './survival'
import { DAY_LENGTH, DayClock, euclideanModulo, isNight, START_PHASE } from './world/daycycle'
import { heightAt } from './world/terrain'
import { WorldEvents, type WorldEventsState } from './worldEvents'

/** Los jugadores que no son el primero aparecen en un anillo a esta distancia del punto de aparición. */
const SPAWN_RING = 2.5
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
/** Altura sobre los pies desde la que sale lo que tira un jugador. */
const TOSS_HEIGHT = 1.2
/** Altura sobre el suelo desde la que sale una roca lanzada. */
const THROW_HEIGHT = 1.5

/**
 * Conexión de un jugador. `present` y `absent` (conectado pero sin mandar comandos) están en el mundo;
 * `gone` (socket cerrado) no: ni se mueve, ni es objetivo, ni cuenta, pero conserva su hueco para cuando vuelva.
 */
export type Connection = 'present' | 'absent' | 'gone'

/** Un jugador en la simulación: su cuerpo, su inventario, sus golpes y lo que lleva aplicado de sus acciones. */
export interface PlayerSlot extends Actor {
  /** Está encima de algo que no cabe en el inventario. */
  inventoryFull: boolean
  connection: Connection
  spawn: { x: number; z: number }
  /** Muerto en una sala: tick en que reaparece. null si está vivo (o con un jugador, donde no se reaparece). */
  respawnAt: number | null
  /** Recién reaparecido: hasta este tick ni recibe daño ni es objetivo. */
  shieldUntil: number
  /** Veces que ha muerto en esta partida. */
  deaths: number
}

/** Un PlayerSlot como datos (el objetivo no se guarda: se recalcula en cada paso). */
export interface PlayerSlotState {
  id: PlayerId
  player: Player
  inventory: InventoryState
  combat: Combat
  inventoryFull: boolean
  alive: boolean
  connection: Connection
  appliedSeq: number
  spawn: { x: number; z: number }
  respawnAt: number | null
  shieldUntil: number
  deaths: number
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
  projectiles: ProjectilesState
  structures: StructuresState
  worldEvents: WorldEventsState
  /** Todos los jugadores, también los `gone`, por id. */
  players: PlayerSlotState[]
  nextPlayerId: number
  /** Todos muertos: tick en que se acaba la partida. */
  gameOverAt: number | null
  rules: MatchRules
  /** Cómo acabó; null mientras se juega. */
  result: MatchResult | null
}

const copyPlayer = (p: Player): Player => ({ ...p, pos: { ...p.pos }, prev: { ...p.prev }, vel: { ...p.vel } })

/**
 * La partida sin three.js ni DOM: isla, reloj, enemigos, objetos del suelo, estructuras y los jugadores.
 * Avanza con `step(commands)` y devuelve lo que ha pasado como eventos; la vista, el HUD y el sonido
 * solo leen su estado y sus eventos. Determinista para una misma semilla y unos mismos comandos.
 * Los jugadores se recorren siempre por id, así el resultado no depende del orden en que llegan los comandos.
 *
 * Al morir el inventario cae al suelo en un montón por objeto y se reaparece en el punto de aparición a los 30 s o,
 * si fue de noche, al amanecer. La partida se pierde si mueren a la vez todos los que están en el mundo o, en
 * solitario (`rules.players` 1), al gastar sus vidas: `gameOver` y a los pocos segundos `matchEnded`. La sala y Game
 * deciden qué hacer entonces; volver a jugar es `startMatch`.
 */
export class Simulation {
  readonly world: PropWorld
  readonly clock = new DayClock()
  /** Lo colocado: fogatas y estaciones. Bloquea a jugadores, enemigos y objetos del suelo. */
  readonly structures: Structures
  readonly enemies: Enemies
  readonly pickups: Pickups
  readonly projectiles: Projectiles
  readonly worldEvents: WorldEvents
  /** Lo que ocupa sitio en la isla: props, estructuras y la roca del meteorito. */
  readonly obstacles: SpatialGrid<Collider>[]
  readonly interaction: Interaction
  /** Todos los jugadores con hueco en la isla, también los `gone`. Se añaden con `addPlayer`. */
  readonly players = new Map<PlayerId, PlayerSlot>()
  readonly env: PlayerEnv
  /** Punto de aparición: el primer jugador aparece aquí y los demás en un anillo alrededor. */
  readonly spawnCenter: { x: number; z: number }
  /** Con quién y a qué dificultad se juega: las fija `startMatch`. */
  rules: MatchRules = DEFAULT_RULES
  /** Cómo acabó la partida; null mientras se juega. */
  result: MatchResult | null = null
  /** Azar de la simulación (enemigos, objetos que caen). */
  private rng: Rng
  /** Lo que pasa en cada paso, sellado con su tick. Lo emitido fuera de un paso sale con el siguiente. */
  private events = new EventLog()
  /** Tick en el que empezó el día 1: el reloj sale de `tick - worldStartTick`. */
  private worldStartTick = 0
  private nextPlayerId = 0
  /** Todos muertos: tick en que se acaba la partida. */
  private gameOverAt: number | null = null
  private spot: StructureSpot = { x: 0, y: 0, z: 0, valid: false }
  /** Las estaciones para fabricar son las estructuras colocadas. */
  private readonly craftWorld: CraftWorld = {
    nearStation: (kind, pos) => stationNear(this.structures.list, kind, pos, STATION_RANGE),
  }

  constructor(seed: number, placements: readonly PropPlacement[] = generatePropPlacements()) {
    this.rng = mulberry32(seed)
    const world = createPropWorld(placements)
    this.world = world
    const { emit } = this.events
    this.structures = new Structures(emit)
    this.worldEvents = new WorldEvents([world.grid, this.structures.grid], this.rng, emit, {
      // Pegado a la roca, en lo que queda libre de props alrededor de ella.
      spawn: (x, z, players) => this.enemies.spawnAt(x + METEOR_RADIUS + ENEMY_DEFS.guardian.radius + 0.1, z, 'guardian', players).id,
      alive: (id) => this.enemies.list.some((e) => e.id === id),
    })
    this.obstacles = [world.grid, this.structures.grid, this.worldEvents.grid]
    this.enemies = new Enemies(this.obstacles, this.rng, emit, (from, target, damage) => this.launchRock(from, target, damage))
    this.pickups = new Pickups(this.obstacles, this.rng, emit)
    this.projectiles = new Projectiles(this.obstacles, emit)
    this.interaction = new Interaction(world, this.pickups, this.enemies, emit)
    this.env = {
      heightAt,
      collide: (pos) => this.obstacles.reduce((touched, grid) => resolveCircle(pos, PLAYER_RADIUS, grid) || touched, false),
    }
    this.spawnCenter = findSpawn(world.grid)
  }

  /** Último tick simulado. */
  get tick() {
    return this.events.tick
  }

  /** Tick en el que empezó el día 1 (lo cambian `setPhase` y `reset`). */
  get startTick() {
    return this.worldStartTick
  }

  /** El jugador `id`; lanza si no existe. */
  slot(id: PlayerId): PlayerSlot {
    const slot = this.players.get(id)
    if (!slot) throw new Error(`no existe el jugador ${id}`)
    return slot
  }

  /** Jugadores que están en el mundo (no `gone`), por id. */
  inWorld(): PlayerSlot[] {
    return [...this.players.values()].filter((s) => s.connection !== 'gone').sort((a, b) => a.id - b.id)
  }

  /** Un jugador nuevo en su punto de aparición, presente y con el inventario vacío. */
  addPlayer(id: PlayerId = this.nextPlayerId): PlayerSlot {
    if (this.players.has(id)) throw new Error(`ya existe el jugador ${id}`)
    this.nextPlayerId = Math.max(this.nextPlayerId, id + 1)
    const spawn = this.spawnPoint(id)
    const slot: PlayerSlot = {
      id,
      player: createPlayer(this.env, spawn.x, spawn.z),
      inventory: new Inventory(),
      combat: createCombat(),
      target: null,
      inventoryFull: false,
      alive: true,
      connection: 'present',
      appliedSeq: 0,
      spawn,
      respawnAt: null,
      shieldUntil: 0,
      deaths: 0,
    }
    this.players.set(id, slot)
    return slot
  }

  /** Quita del todo el hueco de un jugador (la sala decide cuándo; mientras, `gone` lo conserva). */
  removePlayer(id: PlayerId) {
    this.players.delete(id)
  }

  setConnection(id: PlayerId, connection: Connection) {
    this.slot(id).connection = connection
  }

  /**
   * Un tick: aplica los comandos de ese tick de cada jugador y avanza el mundo. Devuelve sus eventos.
   * Un jugador sin comandos en este tick se queda quieto, mirando a donde miraba. Elegir casilla y fabricar
   * van antes de moverse; golpear, colocar y comer, después de que se muevan todos y los enemigos.
   * Lo que toca solo a cada jugador son los trozos de playerTick.ts, los mismos que predice el cliente.
   */
  step(commands: ReadonlyMap<PlayerId, PlayerCommands>): SimEvent[] {
    this.events.tick++
    if (this.gameOverAt !== null && this.tick >= this.gameOverAt) {
      this.gameOverAt = null
      this.finish('lost')
    }
    const present = this.inWorld()
    // Alguien vivo ha entrado (o ha vuelto) durante la cuenta atrás: ya no están todos muertos.
    if (this.gameOverAt !== null && present.some((s) => s.alive)) {
      this.gameOverAt = null
      this.events.emit({ type: 'gameOverCancelled' })
    }
    if (this.gameOverAt === null) {
      for (const slot of present) if (!slot.alive && slot.respawnAt !== null && this.tick >= slot.respawnAt) this.respawn(slot)
    }
    const living = present.filter((s) => s.alive)
    const intents = new Map<PlayerSlot, Intent>()
    for (const slot of present) {
      const command = commands.get(slot.id)
      const intent = applyActions(slot, command, this.craftWorld, this.events.emit)
      if (!slot.alive) continue
      intents.set(slot, intent)
      movePlayer(slot, command, this.env)
    }

    this.syncClock()
    const prey = present.map(({ id, player, alive, shieldUntil }) => ({ id, pos: player.pos, alive: alive && this.tick >= shieldUntil }))
    const hits = this.enemies.step(STEP, prey, this.clock.phase, this.clock.day)
    hits.push(...this.projectiles.step(this.tick, prey))
    hits.push(...this.worldEvents.step(this.tick, prey, this.clock.phase, this.clock.day))
    for (const { playerId, damage } of hits) {
      hurt(this.slot(playerId).player, damage)
      this.events.emit({ type: 'playerHurt', id: playerId, dmg: damage })
    }

    growBerries(this.world.props, STEP, this.events.emit)
    for (const slot of living) {
      const intent = intents.get(slot)!
      // Desde la posición simulada (no interpolada): golpear no depende del framerate. En red, el cliente
      // dice a qué apunta (ve a los enemigos en el pasado) y aquí solo se comprueba que sea creíble.
      if (intent.aim === undefined) this.interaction.updateTarget(slot)
      else this.interaction.validateAim(slot, intent.aim)
      const hands = useHands(slot, intent)
      if (hands.swing) this.interaction.strike(slot)
      if (hands.place) this.place(slot)
      for (const { item, amount } of intent.drops) this.toss(slot, item, amount)
    }
    // Lo que rompió o mató otro jugador en este paso deja de ser objetivo de los demás.
    for (const slot of living) if (slot.target && !slot.target.alive) slot.target = null

    const collected = this.pickups.step(STEP, living.map(({ id, player, inventory }) => ({ id, pos: player.pos, inventory })))
    living.forEach((slot, i) => (slot.inventoryFull = collected[i].full))

    for (const slot of living) {
      finishPlayerTick(slot, intents.get(slot)!, this.events.emit)
      if (isDead(slot.player)) this.die(slot)
    }
    if (this.gameOverAt === null && this.result === null && present.length > 0 && present.every((s) => !s.alive && this.outOfLives(s))) {
      this.gameOverAt = this.tick + Math.round(GAME_OVER_DELAY / STEP)
      this.events.emit({ type: 'gameOver', day: this.clock.day })
    }
    return this.events.drain()
  }

  /** El jugador `id` fabrica la receta `recipe` (sin pasar por sus acciones). */
  craft(id: PlayerId, recipe: RecipeId): boolean {
    return craftRecipe(this.slot(id), recipe, this.craftWorld, this.events.emit)
  }

  /** Tick del próximo amanecer. */
  nextDawnTick(): number {
    const cycles = START_PHASE + this.clock.elapsed / DAY_LENGTH
    return this.worldStartTick + Math.round(((Math.floor(cycles) + 1 - START_PHASE) * DAY_LENGTH) / STEP)
  }

  /** Empieza una partida con estas reglas, sobre la isla recién restaurada. */
  startMatch(rules: MatchRules) {
    this.rules = rules
    this.reset()
  }

  /** Acaba la partida (una vez). `escaped`: quiénes se han salvado. */
  finish(end: MatchEnd, escaped: readonly PlayerId[] = []) {
    if (this.result) return
    const players = [...this.players.values()].sort((a, b) => a.id - b.id).map(({ id, deaths }) => ({ id, deaths, escaped: escaped.includes(id) }))
    this.result = { end, day: this.clock.day, seconds: Math.round((this.tick - this.worldStartTick) * STEP), players }
    this.events.emit({ type: 'matchEnded', result: this.result })
  }

  /**
   * Partida nueva: isla restaurada, reloj al principio y todos los jugadores (también los `gone`) vivos,
   * con el inventario vacío y en su punto de aparición.
   */
  reset() {
    // Lo que quedara por presentar es de la partida anterior.
    this.events.drain()
    this.interaction.reset()
    this.enemies.reset()
    this.pickups.clear()
    this.projectiles.clear()
    this.structures.clear()
    this.worldEvents.reset()
    for (const slot of this.players.values()) {
      slot.inventory.clear()
      Object.assign(slot.combat, createCombat())
      slot.target = null
      slot.inventoryFull = false
      slot.alive = true
      slot.respawnAt = null
      slot.shieldUntil = 0
      slot.deaths = 0
      Object.assign(slot.player, createPlayer(this.env, slot.spawn.x, slot.spawn.z))
    }
    this.gameOverAt = null
    this.result = null
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

  /** Salta al día `day` (desde 1) a la misma hora, redondeada al tick (para probar las noches de un día concreto). */
  setDay(day: number) {
    const elapsed = (Math.max(1, Math.floor(day)) - 1 + this.clock.phase - START_PHASE) * DAY_LENGTH
    this.worldStartTick = this.tick - Math.round(elapsed / STEP)
    this.syncClock()
    this.events.emit({ type: 'clockSet', worldStartTick: this.worldStartTick })
  }

  /** Lanza una roca desde (x, z), a la altura del pecho, hacia el jugador `id`. */
  throwRock(x: number, z: number, id: PlayerId) {
    this.launchRock({ x, y: heightAt(x, z) + THROW_HEIGHT, z }, id, ENEMY_DEFS.thrower.damage)
  }

  /** Una roca hacia donde está ahora el jugador `id`. */
  private launchRock(from: { x: number; y: number; z: number }, id: PlayerId, damage: number) {
    const { pos } = this.slot(id).player
    this.projectiles.launch(this.tick, 'rock', from, aimedVelocity(from, { x: pos.x, y: pos.y + EYE_HEIGHT / 2, z: pos.z }, ROCK_SPEED), damage)
  }

  /** Hace caer un meteorito ya (para probarlo): en (x, z) o, sin ellos, donde toque. */
  meteor(x?: number, z?: number) {
    const spot = x !== undefined && z !== undefined ? { x, z } : this.worldEvents.findSpot(this.inWorld().map(({ id, player, alive }) => ({ id, pos: player.pos, alive })))
    if (spot) this.worldEvents.fall(this.tick, spot.x, spot.z)
  }

  teleport(id: PlayerId, x: number, z: number, yaw: number, pitch: number) {
    const { player } = this.slot(id)
    teleportPlayer(player, this.env, x, z, yaw)
    player.pitch = pitch
  }

  /** Estado completo como datos JSON (sin referencias a la simulación): basta con él y la isla para seguir. */
  toJSON(): SimState {
    return {
      tick: this.tick,
      worldStartTick: this.worldStartTick,
      rng: this.rng.state,
      props: this.world.props
        .filter((p) => p.hp !== p.maxHp || !p.alive || p.regrowLeft !== 0)
        .map(({ id, hp, alive, regrowLeft }) => ({ id, hp, alive, regrowLeft })),
      enemies: this.enemies.save(),
      pickups: this.pickups.save(),
      projectiles: this.projectiles.save(),
      structures: this.structures.save(),
      worldEvents: this.worldEvents.save(),
      players: [...this.players.values()]
        .sort((a, b) => a.id - b.id)
        .map((slot) => ({
          id: slot.id,
          player: copyPlayer(slot.player),
          inventory: slot.inventory.save(),
          combat: { ...slot.combat },
          inventoryFull: slot.inventoryFull,
          alive: slot.alive,
          connection: slot.connection,
          appliedSeq: slot.appliedSeq,
          spawn: { ...slot.spawn },
          respawnAt: slot.respawnAt,
          shieldUntil: slot.shieldUntil,
          deaths: slot.deaths,
        })),
      nextPlayerId: this.nextPlayerId,
      gameOverAt: this.gameOverAt,
      rules: this.rules,
      result: this.result,
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
    this.projectiles.load(state.projectiles)
    this.structures.load(state.structures)
    this.worldEvents.load(state.worldEvents)
    this.players.clear()
    for (const saved of state.players) {
      const slot = this.addPlayer(saved.id)
      Object.assign(slot.player, copyPlayer(saved.player))
      slot.inventory.load(saved.inventory)
      Object.assign(slot.combat, saved.combat)
      slot.inventoryFull = saved.inventoryFull
      slot.alive = saved.alive
      slot.connection = saved.connection
      slot.appliedSeq = saved.appliedSeq
      slot.spawn = { ...saved.spawn }
      slot.respawnAt = saved.respawnAt
      slot.shieldUntil = saved.shieldUntil
      slot.deaths = saved.deaths
    }
    this.nextPlayerId = state.nextPlayerId
    this.gameOverAt = state.gameOverAt
    this.rules = state.rules
    this.result = state.result
  }

  /** En solitario la partida sigue mientras queden vidas; en grupo, cualquiera en pie basta. */
  private outOfLives(slot: PlayerSlot) {
    return this.rules.players > 1 || slot.deaths >= DIFFICULTY_DEFS[this.rules.difficulty].lives
  }

  /** Muere: suelta su inventario y espera para reaparecer. */
  private die(slot: PlayerSlot) {
    slot.alive = false
    slot.deaths++
    this.events.emit({ type: 'playerDied', id: slot.id })
    const { pos } = slot.player
    for (const item of slot.inventory.slots) {
      if (item) this.pickups.dropPile(item, slot.inventory.count(item), pos.x, pos.y + DEATH_DROP_HEIGHT, pos.z)
    }
    slot.inventory.clear()
    Object.assign(slot.combat, createCombat())
    slot.target = null
    slot.inventoryFull = false
    slot.respawnAt = isNight(this.clock.phase) ? this.nextDawnTick() : this.tick + Math.round(RESPAWN_DAY_DELAY / STEP)
  }

  /** Vuelve vivo a su punto de aparición, con la vida y el hambre llenas y el inventario vacío. */
  private respawn(slot: PlayerSlot) {
    const { yaw, pitch } = slot.player
    Object.assign(slot.player, createPlayer(this.env, slot.spawn.x, slot.spawn.z, yaw), { pitch })
    slot.alive = true
    slot.respawnAt = null
    slot.shieldUntil = this.tick + Math.round(RESPAWN_SHIELD / STEP)
    this.events.emit({ type: 'playerRespawn', id: slot.id, x: slot.player.pos.x, z: slot.player.pos.z })
  }

  private syncClock() {
    this.clock.elapsed = (this.tick - this.worldStartTick) * STEP
  }

  /** El primero (id 0) en el centro; los demás en un anillo alrededor, cada id en su ángulo. */
  private spawnPoint(id: PlayerId) {
    const { x, z } = this.spawnCenter
    if (id === 0) return { x, z }
    const angle = id * GOLDEN_ANGLE
    return { x: x + Math.cos(angle) * SPAWN_RING, z: z + Math.sin(angle) * SPAWN_RING }
  }

  /** Desde la posición y el yaw del jugador en este tick; dos en el mismo tick se validan por orden de id. */
  private place(slot: PlayerSlot) {
    const item = slot.inventory.selectedItem
    const def = placeableOf(item)
    if (!item || !def) return
    const spot = structureSpot(slot.player.pos, slot.player.yaw, def.radius, this.obstacles, this.spot)
    if (!this.structures.place(spot, def.kind, slot.id, slot.player.yaw)) return
    this.events.emit({ type: 'playerPlaced', id: slot.id, item })
    slot.inventory.remove(item, 1)
  }

  /** Lo que ha tirado (ya fuera de su inventario, ver `dropFromSlot`) sale a la altura del pecho hacia donde mira. */
  private toss(slot: PlayerSlot, item: ItemId, amount: number) {
    const { pos, yaw } = slot.player
    this.pickups.toss(item, amount, pos.x, pos.y + TOSS_HEIGHT, pos.z, yaw, slot.id)
  }
}
