import { BERRY_REGROW, PROP_DEFS } from './constants'
import { SpatialGrid, type Collider } from './collision'
import type { Emit } from './events'
import { createBushRng, createPropsRng } from './random'
import { heightAt, MAX_SLOPE, ROCK_LEVEL, SAND_LEVEL, slopeAt, WORLD_SIZE } from './world/terrain'

const TREE_COUNT = 180
const ROCK_COUNT = 60
const BUSH_COUNT = 45

// Forma de cada tipo en espacio local (antes de rotar y escalar): la usan la vista y las hitboxes (aim.ts).
export const TRUNK_TOP_RADIUS = 0.25
export const TRUNK_BOTTOM_RADIUS = 0.35
export const TRUNK_HEIGHT = 2.6
export const TRUNK_SIDES = 6
export const FOLIAGE_RADIUS = 1.5
// La base de la copa queda por encima de los ojos (1,7) incluso con la escala mínima (0,8).
export const FOLIAGE_BASE = 2.4
export const FOLIAGE_HEIGHT = 3.4
export const FOLIAGE_SIDES = 7
/** Las rocas son un icosaedro de radio 1 escalado. */
export const ROCK_RADIUS = 1
/** Los arbustos son un icosaedro de este radio, achatado en Y y subido sobre su base. */
export const BUSH_RADIUS = 0.75
export const BUSH_SQUASH = 0.75
export const BUSH_LIFT = 0.45

export type PropKind = keyof typeof PROP_DEFS

/**
 * Dónde está y cómo es cada prop de la isla; no cambia durante la partida.
 * La transformación es la de un Object3D: posición, giro (Euler XYZ, sin Z) y escala.
 */
export interface PropPlacement {
  /** Índice en la lista de colocaciones: los árboles primero, luego las rocas y al final los arbustos. */
  id: number
  kind: PropKind
  x: number
  /** Árboles y arbustos: base. Rocas: centro. */
  y: number
  z: number
  /** Radio de colisión en XZ. */
  radius: number
  rotX: number
  rotY: number
  scaleX: number
  scaleY: number
  scaleZ: number
}

/** Lo que cambia de un prop durante la partida. */
export interface PropState {
  hp: number
  alive: boolean
  /** Arbustos incompletos: segundos que faltan para que les vuelva a crecer una baya (0: ninguna pendiente). */
  regrowLeft: number
}

export interface PropData extends PropPlacement, PropState {
  maxHp: number
}

/**
 * Coloca los props de la isla (determinista por WORLD_SEED). El orden de consumo del PRNG no debe
 * cambiar: define el mundo (ver world/hash.ts).
 */
