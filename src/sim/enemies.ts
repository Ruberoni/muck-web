import { biomeAt, type Biome } from './world/biomes'
import { isNight } from './world/daycycle'
import { heightAt, WATER_LEVEL, WORLD_SIZE } from './world/terrain'
import { NO_EMIT, type Emit, type PlayerId } from './events'
import { resolveCircle, type Collider, type SpatialGrid } from './collision'
import {
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
  WADE_DEPTH,
  WORLD_BOUND_FACTOR,
  type EnemyType,
  type HitEfficacy,
} from './constants'

const BOUND = WORLD_SIZE * WORLD_BOUND_FACTOR
const SPAWN_ATTEMPTS = 12
/** Noches que tarda un tipo nuevo en llegar a toda su probabilidad, desde la primera en que sale. */
const SPAWN_RAMP = 3
/** Altura del centro del cuerpo de un tipo de enemigo: a donde apunta aimAtEnemy. */
export const enemyAimHeight = (type: EnemyType) => 0.8 * ENEMY_DEFS[type].scale
/** Distancia entre centros a la que un enemigo de este tipo toca a un jugador. */
const contactOf = (type: EnemyType) => PLAYER_RADIUS + ENEMY_DEFS[type].radius

/** Un enemigo en la simulación. Su modelo y sus animaciones (bote, golpe, embestida, muerte) son de EnemyView. */
export interface EnemyData {
  /** Lo distingue de un prop en `Target`; qué enemigo es lo dice `type`. */
  kind: 'enemy'
  type: EnemyType
  id: number
  pos: { x: number; z: number }
  /** Posición al empezar el paso, para interpolar al dibujar. */
  prev: { x: number; z: number }
  /** Hacia donde mira (rotación Y del modelo: +Z local hacia el jugador). */
  yaw: number
  hp: number
  maxHp: number
  alive: boolean
  attackCooldown: number
  /** Tras un golpe retrocede con `knock` y no persigue ni ataca durante este tiempo. */
  stagger: number
  knock: { x: number; z: number }
  /** Segundos hasta que otro golpe pueda volver a aturdirlo (`stagger` + `staggerGap` de su tipo). */
  staggerGuard: number
  /** A quién persigue (null: a nadie todavía). */
  target: PlayerId | null
  /** Segundos hasta volver a elegir a quién persigue. */
  retarget: number
}

/** Lo que los enemigos ven de un jugador que está en el mundo. Los muertos y quien acaba de reaparecer no son objetivo, pero cuentan para N. */
export interface EnemyPrey {
  id: PlayerId
  pos: { x: number; z: number }
  alive: boolean
}

/** Daño que recibe un jugador en un paso. */
export interface EnemyDamage {
  playerId: PlayerId
  damage: number
}

/** Los enemigos como datos, para guardar y restaurar la partida. */
export interface EnemiesState {
  list: EnemyData[]
  spawnTimer: number
  nextId: number
  spawnTurn: number
}

const copyEnemy = (e: EnemyData): EnemyData => ({ ...e, pos: { ...e.pos }, prev: { ...e.prev }, knock: { ...e.knock } })

/** Número máximo de enemigos a la vez en la noche del día `day`. */
export const enemyCap = (day: number) => Math.min(ENEMY_MAX, ENEMY_BASE_COUNT + (day - 1) * ENEMY_PER_NIGHT)

/** Máximo a la vez con `players` jugadores en el mundo: ENEMY_PER_PLAYER más por cada uno desde el segundo. */
export const enemyCapFor = (day: number, players: number) =>
  Math.min(ENEMY_HARD_MAX, enemyCap(day) + ENEMY_PER_PLAYER * Math.max(0, players - 1))

/** Segundos entre apariciones: con más jugadores salen antes. */
export const spawnIntervalFor = (players: number) => ENEMY_SPAWN_INTERVAL / Math.sqrt(Math.max(1, players))

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

/** No se mueve a agua profunda: si el jugador nada lejos de la orilla, lo esperan en ella. */
const walkable = (x: number, z: number) => heightAt(x, z) >= WATER_LEVEL - WADE_DEPTH

/** Enemigos: aparecen de noche y siguen hasta que los matan. Aparición, persecución, ataque y golpes recibidos. */
export class Enemies {
  /** Enemigos vivos: al morir salen de la lista. */
  readonly list: EnemyData[] = []
  private spawnTimer = 0
  private nextId = 0
  /** A qué jugador vivo le toca la siguiente aparición (por turnos). */
  private spawnTurn = 0

  /** `grids`: obstáculos que rodean (props, estructuras…). */
  constructor(
    private grids: SpatialGrid<Collider>[],
    private rng: () => number = Math.random,
    private emit: Emit = NO_EMIT,
  ) {}

  /**
   * Paso fijo: aparece, persigue y ataca. `players` son los jugadores que están en el mundo (ordenados por id);
   * persiguen al vivo más cercano. Devuelve el daño que recibe cada jugador en este paso (solo los que reciben).
   */
  step(dt: number, players: readonly EnemyPrey[], phase: number, day: number): EnemyDamage[] {
    const prey = players.filter((p) => p.alive)
    if (isNight(phase)) {
      this.spawnTimer -= dt
      if (this.spawnTimer <= 1e-9) {
        if (prey.length && this.list.length < enemyCapFor(day, players.length)) {
          // Por turnos: cada aparición elige a un jugador vivo distinto.
          const around = prey[this.spawnTurn++ % prey.length]
          this.trySpawn(around, prey, day)
        }
        this.spawnTimer = spawnIntervalFor(players.length)
      }
    } else {
      // De día no sale ninguno; los que quedan siguen, y cuentan para el tope de la noche siguiente.
      this.spawnTimer = 0
    }

    const damage: EnemyDamage[] = []
    for (const e of this.list) {
      e.prev.x = e.pos.x
      e.prev.z = e.pos.z
      const target = this.chooseTarget(e, prey, dt)
      if (!this.chase(e, target, dt) || !target) continue
      const dealt = ENEMY_DEFS[e.type].damage
      const hurt = damage.find((d) => d.playerId === target.id)
      if (hurt) hurt.damage += dealt
      else damage.push({ playerId: target.id, damage: dealt })
    }
    this.separate(prey)
    return damage
  }

