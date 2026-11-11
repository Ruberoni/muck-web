import type { PlayerCommands } from './commands'
import { buyBoost, maxHealthOf } from './boosts'
import { isBuilt, usableNear } from './builds'
import { findLandmarks } from './landmarks'
import { resolveCircle, type Collider, type SpatialGrid } from './collision'
import type { CraftWorld, RecipeId } from './crafting'
import {
  DEATH_DROP_HEIGHT,
  ENEMY_DEFS,
  EYE_HEIGHT,
  GAME_OVER_DELAY,
  GRAVE_HOLD,
  LIT_SHARE,
  METEOR_RADIUS,
  MOTOR_TIME,
  OIL_SECONDS,
  OIL_WEAR,
  PLANE_BOARD,
  PLANE_HP,
  PLANE_REPAIR_WOOD,
  TOTEM_HOLD,
  PLAYER_RADIUS,
  WORLD_BOUND_FACTOR,
  RESPAWN_DAY_DELAY,
  RESPAWN_LIGHTHOUSE_DELAY,
  RESPAWN_SHIELD,
  ROCK_SPEED,
  CONSUMABLE_DEFS,
  STATION_RANGE,
  STEP,
} from './constants'
import { Enemies, PLANE_TARGET, type EnemyData, type EnemyPrey, type EnemiesState } from './enemies'
import { EventLog, type PlayerId, type SimEvent } from './events'
import { createCombat, Interaction, type Combat } from './interaction'
import { Inventory, KEY_ITEMS, type InventoryState, type ItemId } from './inventory'
import { clockOf, DEFAULT_RULES, DIFFICULTY_DEFS, workFactor, type MatchEnd, type MatchResult, type MatchRules } from './match'
import { Pickups, type PickupsState } from './pickups'
import { createPlayer, teleportPlayer, type Player, type PlayerEnv } from './player'
import { aimedVelocity, Projectiles, type Projectile, type ProjectileEnd, type ProjectilesState } from './projectiles'
import { Hazards, ticks, type HazardsState } from './hazards'
import type { SpecialId } from './constants'
import { applyActions, craftRecipe, finishPlayerTick, movePlayer, useHands, type Actor, type Intent, type StationOp, type TradeOp } from './playerTick'
import { trade } from './merchant'
import { createPropWorld, findSpawn, generatePropPlacements, growBerries, scaleProps, type PropPlacement, type PropWorld } from './props'
import { mulberry32, type Rng } from './random'
import { placeableOf, stationNear, Structures, structureSpot, type Structure, type StructuresState, type StructureSpot } from './structures'
import { damageTaken, spendGuard } from './equipment'
import { putInto, takeFrom } from './stations'
import { guardFactor, hurt, isDead } from './survival'
import { Threat, type ThreatState } from './threat'
import { DayClock, isNight, NIGHT_LENGTH } from './world/daycycle'
import { createIsland, DEFAULT_ISLAND, inLake, type Island } from './world/island'
import { enemyFloor, WATER_LEVEL } from './world/terrain'
import { Fishes, type FishState } from './fish'
import { WORLD_SEED } from './random'
import { WorldEvents, type WorldEventsState } from './worldEvents'

/** Los jugadores que no son el primero aparecen en un anillo a esta distancia del punto de aparición. */
const SPAWN_RING = 2.5
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
/** Altura sobre los pies desde la que sale lo que tira un jugador. */
const TOSS_HEIGHT = 1.2
/** Altura sobre el suelo desde la que sale lo que termina una estación. */
/** Intentos de encontrar dónde cae el avión o dónde va la tumba. */
const CRASH_ATTEMPTS = 20
// Los ataques especiales de los jefes (ver `special`).
const STOMP_RADIUS = 7
const STOMP_SPEED = 12
const STOMP_WIDTH = 1.2
const STOMP_DAMAGE = 20
const TOSS_SPEED = 11
const TOSS_DAMAGE = 15
const RAIN_ROCKS = 5
const RAIN_RADIUS = 1.8
const RAIN_WARNING = 1.2
const RAIN_DAMAGE = 15
const BOULDER_SPEED = 9
const BOULDER_DAMAGE = 25
const BOULDER_BLAST = 3
const BOULDER_BLAST_DAMAGE = 15
const FIRE_RING_RADIUS = 9
const FIRE_RING_SPEED = 8
const FIRE_RING_WIDTH = 1.4
const FIRE_RING_DAMAGE = 18
const LIGHTNING_RADIUS = 1.6
const LIGHTNING_WARNING = 0.9
const LIGHTNING_DAMAGE = 25
const BURN_POOLS = 3
const BURN_RADIUS = 2.2
const BURN_WARNING = 0.8
const BURN_TIME = 5
const BURN_EVERY = 0.5
const BURN_DAMAGE = 4
const PULSE_RADIUS = 4.5
const PULSE_WARNING = 0.5
const PULSE_DAMAGE = 25
const PILLARS = 6
const PILLAR_FIRST = 2
const PILLAR_SPACING = 2.2
const PILLAR_RADIUS = 1.3
const PILLAR_WARNING = 0.7
const PILLAR_DELAY = 0.12
const PILLAR_DAMAGE = 20
const SHARDS = 5
/** Ángulo entre la primera y la última esquirla del abanico. */
const SHARD_SPREAD = 1
const SHARD_SPEED = 16
const SHARD_DAMAGE = 12
const BEAM_RADIUS = 2.2
const BEAM_WARNING = 0.8
const BEAM_DAMAGE = 35
/** Lo que se aparta el puesto del mercader del faro y del tótem (desde su borde). */
const MERCHANT_GAP = 25
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
  /** Segundos que lleva mantenida la tecla de uso sobre algo. */
  useHeld: number
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
  useHeld: number
}

