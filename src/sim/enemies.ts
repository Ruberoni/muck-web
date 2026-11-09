import { MOB_MAX_SPEED, NO_SCALING, type MobScaling } from './threat'
import type { Biome } from './world/biomes'
import { DEFAULT_ISLAND, type Island } from './world/island'
import { DAY_FRACTION, DAY_LENGTH, isNight } from './world/daycycle'
import { enemyFloor, WATER_LEVEL } from './world/terrain'
import { NO_EMIT, type Emit, type PlayerId } from './events'
import { resolveCircle, type Collider, type SpatialGrid } from './collision'
import {
  BOSS_DELAY,
  BOSS_EVERY,
  BOSS_PER_PLAYER,
  BOSS_SPAWN_MAX,
  BOSS_SPAWN_MIN,
  DAZED_DAMAGE,
  DOG_PACK,
  ENEMY_BASE_COUNT,
  ENEMY_DEFS,
  ENEMY_HARD_MAX,
  ENEMY_MAX,
  ENEMY_PER_NIGHT,
  ENEMY_PER_PLAYER,
  ENEMY_RETARGET,
  ENEMY_RETARGET_MARGIN,
  ENEMY_SPAWN_INTERVAL,
  ENEMY_SPAWN_MAX,
  ENEMY_SPAWN_MIN,
  ENEMY_TYPES,
  PLAYER_RADIUS,
  SHELL_RESIST,
  SPAWN_WARN,
  STEP,
  WADE_DEPTH,
  WORLD_BOUND_FACTOR,
  type ChargeDef,
  type EnemyDef,
  type EnemyType,
  type GuardDef,
  type HitEfficacy,
  type RangedDef,
  type WeaponClass,
} from './constants'

const SPAWN_ATTEMPTS = 12
/** Noches que tarda un tipo nuevo en llegar a toda su probabilidad, desde la primera en que sale. */
const SPAWN_RAMP = 3
/** Los jefes, por turnos: el de la noche 3, el de la 6, y vuelta a empezar. */
const BOSSES: readonly EnemyType[] = ['giant', 'thrower']
/** Altura del centro del cuerpo de un tipo de enemigo: a donde apunta aimAtEnemy. */
export const enemyAimHeight = (type: EnemyType) => 0.8 * ENEMY_DEFS[type].scale
/** Distancia entre centros a la que un enemigo de este tipo toca a un jugador. */
const contactOf = (type: EnemyType) => PLAYER_RADIUS + ENEMY_DEFS[type].radius

/** `crouch` y `rush`: la embestida. `dazed`: aturdido tras ella. `aim`: preparando un lanzamiento. */
export type ChargeState = 'idle' | 'crouch' | 'rush' | 'dazed' | 'aim'

/** Por dónde va una embestida o un lanzamiento. */
export interface EnemyCharge {
  state: ChargeState
  /** Segundos que le quedan al estado actual. */
  time: number
  /** Segundos hasta poder embestir o lanzar de nuevo. */
  cooldown: number
  /** Dirección de la carga, fijada al salir: se esquiva apartándose. */
  dx: number
  dz: number
}

/** Un enemigo en la simulación. Su modelo y sus animaciones (bote, golpe, embestida, muerte) son de EnemyView. */
export interface EnemyData {
  /** Lo distingue de un prop en `Target`; qué enemigo es lo dice `type`. */
  kind: 'enemy'
  type: EnemyType
  id: number
  pos: { x: number; z: number }
  /** Posición al empezar el paso, para interpolar al dibujar. */
  prev: { x: number; z: number }
  /** Donde salió: el sitio que guarda un guardián. */
  home: { x: number; z: number }
  /** Hacia donde mira (rotación Y del modelo: +Z local hacia el jugador). */
  yaw: number
  hp: number
  maxHp: number
  /** Por cuánto se multiplica su botín: según los jugadores, no según lo que hayan subido los mobs. */
  lootScale: number
  /** Las monedas suben con la vida de los mobs comunes: cuanto más cuesta matarlo, más da. */
  coinScale: number
  /** Lo que queda de su coraza. */
  shell: number
  alive: boolean
  attackCooldown: number
  /** Tras un golpe retrocede con `knock` y no persigue ni ataca durante este tiempo. */
  stagger: number
  knock: { x: number; z: number }
  /** Segundos hasta que otro golpe pueda volver a aturdirlo (`stagger` + `staggerGap` de su tipo). */
  staggerGuard: number
  charge: EnemyCharge
  /** A quién persigue (null: a nadie todavía). */
  target: PlayerId | null
  /** Segundos hasta volver a elegir a quién persigue. */
  retarget: number
}

