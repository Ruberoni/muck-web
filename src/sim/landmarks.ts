import type { Collider, SpatialGrid } from './collision'
import { DEFAULT_ISLAND, type Island } from './world/island'
import { MAX_SLOPE, WORLD_SIZE } from './world/terrain'

/** Radios de lo que ya viene puesto en la isla: los usan la colisión y la búsqueda de sitio. */
export const LIGHTHOUSE_RADIUS = 6.2
export const TOTEM_RADIUS = 3.4
/** Cada cuánto se mira el mapa buscando sitio: crece con él, para que la búsqueda cueste lo mismo. */
const SEARCH_STEP = WORLD_SIZE / 100
/** Hasta dónde se busca: donde se colocan los props. */
const SEARCH_RADIUS = WORLD_SIZE * 0.45
/** Hueco libre alrededor de lo colocado y distancia mínima al punto de aparición. */
const CLEARANCE = 1.5
const SPAWN_GAP = 12

export interface Spot {
  x: number
  z: number
}

const isClear = (grid: SpatialGrid<Collider>, x: number, z: number, radius: number) => {
  for (const prop of grid.query(x, z, radius + grid.maxRadius)) {
    if (Math.hypot(prop.x - x, prop.z - z) - prop.radius < radius) return false
  }
  return true
}

/** El sitio de mayor `score` con `radius` metros libres; `score` devuelve null donde no vale. */
function bestSpot(island: Island, grid: SpatialGrid<Collider>, radius: number, score: (x: number, z: number) => number | null): Spot | null {
  let best: Spot | null = null
  let bestScore = -Infinity
  for (let x = -SEARCH_RADIUS; x <= SEARCH_RADIUS; x += SEARCH_STEP) {
    for (let z = -SEARCH_RADIUS; z <= SEARCH_RADIUS; z += SEARCH_STEP) {
      if (Math.hypot(x, z) > SEARCH_RADIUS || island.slopeAt(x, z) > MAX_SLOPE) continue
      const value = score(x, z)
      if (value === null || value <= bestScore || !isClear(grid, x, z, radius + CLEARANCE)) continue
      best = { x, z }
      bestScore = value
    }
  }
  return best
}

/**
 * Dónde están el faro y el tótem, los mismos en toda partida de esta isla: el faro en lo más alto que quede libre, para
 * verse desde todas partes, y el tótem en bosque o pradera, lo más lejos posible del faro y del punto de aparición.
 */
/** `found`: si hay sitio para los dos; si no, quedan junto al punto de aparición (una isla así no se juega, ver islands.ts). */
export function findLandmarks(grid: SpatialGrid<Collider>, spawn: Spot, island: Island = DEFAULT_ISLAND): { lighthouse: Spot; totem: Spot; found: boolean } {
  const fromSpawn = (x: number, z: number) => Math.hypot(x - spawn.x, z - spawn.z)
  const lighthouseSpot = bestSpot(island, grid, LIGHTHOUSE_RADIUS, (x, z) => (fromSpawn(x, z) < LIGHTHOUSE_RADIUS + SPAWN_GAP ? null : island.heightAt(x, z)))
  const lighthouse = lighthouseSpot ?? { x: spawn.x + LIGHTHOUSE_RADIUS + SPAWN_GAP, z: spawn.z }
  const totemSpot = bestSpot(island, grid, TOTEM_RADIUS, (x, z) => {
    const biome = island.biomeAt(x, z)
    if (biome !== 'forest' && biome !== 'meadow') return null
    return Math.min(fromSpawn(x, z), Math.hypot(x - lighthouse.x, z - lighthouse.z))
  })
  const totem = totemSpot ?? { x: spawn.x - TOTEM_RADIUS - SPAWN_GAP, z: spawn.z }
  return { lighthouse, totem, found: lighthouseSpot !== null && totemSpot !== null }
}
