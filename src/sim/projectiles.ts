import type { Collider, SpatialGrid } from './collision'
import { EYE_HEIGHT, GRAVITY, PLAYER_RADIUS, STEP } from './constants'
import { NO_EMIT, type Emit, type PlayerId } from './events'
import { WATER_LEVEL } from './world/terrain'
import { DEFAULT_ISLAND, type Island } from './world/island'

type Vec3 = { x: number; y: number; z: number }

/** La roca del lanzarrocas; la roca gorda, que estalla al caer; y el trasgo que lanza el gigante, que se levanta. */
export type ProjectileKind = 'rock' | 'boulder' | 'goblin'
/** Con qué chocó un proyectil; `expired` si se le acabó el tiempo sin tocar nada. */
export type ProjectileEnd = 'player' | 'obstacle' | 'ground' | 'expired'

/** Radio y segundos que dura en el aire, como mucho. */
export const PROJECTILE_DEFS: Record<ProjectileKind, { radius: number; life: number }> = {
  rock: { radius: 0.3, life: 5 },
  boulder: { radius: 0.6, life: 6 },
  goblin: { radius: 0.45, life: 6 },
}

/** Lo que pasa donde acaba un proyectil (la roca gorda estalla, el trasgo se levanta): lo hace la simulación. */
export type ProjectileLanded = (p: Projectile, end: ProjectileEnd) => void

/** Altura sobre el jugador hasta la que le da un proyectil. */
const PLAYER_HEIGHT = EYE_HEIGHT + 0.1
/** Por encima de esta altura sobre el suelo un proyectil pasa por encima de los props y las estructuras. */
const OBSTACLE_HEIGHT = 3

/**
 * Un proyectil. La trayectoria sale siempre de `from`, `vel` y `tick`, sin acumular nada paso a paso: así el cliente
 * la dibuja en cualquier tick igual que la calcula el servidor.
 */
export interface Projectile {
  id: number
  kind: ProjectileKind
  from: Vec3
  vel: Vec3
  /** Tick en que salió. */
  tick: number
  damage: number
  pos: Vec3
  /** Posición en el paso anterior, para interpolar al dibujar. */
  prev: Vec3
}

/** Un jugador al que le puede dar: en el mundo y vivo (`alive` falso: no le da, como con los enemigos). */
export interface ProjectileTarget {
  id: PlayerId
  pos: Vec3
  alive: boolean
}

export interface ProjectileDamage {
  playerId: PlayerId
  damage: number
  /** De dónde llega: el último punto antes del golpe. */
  from: { x: number; z: number }
}

/** Los proyectiles como datos, para guardar y restaurar la partida. */
export interface ProjectilesState {
  list: Projectile[]
  nextId: number
}

const copyProjectile = (p: Projectile): Projectile => ({ ...p, from: { ...p.from }, vel: { ...p.vel }, pos: { ...p.pos }, prev: { ...p.prev } })

/** Dónde está un proyectil en `tick`. */
export function projectilePos({ from, vel, tick: start }: Pick<Projectile, 'from' | 'vel' | 'tick'>, tick: number, out: Vec3): Vec3 {
  const t = (tick - start) * STEP
  out.x = from.x + vel.x * t
  out.y = from.y + vel.y * t - (GRAVITY * t * t) / 2
  out.z = from.z + vel.z * t
  return out
}

/** Velocidad para que un proyectil lanzado a `speed` en horizontal llegue de `from` a `to`. */
export function aimedVelocity(from: Vec3, to: Vec3, speed: number): Vec3 {
  const dx = to.x - from.x
  const dz = to.z - from.z
  const t = Math.max(Math.hypot(dx, dz) / speed, STEP)
  return { x: dx / t, y: (to.y - from.y) / t + (GRAVITY * t) / 2, z: dz / t }
}

/**
 * Lo que vuela: sale, cae con la gravedad y choca con jugadores, props, estructuras y suelo. Los choques los decide
 * solo la simulación: en red el cliente tiene su propia copia, que sigue la trayectoria (`follow`) y solo se quita
 * cuando llega `projectileHit`. Los dibuja ProjectileView.
 */
export class Projectiles {
  readonly list: Projectile[] = []
  private nextId = 0

