import { createNoise2D } from 'simplex-noise'
import { createTerrainRng, WORLD_SEED } from '../random'

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

/** El suelo de una isla. */
export interface Terrain {
  /** Altura del terreno en (x, z). Fuente única para la malla y para posar objetos. */
  heightAt(x: number, z: number): number
  /** Diferencia de altura en un entorno de ±1 unidad: aproxima la pendiente. */
  slopeAt(x: number, z: number): number
}

/** El terreno de la isla de semilla `seed`. */
export function terrainFor(seed: number): Terrain {
  const noise2D = createNoise2D(createTerrainRng(seed))
  const heightAt = (x: number, z: number): number => {
    const n =
      0.6 * noise2D(x * 0.012, z * 0.012) +
      0.3 * noise2D(x * 0.03, z * 0.03) +
      0.1 * noise2D(x * 0.08, z * 0.08)
    const hills = Math.pow(n * 0.5 + 0.5, 1.3) * 12

    // Atenuación radial: la isla baja hacia el mar en los bordes.
    const r = Math.hypot(x, z) / (WORLD_SIZE / 2)
    const falloff = 1 - smoothstep(0.55, 0.95, r)

    return hills * falloff + falloff * 4 - 3
  }
  const slopeAt = (x: number, z: number) => Math.abs(heightAt(x + 1, z) - heightAt(x - 1, z)) + Math.abs(heightAt(x, z + 1) - heightAt(x, z - 1))
  return { heightAt, slopeAt }
}

/** El de la isla de siempre (WORLD_SEED). La partida usa el de la suya (`Island`, island.ts); esto queda para las pruebas. */
export const DEFAULT_TERRAIN = terrainFor(WORLD_SEED)
export const { heightAt, slopeAt } = DEFAULT_TERRAIN
