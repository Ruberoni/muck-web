import { describe, expect, it } from 'vitest'
import { generatePropPlacements, type PropKind } from '../props'
import { BEACH_LEVEL, BIOME_FLORA, biomeAt, BIOME_NAMES, forestness, MOUNTAIN_LEVEL, type Biome } from './biomes'
import { heightAt, WATER_LEVEL, WORLD_SIZE } from './terrain'

const BIOMES = Object.keys(BIOME_NAMES) as Biome[]
const KINDS = Object.keys(BIOME_FLORA) as PropKind[]

/** Rejilla de puntos de tierra firme. */
const land: { x: number; z: number; y: number }[] = []
for (let x = -WORLD_SIZE / 2; x < WORLD_SIZE / 2; x += 3) {
  for (let z = -WORLD_SIZE / 2; z < WORLD_SIZE / 2; z += 3) {
    const y = heightAt(x, z)
    if (y >= WATER_LEVEL) land.push({ x, z, y })
  }
}

describe('biomas', () => {
  it('son deterministas y la altura se puede pasar ya calculada', () => {
    for (const { x, z, y } of land.slice(0, 200)) {
      expect(biomeAt(x, z, y)).toBe(biomeAt(x, z))
      expect(forestness(x, z)).toBe(forestness(x, z))
    }
  })

  it('la isla tiene los cuatro y ninguno se la queda entera', () => {
    const share = (biome: Biome) => land.filter(({ x, z, y }) => biomeAt(x, z, y) === biome).length / land.length
    for (const biome of BIOMES) {
      expect(share(biome), biome).toBeGreaterThan(0.08)
      expect(share(biome), biome).toBeLessThan(0.6)
    }
  })

  it('la playa va por altura; el bosque y la pradera, por ruido, y la montaña empieza a su altura', () => {
    for (const { x, z, y } of land) {
      const biome = biomeAt(x, z, y)
      if (y < BEACH_LEVEL) expect(biome).toBe('beach')
      else expect(biome).not.toBe('beach')
      if (y < MOUNTAIN_LEVEL) expect(biome).not.toBe('mountain')
      if (biome === 'forest') expect(forestness(x, z)).toBeGreaterThan(0)
      if (biome === 'meadow') expect(forestness(x, z)).toBeLessThanOrEqual(0)
    }
  })

  it('el centro de la isla, donde aparecen los jugadores, es pradera', () => {
    for (let r = 0; r < 24; r += 2) {
      for (let a = 0; a < 16; a++) {
        const x = Math.cos((a / 16) * Math.PI * 2) * r
        const z = Math.sin((a / 16) * Math.PI * 2) * r
        expect(biomeAt(x, z), `${x}, ${z}`).toBe('meadow')
      }
    }
  })

  it('BIOME_FLORA: pesos de 0 a 1, y cada tipo crece en algún bioma', () => {
    for (const kind of KINDS) {
      const weights = BIOMES.map((biome) => BIOME_FLORA[kind][biome])
      for (const weight of weights) {
        expect(weight).toBeGreaterThanOrEqual(0)
        expect(weight).toBeLessThanOrEqual(1)
      }
      expect(Math.max(...weights)).toBe(1)
    }
  })

  it('cada prop está en un bioma donde su tipo puede crecer', () => {
    for (const { kind, x, z } of generatePropPlacements()) expect(BIOME_FLORA[kind][biomeAt(x, z)], kind).toBeGreaterThan(0)
  })

  it('en el bosque hay muchos más árboles por metro que en la pradera, y en la pradera más arbustos', () => {
    const area = (biome: Biome) => land.filter(({ x, z, y }) => biomeAt(x, z, y) === biome).length
    const density = (kinds: PropKind[], biome: Biome) =>
      generatePropPlacements().filter((p) => kinds.includes(p.kind) && biomeAt(p.x, p.z) === biome).length / area(biome)
    expect(density(['tree', 'birch'], 'forest')).toBeGreaterThan(density(['tree', 'birch'], 'meadow') * 3)
    expect(density(['bush'], 'meadow')).toBeGreaterThan(density(['bush'], 'forest') * 3)
  })

  it('las menas y los pinos oscuros solo están en la montaña', () => {
    const inMountain = generatePropPlacements().filter((p) => ['iron_ore', 'darkpine', 'mithril_ore'].includes(p.kind))
    expect(inMountain.length).toBeGreaterThan(0)
    for (const { x, z } of inMountain) expect(biomeAt(x, z)).toBe('mountain')
  })
})
