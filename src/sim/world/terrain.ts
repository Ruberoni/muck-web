import { createNoise2D } from 'simplex-noise'
import { createTerrainRng, mulberry32, WORLD_SEED } from '../random'

/** Lado de la isla de siempre (la del menú y las pruebas), en metros. Las de cada partida miden ISLAND_SIZE (island.ts). */
export const WORLD_SIZE = 200
export const WATER_LEVEL = 0
export const SAND_LEVEL = 1.2
export const ROCK_LEVEL = 9
export const MAX_SLOPE = 1.6

// Igual que THREE.MathUtils.clamp, para no cambiar ni un bit de la altura.
const clamp = (x: number, min: number, max: number) => Math.max(min, Math.min(max, x))

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

/** Un lago de dentro: el centro y hasta dónde llega. */
export interface Lake {
  x: number
  z: number
  radius: number
}

/** El suelo de una isla. */
export interface Terrain {
  /** Lado del cuadrado en el que cabe la isla, en metros: el mar empieza antes del borde. */
  readonly size: number
  /** Los lagos: agua poco honda, que se vadea casi entera. El mar es lo que rodea la isla. */
  readonly lakes: readonly Lake[]
  /** Altura del terreno en (x, z). Fuente única para la malla y para posar objetos. */
  heightAt(x: number, z: number): number
  /** Diferencia de altura en un entorno de ±1 unidad: aproxima la pendiente. */
  slopeAt(x: number, z: number): number
}

/** El fondo de los lagos: casi todo a esta altura, que se vadea (WADE_DEPTH y FLOAT_DEPTH, constants.ts)… */
const LAKE_BOTTOM = -0.7
/** …y en el centro, hasta esta, donde ya se nada. */
const LAKE_DEEP = -1.4
/** Lagos por cada superficie de una isla de siempre: en la de siempre, ninguno. */
const LAKES_PER_AREA = 0.6
const LAKE_MIN_RADIUS = 14
const LAKE_MAX_RADIUS = 30
/** Entre la orilla de un lago y la de otro, como poco. */
const LAKE_GAP = 12

/** El terreno de la isla de semilla `seed` y lado `size`: colinas de ruido, que bajan al mar en los bordes, y sus lagos. */
export function terrainFor(seed: number, size = WORLD_SIZE): Terrain {
  const noise2D = createNoise2D(createTerrainRng(seed))
  const base = (x: number, z: number): number => {
    const n =
      0.6 * noise2D(x * 0.012, z * 0.012) +
      0.3 * noise2D(x * 0.03, z * 0.03) +
      0.1 * noise2D(x * 0.08, z * 0.08)
    const hills = Math.pow(n * 0.5 + 0.5, 1.3) * 12

    // Atenuación radial: la isla baja hacia el mar en los bordes.
    const r = Math.hypot(x, z) / (size / 2)
    const falloff = 1 - smoothstep(0.55, 0.95, r)

    return hills * falloff + falloff * 4 - 3
  }
  const lakes = size > WORLD_SIZE ? placeLakes(seed, size, base) : []
  const heightAt = (x: number, z: number): number => {
    let h = base(x, z)
    for (const lake of lakes) {
      const d = Math.hypot(x - lake.x, z - lake.z) / lake.radius
      if (d >= 1) continue
      const bottom = d < 0.35 ? LAKE_DEEP + (LAKE_BOTTOM - LAKE_DEEP) * smoothstep(0, 0.35, d) : LAKE_BOTTOM
      // De la orilla (d = 1) al fondo (d = 0,6) baja suave; donde el suelo ya está más bajo, se queda.
      h = Math.min(h, h + (bottom - h) * smoothstep(1, 0.6, d))
    }
    return h
  }
  const slopeAt = (x: number, z: number) => Math.abs(heightAt(x + 1, z) - heightAt(x - 1, z)) + Math.abs(heightAt(x, z + 1) - heightAt(x, z - 1))
  return { size, lakes, heightAt, slopeAt }
}

/**
 * Dónde van los lagos: tierra adentro, fuera del claro del centro, en terreno bajo (no en lo alto de una montaña) y
 * sin tocar el mar ni otro lago. Con su propio stream: no cambian el terreno de alrededor.
 */
function placeLakes(seed: number, size: number, base: (x: number, z: number) => number): Lake[] {
  const rng = mulberry32(seed ^ 0x51ed270b)
  const count = Math.round((size / WORLD_SIZE) ** 2 * LAKES_PER_AREA)
  const lakes: Lake[] = []
  for (let attempt = 0; lakes.length < count && attempt < count * 40; attempt++) {
    const angle = rng() * Math.PI * 2
    const r = (0.18 + rng() * 0.42) * (size / 2)
    const radius = LAKE_MIN_RADIUS + rng() * (LAKE_MAX_RADIUS - LAKE_MIN_RADIUS)
    const x = Math.cos(angle) * r
    const z = Math.sin(angle) * r
    const h = base(x, z)
    if (h < SAND_LEVEL + 0.5 || h > 5.5) continue
    // La orilla, en tierra: si no, el lago se abriría al mar.
    let inland = true
    for (let i = 0; i < 12 && inland; i++) {
      const a = (i / 12) * Math.PI * 2
      inland = base(x + Math.cos(a) * radius * 1.15, z + Math.sin(a) * radius * 1.15) > WATER_LEVEL + 0.6
    }
    if (!inland || lakes.some((o) => Math.hypot(o.x - x, o.z - z) < o.radius + radius + LAKE_GAP)) continue
    lakes.push({ x, z, radius })
  }
  return lakes
}

/** El de la isla de siempre (WORLD_SEED). La partida usa el de la suya (`Island`, island.ts); esto queda para las pruebas. */
export const DEFAULT_TERRAIN = terrainFor(WORLD_SEED)
export const { heightAt, slopeAt } = DEFAULT_TERRAIN
