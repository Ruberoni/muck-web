export const WORLD_SEED = 1337

/** PRNG pequeño y rápido con semilla. Devuelve floats en [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Streams independientes: cambiar el terreno no reordena los props y viceversa.
export const createTerrainRng = () => mulberry32(WORLD_SEED)
export const createPropsRng = () => mulberry32(WORLD_SEED ^ 0x9e3779b9)