/** Lanza una roca desde `from` hacia el jugador `target`. */
export type ThrowRock = (from: { x: number; y: number; z: number }, target: PlayerId, damage: number) => void

/** Lo que los enemigos ven de un jugador que está en el mundo. Los muertos y quien acaba de reaparecer no son objetivo, pero cuentan para N. */
export interface EnemyPrey {
  id: PlayerId
  pos: { x: number; z: number }
  alive: boolean
  /** Si no es un jugador, lo que ocupa. */
  radius?: number
}

/** El "jugador" al que le llega el daño cuando pegan al avión. */
export const PLANE_TARGET: PlayerId = -1

/** Daño que recibe un jugador en un paso. */
export interface EnemyDamage {
  playerId: PlayerId
  damage: number
  /** De dónde viene el golpe: el escudo solo para lo que llega de frente. */
  from: { x: number; z: number }
}

/** Los enemigos como datos, para guardar y restaurar la partida. */
export interface EnemiesState {
  list: EnemyData[]
  spawnTimer: number
  nextId: number
  spawnTurn: number
  /** Última noche en que le tocó salir a un jefe: no sale otro aunque se recargue la partida. */
  bossDay: number
  /** Los que ya se han anunciado y aún no han salido. */
  pending?: PendingSpawn[]
}

/** Un mob común anunciado con humo que saldrá en (x, z) cuando `left` llegue a 0. */
export interface PendingSpawn {
  x: number
  z: number
  type: EnemyType
  left: number
}

const copyEnemy = (e: EnemyData): EnemyData => ({ ...e, pos: { ...e.pos }, prev: { ...e.prev }, home: { ...e.home }, knock: { ...e.knock }, charge: { ...e.charge } })

export const NO_CHARGE: EnemyCharge = { state: 'idle', time: 0, cooldown: 0, dx: 0, dz: 0 }

/** Número máximo de enemigos a la vez en la noche del día `day`. */
export const enemyCap = (day: number) => Math.min(ENEMY_MAX, ENEMY_BASE_COUNT + (day - 1) * ENEMY_PER_NIGHT)

/** Máximo a la vez con `players` jugadores en el mundo: ENEMY_PER_PLAYER más por cada uno desde el segundo. */
export const enemyCapFor = (day: number, players: number) =>
  Math.min(ENEMY_HARD_MAX, enemyCap(day) + ENEMY_PER_PLAYER * Math.max(0, players - 1))

/** Segundos entre apariciones: con más jugadores salen antes. */
export const spawnIntervalFor = (players: number) => ENEMY_SPAWN_INTERVAL / Math.sqrt(Math.max(1, players))

/** El jefe de la noche `day`, si le toca alguno. */
export function bossOfNight(day: number): EnemyType | null {
  if (day % BOSS_EVERY !== 0) return null
  return BOSSES[(day / BOSS_EVERY - 1) % BOSSES.length]
}

/** Por cuánto se multiplica la vida de un jefe o un guardián: por jugador, para que un grupo no lo mate antes que uno solo. */
export const bossScale = (players: number) => Math.max(1, players)

/** Por cuánto se multiplica la vida de un enemigo con `players` jugadores. */
const hpScale = (def: EnemyDef, players: number) => (def.boss || def.guard || def.light ? bossScale(players) : 1)

/** Y su botín: el guardián suelta por jugador; un jefe, algo menos. */
const lootScaleOf = (def: EnemyDef, players: number) => (def.guard ? bossScale(players) : def.boss ? 1 + BOSS_PER_PLAYER * (bossScale(players) - 1) : 1)

