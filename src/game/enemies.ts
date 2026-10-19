import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { isNight } from '../world/daycycle'
import { heightAt, WATER_LEVEL, WORLD_SIZE } from '../world/terrain'
import { resolveCircle, type Collider, type SpatialGrid } from './collision'
import {
  ENEMY_ATTACK_INTERVAL,
  ENEMY_BASE_COUNT,
  ENEMY_DAMAGE,
  ENEMY_DEF,
  ENEMY_GAP,
  ENEMY_KNOCKBACK,
  ENEMY_MAX,
  ENEMY_PER_NIGHT,
  ENEMY_RADIUS,
  ENEMY_REACH,
  ENEMY_SPAWN_INTERVAL,
  ENEMY_SPAWN_MAX,
  ENEMY_SPAWN_MIN,
  ENEMY_SPEED,
  ENEMY_STAGGER,
  ENEMY_WINDUP,
  PLAYER_RADIUS,
  WADE_DEPTH,
  WORLD_BOUND_FACTOR,
} from './constants'

const BOUND = WORLD_SIZE * WORLD_BOUND_FACTOR
const CONTACT = PLAYER_RADIUS + ENEMY_RADIUS
const SPAWN_ATTEMPTS = 12
const HURT_FLASH = 0.15
const LUNGE_TIME = 0.2
const DEATH_TIME = 0.35
// El modelo mide unos 1,4 sin escalar: escalado, los ojos quedan algo por debajo de los del jugador.
const MODEL_SCALE = 1.25
/** Altura del centro del cuerpo: a donde apunta aimAtEnemy. */
export const ENEMY_AIM_HEIGHT = 0.8 * MODEL_SCALE

const bodyGeometry = new THREE.IcosahedronGeometry(0.5, 0).scale(1, 1.25, 0.9).translate(0, 0.75, 0)
// Cuernos y pies, del mismo color oscuro, en una sola geometría.
const detailGeometry = mergeGeometries([
  new THREE.ConeGeometry(0.08, 0.32, 5).rotateZ(-0.4).translate(0.24, 1.38, 0),
  new THREE.ConeGeometry(0.08, 0.32, 5).rotateZ(0.4).translate(-0.24, 1.38, 0),
  new THREE.BoxGeometry(0.18, 0.15, 0.28).translate(0.2, 0.075, 0.04),
  new THREE.BoxGeometry(0.18, 0.15, 0.28).translate(-0.2, 0.075, 0.04),
])
// Mirando hacia +Z local.
const eyeGeometry = mergeGeometries([
  new THREE.OctahedronGeometry(0.08, 0).translate(0.16, 1.02, 0.4),
  new THREE.OctahedronGeometry(0.08, 0).translate(-0.16, 1.02, 0.4),
])
// Un poco de emisivo para que la silueta se lea de noche.
const BODY_GLOW = new THREE.Color('#2b1240')
const bodyMaterial = new THREE.MeshStandardMaterial({ color: '#9558bd', emissive: BODY_GLOW, flatShading: true })
const detailMaterial = new THREE.MeshStandardMaterial({ color: '#3a2348', flatShading: true })
// Sin iluminación: los ojos se ven de noche.
const eyeMaterial = new THREE.MeshBasicMaterial({ color: '#ffe066' })
const HURT_COLOR = new THREE.Color('#ff3b2f')

export interface EnemyData {
  kind: 'enemy'
  id: number
  pos: { x: number; z: number }
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
  /** Temporizadores de animación, en tiempo de simulación. */
  walk: number
  hurt: number
  lunge: number
  dying: number
  object: THREE.Group
  material: THREE.MeshStandardMaterial
}

/** Número máximo de enemigos a la vez en la noche del día `day`. */
export const enemyCap = (day: number) => Math.min(ENEMY_MAX, ENEMY_BASE_COUNT + (day - 1) * ENEMY_PER_NIGHT)

/** No se mueve a agua profunda: si el jugador nada lejos de la orilla, lo esperan en ella. */
const walkable = (x: number, z: number) => heightAt(x, z) >= WATER_LEVEL - WADE_DEPTH

