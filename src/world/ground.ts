import { forestness, mountainness } from '../sim/world/biomes'
import { ROCK_LEVEL, SAND_LEVEL, WATER_LEVEL } from '../sim/world/terrain'

export type Rgb = [number, number, number]

export const DEEP: Rgb = [38, 98, 150]
const SHALLOW: Rgb = [92, 170, 205]
const SAND: Rgb = [227, 207, 142]
const MEADOW_LOW: Rgb = [134, 191, 78]
const MEADOW_HIGH: Rgb = [111, 174, 69]
const FOREST_LOW: Rgb = [74, 138, 53]
const FOREST_HIGH: Rgb = [56, 116, 48]
const MOUNTAIN: Rgb = [126, 136, 104]
const ROCK: Rgb = [139, 136, 120]
const SHALLOW_DEPTH = 3
/** Anchura de la mezcla de colores a cada lado de la frontera: en unidades de `forestness` y en metros de altura. */
const FOREST_BLEND = 0.08
const MOUNTAIN_BLEND = 0.6

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb => {
  const k = Math.min(1, Math.max(0, t))
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
}

/** Cuánto hay de bosque y de montaña en (x, z), de 0 a 1: pasan de un bioma a otro poco a poco, sin un corte. */
export function biomeBlend(x: number, z: number, h: number) {
  return {
    forest: smoothstep(-FOREST_BLEND, FOREST_BLEND, forestness(x, z)),
    mountain: smoothstep(-MOUNTAIN_BLEND, MOUNTAIN_BLEND, mountainness(x, z, h)),
  }
}

/** Color del suelo a la altura `h`: el mismo en la malla de la isla y en el minimapa. */
export function terrainColor(h: number, steep: boolean, { forest, mountain } = { forest: 0, mountain: 0 }): Rgb {
  if (h < WATER_LEVEL) return mix(SHALLOW, DEEP, (WATER_LEVEL - h) / SHALLOW_DEPTH)
  if (h < SAND_LEVEL) return SAND
  if (steep || h > ROCK_LEVEL) return ROCK
  const t = (h - SAND_LEVEL) / (ROCK_LEVEL - SAND_LEVEL)
  return mix(mix(mix(MEADOW_LOW, MEADOW_HIGH, t), mix(FOREST_LOW, FOREST_HIGH, t), forest), MOUNTAIN, mountain)
}