/** Los que suben con la amenaza: ni los jefes ni los guardianes. */
export const isCommon = (type: EnemyType) => !ENEMY_DEFS[type].boss && !ENEMY_DEFS[type].guard && !ENEMY_DEFS[type].light

/** Probabilidad de que una aparición de la noche `day` en `biome` sea de tipo `type` en vez de un trasgo. */
export function spawnChance(type: EnemyType, day: number, biome: Biome): number {
  const { spawn } = ENEMY_DEFS[type]
  if (!spawn || day < spawn.fromNight) return 0
  return spawn.biomes[biome] * Math.min(1, (day - spawn.fromNight + 1) / SPAWN_RAMP)
}

/** El tipo que aparece con la tirada `roll` (de 0 a 1): lo que sobra de las probabilidades son trasgos. */
export function spawnType(roll: number, day: number, biome: Biome): EnemyType {
  for (const type of ENEMY_TYPES) {
    roll -= spawnChance(type, day, biome)
    if (roll < 0) return type
  }
  return 'goblin'
}

/**
 * En el agua (donde ya no se hace pie: el fondo por debajo de WADE_DEPTH) nadan: a la mitad de su velocidad y, como
 * mucho, a ENEMY_SWIM_MAX, por debajo de lo que nada el jugador, para que siempre pueda escapar.
 */
export const ENEMY_SWIM_FACTOR = 0.5
export const ENEMY_SWIM_MAX = 2.5
const swimming = (island: Island, x: number, z: number) => island.heightAt(x, z) < WATER_LEVEL - WADE_DEPTH

/** Enemigos: aparecen de noche y siguen hasta que los matan. Aparición, persecución, ataque y golpes recibidos. */
export class Enemies {
  /** Enemigos vivos: al morir salen de la lista. */
  readonly list: EnemyData[] = []
  private spawnTimer = 0
  private nextId = 0
  /** A qué jugador vivo le toca la siguiente aparición (por turnos). */
  private spawnTurn = 0
  private bossDay = 0
  /** Lo que han subido los mobs comunes (ver Threat). */
  scaling: MobScaling = { ...NO_SCALING }
  /** Lo que atrae a todos los mobs comunes, en vez de los jugadores: el avión con el motor en marcha. */
  decoy: EnemyPrey | null = null
  /** Con el faro encendido no se anuncian mobs comunes nuevos (los ya anunciados salen igual). */
  calm = false
  /** Anunciados que aún no han salido: cuentan para el tope. */
  private pending: PendingSpawn[] = []

  /**
   * `grids`: obstáculos que rodean (props, estructuras…). `throwRock`: lo que vuela va por los proyectiles de la partida.
   * `island`: el suelo, que dice dónde se puede andar y aparecer.
   */
  constructor(
    private grids: SpatialGrid<Collider>[],
    private rng: () => number = Math.random,
    private emit: Emit = NO_EMIT,
    private throwRock: ThrowRock = () => {},
    private island: Island = DEFAULT_ISLAND,
  ) {}

  /**
   * Paso fijo: aparece, persigue y ataca. `players` son los jugadores que están en el mundo (ordenados por id);
   * persiguen al vivo más cercano. Devuelve el daño que recibe cada jugador en este paso (solo los que reciben).
   */
  step(dt: number, players: readonly EnemyPrey[], phase: number, day: number): EnemyDamage[] {
    const prey = players.filter((p) => p.alive)
    this.stepPending(dt)
    if (isNight(phase)) {
      this.spawnTimer -= dt
      if (this.spawnTimer <= 1e-9) {
        const count = this.list.filter((e) => isCommon(e.type)).length + this.pending.length
        if (prey.length && !this.calm && count < enemyCapFor(day, players.length)) {
          // Por turnos: cada aparición elige a un jugador vivo distinto.
          const around = prey[this.spawnTurn++ % prey.length]
          this.queueSpawn(around, prey, (x, z) => spawnType(this.rng(), day, this.island.biomeAt(x, z)), enemyCapFor(day, players.length) - count)
        }
        this.spawnTimer = spawnIntervalFor(players.length) * this.scaling.spawnInterval
      }
      this.trySpawnBoss(prey, players.length, phase, day)
    } else {
      // De día no sale ninguno; los que quedan siguen, y cuentan para el tope de la noche siguiente.
      this.spawnTimer = 0
    }

    const damage: EnemyDamage[] = []
    for (const e of this.list) {
      e.prev.x = e.pos.x
      e.prev.z = e.pos.z
      const target = this.decoy && isCommon(e.type) ? this.decoy : this.chooseTarget(e, prey, dt)
      if (!this.chase(e, target, dt) || !target) continue
      const dealt = isCommon(e.type) ? Math.round(ENEMY_DEFS[e.type].damage * this.scaling.damage) : ENEMY_DEFS[e.type].damage
      damage.push({ playerId: target.id, damage: dealt, from: { x: e.pos.x, z: e.pos.z } })
    }
    this.separate(prey)
    return damage
  }

