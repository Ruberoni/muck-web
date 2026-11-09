import { PROP_DEFS } from './constants'
import { SpatialGrid, type Collider } from './collision'
import type { Emit } from './events'
import { createBirchRng, createCoalOreRng, createCrystalOreRng, createDeadTreeRng, createBushRng, createDarkpineRng, createHerbRng, createIronOreRng, createMithrilOreRng, createRockRng, createTreeRng, type Rng } from './random'
import { BIOME_FLORA } from './world/biomes'
import { DEFAULT_ISLAND, type Island } from './world/island'
import { lift, MAX_SLOPE, ROCK_LEVEL, SAND_LEVEL, slopeLimit, WATER_LEVEL, WORLD_SIZE } from './world/terrain'

const TREE_COUNT = 180
const ROCK_COUNT = 60
const BUSH_COUNT = 45
export const BIRCH_COUNT = 40
export const IRON_ORE_COUNT = 40
export const DARKPINE_COUNT = 20
export const MITHRIL_ORE_COUNT = 16
export const HERB_COUNT = 30
export const COAL_ORE_COUNT = 30
export const CRYSTAL_ORE_COUNT = 12
export const DEADTREE_COUNT = 24
/** Las rocas llegan hasta la arena; el resto de lo que crece en el suelo, solo hasta la hierba. */
const ROCK_MIN_HEIGHT = 0.4
/**
 * Franjas de altura del terreno (en el centro) de algunos tipos: las de las menas no se solapan entre sí. Se dan en la
 * altura de antes de elevar las montañas y pasan por `lift`, así que caen en las mismas laderas.
 */
const band = (min: number, max: number) => ({ min: lift(min), max: lift(max) })
export const BIRCH_BAND = band(3, 6)
export const IRON_ORE_BAND = band(6, 8.5)
export const DARKPINE_BAND = band(6, 9)
/** Las cimas. */
export const MITHRIL_ORE_BAND = band(8.5, Infinity)
/** Entre la pradera y la montaña: se encuentra pronto, con el pico de madera. */
export const COAL_ORE_BAND = band(3, 8)
/** En las cimas, como el mithril. */
export const CRYSTAL_ORE_BAND = band(8, Infinity)
/** Los tipos que salen después de los arbustos no se colocan a menos de esto (hasta su borde) del punto de aparición. */
export const SPAWN_EXCLUSION = 8
/** Intentos por prop de cada tipo: sobran (el test de cantidad exacta lo vigila). */
const ATTEMPTS_PER_PROP = 400
/** Hueco libre que deja el punto de aparición hasta el borde de cualquier prop. */
const SPAWN_CLEARANCE = 3
/** Alrededor del punto de aparición el suelo es llano hasta aquí: se puede colocar una fogata en cualquier dirección. */
const SPAWN_FLAT_RADIUS = 3
const SPAWN_FLAT_SLOPE = MAX_SLOPE * 0.6

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
/** La hierba curativa es una mata como los arbustos, mucho más pequeña; la flor de encima es adorno. */
export const HERB_RADIUS = 0.3
export const HERB_SQUASH = 0.7
export const HERB_LIFT = 0.18
/** Los arbustos son un icosaedro de este radio, achatado en Y y subido sobre su base. */
export const BUSH_RADIUS = 0.75
export const BUSH_SQUASH = 0.75
export const BUSH_LIFT = 0.45

export type PropKind = keyof typeof PROP_DEFS

/** Cuántos hay de cada tipo en la isla de siempre: el bioma decide dónde salen, no cuántos (islands.ts comprueba que quepan). */
/**
 * Cuántos hay de cada tipo en `island`: los de la isla de siempre por lo que crece su lado elevado a 1,5. Algo menos que
 * su superficie: en una grande hay más sitio vacío entre zonas, y caminar es parte del juego.
 */
