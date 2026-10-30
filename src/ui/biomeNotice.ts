import type { Biome } from '../sim/world/biomes'

/** Segundos en un bioma nuevo antes de avisar: andando por la frontera no sale un aviso tras otro. */
export const BIOME_NOTICE_DELAY = 1

/** Decide cuándo avisar de que se ha entrado en un bioma. */
export class BiomeNotice {
  private shown: Biome | null = null
  private pending: Biome | null = null
  private time = 0

  /** Por frame, jugando: devuelve el bioma del que hay que avisar ahora. El primero se avisa al momento. */
  update(biome: Biome, dt: number): Biome | null {
    if (biome === this.shown) {
      this.pending = null
      return null
    }
    if (biome !== this.pending) {
      this.pending = biome
      this.time = 0
    }
    this.time += dt
    if (this.shown !== null && this.time < BIOME_NOTICE_DELAY) return null
    this.shown = biome
    this.pending = null
    return biome
  }
}
