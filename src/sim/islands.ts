import { findLandmarks } from './landmarks'
import { createPropWorld, findSpawn, generatePropPlacements, PROP_COUNTS, type PropKind } from './props'
import { mulberry32 } from './random'
import { createIsland, DEFAULT_ISLAND, type Island } from './world/island'
import { MAX_SLOPE, SAND_LEVEL } from './world/terrain'

/** Cuántas semillas se prueban antes de quedarse con la isla de siempre. */
const TRIES = 20
/** El tótem, lejos de donde se aparece: si no, la isla no obliga a cruzarla. */
const TOTEM_MIN_DISTANCE = 40

/**
 * Lo que no vale de una isla para jugar una partida: que no quepan todos los props (cada tipo en su bioma y su franja
 * de altura), que no haya dónde aparecer (pradera llana) o que no quepan el faro y el tótem, este lejos del principio.
 * Vacío si se puede jugar.
 */
export function islandProblems(island: Island): string[] {
  const problems: string[] = []
  const placements = generatePropPlacements(island)
  const counts = new Map<PropKind, number>()
  for (const { kind } of placements) counts.set(kind, (counts.get(kind) ?? 0) + 1)
  for (const [kind, count] of Object.entries(PROP_COUNTS) as [PropKind, number][]) {
    if ((counts.get(kind) ?? 0) < count) problems.push(`solo caben ${counts.get(kind) ?? 0} de ${count} ${kind}`)
  }
  const { grid } = createPropWorld(placements)
  const spawn = findSpawn(grid, island)
  const ground = island.heightAt(spawn.x, spawn.z)
  if (ground <= SAND_LEVEL || island.biomeAt(spawn.x, spawn.z, ground) !== 'meadow' || island.slopeAt(spawn.x, spawn.z) > MAX_SLOPE) {
    problems.push('no hay dónde aparecer')
  }
  const { totem, found } = findLandmarks(grid, spawn, island)
  if (!found) problems.push('no caben el faro y el tótem')
  else if (Math.hypot(totem.x - spawn.x, totem.z - spawn.z) < TOTEM_MIN_DISTANCE) problems.push('el tótem queda demasiado cerca')
  return problems
}

/**
 * Una isla jugable a partir de `seed`: la suya o, si no vale, la primera que valga de las semillas que salen de ella.
 * Determinista: la misma semilla da la misma isla. Si ninguna vale, la de siempre.
 */
export function pickIsland(seed: number): Island {
  const next = mulberry32(seed)
  for (let i = 0; i < TRIES; i++) {
    const island = createIsland(i === 0 ? seed >>> 0 : Math.floor(next() * 2 ** 32))
    if (!islandProblems(island).length) return island
  }
  return DEFAULT_ISLAND
}
