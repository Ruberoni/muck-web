import { createNoise2D } from 'simplex-noise'
import type { PropKind } from '../props'
import { createBiomeRng, WORLD_SEED } from '../random'
import { DEFAULT_TERRAIN, SAND_LEVEL, type Terrain } from './terrain'

/** Zonas de la isla: deciden qué crece en cada sitio (BIOME_FLORA) y de qué color es el suelo. */
export type Biome = 'beach' | 'meadow' | 'forest' | 'mountain'

export const BIOME_NAMES: Record<Biome, string> = { beach: 'Playa', meadow: 'Pradera', forest: 'Bosque', mountain: 'Montaña' }

/** Por debajo de esta altura es playa. */
export const BEACH_LEVEL = SAND_LEVEL + 0.3
/** Desde esta altura es montaña: las franjas de las menas (props.ts) empiezan aquí. */
export const MOUNTAIN_LEVEL = 6
/** Hasta aquí desde el centro de la isla, donde aparecen los jugadores, siempre es pradera. */
const CLEARING_RADIUS = 24
/** Desde aquí el claro del centro ya no se nota. */
const CLEARING_FADE = 44
const FOREST_NOISE_SCALE = 0.016

/** Cuánto se nota el claro del centro en (x, z): 1 dentro de CLEARING_RADIUS y 0 desde CLEARING_FADE. */
const clearing = (x: number, z: number) => Math.min(1, Math.max(0, (CLEARING_FADE - Math.hypot(x, z)) / (CLEARING_FADE - CLEARING_RADIUS)))

/** Los biomas de una isla. */
export interface Biomes {
  /** Lo positivo es bosque y lo negativo, pradera; cerca de 0 está la frontera (la vista mezcla los colores ahí). */
  forestness(x: number, z: number): number
  /** Metros por encima (positivo) o por debajo de donde empieza la montaña, que en el claro del centro no llega. */
  mountainness(x: number, z: number, y: number): number
  /** El bioma en (x, z). `y` es la altura del terreno ahí, si ya se tiene. */
  biomeAt(x: number, z: number, y?: number): Biome
}

/** Los biomas de la isla de semilla `seed`, sobre su terreno. */
export function biomesFor(seed: number, terrain: Terrain): Biomes {
  // Con su propio stream: el bioma no depende del terreno ni de los props.
  const noise2D = createNoise2D(createBiomeRng(seed))
  const forestness = (x: number, z: number) => noise2D(x * FOREST_NOISE_SCALE, z * FOREST_NOISE_SCALE) - clearing(x, z) * 2
  const mountainness = (x: number, z: number, y: number) => y - MOUNTAIN_LEVEL - clearing(x, z) * 10
  const biomeAt = (x: number, z: number, y = terrain.heightAt(x, z)): Biome => {
    if (y < BEACH_LEVEL) return 'beach'
    if (mountainness(x, z, y) >= 0) return 'mountain'
    return forestness(x, z) > 0 ? 'forest' : 'meadow'
  }
  return { forestness, mountainness, biomeAt }
}

/** Los de la isla de siempre (WORLD_SEED), para las pruebas: la partida usa los de la suya. */
export const DEFAULT_BIOMES = biomesFor(WORLD_SEED, DEFAULT_TERRAIN)
export const { forestness, mountainness, biomeAt } = DEFAULT_BIOMES

/** Probabilidad de 0 a 1 de que cada tipo de prop arraigue en cada bioma: reparte, pero no cambia cuántos hay. */
export const BIOME_FLORA: Record<PropKind, Record<Biome, number>> = {
  tree: { beach: 0, meadow: 0.2, forest: 1, mountain: 0.25 },
  rock: { beach: 0.5, meadow: 0.5, forest: 0.2, mountain: 1 },
  bush: { beach: 0, meadow: 1, forest: 0.25, mountain: 0.1 },
  birch: { beach: 0, meadow: 0.1, forest: 1, mountain: 0 },
  iron_ore: { beach: 0, meadow: 0, forest: 0, mountain: 1 },
  darkpine: { beach: 0, meadow: 0, forest: 0, mountain: 1 },
  mithril_ore: { beach: 0, meadow: 0, forest: 0, mountain: 1 },
  healing_herb: { beach: 0, meadow: 0.15, forest: 1, mountain: 0 },
  coal_ore: { beach: 0, meadow: 0.4, forest: 0.3, mountain: 1 },
  crystal_ore: { beach: 0, meadow: 0, forest: 0, mountain: 1 },
}