/** Todo lo que cambia durante la partida, como datos (ver Simulation.toJSON). */
export interface SimState {
  /** La semilla de la isla: de ella salen el terreno y los props. */
  island: number
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
  /** Las partidas guardadas antes del pez no lo traen. */
  fish?: FishState
  /** Lo que marcan en el suelo los ataques de los jefes; las de antes no lo traen. */
  hazards?: HazardsState
  threat: ThreatState
  /** Todos los jugadores, también los `gone`, por id. */
  players: PlayerSlotState[]
  nextPlayerId: number
  /** Todos muertos: tick en que se acaba la partida. */
  gameOverAt: number | null
  rules: MatchRules | null
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
  // Lo que sale de la isla cambia con ella (`startMatch` con otra): no hay que guardarse estas referencias.
  /** El suelo: terreno y biomas. */
  island!: Island
  /** Los props, que salen de la isla. */
  world!: PropWorld
  readonly clock = new DayClock()
  /** Lo colocado: fogatas y estaciones. Bloquea a jugadores, enemigos y objetos del suelo. */
  readonly structures: Structures
  enemies!: Enemies
  pickups!: Pickups
  projectiles!: Projectiles
  worldEvents!: WorldEvents
  /** Cuánto han subido los mobs. */
  readonly threat = new Threat()
  /** Los peces del mar, detrás de quien nada lejos de la orilla. */
  readonly fishes: Fishes
  /** Lo que marcan en el suelo los ataques especiales de los jefes. */
  readonly hazards: Hazards
  /** Lo que ocupa sitio en la isla: props, estructuras y la roca del meteorito. */
  obstacles!: SpatialGrid<Collider>[]
  interaction!: Interaction
  /** Todos los jugadores con hueco en la isla, también los `gone`. Se añaden con `addPlayer`. */
  readonly players = new Map<PlayerId, PlayerSlot>()
  readonly env: PlayerEnv
  /** Punto de aparición: el primer jugador aparece aquí y los demás en un anillo alrededor. */
  spawnCenter!: { x: number; z: number }
  /** Cómo acabó la partida; null mientras se juega. */
  result: MatchResult | null = null
  /** Azar de la simulación (enemigos, objetos que caen). */
  private rng: Rng
  /** null: nadie ha fijado reglas (pruebas): ciclo de referencia, sin Noche Eterna. */
  private matchRules: MatchRules | null = null
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

  /** `seed`: el azar de la partida. `island`: dónde se juega (sin ella, la de siempre); sus props salen de ella si no se dan. */
  constructor(seed: number, placements?: readonly PropPlacement[], island: Island = DEFAULT_ISLAND) {
    this.rng = mulberry32(seed)
    this.structures = new Structures(this.events.emit)
    this.fishes = new Fishes(this.events.emit)
    this.hazards = new Hazards(this.events.emit)
    // El mismo objeto con cualquier isla: la predicción del cliente se lo guarda.
    this.env = {
      heightAt: (x, z) => this.island.heightAt(x, z),
      collide: (pos) => this.obstacles.reduce((touched, grid) => resolveCircle(pos, PLAYER_RADIUS, grid) || touched, false),
      bound: () => this.island.size * WORLD_BOUND_FACTOR,
    }
    this.build(island, placements ?? generatePropPlacements(island))
  }

  /** Pasa a otra isla, vacía (sin estructuras ni enemigos), con los mismos jugadores: el cliente, con la que dice el servidor. */
  useIsland(island: Island, placements: readonly PropPlacement[] = generatePropPlacements(island)) {
    this.build(island, placements)
  }

