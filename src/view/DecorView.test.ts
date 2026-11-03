import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { generatePropPlacements } from '../sim/props'
import { heightAt, WATER_LEVEL } from '../sim/world/terrain'
import { DECOR_MODELS, DECOR_RADIUS, DecorView, scatterDecor } from './DecorView'

const placements = generatePropPlacements()

describe('decoración', () => {
  it('sale igual cada vez, fuera del agua y no encima de los props', () => {
    const items = scatterDecor(placements).flat(2)
    expect(items.length).toBeGreaterThan(2000)
    expect(scatterDecor(placements).flat(2).map((i) => [i.x, i.z])).toEqual(items.map((i) => [i.x, i.z]))
    for (const { x, z } of items) {
      expect(heightAt(x, z)).toBeGreaterThan(WATER_LEVEL)
      expect(placements.some((p) => Math.hypot(p.x - x, p.z - z) < p.radius)).toBe(false)
    }
  })

  it('la hierba lleva el color del suelo y lo demás, los suyos', () => {
    const [grass, flowers] = scatterDecor(placements)
    expect(grass.flat().every((i) => i.color !== null)).toBe(true)
    expect(flowers.flat().every((i) => i.color === null)).toBe(true)
  })

  it('solo se dibuja lo que queda cerca de la cámara', () => {
    const models = new Map(DECOR_MODELS.map((name) => [name, new THREE.BoxGeometry()]))
    const view = new DecorView(models, placements)
    const near = (x: number, z: number) => scatterDecor(placements).flat(2).filter((i) => Math.hypot(i.x - x, i.z - z) <= DECOR_RADIUS).length
    view.update({ x: 0, z: 0 })
    expect(view.drawn).toBe(near(0, 0))
    expect(view.drawn).toBeLessThan(scatterDecor(placements).flat(2).length)
    // Moverse un poco no lo recalcula; algo más, sí.
    view.update({ x: 1, z: 0 })
    expect(view.drawn).toBe(near(0, 0))
    view.update({ x: 40, z: 0 })
    expect(view.drawn).toBe(near(40, 0))
    view.dispose()
  })
})