/** Enemigos nocturnos: aparición, persecución, ataque, golpes recibidos y su modelo. */
export class Enemies {
  /** Enemigos vivos. Los que mueren pasan a `fading` hasta que acaba su animación. */
  readonly list: EnemyData[] = []
  readonly group = new THREE.Group()
  private fading: EnemyData[] = []
  private spawnTimer = 0
  private nextId = 0

  constructor(
    private grid: SpatialGrid<Collider>,
    private rng: () => number = Math.random,
  ) {}

  /** Paso fijo: aparece, persigue y ataca. Devuelve el daño total que recibe el jugador. */
  step(dt: number, player: { x: number; z: number }, phase: number, day: number): number {
    if (isNight(phase)) {
      this.spawnTimer -= dt
      if (this.spawnTimer <= 1e-9) {
        if (this.list.length < enemyCap(day)) this.trySpawn(player.x, player.z)
        this.spawnTimer = ENEMY_SPAWN_INTERVAL
      }
    } else {
      // Al amanecer se desvanecen sin soltar nada.
      this.spawnTimer = 0
      while (this.list.length) this.kill(this.list[0])
    }

    let damage = 0
    for (const e of this.list) {
      e.prev.x = e.pos.x
      e.prev.z = e.pos.z
      e.hurt = Math.max(0, e.hurt - dt)
      e.lunge = Math.max(0, e.lunge - dt)
      if (this.chase(e, player, dt)) damage += ENEMY_DAMAGE
    }
    this.separate(player)

    for (const e of this.fading) e.dying -= dt
    for (const e of this.fading.filter((f) => f.dying <= 0)) this.dispose(e)

    this.place(1)
    return damage
  }

  /** Mueve un enemigo y devuelve si ataca en este paso. */
  private chase(e: EnemyData, player: { x: number; z: number }, dt: number): boolean {
    if (e.stagger > 0) {
      const k = e.stagger / ENEMY_STAGGER
      this.move(e, e.knock.x * k * dt, e.knock.z * k * dt)
      e.stagger = Math.max(0, e.stagger - dt)
      return false
    }
    const dx = player.x - e.pos.x
    const dz = player.z - e.pos.z
    const dist = Math.hypot(dx, dz)
    if (dist > 1e-6) e.yaw = Math.atan2(dx, dz)
    if (dist > CONTACT + ENEMY_GAP) {
      const step = Math.min(ENEMY_SPEED * dt, dist - CONTACT - ENEMY_GAP)
      this.move(e, (dx / dist) * step, (dz / dist) * step)
      e.walk += dt
    }
    if (dist > CONTACT + ENEMY_REACH) {
      e.attackCooldown = Math.max(e.attackCooldown - dt, ENEMY_WINDUP)
      return false
    }
    e.attackCooldown -= dt
    if (e.attackCooldown > 1e-9) return false
    e.attackCooldown = ENEMY_ATTACK_INTERVAL
    e.lunge = LUNGE_TIME
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
    resolveCircle(e.pos, ENEMY_RADIUS, this.grid)
    if (!walkable(e.pos.x, e.pos.z)) {
      e.pos.x = x
      e.pos.z = z
    }
  }

