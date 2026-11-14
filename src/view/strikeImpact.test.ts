import { describe, expect, it } from 'vitest'
import type { PropPlacement } from '../sim/props'
import { enemyImpact, hitOnCylinder, propImpact, rayTo } from './strikeImpact'

const prop = (kind: PropPlacement['kind'], over: Partial<PropPlacement> = {}): PropPlacement => ({
  id: 0,
  kind,
  x: 0,
  y: 0,
  z: 0,
  radius: 0.5,
  rotX: 0,
  rotY: 0,
  scaleX: 1,
  scaleY: 1,
  scaleZ: 1,
  ...over,
})

describe('dónde da un golpe', () => {
  it('donde el rayo entra en el cilindro, con la normal hacia quien golpea', () => {
    const hit = hitOnCylinder(rayTo(3, 1, 0, 0, 1, 0), 0, 0, 0.5, 0, 2)
    expect(hit.x).toBeCloseTo(0.5)
    expect(hit.y).toBeCloseTo(1)
    expect(hit.z).toBeCloseTo(0)
    expect(hit.nx).toBeCloseTo(1)
  })

  it('si pasa rozando, en la superficie más cercana; y la altura, dentro de lo que mide', () => {
    const ray = { x: 3, y: 5, z: 0.8, dx: -1, dy: 0, dz: 0 }
    const hit = hitOnCylinder(ray, 0, 0, 0.5, 0, 2)
    expect(Math.hypot(hit.x, hit.z)).toBeCloseTo(0.5)
    expect(hit.z).toBeGreaterThan(0)
    expect(hit.y).toBe(2)
  })

  it('un árbol: madera, con copa y, a mano o con hacha, siempre le hace algo', () => {
    const tree = prop('tree')
    const ray = rayTo(2, 1.6, 0, 0, 1.2, 0)
    const hit = propImpact(tree, 'iron_axe', ray)
    expect(hit).toMatchObject({ material: 'wood', tool: 'axe' })
    expect(hit.canopy).toBeGreaterThan(1.5)
    expect(hit.blocked).toBeUndefined()
    expect(hit.y).toBeGreaterThan(0.5)
  })

  it('una mena sin el pico que pide: golpe seco', () => {
    const ore = prop('mithril_ore')
    expect(propImpact(ore, 'stone_pickaxe', rayTo(2, 1, 0, 0, 0, 0))).toMatchObject({ material: 'mithril', blocked: true })
    expect(propImpact(ore, 'iron_pickaxe', rayTo(2, 1, 0, 0, 0, 0)).blocked).toBeUndefined()
  })

  it('un enemigo: en el cuerpo, de lo que está hecho y con la eficacia del golpe', () => {
    const hit = enemyImpact({ type: 'golem', x: 0, z: 0, floor: 10 }, 'iron_pickaxe', rayTo(3, 11.6, 0, 0, 10.8, 0), 'effective')
    expect(hit).toMatchObject({ material: 'rockCreature', tool: 'pickaxe', efficacy: 'effective' })
    expect(hit.y).toBeGreaterThan(10)
    expect(hit.x).toBeGreaterThan(0)
    expect(enemyImpact({ type: 'goblin', x: 0, z: 0, floor: 0 }, null, rayTo(2, 1, 0, 0, 1, 0)).material).toBe('creature')
  })
})