  /**
   * Lo que sale de la isla: sus props y lo que choca con ellos o mira el suelo, vacío. Los jugadores se quedan, con su
   * punto de aparición en la isla nueva (`reset` los lleva a él).
   */
  private build(island: Island, placements: readonly PropPlacement[]) {
    this.island = island
    const world = createPropWorld(placements)
    this.world = world
    const { emit } = this.events
    this.structures.clear()
    this.worldEvents = new WorldEvents([world.grid, this.structures.grid], this.rng, emit, {
      // Pegado a la roca, en lo que queda libre de props alrededor de ella.
      spawn: (x, z, players) => this.enemies.spawnAt(x + METEOR_RADIUS + ENEMY_DEFS.guardian.radius + 0.1, z, 'guardian', players).id,
      alive: (id) => this.enemies.list.some((e) => e.id === id),
    }, island)
    this.obstacles = [world.grid, this.structures.grid, this.worldEvents.grid]
    this.enemies = new Enemies(this.obstacles, this.rng, emit, (from, target, damage) => this.launchRock(from, target, damage), island, (e, id, target) => this.special(e, id, target))
    this.pickups = new Pickups(this.obstacles, this.rng, emit, island)
    this.projectiles = new Projectiles(this.obstacles, emit, island, (p, end) => this.landed(p, end))
    this.interaction = new Interaction(world, this.pickups, this.enemies, emit, island)
    this.spawnCenter = findSpawn(world.grid, island)
    for (const slot of this.players.values()) slot.spawn = this.spawnPoint(slot.id)
  }

  /** Con quién y a qué dificultad se juega: las fija `startMatch`. */
  get rules(): MatchRules {
    return this.matchRules ?? DEFAULT_RULES
  }