export function propCounts(island: Island): Record<PropKind, number> {
  const scale = (island.size / WORLD_SIZE) ** 1.5
  return Object.fromEntries(Object.entries(PROP_COUNTS).map(([kind, count]) => [kind, Math.round(count * scale)])) as Record<PropKind, number>
}

export const PROP_COUNTS: Record<PropKind, number> = {
  tree: TREE_COUNT,
  rock: ROCK_COUNT,
  bush: BUSH_COUNT,
  birch: BIRCH_COUNT,
  iron_ore: IRON_ORE_COUNT,
  darkpine: DARKPINE_COUNT,
  mithril_ore: MITHRIL_ORE_COUNT,
  healing_herb: HERB_COUNT,
  coal_ore: COAL_ORE_COUNT,
  crystal_ore: CRYSTAL_ORE_COUNT,
  deadtree: DEADTREE_COUNT,
}

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

/** Las últimas islas calculadas, por semilla: la de siempre, la de la partida y poco más. */
const cached = new Map<number, readonly PropPlacement[]>()
const CACHED_ISLANDS = 4

/**
 * Los props de la isla `island` (sin ella, la de siempre), calculados una vez: los comparten la simulación, la vista y
 * los tests, así que son de solo lectura (congelados).
 */
export function generatePropPlacements(island: Island = DEFAULT_ISLAND): readonly PropPlacement[] {
  let placements = cached.get(island.seed)
  if (!placements) {
    placements = Object.freeze(buildPropPlacements(island).map((p) => Object.freeze(p)))
    if (cached.size >= CACHED_ISLANDS) cached.delete(cached.keys().next().value!)
    cached.set(island.seed, placements)
  }
  return placements
}

/**
 * Coloca los props de la isla `island` (determinista por su semilla). Cada tipo tiene su stream y sale en orden: árboles,
 * rocas y arbustos, que deciden el punto de aparición, y después el resto, que se queda lejos de él. El bioma de cada
 * sitio (BIOME_FLORA) decide si un intento arraiga, pero no cuántos hay: se sigue hasta colocarlos todos.
 * Sin memoizar: generatePropPlacements es la de uso normal.
 */
