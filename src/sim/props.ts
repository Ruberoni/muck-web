import { BERRY_REGROW, PROP_DEFS } from './constants'
import { SpatialGrid, type Collider } from './collision'
import type { Emit } from './events'
import { createBirchRng, createBushRng, createDarkpineRng, createIronOreRng, createMithrilOreRng, createPropsRng, type Rng } from './random'
import { heightAt, MAX_SLOPE, ROCK_LEVEL, SAND_LEVEL, slopeAt, WORLD_SIZE } from './world/terrain'

const TREE_COUNT = 180
const ROCK_COUNT = 60
const BUSH_COUNT = 45
export const BIRCH_COUNT = 40
export const IRON_ORE_COUNT = 40
export const DARKPINE_COUNT = 20
export const MITHRIL_ORE_COUNT = 16
/** Franjas de altura del terreno (en el centro) de los tipos nuevos: las de las menas no se solapan entre sí. */
export const BIRCH_BAND = { min: 3, max: 6 }
export const IRON_ORE_BAND = { min: 6, max: 8.5 }
export const DARKPINE_BAND = { min: 6, max: 9 }
/** Las cimas. */
export const MITHRIL_ORE_BAND = { min: 8.5, max: Infinity }
/** Los tipos nuevos no se colocan a menos de esto (hasta su borde) del punto de aparición. */
export const SPAWN_EXCLUSION = 8
/** Intentos por prop de cada tipo nuevo: sobran (el test de cantidad exacta lo vigila). */
const ATTEMPTS_PER_PROP = 400
/** Hueco libre que deja el punto de aparición hasta el borde de cualquier prop. */
const SPAWN_CLEARANCE = 3

// Forma de cada familia en espacio local (antes de rotar y escalar): la usan la vista y las hitboxes (aim.ts).
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
  /**
   * Índice en la lista de colocaciones: árboles, rocas, arbustos y después los tipos nuevos (abedules, menas de
   * hierro, pinos oscuros y menas de mithril), cada uno al final para no mover los ids de lo anterior.
   */
  id: number
  kind: PropKind
  x: number
  /** Árboles y arbustos: base. Rocas y menas: centro. */
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

let cached: readonly PropPlacement[] | null = null

/**
 * Los props de la isla, calculados una vez: los comparten todas las salas, la simulación y los tests, así que
 * son de solo lectura (congelados).
 */
export function generatePropPlacements(): readonly PropPlacement[] {
  if (!cached) cached = Object.freeze(buildPropPlacements().map((p) => Object.freeze(p)))
  return cached
}

/**
 * Coloca los props de la isla (determinista por WORLD_SEED). El orden de consumo del PRNG no debe
 * cambiar: define el mundo (ver world/hash.ts). Sin memoizar: generatePropPlacements es la de uso normal.
 */
