import { WORLD_SEED } from '../random'
import { biomesFor, DEFAULT_BIOMES, type Biomes } from './biomes'
import { DEFAULT_TERRAIN, terrainFor, type Terrain } from './terrain'

/**
 * Una isla: su semilla, su terreno y sus biomas. Cada partida tiene la suya (los props salen de ella, ver props.ts), y
 * todo lo que mira el suelo la recibe en vez de una isla fija.
 */
export interface Island extends Terrain, Biomes {
  readonly seed: number
}

/** La de siempre (WORLD_SEED): la de las pruebas, y la que se usa mientras no hay otra. */
export const DEFAULT_ISLAND: Island = { seed: WORLD_SEED, ...DEFAULT_TERRAIN, ...DEFAULT_BIOMES }

export function createIsland(seed: number): Island {
  if (seed === WORLD_SEED) return DEFAULT_ISLAND
  const terrain = terrainFor(seed)
  return { seed, ...terrain, ...biomesFor(seed, terrain) }
}