export function generatePropPlacements(): PropPlacement[] {
  const rng = createPropsRng()
  const range = (min: number, max: number) => min + rng() * (max - min)
  const randomPoint = () => {
    const angle = rng() * Math.PI * 2
    const radius = Math.sqrt(rng()) * WORLD_SIZE * 0.45
    return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius }
  }
  const placements: PropPlacement[] = []
  const add = (placement: Omit<PropPlacement, 'id'>) => placements.push({ id: placements.length, ...placement })

  let trees = 0
  for (let attempt = 0; trees < TREE_COUNT && attempt < TREE_COUNT * 20; attempt++) {
    const { x, z } = randomPoint()
    const scale = range(0.8, 1.4)
    const rotation = rng() * Math.PI * 2
    const y = heightAt(x, z)
    if (y < SAND_LEVEL + 0.3 || y > ROCK_LEVEL || slopeAt(x, z) > MAX_SLOPE) continue
    add({ kind: 'tree', x, y: y - 0.1, z, radius: TRUNK_BOTTOM_RADIUS * scale, rotX: 0, rotY: rotation, scaleX: scale, scaleY: scale, scaleZ: scale })
    trees++
  }

  let rocks = 0
  for (let attempt = 0; rocks < ROCK_COUNT && attempt < ROCK_COUNT * 20; attempt++) {
    const { x, z } = randomPoint()
    const sx = range(0.8, 2.2)
    const sy = range(0.5, 1.2)
    const sz = range(0.8, 2.2)
    const rx = rng() * Math.PI
    const ry = rng() * Math.PI * 2
    const y = heightAt(x, z)
    if (y < SAND_LEVEL || slopeAt(x, z) > MAX_SLOPE * 1.5) continue
    // Algo hundidas para que no parezcan apoyadas en un punto. El icosaedro tiene radio 1:
    // max(sx, sz) cubre sus vértices en XZ.
    add({ kind: 'rock', x, y: y - sy * 0.3, z, radius: Math.max(sx, sz) * ROCK_RADIUS, rotX: rx * 0.2, rotY: ry, scaleX: sx, scaleY: sy, scaleZ: sz })
    rocks++
  }

  const grid = new SpatialGrid<Collider>()
  for (const { x, z, radius } of placements) grid.insert({ x, z, radius, alive: true })

  // Después de árboles y rocas y con su propio PRNG: no cambian nada de lo anterior.
  const bushRng = createBushRng()
  let bushes = 0
  for (let attempt = 0; bushes < BUSH_COUNT && attempt < BUSH_COUNT * 20; attempt++) {
    const angle = bushRng() * Math.PI * 2
    const r = Math.sqrt(bushRng()) * WORLD_SIZE * 0.45
    const x = Math.cos(angle) * r
    const z = Math.sin(angle) * r
    const scale = 0.8 + bushRng() * 0.4
    const rotation = bushRng() * Math.PI * 2
    const y = heightAt(x, z)
    const radius = BUSH_RADIUS * scale
    if (y < SAND_LEVEL + 0.3 || y > ROCK_LEVEL || slopeAt(x, z) > MAX_SLOPE) continue
    let blocked = false
    for (const other of grid.query(x, z, radius + 1 + grid.maxRadius)) {
      if (Math.hypot(other.x - x, other.z - z) < other.radius + radius + 1) blocked = true
    }
    if (blocked) continue
    add({ kind: 'bush', x, y: y - 0.05, z, radius, rotX: 0, rotY: rotation, scaleX: scale, scaleY: scale, scaleZ: scale })
    grid.insert({ x, z, radius, alive: true })
    bushes++
  }

  return placements
}

/** Props con su estado inicial y la rejilla de colisión, a partir de las colocaciones. */
export function createPropWorld(placements: readonly PropPlacement[] = generatePropPlacements()) {
  const props: PropData[] = placements.map((placement) => {
    const { hp } = PROP_DEFS[placement.kind]
    return { ...placement, hp, maxHp: hp, alive: true, regrowLeft: 0 }
  })
  const grid = new SpatialGrid<PropData>()
  for (const prop of props) grid.insert(prop)
  return { placements, props, grid }
}

export type PropWorld = ReturnType<typeof createPropWorld>

/** Devuelve un prop a su estado inicial. */
export function resetProp(prop: PropData) {
  prop.hp = prop.maxHp
  prop.alive = true
  prop.regrowLeft = 0
}

/** Paso fijo del rebrote: a cada arbusto incompleto le vuelve a crecer una baya cada BERRY_REGROW segundos. */
export function growBerries(props: readonly PropData[], dt: number, emit: Emit) {
  for (const bush of props) {
    if (bush.regrowLeft <= 0) continue
    if (bush.regrowLeft - dt > 1e-9) {
      bush.regrowLeft -= dt
      continue
    }
    bush.hp++
    bush.regrowLeft = bush.hp < bush.maxHp ? BERRY_REGROW : 0
    emit({ type: 'berryGrew', id: bush.id, hp: bush.hp })
  }
}

/** Empieza a contar el rebrote de un arbusto al quitarle una baya; si ya contaba, sigue su ritmo. */
export function startRegrow(bush: PropData) {
  if (bush.regrowLeft <= 0) bush.regrowLeft = BERRY_REGROW
}