  /** `grids`: obstáculos con los que chocan (props, estructuras…). `island`: el suelo contra el que se paran. */
  constructor(
    private grids: SpatialGrid<Collider>[] = [],
    private emit: Emit = NO_EMIT,
    private island: Island = DEFAULT_ISLAND,
    private landed: ProjectileLanded = () => {},
  ) {}

  /** Lanza un proyectil en el tick `tick`. */
  launch(tick: number, kind: ProjectileKind, from: Vec3, vel: Vec3, damage: number): Projectile {
    const projectile = this.add({ id: this.nextId++, kind, from: { ...from }, vel: { ...vel }, tick, damage })
    this.emit({ type: 'projectileThrown', id: projectile.id, kind, x: from.x, y: from.y, z: from.z, vx: vel.x, vy: vel.y, vz: vel.z })
    return projectile
  }

  /** Lo añade a la lista: en la simulación lo hace `launch`; en el cliente, su evento. */
  add(data: Pick<Projectile, 'id' | 'kind' | 'from' | 'vel' | 'tick' | 'damage'>): Projectile {
    const projectile: Projectile = { ...data, pos: { ...data.from }, prev: { ...data.from } }
    this.list.push(projectile)
    return projectile
  }

  remove(id: number) {
    const index = this.list.findIndex((p) => p.id === id)
    if (index >= 0) this.list.splice(index, 1)
  }

  /** Paso fijo al tick `tick`: mueve y resuelve los choques. Devuelve el daño a cada jugador en este paso. */
  step(tick: number, players: readonly ProjectileTarget[]): ProjectileDamage[] {
    const damage: ProjectileDamage[] = []
    for (const p of [...this.list]) {
      this.move(p, tick)
      const target = players.find((player) => player.alive && hitsPlayer(p, player))
      const end = target ? 'player' : this.hitsObstacle(p) ? 'obstacle' : hitsGround(this.island, p) ? 'ground' : (tick - p.tick) * STEP >= PROJECTILE_DEFS[p.kind].life ? 'expired' : null
      if (!end) continue
      this.remove(p.id)
      this.emit({ type: 'projectileHit', id: p.id, x: p.pos.x, y: p.pos.y, z: p.pos.z, end })
      if (target) damage.push({ playerId: target.id, damage: p.damage, from: { x: p.prev.x, z: p.prev.z } })
      this.landed(p, end)
    }
    return damage
  }

  /** La copia del cliente, al tick `tick`: sigue la trayectoria y se queda en el suelo hasta que llegue su `projectileHit`. */
  follow(tick: number) {
    for (const p of this.list) {
      this.move(p, tick)
      p.pos.y = Math.max(p.pos.y, groundAt(this.island, p.pos))
    }
  }

  private move(p: Projectile, tick: number) {
    p.prev.x = p.pos.x
    p.prev.y = p.pos.y
    p.prev.z = p.pos.z
    projectilePos(p, tick, p.pos)
  }

  private hitsObstacle(p: Projectile): boolean {
    const { x, y, z } = p.pos
    if (y - this.island.heightAt(x, z) > OBSTACLE_HEIGHT) return false
    const { radius } = PROJECTILE_DEFS[p.kind]
    return this.grids.some((grid) => {
      for (const other of grid.query(x, z, radius + grid.maxRadius)) {
        if (other.alive && Math.hypot(other.x - x, other.z - z) < other.radius + radius) return true
      }
      return false
    })
  }

  /** Reinicio de partida: sin nada en el aire. */
  clear() {
    this.list.length = 0
    this.nextId = 0
  }

  save(): ProjectilesState {
    return { list: this.list.map(copyProjectile), nextId: this.nextId }
  }

  load(state: ProjectilesState) {
    this.list.length = 0
    this.list.push(...state.list.map(copyProjectile))
    this.nextId = state.nextId
  }
}

const groundAt = (island: Island, { x, z }: Vec3) => Math.max(island.heightAt(x, z), WATER_LEVEL)

const hitsGround = (island: Island, p: Projectile) => p.pos.y <= groundAt(island, p.pos)

function hitsPlayer(p: Projectile, { pos }: ProjectileTarget): boolean {
  const { radius } = PROJECTILE_DEFS[p.kind]
  if (p.pos.y < pos.y - radius || p.pos.y > pos.y + PLAYER_HEIGHT + radius) return false
  return Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z) <= PLAYER_RADIUS + radius
}