export function buildPropPlacements(): PropPlacement[] {
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
    if (overlaps(grid, x, z, radius)) continue
    add({ kind: 'bush', x, y: y - 0.05, z, radius, rotX: 0, rotY: rotation, scaleX: scale, scaleY: scale, scaleZ: scale })
    grid.insert({ x, z, radius, alive: true })
    bushes++
  }

  // Los tipos nuevos van detrás, cada uno con su stream, y no se acercan al punto de aparición que dan los de
  // antes: así ni los ids, ni las posiciones, ni el punto de aparición de antes cambian.
  const spawn = findSpawn(grid)
  const scatter = (rng: Rng, count: number, sample: (x: number, z: number, y: number) => Omit<PropPlacement, 'id'> | null) => {
    let placed = 0
    for (let attempt = 0; placed < count && attempt < count * ATTEMPTS_PER_PROP; attempt++) {
      const angle = rng() * Math.PI * 2
      const r = Math.sqrt(rng()) * WORLD_SIZE * 0.45
      const x = Math.cos(angle) * r
      const z = Math.sin(angle) * r
      // `sample` consume siempre lo mismo del stream, se acepte o no: el resto de intentos no depende de ello.
      const placement = sample(x, z, heightAt(x, z))
      if (!placement || Math.hypot(x - spawn.x, z - spawn.z) - placement.radius < SPAWN_EXCLUSION) continue
      if (overlaps(grid, x, z, placement.radius)) continue
      add(placement)
      grid.insert({ x, z, radius: placement.radius, alive: true })
      placed++
    }
  }

  const birchRng = createBirchRng()
  scatter(birchRng, BIRCH_COUNT, (x, z, y) => {
    const scale = 0.9 + birchRng() * 0.4
    const rotation = birchRng() * Math.PI * 2
    if (y < BIRCH_BAND.min || y > BIRCH_BAND.max || slopeAt(x, z) > MAX_SLOPE) return null
    return { kind: 'birch', x, y: y - 0.1, z, radius: TRUNK_BOTTOM_RADIUS * scale, rotX: 0, rotY: rotation, scaleX: scale, scaleY: scale, scaleZ: scale }
  })

  const oreRng = createIronOreRng()
  scatter(oreRng, IRON_ORE_COUNT, (x, z, y) => {
    const sx = 0.8 + oreRng() * 0.8
    const sy = 0.6 + oreRng() * 0.5
    const sz = 0.8 + oreRng() * 0.8
    const rx = oreRng() * Math.PI
    const ry = oreRng() * Math.PI * 2
    if (y < IRON_ORE_BAND.min || y > IRON_ORE_BAND.max || slopeAt(x, z) > MAX_SLOPE * 1.5) return null
    // Como las rocas: algo hundidas, y max(sx, sz) cubre los vértices del icosaedro en XZ.
    return { kind: 'iron_ore', x, y: y - sy * 0.3, z, radius: Math.max(sx, sz) * ROCK_RADIUS, rotX: rx * 0.2, rotY: ry, scaleX: sx, scaleY: sy, scaleZ: sz }
  })

  // Los del mithril, detrás de los del hierro: no mueven sus ids ni sus posiciones.
  const pineRng = createDarkpineRng()
  scatter(pineRng, DARKPINE_COUNT, (x, z, y) => {
    const scale = 1.2 + pineRng() * 0.4
    const rotation = pineRng() * Math.PI * 2
    if (y < DARKPINE_BAND.min || y > DARKPINE_BAND.max || slopeAt(x, z) > MAX_SLOPE) return null
    return { kind: 'darkpine', x, y: y - 0.1, z, radius: TRUNK_BOTTOM_RADIUS * scale, rotX: 0, rotY: rotation, scaleX: scale, scaleY: scale, scaleZ: scale }
  })

  const mithrilRng = createMithrilOreRng()
  scatter(mithrilRng, MITHRIL_ORE_COUNT, (x, z, y) => {
    // Más pequeñas que las de hierro: caben más en las cimas.
    const sx = 0.6 + mithrilRng() * 0.4
    const sy = 0.5 + mithrilRng() * 0.3
    const sz = 0.6 + mithrilRng() * 0.4
    const rx = mithrilRng() * Math.PI
    const ry = mithrilRng() * Math.PI * 2
    if (y < MITHRIL_ORE_BAND.min || y > MITHRIL_ORE_BAND.max || slopeAt(x, z) > MAX_SLOPE * 1.5) return null
    return { kind: 'mithril_ore', x, y: y - sy * 0.3, z, radius: Math.max(sx, sz) * ROCK_RADIUS, rotX: rx * 0.2, rotY: ry, scaleX: sx, scaleY: sy, scaleZ: sz }
  })

  return placements
}

/** Si un círculo en (x, z) queda a menos de 1 m de algún prop de la rejilla. */
function overlaps(grid: SpatialGrid<Collider>, x: number, z: number, radius: number) {
  for (const other of grid.query(x, z, radius + 1 + grid.maxRadius)) {
    if (Math.hypot(other.x - x, other.z - z) < other.radius + radius + 1) return true
  }
  return false
}

/**
 * Punto de aparición: en espiral desde el centro, el primero con hierba y sin props cerca. Los tipos nuevos
 * quedan a más de SPAWN_EXCLUSION del que dan los de antes, así que añadirlos no lo mueve.
 */
export function findSpawn(grid: SpatialGrid<Collider>) {
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