  /**
   * El jugador vivo más cercano, reevaluado cada ENEMY_RETARGET segundos: solo cambia si otro está
   * ENEMY_RETARGET_MARGIN metros más cerca, para que no dude entre dos. Si el suyo ya no está, elige al momento.
   */
  private chooseTarget(e: EnemyData, prey: readonly EnemyPrey[], dt: number): EnemyPrey | null {
    const { guard } = ENEMY_DEFS[e.type]
    if (guard) return this.guardTarget(e, guard, prey)
    let current = e.target === null ? undefined : prey.find((p) => p.id === e.target)
    e.retarget -= dt
    if (current && e.retarget > 1e-9) return current
    e.retarget = ENEMY_RETARGET
    const distance = (p: EnemyPrey) => Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z)
    let nearest: EnemyPrey | undefined
    for (const p of prey) if (!nearest || distance(p) < distance(nearest)) nearest = p
    if (nearest && (!current || distance(nearest) < distance(current) - ENEMY_RETARGET_MARGIN)) current = nearest
    e.target = current?.id ?? null
    return current ?? null
  }

  /**
   * A quién persigue un guardián: al suyo mientras no se aleje de su sitio; si no, al vivo más cercano de los que tenga
   * a `aggro` metros sin salir de ese sitio. null: a nadie, y vuelve a él.
   */
  private guardTarget(e: EnemyData, { aggro, leash }: GuardDef, prey: readonly EnemyPrey[]): EnemyPrey | null {
    const inside = (p: EnemyPrey) => Math.hypot(p.pos.x - e.home.x, p.pos.z - e.home.z) < leash
    const current = prey.find((p) => p.id === e.target)
    if (current && inside(current)) return current
    let nearest: EnemyPrey | null = null
    let best = aggro
    for (const p of prey) {
      const distance = Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z)
      if (distance > best || !inside(p)) continue
      best = distance
      nearest = p
    }
    e.target = nearest?.id ?? null
    return nearest
  }

  /** Mueve un enemigo hacia `prey` (o lo deja quieto si no hay nadie) y devuelve si ataca en este paso. */
  private chase(e: EnemyData, prey: EnemyPrey | null, dt: number): boolean {
    const def = ENEMY_DEFS[e.type]
    e.staggerGuard = Math.max(0, e.staggerGuard - dt)
    if (e.stagger > 0) {
      const k = e.stagger / def.stagger
      this.move(e, e.knock.x * k * dt, e.knock.z * k * dt)
      e.stagger = Math.max(0, e.stagger - dt)
      e.attackCooldown = Math.max(0, e.attackCooldown - dt)
      return false
    }
    if (!prey) {
      e.attackCooldown = Math.max(e.attackCooldown - dt, def.windup)
      if (def.guard) this.goHome(e, def.speed * dt)
      return false
    }
    const player = prey.pos
    const dx = player.x - e.pos.x
    const dz = player.z - e.pos.z
    const dist = Math.hypot(dx, dz)
    if (dist > 1e-6) e.yaw = Math.atan2(dx, dz)
    if (def.charge) {
      const hit = this.charge(e, def.charge, prey, dist, dt)
      if (hit !== null) return hit
    }
    if (def.ranged) {
      this.ranged(e, def.ranged, prey, dist, dt)
      return false
    }
    const contact = contactOf(e.type) + (prey.radius ?? 0)
    if (dist > contact + def.gap) {
      const speed = isCommon(e.type) ? Math.min(def.speed * this.scaling.speed, MOB_MAX_SPEED) : def.speed
      const step = Math.min(speed * dt, dist - contact - def.gap)
      this.move(e, (dx / dist) * step, (dz / dist) * step)
    }
    if (dist > contact + def.reach) {
      // Al llegar de lejos espera `windup`; el empujón de un golpe no cuenta como irse.
      e.attackCooldown = Math.max(e.attackCooldown - dt, e.staggerGuard > 0 ? 0 : def.windup)
      return false
    }
    e.attackCooldown -= dt
    if (e.attackCooldown > 1e-9) return false
    e.attackCooldown = isCommon(e.type) ? def.attackInterval * this.scaling.attackInterval : def.attackInterval
    this.emit({ type: 'enemyAttack', id: e.id, target: prey.id })
    return true
  }

  /** Sin nadie a quien perseguir, un guardián vuelve a su sitio. La vida que le hayan quitado no la recupera. */
  private goHome(e: EnemyData, step: number) {
    const dx = e.home.x - e.pos.x
    const dz = e.home.z - e.pos.z
    const dist = Math.hypot(dx, dz)
    if (dist < 1e-6) return
    e.yaw = Math.atan2(dx, dz)
    const k = Math.min(step, dist) / dist
    this.move(e, dx * k, dz * k)
  }

  /**
   * La embestida: null si sigue andando como cualquiera; si no, si alcanza al jugador en este paso. Agachado sigue
   * mirando al jugador, pero la dirección se fija al salir: apartándose se esquiva. Se para al chocar con algo, y
   * entonces queda aturdido: es el momento de golpearlo.
   */
  private charge(e: EnemyData, def: ChargeDef, prey: EnemyPrey, dist: number, dt: number): boolean | null {
    const c = e.charge
    c.cooldown = Math.max(0, c.cooldown - dt)
    if (c.state === 'idle') {
      if (c.cooldown > 1e-9 || dist < def.min || dist > def.max) return null
      c.state = 'crouch'
      c.time = def.windup
      this.emit({ type: 'enemyCharge', id: e.id, state: 'crouch' })
      return false
    }
    c.time -= dt
    if (c.state === 'dazed') {
      if (c.time > 1e-9) return false
      c.state = 'idle'
      this.emit({ type: 'enemyCharge', id: e.id, state: 'idle' })
      return null
    }
    if (c.state === 'crouch') {
      if (c.time > 1e-9) return false
      c.state = 'rush'
      c.time = def.time
      c.dx = (prey.pos.x - e.pos.x) / (dist || 1)
      c.dz = (prey.pos.z - e.pos.z) / (dist || 1)
      this.emit({ type: 'enemyCharge', id: e.id, state: 'rush' })
      return false
    }
    e.yaw = Math.atan2(c.dx, c.dz)
    const { x, z } = e.pos
    const step = def.speed * dt
    this.move(e, c.dx * step, c.dz * step)
    const blocked = Math.hypot(e.pos.x - x, e.pos.z - z) < step * 0.5
    const hit = Math.hypot(prey.pos.x - e.pos.x, prey.pos.z - e.pos.z) <= contactOf(e.type) + ENEMY_DEFS[e.type].reach
    if (!hit && !blocked && c.time > 1e-9) return false
    c.state = 'dazed'
    c.time = def.dazed
    c.cooldown = def.cooldown
    e.attackCooldown = Math.max(e.attackCooldown, ENEMY_DEFS[e.type].attackInterval)
    this.emit({ type: 'enemyCharge', id: e.id, state: 'dazed' })
    if (hit) this.emit({ type: 'enemyAttack', id: e.id, target: prey.id })
    return hit
  }

  /**
   * A distancia: mantiene las distancias y cada `attackInterval` segundos se para, avisa y lanza una roca hacia donde
   * está el jugador al soltarla. Su daño lo hace la roca al llegar, no este paso.
   */
  private ranged(e: EnemyData, def: RangedDef, prey: EnemyPrey, dist: number, dt: number) {
    const c = e.charge
    const { attackInterval, damage, speed, windup } = ENEMY_DEFS[e.type]
    c.cooldown = Math.max(0, c.cooldown - dt)
    if (c.state === 'aim') {
      c.time -= dt
      if (c.time > 1e-9) return
      c.state = 'idle'
      this.emit({ type: 'enemyCharge', id: e.id, state: 'idle' })
      this.emit({ type: 'enemyAttack', id: e.id, target: prey.id })
      this.throwRock({ x: e.pos.x, y: enemyFloor(this.island, e.pos.x, e.pos.z) + def.height, z: e.pos.z }, prey.id, damage)
      return
    }
    if (c.cooldown <= 1e-9 && dist <= def.range) {
      c.state = 'aim'
      c.time = windup
      c.cooldown = attackInterval
      this.emit({ type: 'enemyCharge', id: e.id, state: 'aim' })
      return
    }
    const away = dist < def.flee ? Math.min(speed * dt, def.flee - dist) : dist > def.max ? -Math.min(speed * dt, dist - def.max) : 0
    if (away !== 0 && dist > 1e-6) this.move(e, ((e.pos.x - prey.pos.x) / dist) * away, ((e.pos.z - prey.pos.z) / dist) * away)
  }

  /** Se mueve (mx, mz) en este paso; en el agua, más despacio (ENEMY_SWIM_FACTOR, hasta ENEMY_SWIM_MAX). */
  private move(e: EnemyData, mx: number, mz: number) {
    const { x, z } = e.pos
    if (swimming(this.island, x, z)) {
      const step = Math.hypot(mx, mz)
      const k = step > 1e-9 ? Math.min(ENEMY_SWIM_FACTOR, (ENEMY_SWIM_MAX * STEP) / step) : 1
      mx *= k
      mz *= k
    }
    e.pos.x += mx
    e.pos.z += mz
    const r = Math.hypot(e.pos.x, e.pos.z)
    const bound = this.island.size * WORLD_BOUND_FACTOR
    if (r > bound) {
      e.pos.x *= bound / r
      e.pos.z *= bound / r
    }
    this.settle(e, x, z)
  }

  /** Lo saca de los props. */
  private settle(e: EnemyData, _x: number, _z: number) {
    for (const grid of this.grids) resolveCircle(e.pos, ENEMY_DEFS[e.type].radius, grid)
  }

  /** Ni se amontonan entre ellos ni se meten dentro de ningún jugador vivo. */
  private separate(prey: readonly EnemyPrey[]) {
    const push = (pos: { x: number; z: number }, ox: number, oz: number, min: number, share: number) => {
      const dx = pos.x - ox
      const dz = pos.z - oz
      const d = Math.hypot(dx, dz)
      if (d >= min) return
      const k = d < 1e-6 ? 0 : ((min - d) * share) / d
      pos.x += d < 1e-6 ? (min - d) * share : dx * k
      pos.z += dz * k
    }
    for (let i = 0; i < this.list.length; i++) {
      for (let j = i + 1; j < this.list.length; j++) {
        const a = this.list[i].pos
        const b = this.list[j].pos
        const ax = a.x
        const az = a.z
        const min = ENEMY_DEFS[this.list[i].type].radius + ENEMY_DEFS[this.list[j].type].radius
        push(a, b.x, b.z, min, 0.5)
        push(b, ax, az, min, 0.5)
      }
    }
    for (const e of this.list) {
      for (const { pos } of prey) push(e.pos, pos.x, pos.z, contactOf(e.type), 1)
      this.settle(e, e.prev.x, e.prev.z)
    }
  }

  /** Una vez en cada noche de jefe, y solo si no queda vivo el anterior. */
  private trySpawnBoss(prey: readonly EnemyPrey[], players: number, phase: number, day: number) {
    const type = bossOfNight(day)
    if (!type || day <= this.bossDay || !prey.length || phase < DAY_FRACTION + BOSS_DELAY / DAY_LENGTH) return
    if (this.list.some((e) => ENEMY_DEFS[e.type].boss)) {
      this.bossDay = day
      return
    }
    const around = prey[this.spawnTurn++ % prey.length]
    if (this.trySpawn(around, prey, BOSS_SPAWN_MIN, BOSS_SPAWN_MAX, () => type, players)) this.bossDay = day
  }

  /**
   * Un mob común: se anuncia (`enemyIncoming`) y sale SPAWN_WARN segundos después donde se anunció. Un perro trae a su
   * manada (DOG_PACK), cada uno con su humo, sin pasar de `room` (lo que queda hasta el tope).
   */
  private queueSpawn(around: EnemyPrey, prey: readonly EnemyPrey[], pick: (x: number, z: number) => EnemyType, room = 1) {
    const spot = this.findSpot(around, prey, ENEMY_SPAWN_MIN, ENEMY_SPAWN_MAX, pick)
    if (!spot) return null
    const spots = [spot]
    if (spot.type === 'dog') {
      const size = Math.min(room, DOG_PACK.min + Math.floor(this.rng() * (DOG_PACK.max - DOG_PACK.min + 1)))
      for (let i = 1; i < size; i++) {
        const angle = this.rng() * Math.PI * 2
        const x = spot.x + Math.cos(angle) * 2
        const z = spot.z + Math.sin(angle) * 2
        if (this.island.heightAt(x, z) < WATER_LEVEL + 0.2 || this.grids.some((grid) => resolveCircle({ x, z }, ENEMY_DEFS.dog.radius, grid))) continue
        spots.push({ x, z, type: 'dog' })
      }
    }
    for (const s of spots) {
      this.pending.push({ ...s, left: SPAWN_WARN })
      this.emit({ type: 'enemyIncoming', enemy: s.type, x: s.x, z: s.z })
    }
    return spots
  }

  /** Saca los anunciados cuyo aviso ha terminado, también de día. */
  private stepPending(dt: number) {
    if (!this.pending.length) return
    for (const p of this.pending) p.left -= dt
    const ready = this.pending.filter((p) => p.left <= 1e-9)
    if (!ready.length) return
    this.pending = this.pending.filter((p) => p.left > 1e-9)
    for (const p of ready) this.spawnAt(p.x, p.z, p.type)
  }

  /** Alrededor de `around`, entre `min` y `max` metros de él y a `min` como poco de todos los jugadores vivos. */
  private trySpawn(around: EnemyPrey, prey: readonly EnemyPrey[], min: number, max: number, pick: (x: number, z: number) => EnemyType, players = 1) {
    const spot = this.findSpot(around, prey, min, max, pick)
    return spot ? this.spawnAt(spot.x, spot.z, spot.type, players) : null
  }

  /** Un sitio libre en tierra alrededor de `around` (ver `trySpawn`) y el tipo que sale en él, o null. */
  private findSpot(around: EnemyPrey, prey: readonly EnemyPrey[], min: number, max: number, pick: (x: number, z: number) => EnemyType) {
    for (let i = 0; i < SPAWN_ATTEMPTS; i++) {
      const angle = this.rng() * Math.PI * 2
      const r = min + this.rng() * (max - min)
      const x = around.pos.x + Math.cos(angle) * r
      const z = around.pos.z + Math.sin(angle) * r
      if (Math.hypot(x, z) > this.island.size * WORLD_BOUND_FACTOR || this.island.heightAt(x, z) < WATER_LEVEL + 0.2) continue
      if (prey.some((p) => p !== around && Math.hypot(p.pos.x - x, p.pos.z - z) < min)) continue
      const type = pick(x, z)
      const pos = { x, z }
      if (this.grids.some((grid) => resolveCircle(pos, ENEMY_DEFS[type].radius, grid))) continue
      return { x, z, type }
    }
    return null
  }

  /** Crea un enemigo de tipo `type` en (x, z) mirando hacia +Z. Un jefe o un guardián sale con más vida cuantos más `players` haya. */
  spawnAt(x: number, z: number, type: EnemyType = 'goblin', players = 1): EnemyData {
    const def = ENEMY_DEFS[type]
    const lootScale = lootScaleOf(def, players)
    const hp = Math.round(def.hp * hpScale(def, players) * (isCommon(type) ? this.scaling.hp : 1))
    const e: EnemyData = {
      kind: 'enemy',
      type,
      id: this.nextId++,
      pos: { x, z },
      prev: { x, z },
      home: { x, z },
      yaw: 0,
      hp,
      maxHp: hp,
      lootScale,
      coinScale: isCommon(type) ? this.scaling.hp : 1,
      shell: (def.shell ?? 0) * bossScale(players),
      alive: true,
      attackCooldown: def.windup,
      stagger: 0,
      knock: { x: 0, z: 0 },
      staggerGuard: 0,
      charge: { ...NO_CHARGE },
      target: null,
      retarget: 0,
    }
    this.list.push(e)
    this.emit({ type: 'enemySpawn', id: e.id, enemy: type, x, z })
    return e
  }

  /** Golpe de `by` desde `from` (la posición del atacante). Devuelve true si lo mata. */
  hit(e: EnemyData, damage: number, from: { x: number; z: number }, by: PlayerId, efficacy: HitEfficacy = 'normal', weapon: WeaponClass = 'hand'): boolean {
    if (!e.alive) return false
    if (e.shell > 0) {
      // El pico rompe la coraza; lo demás apenas le hace nada.
      const breaking = weapon === 'pickaxe'
      if (breaking) e.shell = Math.max(0, e.shell - damage)
      damage = breaking ? 0 : damage * SHELL_RESIST
      efficacy = breaking ? 'effective' : 'resisted'
      if (breaking && e.shell <= 0) this.emit({ type: 'shellBroken', id: e.id })
    }
    const dazed = e.charge.state === 'dazed'
    if (dazed) efficacy = 'effective'
    e.hp = Math.max(0, e.hp - (dazed ? damage * DAZED_DAMAGE : damage))
    if (e.hp <= 0) {
      this.kill(e)
      this.emit({ type: 'enemyDied', id: e.id, by })
      return true
    }
    const def = ENEMY_DEFS[e.type]
    // Lo aguanta: si cada golpe lo aturdiera, golpeando sin parar nunca llegaría a atacar.
    if (def.stagger <= 0 || e.staggerGuard > 1e-9) {
      this.emit({ type: 'enemyHit', id: e.id, hp: e.hp, kx: 0, kz: 0, by, efficacy })
      return false
    }
    const dx = e.pos.x - from.x
    const dz = e.pos.z - from.z
    const d = Math.hypot(dx, dz) || 1
    e.knock.x = (dx / d) * def.knockback
    e.knock.z = (dz / d) * def.knockback
    e.stagger = def.stagger
    e.staggerGuard = def.stagger + def.staggerGap
    e.attackCooldown = Math.max(e.attackCooldown, def.windup)
    this.emit({ type: 'enemyHit', id: e.id, hp: e.hp, kx: e.knock.x, kz: e.knock.z, by, efficacy })
    return false
  }

  private kill(e: EnemyData) {
    e.alive = false
    this.list.splice(this.list.indexOf(e), 1)
  }

  /** Reinicio de partida: sin enemigos y con la próxima aparición inmediata al anochecer. */
  reset() {
    for (const e of [...this.list]) this.kill(e)
    this.pending = []
    this.spawnTimer = 0
    this.spawnTurn = 0
    this.bossDay = 0
  }

  save(): EnemiesState {
    return {
      list: this.list.map(copyEnemy),
      spawnTimer: this.spawnTimer,
      nextId: this.nextId,
      spawnTurn: this.spawnTurn,
      bossDay: this.bossDay,
      pending: this.pending.map((p) => ({ ...p })),
    }
  }

  load(state: EnemiesState) {
    this.list.length = 0
    this.list.push(...state.list.map(copyEnemy))
    this.spawnTimer = state.spawnTimer
    this.nextId = state.nextId
    this.spawnTurn = state.spawnTurn
    this.bossDay = state.bossDay
    this.pending = (state.pending ?? []).map((p) => ({ ...p }))
  }
}