  /** Las reglas mandan en el reloj. */
  set rules(rules: MatchRules) {
    this.matchRules = rules
    this.clock.configure(clockOf(rules.players))
    scaleProps(this.world.props, workFactor(rules))
    this.syncClock()
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
      useHeld: 0,
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

    const { day, eternal } = this.clock
    this.syncClock()
    if (this.clock.eternal && !eternal) {
      // Lo que ardió antes no cuenta para la primera campana.
      this.structures.endNight()
      this.threat.fall(this.rng)
      this.events.emit({ type: 'eternalNight' })
      this.events.emit({ type: 'mobsRose', trait: null, threat: this.threat.save() })
    } else if (this.clock.eternal && this.clock.day !== day) {
      this.bell()
    } else if (this.clock.day !== day) {
      this.dawn()
    }
    this.threat.apply(this.clock.day, this.rules.difficulty, this.enemies.scaling)
    const prey = present.map(({ id, player, alive, shieldUntil }) => ({ id, pos: player.pos, alive: alive && this.tick >= shieldUntil }))
    const flying = this.structures.flying
    this.enemies.decoy = flying ? { id: PLANE_TARGET, pos: flying, alive: true, radius: flying.radius } : null
    // Con el faro encendido no aparecen mobs comunes en toda la isla.
    this.enemies.calm = this.structures.burning !== undefined
    // Los del mundo (meteoritos) no traen de dónde: caen de arriba y no se paran.
    const hits: { playerId: PlayerId; damage: number; from?: { x: number; z: number } }[] = this.enemies.step(STEP, prey, this.clock.phase, this.clock.day)
    hits.push(...this.projectiles.step(this.tick, prey))
    // Detrás de los proyectiles: la roca gorda estalla en el mismo paso en que cae. En el aire, la onda pasa por debajo.
    hits.push(...this.hazards.step(this.tick, present.map(({ id, player, alive, shieldUntil }) => ({ id, pos: player.pos, alive: alive && this.tick >= shieldUntil, grounded: player.grounded }))))
    hits.push(...this.worldEvents.step(this.tick, prey, this.clock.phase, this.clock.day, this.clock.eternal))
    // Muerde desde abajo: tampoco se para.
    hits.push(
      ...this.fishes.step(
        STEP,
        present.map(({ id, player, alive, shieldUntil }) => ({
          id,
          alive: alive && this.tick >= shieldUntil,
          // Desde que se pisa agua de verdad (vadeando), no solo nadando: las afueras de la isla son peligrosas.
          inSea: player.inWater && !inLake(this.island, player.pos.x, player.pos.z),
          deep: player.floating,
        })),
      ),
    )
    // Golpe a golpe, por si el escudo para unos y otros no; el aviso, uno por jugador y paso.
    const taken = new Map<PlayerId, { dmg: number; blocked: number }>()
    for (const { playerId, damage, from } of hits) {
      if (playerId === PLANE_TARGET) {
        this.hurtPlane(damage)
        continue
      }
      const { player, inventory } = this.slot(playerId)
      const hit = damageTaken(damage, inventory.equipped, player, from)
      if (hit.blocked > 0) spendGuard(player, hit.blocked)
      // La poción de piedra quita una parte de lo que pasa del escudo y el peto.
      const dealt = hit.damage * guardFactor(player)
      hurt(player, dealt)
      const sum = taken.get(playerId) ?? { dmg: 0, blocked: 0 }
      sum.dmg += dealt
      sum.blocked += hit.blocked
      taken.set(playerId, sum)
    }
    for (const [id, { dmg, blocked }] of taken) this.events.emit({ type: 'playerHurt', id, dmg, ...(blocked > 0 ? { blocked } : {}) })

    growBerries(this.world.regrowing, STEP, this.events.emit)
    this.structures.burn(STEP, this.oilUnit, isNight(this.clock.phase))
    this.warmPlane(living)
    this.structures.step(STEP, workFactor(this.rules))
    for (const slot of living) {
      const intent = intents.get(slot)!
      // Desde la posición simulada (no interpolada): golpear no depende del framerate. En red, el cliente
      // dice a qué apunta (ve a los enemigos en el pasado) y aquí solo se comprueba que sea creíble.
      if (intent.aim === undefined) this.interaction.updateTarget(slot)
      else this.interaction.validateAim(slot, intent.aim)
      this.use(slot, intent.use)
      const hands = useHands(slot, intent)
      if (hands.swing) this.interaction.strike(slot)
      if (hands.place) this.place(slot)
      for (const { item, amount } of intent.drops) this.toss(slot, item, amount)
      for (const op of intent.stations) this.tendStation(slot, op)
      for (const op of intent.trades) this.trade(slot, op)
    }
    // Lo que rompió o mató otro jugador en este paso deja de ser objetivo de los demás.
    for (const slot of living) if (slot.target && !slot.target.alive) slot.target = null

    const collected = this.pickups.step(STEP, living.map(({ id, player, inventory }) => ({ id, pos: player.pos, inventory })))
    living.forEach((slot, i) => (slot.inventoryFull = collected[i].full))

    for (const slot of living) {
      finishPlayerTick(slot, intents.get(slot)!, (e) => {
        this.events.emit(e)
        // Lo que se toma y hace algo en el mundo (el incienso, el amuleto) lo hace aquí, no quien lo toma.
        if (e.type === 'playerAte') this.worldEffect(CONSUMABLE_DEFS[e.item]?.world)
      })
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

  /** Tick del próximo amanecer o, en la Noche Eterna, de la próxima campana. */
  nextDawnTick(): number {
    return this.worldStartTick + Math.round(this.clock.nextMorning / STEP)
  }

  /**
   * Empieza una partida con estas reglas, sobre la isla recién restaurada o en `island` (con sus props, o los que salen
   * de ella). El tick, el azar y los jugadores siguen.
   */
  startMatch(rules: MatchRules, island?: Island, placements?: readonly PropPlacement[]) {
    if (island && island !== this.island) this.build(island, placements ?? generatePropPlacements(island))
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
    this.hazards.clear()
    this.structures.clear()
    this.worldEvents.reset()
    this.fishes.reset()
    this.threat.reset()
    for (const slot of this.players.values()) {
      slot.inventory.clear()
      Object.assign(slot.combat, createCombat())
      slot.target = null
      slot.inventoryFull = false
      slot.alive = true
      slot.respawnAt = null
      slot.shieldUntil = 0
      slot.deaths = 0
      slot.useHeld = 0
      Object.assign(slot.player, createPlayer(this.env, slot.spawn.x, slot.spawn.z))
    }
    this.gameOverAt = null
    this.result = null
    this.worldStartTick = this.tick
    this.syncClock()
    this.events.emit({ type: 'worldReset', worldStartTick: this.worldStartTick })
    if (this.matchRules) this.placeLandmarks()
  }

  /** Salta a una hora del día actual (0 = amanecer), redondeada al tick. */
  setPhase(phase: number) {
    this.worldStartTick = this.tick - Math.round(this.clock.elapsedAt(this.clock.day, phase) / STEP)
    this.syncClock()
    this.events.emit({ type: 'clockSet', worldStartTick: this.worldStartTick })
  }

  /** Salta al día `day` (desde 1) a la misma hora, redondeada al tick (para probar las noches de un día concreto). */
  setDay(day: number) {
    this.worldStartTick = this.tick - Math.round(this.clock.elapsedAt(Math.max(1, Math.floor(day)), this.clock.phase) / STEP)
    this.syncClock()
    this.events.emit({ type: 'clockSet', worldStartTick: this.worldStartTick })
  }

  /** Lanza una roca desde (x, z), a la altura del pecho, hacia el jugador `id`. */
  throwRock(x: number, z: number, id: PlayerId) {
    this.launchRock({ x, y: this.island.heightAt(x, z) + THROW_HEIGHT, z }, id, ENEMY_DEFS.thrower.damage)
  }

  /** Una roca hacia donde está ahora el jugador `id`. */
  private launchRock(from: { x: number; y: number; z: number }, id: PlayerId, damage: number) {
    const { pos } = this.slot(id).player
    this.projectiles.launch(this.tick, 'rock', from, aimedVelocity(from, { x: pos.x, y: pos.y + EYE_HEIGHT / 2, z: pos.z }, ROCK_SPEED), damage)
  }

  /** Un ataque especial de un jefe al acabar su aviso, contra `target` (ver SPECIALS en constants.ts). */
  private special(e: EnemyData, id: SpecialId, target: EnemyPrey) {
    const { x, z } = e.pos
    const floor = enemyFloor(this.island, x, z)
    const aim = (height: number) => ({ x: target.pos.x, y: this.island.heightAt(target.pos.x, target.pos.z) + height, z: target.pos.z })
    switch (id) {
      case 'stomp':
        this.hazards.add({ look: 'stomp', x, z, radius: STOMP_RADIUS, startTick: this.tick, hitTick: this.tick, damage: STOMP_DAMAGE, ring: { speed: STOMP_SPEED, width: STOMP_WIDTH } })
        break
      case 'tossGoblin': {
        const from = { x, y: floor + 2.6, z }
        this.projectiles.launch(this.tick, 'goblin', from, aimedVelocity(from, aim(0.5), TOSS_SPEED), TOSS_DAMAGE)
        break
      }
      case 'rockRain':
        // Una justo donde está y las demás alrededor: quedarse quieto es lo peor.
        for (let i = 0; i < RAIN_ROCKS; i++) {
          const angle = this.rng() * Math.PI * 2
          const r = i === 0 ? 0 : 1.5 + this.rng() * 3.5
          const hx = target.pos.x + Math.cos(angle) * r
          const hz = target.pos.z + Math.sin(angle) * r
          this.hazards.add({ look: 'rock', x: hx, z: hz, radius: RAIN_RADIUS, startTick: this.tick, hitTick: this.tick + ticks(RAIN_WARNING), damage: RAIN_DAMAGE })
        }
        break
      case 'boulder': {
        const from = { x, y: floor + 3.2, z }
        this.projectiles.launch(this.tick, 'boulder', from, aimedVelocity(from, aim(0.3), BOULDER_SPEED), BOULDER_DAMAGE)
        break
      }
      case 'fireRing':
        this.hazards.add({ look: 'fire', x, z, radius: FIRE_RING_RADIUS, startTick: this.tick, hitTick: this.tick, damage: FIRE_RING_DAMAGE, ring: { speed: FIRE_RING_SPEED, width: FIRE_RING_WIDTH } })
        break
      case 'lightning':
      case 'lightBeam': {
        // Donde está al acabar el aviso: el que se queda quieto se lo come.
        const beam = id === 'lightBeam'
        const warning = beam ? BEAM_WARNING : LIGHTNING_WARNING
        this.hazards.add({ look: 'light', x: target.pos.x, z: target.pos.z, radius: beam ? BEAM_RADIUS : LIGHTNING_RADIUS, startTick: this.tick, hitTick: this.tick + ticks(warning), damage: beam ? BEAM_DAMAGE : LIGHTNING_DAMAGE })
        break
      }
      case 'burningGround':
        // Uno donde está y los demás alrededor, repartidos: arden BURN_TIME segundos y queman cada BURN_EVERY.
        for (let i = 0; i < BURN_POOLS; i++) {
          const angle = this.rng() * Math.PI * 2
          const r = i === 0 ? 0 : 3 + this.rng() * 2
          const hitTick = this.tick + ticks(BURN_WARNING)
          const at = { x: target.pos.x + Math.cos(angle) * r, z: target.pos.z + Math.sin(angle) * r }
          this.hazards.add({ look: 'fire', ...at, radius: BURN_RADIUS, startTick: this.tick, hitTick, endTick: hitTick + ticks(BURN_TIME), pulse: ticks(BURN_EVERY), damage: BURN_DAMAGE })
        }
        break
      case 'pulse':
        this.hazards.add({ look: 'crystal', x, z, radius: PULSE_RADIUS, startTick: this.tick, hitTick: this.tick + ticks(PULSE_WARNING), damage: PULSE_DAMAGE })
        break
      case 'pillars': {
        // En fila hacia donde está, uno tras otro desde el Coloso: se esquiva de lado.
        const dx = target.pos.x - x
        const dz = target.pos.z - z
        const length = Math.hypot(dx, dz) || 1
        for (let i = 0; i < PILLARS; i++) {
          const d = PILLAR_FIRST + i * PILLAR_SPACING
          const hitTick = this.tick + ticks(PILLAR_WARNING + i * PILLAR_DELAY)
          this.hazards.add({ look: 'crystal', x: x + (dx / length) * d, z: z + (dz / length) * d, radius: PILLAR_RADIUS, startTick: this.tick, hitTick, damage: PILLAR_DAMAGE })
        }
        break
      }
      case 'shardFan': {
        // Cinco abiertas en abanico, la del centro hacia el jugador: entre dos hay hueco.
        const from = { x, y: floor + 2.4, z }
        const to = aim(0.9)
        const dx = to.x - x
        const dz = to.z - z
        for (let i = 0; i < SHARDS; i++) {
          const a = (i / (SHARDS - 1) - 0.5) * SHARD_SPREAD
          const cos = Math.cos(a)
          const sin = Math.sin(a)
          const point = { x: x + dx * cos - dz * sin, y: to.y, z: z + dx * sin + dz * cos }
          this.projectiles.launch(this.tick, 'shard', from, aimedVelocity(from, point, SHARD_SPEED), SHARD_DAMAGE)
        }
        break
      }
    }
  }

  /** Donde acaba un proyectil: la roca gorda estalla y el trasgo lanzado se levanta (si cae en tierra). */
  private landed(p: Projectile, end: ProjectileEnd) {
    const { x, z } = p.pos
    if (p.kind === 'boulder' && end !== 'player' && end !== 'expired') {
      this.hazards.add({ look: 'rock', x, z, radius: BOULDER_BLAST, startTick: this.tick, hitTick: this.tick, damage: BOULDER_BLAST_DAMAGE })
    }
    if (p.kind === 'goblin' && end !== 'expired' && this.island.heightAt(x, z) > WATER_LEVEL) this.enemies.spawnAt(x, z, 'goblin')
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
      island: this.island.seed,
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
      fish: this.fishes.save(),
      hazards: this.hazards.save(),
      threat: this.threat.save(),
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
          useHeld: slot.useHeld,
        })),
      nextPlayerId: this.nextPlayerId,
      gameOverAt: this.gameOverAt,
      rules: this.matchRules,
      result: this.result,
    }
  }

  /** Simulación a partir de `toJSON()`, sobre la misma isla (sus props, si no se dan, salen de su semilla). */
  static fromJSON(state: SimState, placements?: readonly PropPlacement[]): Simulation {
    const sim = new Simulation(0, placements, createIsland(state.island ?? WORLD_SEED))
    sim.load(state)
    return sim
  }

  private load(state: SimState) {
    this.events.tick = state.tick
    this.worldStartTick = state.worldStartTick
    if (state.rules) this.rules = state.rules
    this.syncClock()
    this.rng.state = state.rng
    for (const { id, hp, alive, regrowLeft } of state.props) Object.assign(this.world.props[id], { hp, alive, regrowLeft })
    this.enemies.load(state.enemies)
    this.pickups.load(state.pickups)
    this.projectiles.load(state.projectiles)
    if (state.hazards) this.hazards.load(state.hazards)
    this.structures.load(state.structures)
    this.worldEvents.load(state.worldEvents)
    if (state.fish) this.fishes.load(state.fish)
    this.threat.load(state.threat)
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
      slot.useHeld = saved.useHeld
    }
    this.nextPlayerId = state.nextPlayerId
    this.gameOverAt = state.gameOverAt
    this.result = state.result
  }

  /** Quien se va no se lleva lo imprescindible: se quedaría la partida sin poder ganarse. */
  dropKeyItems(id: PlayerId) {
    const { player, inventory } = this.slot(id)
    for (const item of KEY_ITEMS) {
      const amount = inventory.count(item)
      if (amount && inventory.remove(item, amount)) this.pickups.dropPile(item, amount, player.pos.x, player.pos.y + DEATH_DROP_HEIGHT, player.pos.z)
    }
  }

  /** La tecla de uso: pulsarla entrega; mantenerla cuenta el tiempo, para lo que no debe hacerse sin querer. */
  private use(slot: PlayerSlot, held: boolean) {
    const target = held ? usableNear(this.structures.list, slot.player.pos) : null
    if (!target) {
      slot.useHeld = 0
      return
    }
    const pressed = slot.useHeld === 0
    slot.useHeld += STEP
    if (target.kind === 'totem' && isBuilt(target) && !target.awake && slot.useHeld >= TOTEM_HOLD) this.activateTotem(target)
    if (target.kind === 'grave' && this.threat.state.totem && !target.opened && slot.useHeld >= GRAVE_HOLD) this.openGrave(target)
    if (!pressed) return
    if (target.build && !isBuilt(target)) this.structures.deliver(target, slot.inventory, this.rules)
    else if (target.kind === 'lighthouse') this.tendLighthouse(target, slot)
    else if (target.kind === 'plane') this.tendPlane(target, slot)
  }

  /** Sin vuelta atrás: los mobs dan el segundo salto y cae el avión, lejos del tótem. */
  private activateTotem(totem: Structure) {
    totem.awake = true
    this.threat.awaken()
    this.events.emit({ type: 'totemActivated', id: totem.id })
    this.events.emit({ type: 'mobsRose', trait: null, threat: this.threat.save() })
    const around = [{ id: PLANE_TARGET, pos: totem, alive: true }]
    let spot: { x: number; z: number } | null = null
    for (let i = 0; i < CRASH_ATTEMPTS && !spot; i++) spot = this.worldEvents.findSpot(around)
    const { x, z } = spot ?? this.spawnCenter
    const plane = this.structures.place({ x, y: this.island.heightAt(x, z), z, valid: true }, 'plane')!
    this.events.emit({ type: 'planeCrashed', id: plane.id, x, z })
  }

  /** Nace su jefe, con vida por jugador; si no se mata sigue ahí, y no se pierde nada. */
  private openGrave(grave: Structure) {
    grave.opened = true
    this.events.emit({ type: 'graveOpened', id: grave.id })
    this.enemies.spawnAt(grave.x + grave.radius + ENEMY_DEFS.colossus.radius + 0.5, grave.z, 'colossus', this.inWorld().length)
  }

  /** Lo que ya viene puesto en la isla: el faro y el tótem no se fabrican, se reparan llevando materiales. */
  private placeLandmarks() {
    const { lighthouse, totem } = findLandmarks(this.world.grid, this.spawnCenter, this.island)
    this.structures.place({ ...lighthouse, y: this.island.heightAt(lighthouse.x, lighthouse.z), valid: true }, 'lighthouse')
    this.structures.place({ ...totem, y: this.island.heightAt(totem.x, totem.z), valid: true }, 'totem')
    this.placeGrave()
    // El último: no mueve las ids ni el sitio de lo anterior.
    this.placeMerchant()
  }

  /** El puesto del mercader: en hierba, a 40–70 m del punto de aparición, lejos del faro y del tótem. */
  private placeMerchant() {
    const around = [{ id: 0, pos: this.spawnCenter, alive: true }]
    const far = (x: number, z: number) => this.structures.list.every((s) => s.kind === 'grave' || Math.hypot(s.x - x, s.z - z) > s.radius + MERCHANT_GAP)
    let spot: { x: number; z: number } | null = null
    for (let i = 0; i < CRASH_ATTEMPTS * 2 && !spot; i++) {
      const found = this.worldEvents.findSpot(around)
      if (found && far(found.x, found.z)) spot = found
    }
    const { x, z } = spot ?? { x: this.spawnCenter.x - 14, z: this.spawnCenter.z }
    this.structures.place({ x, y: this.island.heightAt(x, z), z, valid: true }, 'merchant')
  }

  /** Comprar, vender o comprar una mejora en el puesto del mercader, a su alcance. */
  private trade(slot: PlayerSlot, action: TradeOp) {
    const structure = this.structures.byId(action.id)
    const { pos } = slot.player
    if (!structure?.shop || Math.hypot(structure.x - pos.x, structure.z - pos.z) - structure.radius > STATION_RANGE) return
    // Las mejoras son de cada uno (no del puesto) y no se predicen: las paga el servidor y llegan en el `you`.
    if (action.op === 'boost') {
      if (buyBoost(slot.player, action.boost, action.pay, slot.inventory) === null) return
      this.events.emit({ type: 'playerTraded', id: slot.id, op: 'boost', item: action.pay, boost: action.boost })
      return
    }
    const { op, item } = action
    const available = item !== 'forget_amulet' || this.threat.canForget
    const before = structure.shop.bought[item] ?? 0
    if (!trade(structure.shop, slot.inventory, { op, item }, available)) return
    this.events.emit({ type: 'playerTraded', id: slot.id, op, item })
    if ((structure.shop.bought[item] ?? 0) !== before) this.events.emit({ type: 'shopChanged', id: structure.id, bought: { ...structure.shop.bought } })
  }

  /** Lo que hace en el mundo algo que se toma: calmar a los mobs comunes u olvidar el último rasgo. */
  private worldEffect(effect: 'calm' | 'forget' | undefined) {
    if (effect === 'calm') this.events.emit({ type: 'mobsCalmed', spots: this.enemies.calmAll() })
    if (effect === 'forget') this.events.emit({ type: 'mobsForgot', trait: this.threat.forget(), threat: this.threat.save() })
  }

  /** La tumba de la isla: dormida hasta que se active el tótem, pero se puede encontrar antes. */
  private placeGrave() {
    const around = [{ id: 0, pos: this.spawnCenter, alive: true }]
    let spot: { x: number; z: number } | null = null
    for (let i = 0; i < CRASH_ATTEMPTS && !spot; i++) spot = this.worldEvents.findSpot(around)
    const { x, z } = spot ?? { x: this.spawnCenter.x + 12, z: this.spawnCenter.z }
    this.structures.place({ x, y: this.island.heightAt(x, z), z, valid: true }, 'grave')
  }

  /**
   * Mete en una ranura de una estación lo de una casilla, o saca al inventario lo de la ranura. Hay que estar a su
   * alcance. Lo que no cabe en el inventario se queda en la estación.
   */
  private tendStation(slot: PlayerSlot, { id, slot: target, from, all }: StationOp) {
    const structure = this.structures.byId(id)
    const { pos } = slot.player
    if (!structure?.station || Math.hypot(structure.x - pos.x, structure.z - pos.z) - structure.radius > STATION_RANGE) return
    const { inventory } = slot
    const station = structure.station
    if (from === null) {
      const stack = station[target]
      if (!stack || !inventory.canAdd(stack.item)) return
      takeFrom(station, target)
      inventory.add(stack.item, stack.amount)
    } else {
      const item = inventory.slots[from]
      if (!item) return
      const moved = putInto(structure.kind, station, target, item, all ? inventory.count(item) : 1)
      if (!moved) return
      inventory.remove(item, moved)
    }
    this.structures.stationChanged(structure)
  }

  /** Averiado se repara; reparado se arranca. */
  private tendPlane(structure: Structure, slot: PlayerSlot) {
    const plane = structure.plane!
    if (plane.hp <= 0) {
      if (slot.inventory.remove('wood', PLANE_REPAIR_WOOD)) plane.hp = PLANE_HP
    } else if (!plane.running) {
      plane.running = true
      plane.heat = 0
    }
    this.structures.planeChanged(structure)
  }

  /** Con el motor en marcha todos van a por él; si le quitan toda la vida se apaga, pero no se destruye. */
  private hurtPlane(damage: number) {
    const structure = this.structures.flying
    if (!structure) return
    const plane = structure.plane!
    plane.hp = Math.max(0, plane.hp - damage)
    if (plane.hp <= 0) {
      plane.running = false
      plane.heat = 0
    }
    this.structures.planeChanged(structure)
  }

  /** El motor calienta; al acabar despegan quienes estén vivos y a bordo. Si no hay nadie, espera. */
  private warmPlane(living: readonly PlayerSlot[]) {
    const structure = this.structures.flying
    if (!structure) return
    const plane = structure.plane!
    plane.heat = Math.min(MOTOR_TIME, plane.heat + STEP)
    if (plane.heat < MOTOR_TIME) return
    const aboard = living.filter(({ player }) => Math.hypot(player.pos.x - structure.x, player.pos.z - structure.z) - structure.radius <= PLANE_BOARD)
    if (aboard.length) this.finish('escaped', aboard.map((s) => s.id))
  }

  /** Un faro acabado: primero se carga lo que se lleve; si no, se enciende o se apaga. */
  private tendLighthouse(lighthouse: Structure, slot: PlayerSlot) {
    if (!this.structures.refuel(lighthouse, slot.inventory)) this.structures.toggleFire(lighthouse, this.oilUnit)
  }

  /** Lo que da ahora una unidad de aceite: cada campana, un 10 % menos. */
  private get oilUnit() {
    return OIL_SECONDS * OIL_WEAR ** Math.max(0, this.clock.bells)
  }

  /** Acaba una noche normal. Si quedó iluminada, no suma vida a los mobs. */
  private dawn() {
    if (this.structures.endNight() < NIGHT_LENGTH * LIT_SHARE) return
    this.threat.lightNight()
    this.events.emit({ type: 'nightLit', night: this.clock.day - 1, threat: this.threat.save() })
  }

  /** Acaba una noche de la Noche Eterna. Si quedó a oscuras, los mobs suben. */
  private bell() {
    this.events.emit({ type: 'bell', night: this.clock.day })
    if (this.structures.endNight() >= this.clock.bellLength * LIT_SHARE) this.events.emit({ type: 'nightLit', night: this.clock.day, threat: this.threat.save() })
    else this.events.emit({ type: 'mobsRose', trait: this.threat.rise(this.rng), threat: this.threat.save() })
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
      if (item) this.pickups.dropPile(item, slot.inventory.count(item), pos.x, pos.y + DEATH_DROP_HEIGHT, pos.z, true)
    }
    // Lo puesto también cae.
    for (const item of Object.values(slot.inventory.equipped)) {
      if (item) this.pickups.dropPile(item, 1, pos.x, pos.y + DEATH_DROP_HEIGHT, pos.z, true)
    }
    slot.inventory.clear()
    Object.assign(slot.combat, createCombat())
    slot.target = null
    slot.inventoryFull = false
    const night = isNight(this.clock.phase)
    const lit = night && this.structures.burning !== undefined
    slot.respawnAt = lit ? this.tick + Math.round(RESPAWN_LIGHTHOUSE_DELAY / STEP) : night ? this.nextDawnTick() : this.tick + Math.round(RESPAWN_DAY_DELAY / STEP)
  }

  /** Vuelve vivo a su punto de aparición o junto al faro encendido, con la vida y el hambre llenas y el inventario vacío. */
  private respawn(slot: PlayerSlot) {
    const { yaw, pitch, boosts } = slot.player
    const lighthouse = this.structures.burning
    const at = lighthouse ? { x: lighthouse.x + lighthouse.radius + 1, z: lighthouse.z } : slot.spawn
    // Las mejoras del mercader duran toda la partida: morir no las quita (el inventario, sí).
    Object.assign(slot.player, createPlayer(this.env, at.x, at.z, yaw), { pitch, boosts })
    // "Con la vida llena" es su máximo, que con vitalidad es mayor que el de siempre.
    slot.player.health = maxHealthOf(boosts)
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
    const spot = structureSpot(slot.player.pos, slot.player.yaw, def.radius, this.obstacles, this.spot, this.island)
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