  /** Ni se amontonan entre ellos ni se meten dentro del jugador. */
  private separate(player: { x: number; z: number }) {
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
        push(a, b.x, b.z, ENEMY_RADIUS * 2, 0.5)
        push(b, ax, az, ENEMY_RADIUS * 2, 0.5)
      }
    }
    for (const e of this.list) {
      push(e.pos, player.x, player.z, CONTACT, 1)
      this.settle(e, e.prev.x, e.prev.z)
    }
  }

  private trySpawn(px: number, pz: number) {
    for (let i = 0; i < SPAWN_ATTEMPTS; i++) {
      const angle = this.rng() * Math.PI * 2
      const r = ENEMY_SPAWN_MIN + this.rng() * (ENEMY_SPAWN_MAX - ENEMY_SPAWN_MIN)
      const x = px + Math.cos(angle) * r
      const z = pz + Math.sin(angle) * r
      if (Math.hypot(x, z) > BOUND || heightAt(x, z) < WATER_LEVEL + 0.2) continue
      const pos = { x, z }
      if (resolveCircle(pos, ENEMY_RADIUS, this.grid)) continue
      return this.spawnAt(x, z)
    }
    return null
  }

  /** Crea un enemigo en (x, z) mirando hacia +Z. */
  spawnAt(x: number, z: number): EnemyData {
    const material = bodyMaterial.clone()
    const object = new THREE.Group()
    const body = new THREE.Mesh(bodyGeometry, material)
    const detail = new THREE.Mesh(detailGeometry, detailMaterial)
    const eyes = new THREE.Mesh(eyeGeometry, eyeMaterial)
    body.castShadow = detail.castShadow = true
    object.add(body, detail, eyes)
    const e: EnemyData = {
      kind: 'enemy',
      id: this.nextId++,
      pos: { x, z },
      prev: { x, z },
      yaw: 0,
      hp: ENEMY_DEF.hp,
      maxHp: ENEMY_DEF.hp,
      alive: true,
      attackCooldown: ENEMY_WINDUP,
      stagger: 0,
      knock: { x: 0, z: 0 },
      walk: 0,
      hurt: 0,
      lunge: 0,
      dying: 0,
      object,
      material,
    }
    for (const mesh of object.children) mesh.userData.enemy = e
    this.list.push(e)
    this.group.add(object)
    this.place(1)
    return e
  }

  /** Golpe desde `from` (la posición del jugador). Devuelve true si lo mata. */
  hit(e: EnemyData, damage: number, from: { x: number; z: number }): boolean {
    if (!e.alive) return false
    e.hp = Math.max(0, e.hp - damage)
    e.hurt = HURT_FLASH
    if (e.hp <= 0) {
      this.kill(e)
      return true
    }
    const dx = e.pos.x - from.x
    const dz = e.pos.z - from.z
    const d = Math.hypot(dx, dz) || 1
    e.knock.x = (dx / d) * ENEMY_KNOCKBACK
    e.knock.z = (dz / d) * ENEMY_KNOCKBACK
    e.stagger = ENEMY_STAGGER
    e.attackCooldown = Math.max(e.attackCooldown, ENEMY_WINDUP)
    return false
  }

  private kill(e: EnemyData) {
    e.alive = false
    e.dying = DEATH_TIME
    this.list.splice(this.list.indexOf(e), 1)
    this.fading.push(e)
  }

  private dispose(e: EnemyData) {
    this.fading.splice(this.fading.indexOf(e), 1)
    this.group.remove(e.object)
    e.material.dispose()
  }

  /** Reinicio de partida: sin enemigos y con la próxima aparición inmediata al anochecer. */
  reset() {
    for (const e of [...this.list]) this.kill(e)
    for (const e of [...this.fading]) this.dispose(e)
    this.spawnTimer = 0
  }

  /** Coloca los modelos entre el paso anterior y el actual (alpha = 1: posición simulada). */
  place(alpha: number) {
    for (const e of this.list) this.placeOne(e, alpha)
    for (const e of this.fading) this.placeOne(e, 1)
    this.group.updateMatrixWorld()
  }

  private placeOne(e: EnemyData, alpha: number) {
    const x = e.prev.x + (e.pos.x - e.prev.x) * alpha
    const z = e.prev.z + (e.pos.z - e.prev.z) * alpha
    const bob = Math.abs(Math.sin(e.walk * 9)) * 0.12
    // Al atacar se lanza un poco hacia delante.
    const lunge = Math.sin((Math.PI * e.lunge) / LUNGE_TIME) * 0.35
    const o = e.object
    o.position.set(x + Math.sin(e.yaw) * lunge, heightAt(x, z) + bob, z + Math.cos(e.yaw) * lunge)
    o.rotation.y = e.yaw
    // Muere encogiéndose y hundiéndose.
    const s = e.alive ? 1 : Math.max(0, e.dying / DEATH_TIME)
    o.scale.set(1 + (1 - s) * 0.3, s, 1 + (1 - s) * 0.3).multiplyScalar(MODEL_SCALE)
    e.material.emissive.copy(e.hurt > 0 ? HURT_COLOR : BODY_GLOW)
  }
}