export function buildPropPlacements(island: Island = DEFAULT_ISLAND): PropPlacement[] {
  const placements: PropPlacement[] = []
  const counts = propCounts(island)
  // En las grandes, al milímetro: viajan en el welcome y así ocupan menos (la de siempre, como siempre).
  const round = island.size > WORLD_SIZE ? (n: number) => Math.round(n * 1000) / 1000 : (n: number) => n
  const grid = new SpatialGrid<Collider>()
  let spawn: { x: number; z: number } | null = null
  const scatter = (rng: Rng, count: number, sample: (x: number, z: number, y: number) => Omit<PropPlacement, 'id'> | null) => {
    let placed = 0
    for (let attempt = 0; placed < count && attempt < count * ATTEMPTS_PER_PROP; attempt++) {
      const angle = rng() * Math.PI * 2
      const r = Math.sqrt(rng()) * island.size * 0.45
      const x = Math.cos(angle) * r
      const z = Math.sin(angle) * r
      const y = island.heightAt(x, z)
      // `sample` y la tirada consumen siempre lo mismo del stream, se acepte o no: el resto de intentos no depende de ello.
      const placement = sample(x, z, y)
      const roll = rng()
      if (!placement || roll >= BIOME_FLORA[placement.kind][island.biomeAt(x, z, y)]) continue
      if (spawn && Math.hypot(x - spawn.x, z - spawn.z) - placement.radius < SPAWN_EXCLUSION) continue
      if (overlaps(grid, x, z, placement.radius)) continue
      const { kind, rotX, rotY, scaleX, scaleY, scaleZ } = placement
      placements.push({
        id: placements.length,
        kind,
        x: round(placement.x),
        y: round(placement.y),
        z: round(placement.z),
        radius: round(placement.radius),
        rotX: round(rotX),
        rotY: round(rotY),
        scaleX: round(scaleX),
        scaleY: round(scaleY),
        scaleZ: round(scaleZ),
      })
      grid.insert({ x, z, radius: placement.radius, alive: true })
      placed++
    }
  }

  const treeRng = createTreeRng(island.seed)
  scatter(treeRng, counts.tree, (x, z, y) => {
    const scale = 0.8 + treeRng() * 0.6
    const rotation = treeRng() * Math.PI * 2
    if (y < SAND_LEVEL + 0.3 || y > ROCK_LEVEL || island.slopeAt(x, z) > MAX_SLOPE) return null
    return { kind: 'tree', x, y: y - 0.1, z, radius: TRUNK_BOTTOM_RADIUS * scale, rotX: 0, rotY: rotation, scaleX: scale, scaleY: scale, scaleZ: scale }
  })

  const rockRng = createRockRng(island.seed)
  scatter(rockRng, counts.rock, (x, z, y) => {
    const sx = 0.8 + rockRng() * 1.4
    const sy = 0.5 + rockRng() * 0.7
    const sz = 0.8 + rockRng() * 1.4
    const rx = rockRng() * Math.PI
    const ry = rockRng() * Math.PI * 2
    if (y < ROCK_MIN_HEIGHT || island.slopeAt(x, z) > slopeLimit(y, MAX_SLOPE * 1.5)) return null
    // Algo hundidas para que no parezcan apoyadas en un punto. El icosaedro tiene radio 1:
    // max(sx, sz) cubre sus vértices en XZ.
    return { kind: 'rock', x, y: y - sy * 0.3, z, radius: Math.max(sx, sz) * ROCK_RADIUS, rotX: rx * 0.2, rotY: ry, scaleX: sx, scaleY: sy, scaleZ: sz }
  })

  const bushRng = createBushRng(island.seed)
  scatter(bushRng, counts.bush, (x, z, y) => {
    const scale = 0.8 + bushRng() * 0.4
    const rotation = bushRng() * Math.PI * 2
    if (y < SAND_LEVEL + 0.3 || y > ROCK_LEVEL || island.slopeAt(x, z) > MAX_SLOPE) return null
    return { kind: 'bush', x, y: y - 0.05, z, radius: BUSH_RADIUS * scale, rotX: 0, rotY: rotation, scaleX: scale, scaleY: scale, scaleZ: scale }
  })

  // Los demás no se acercan al punto de aparición que dan estos.
  spawn = findSpawn(grid, island)

  const birchRng = createBirchRng(island.seed)
  scatter(birchRng, counts.birch, (x, z, y) => {
    const scale = 0.9 + birchRng() * 0.4
    const rotation = birchRng() * Math.PI * 2
    if (y < BIRCH_BAND.min || y > BIRCH_BAND.max || island.slopeAt(x, z) > MAX_SLOPE) return null
    return { kind: 'birch', x, y: y - 0.1, z, radius: TRUNK_BOTTOM_RADIUS * scale, rotX: 0, rotY: rotation, scaleX: scale, scaleY: scale, scaleZ: scale }
  })

  const oreRng = createIronOreRng(island.seed)
  scatter(oreRng, counts.iron_ore, (x, z, y) => {
    const sx = 0.8 + oreRng() * 0.8
    const sy = 0.6 + oreRng() * 0.5
    const sz = 0.8 + oreRng() * 0.8
    const rx = oreRng() * Math.PI
    const ry = oreRng() * Math.PI * 2
    if (y < IRON_ORE_BAND.min || y > IRON_ORE_BAND.max || island.slopeAt(x, z) > slopeLimit(y, MAX_SLOPE * 1.5)) return null
    // Como las rocas: algo hundidas, y max(sx, sz) cubre los vértices del icosaedro en XZ.
    return { kind: 'iron_ore', x, y: y - sy * 0.3, z, radius: Math.max(sx, sz) * ROCK_RADIUS, rotX: rx * 0.2, rotY: ry, scaleX: sx, scaleY: sy, scaleZ: sz }
  })

  const pineRng = createDarkpineRng(island.seed)
  scatter(pineRng, counts.darkpine, (x, z, y) => {
    const scale = 1.2 + pineRng() * 0.4
    const rotation = pineRng() * Math.PI * 2
    if (y < DARKPINE_BAND.min || y > DARKPINE_BAND.max || island.slopeAt(x, z) > slopeLimit(y, MAX_SLOPE)) return null
    return { kind: 'darkpine', x, y: y - 0.1, z, radius: TRUNK_BOTTOM_RADIUS * scale, rotX: 0, rotY: rotation, scaleX: scale, scaleY: scale, scaleZ: scale }
  })

  const mithrilRng = createMithrilOreRng(island.seed)
  scatter(mithrilRng, counts.mithril_ore, (x, z, y) => {
    // Más pequeñas que las de hierro: caben más en las cimas.
    const sx = 0.6 + mithrilRng() * 0.4
    const sy = 0.6 + mithrilRng() * 0.4
    const sz = 0.6 + mithrilRng() * 0.4
    const rx = mithrilRng() * Math.PI
    const ry = mithrilRng() * Math.PI * 2
    if (y < MITHRIL_ORE_BAND.min || y > MITHRIL_ORE_BAND.max || island.slopeAt(x, z) > slopeLimit(y, MAX_SLOPE * 1.5)) return null
    return { kind: 'mithril_ore', x, y: y - sy * 0.3, z, radius: Math.max(sx, sz) * ROCK_RADIUS, rotX: rx * 0.2, rotY: ry, scaleX: sx, scaleY: sy, scaleZ: sz }
  })

  const herbRng = createHerbRng(island.seed)
  scatter(herbRng, counts.healing_herb, (x, z, y) => {
    const scale = 0.9 + herbRng() * 0.4
    const rotation = herbRng() * Math.PI * 2
    if (y < SAND_LEVEL + 0.3 || y > ROCK_LEVEL || island.slopeAt(x, z) > MAX_SLOPE) return null
    return { kind: 'healing_herb', x, y: y - 0.02, z, radius: HERB_RADIUS * scale, rotX: 0, rotY: rotation, scaleX: scale, scaleY: scale, scaleZ: scale }
  })

  const coalRng = createCoalOreRng(island.seed)
  scatter(coalRng, counts.coal_ore, (x, z, y) => {
    const sx = 0.8 + coalRng() * 0.6
    const sy = 0.6 + coalRng() * 0.4
    const sz = 0.8 + coalRng() * 0.6
    const rx = coalRng() * Math.PI
    const ry = coalRng() * Math.PI * 2
    if (y < COAL_ORE_BAND.min || y > COAL_ORE_BAND.max || island.slopeAt(x, z) > slopeLimit(y, MAX_SLOPE * 1.5)) return null
    return { kind: 'coal_ore', x, y: y - sy * 0.3, z, radius: Math.max(sx, sz) * ROCK_RADIUS, rotX: rx * 0.2, rotY: ry, scaleX: sx, scaleY: sy, scaleZ: sz }
  })

  const crystalRng = createCrystalOreRng(island.seed)
  scatter(crystalRng, counts.crystal_ore, (x, z, y) => {
    const sx = 0.6 + crystalRng() * 0.4
    const sy = 0.6 + crystalRng() * 0.4
    const sz = 0.6 + crystalRng() * 0.4
    const rx = crystalRng() * Math.PI
    const ry = crystalRng() * Math.PI * 2
    if (y < CRYSTAL_ORE_BAND.min || y > CRYSTAL_ORE_BAND.max || island.slopeAt(x, z) > slopeLimit(y, MAX_SLOPE * 1.5)) return null
    return { kind: 'crystal_ore', x, y: y - sy * 0.3, z, radius: Math.max(sx, sz) * ROCK_RADIUS, rotX: rx * 0.2, rotY: ry, scaleX: sx, scaleY: sy, scaleZ: sz }
  })

  const deadRng = createDeadTreeRng(island.seed)
  scatter(deadRng, counts.deadtree, (x, z, y) => {
    const scale = 0.9 + deadRng() * 0.4
    const rotation = deadRng() * Math.PI * 2
    // También en la arena, a diferencia de los vivos.
    if (y < WATER_LEVEL + 0.4 || y > ROCK_LEVEL || island.slopeAt(x, z) > MAX_SLOPE) return null
    return { kind: 'deadtree', x, y: y - 0.1, z, radius: TRUNK_BOTTOM_RADIUS * scale, rotX: 0, rotY: rotation, scaleX: scale, scaleY: scale, scaleZ: scale }
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
 * Punto de aparición: en espiral desde el centro, el primero con hierba, llano y sin props cerca. Lo que se coloca
 * después de él queda a más de SPAWN_EXCLUSION, así que no lo mueve.
 */
export function findSpawn(grid: SpatialGrid<Collider>, island: Island = DEFAULT_ISLAND) {
  const isClear = (x: number, z: number) => {
    for (const prop of grid.query(x, z, SPAWN_CLEARANCE + grid.maxRadius)) {
      if (Math.hypot(prop.x - x, prop.z - z) - prop.radius < SPAWN_CLEARANCE) return false
    }
    return true
  }
  const isFlat = (x: number, z: number) => {
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2
      if (island.slopeAt(x + Math.cos(angle) * SPAWN_FLAT_RADIUS, z + Math.sin(angle) * SPAWN_FLAT_RADIUS) > SPAWN_FLAT_SLOPE) return false
    }
    return island.slopeAt(x, z) <= SPAWN_FLAT_SLOPE
  }
  for (let i = 0; i < 4000; i++) {
    const angle = i * 0.5
    const r = angle * 0.4
    const x = Math.cos(angle) * r
    const z = Math.sin(angle) * r
    const h = island.heightAt(x, z)
    if (h > SAND_LEVEL + 0.3 && h < ROCK_LEVEL && isClear(x, z) && isFlat(x, z)) return { x, z }
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
  // Lo que vuelve a crecer (arbustos y hierbas): lo único que hay que mirar en cada paso.
  const regrowing = props.filter((p) => PROP_DEFS[p.kind].harvest)
  return { placements, props, grid, regrowing }
}

export type PropWorld = ReturnType<typeof createPropWorld>

/** La vida de lo que se rompe en esta partida, sin tocar lo que ya se haya dañado. */
export function scaleProps(props: readonly PropData[], factor: number) {
  for (const prop of props) {
    const { hp, harvest } = PROP_DEFS[prop.kind]
    if (harvest) continue
    const whole = prop.hp === prop.maxHp
    prop.maxHp = Math.ceil(hp * factor)
    if (whole) prop.hp = prop.maxHp
  }
}

/** Devuelve un prop a su estado inicial. */
export function resetProp(prop: PropData) {
  prop.hp = prop.maxHp
  prop.alive = true
  prop.regrowLeft = 0
}

/** Paso fijo del rebrote: a lo que se recoge poco a poco le vuelve una unidad (una baya) cada `harvest.regrow` segundos. */
export function growBerries(props: readonly PropData[], dt: number, emit: Emit) {
  for (const bush of props) {
    if (bush.regrowLeft <= 0) continue
    if (bush.regrowLeft - dt > 1e-9) {
      bush.regrowLeft -= dt
      continue
    }
    bush.hp++
    bush.regrowLeft = bush.hp < bush.maxHp ? regrowOf(bush) : 0
    emit({ type: 'berryGrew', id: bush.id, hp: bush.hp })
  }
}

/** Empieza a contar el rebrote de un arbusto al quitarle una baya; si ya contaba, sigue su ritmo. */
export function startRegrow(bush: PropData) {
  if (bush.regrowLeft <= 0) bush.regrowLeft = regrowOf(bush)
}

const regrowOf = ({ kind }: PropData) => PROP_DEFS[kind].harvest?.regrow ?? 0
