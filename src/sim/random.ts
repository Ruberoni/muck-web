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
// El bioma va aparte de los props: cambiar cómo se reparten no cambia los biomas.
export const createBiomeRng = () => mulberry32(WORLD_SEED ^ 0x4cf5ad43)
// Un stream por tipo de prop, en el orden en que se colocan (props.ts).
export const createTreeRng = () => mulberry32(WORLD_SEED ^ 0x9e3779b9)
export const createRockRng = () => mulberry32(WORLD_SEED ^ 0x2545f491)
export const createBushRng = () => mulberry32(WORLD_SEED ^ 0x85ebca6b)
export const createBirchRng = () => mulberry32(WORLD_SEED ^ 0xc2b2ae35)
export const createIronOreRng = () => mulberry32(WORLD_SEED ^ 0x27d4eb2f)
export const createDarkpineRng = () => mulberry32(WORLD_SEED ^ 0x165667b1)
export const createMithrilOreRng = () => mulberry32(WORLD_SEED ^ 0xd3a2646c)
