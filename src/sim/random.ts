export const WORLD_SEED = 1337

/** Generador con su estado a la vista: guardar `state` y restaurarlo reanuda la misma secuencia. */
export interface Rng {
  (): number
  state: number
}

/** PRNG pequeño y rápido con semilla. Devuelve floats en [0, 1). */
export function mulberry32(seed: number): Rng {
  const rng = (() => {
    rng.state = (rng.state + 0x6d2b79f5) >>> 0
    let t = rng.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }) as Rng
  rng.state = seed >>> 0
  return rng
}

// Streams independientes: cambiar el terreno no reordena los props y viceversa.
export const createTerrainRng = () => mulberry32(WORLD_SEED)
export const createPropsRng = () => mulberry32(WORLD_SEED ^ 0x9e3779b9)
// Los arbustos tienen su propio stream: así no alteran árboles ni rocas (ni el hash del mundo).
export const createBushRng = () => mulberry32(WORLD_SEED ^ 0x85ebca6b)