  /**
   * El jugador vivo más cercano, reevaluado cada ENEMY_RETARGET segundos: solo cambia si otro está
   * ENEMY_RETARGET_MARGIN metros más cerca, para que no dude entre dos. Si el suyo ya no está, elige al momento.
   */
  private chooseTarget(e: EnemyData, prey: readonly EnemyPrey[], dt: number): EnemyPrey | null {
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
      return false
    }
    const player = prey.pos
    const dx = player.x - e.pos.x
    const dz = player.z - e.pos.z
    const dist = Math.hypot(dx, dz)
    if (dist > 1e-6) e.yaw = Math.atan2(dx, dz)
    const contact = contactOf(e.type)
    if (dist > contact + def.gap) {
      const step = Math.min(def.speed * dt, dist - contact - def.gap)
      this.move(e, (dx / dist) * step, (dz / dist) * step)
    }
    if (dist > contact + def.reach) {
      // Al llegar de lejos espera `windup`; el empujón de un golpe no cuenta como irse.
      e.attackCooldown = Math.max(e.attackCooldown - dt, e.staggerGuard > 0 ? 0 : def.windup)
      return false
    }
    e.attackCooldown -= dt
    if (e.attackCooldown > 1e-9) return false
    e.attackCooldown = def.attackInterval
    this.emit({ type: 'enemyAttack', id: e.id, target: prey.id })
    return true
  }

  /** Cada eje por separado, para que resbale por la orilla en vez de pararse. */
  private move(e: EnemyData, mx: number, mz: number) {
    const { x, z } = e.pos
    if (walkable(e.pos.x + mx, e.pos.z)) e.pos.x += mx
    if (walkable(e.pos.x, e.pos.z + mz)) e.pos.z += mz
    const r = Math.hypot(e.pos.x, e.pos.z)
    if (r > BOUND) {
      e.pos.x *= BOUND / r
      e.pos.z *= BOUND / r
    }
    this.settle(e, x, z)
  }

  /** Lo saca de los props; si eso lo empuja al agua profunda, vuelve a (x, z). */
  private settle(e: EnemyData, x: number, z: number) {
    for (const grid of this.grids) resolveCircle(e.pos, ENEMY_DEFS[e.type].radius, grid)
    if (!walkable(e.pos.x, e.pos.z)) {
      e.pos.x = x
      e.pos.z = z
    }
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

  /** Alrededor de `around` y a ENEMY_SPAWN_MIN como poco de todos los jugadores vivos. */
  private trySpawn(around: EnemyPrey, prey: readonly EnemyPrey[], day: number) {
    for (let i = 0; i < SPAWN_ATTEMPTS; i++) {
      const angle = this.rng() * Math.PI * 2
      const r = ENEMY_SPAWN_MIN + this.rng() * (ENEMY_SPAWN_MAX - ENEMY_SPAWN_MIN)
      const x = around.pos.x + Math.cos(angle) * r
      const z = around.pos.z + Math.sin(angle) * r
      if (Math.hypot(x, z) > BOUND || heightAt(x, z) < WATER_LEVEL + 0.2) continue
      if (prey.some((p) => p !== around && Math.hypot(p.pos.x - x, p.pos.z - z) < ENEMY_SPAWN_MIN)) continue
      const type = spawnType(this.rng(), day, biomeAt(x, z))
      const pos = { x, z }
      if (this.grids.some((grid) => resolveCircle(pos, ENEMY_DEFS[type].radius, grid))) continue
      return this.spawnAt(x, z, type)
    }
    return null
  }

  /** Crea un enemigo de tipo `type` en (x, z) mirando hacia +Z. */
  spawnAt(x: number, z: number, type: EnemyType = 'goblin'): EnemyData {
    const def = ENEMY_DEFS[type]
    const e: EnemyData = {
      kind: 'enemy',
      type,
      id: this.nextId++,
      pos: { x, z },
      prev: { x, z },
      yaw: 0,
      hp: def.hp,
      maxHp: def.hp,
      alive: true,
      attackCooldown: def.windup,
      stagger: 0,
      knock: { x: 0, z: 0 },
      staggerGuard: 0,
      target: null,
      retarget: 0,
    }
    this.list.push(e)
    this.emit({ type: 'enemySpawn', id: e.id, enemy: type, x, z })
    return e
  }

  /** Golpe de `by` desde `from` (la posición del atacante). Devuelve true si lo mata. */
  hit(e: EnemyData, damage: number, from: { x: number; z: number }, by: PlayerId, efficacy: HitEfficacy = 'normal'): boolean {
    if (!e.alive) return false
    e.hp = Math.max(0, e.hp - damage)
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
    this.spawnTimer = 0
    this.spawnTurn = 0
  }

  save(): EnemiesState {
    return { list: this.list.map(copyEnemy), spawnTimer: this.spawnTimer, nextId: this.nextId, spawnTurn: this.spawnTurn }
  }

  load(state: EnemiesState) {
    this.list.length = 0
    this.list.push(...state.list.map(copyEnemy))
    this.spawnTimer = state.spawnTimer
    this.nextId = state.nextId
    this.spawnTurn = state.spawnTurn
  }
}
