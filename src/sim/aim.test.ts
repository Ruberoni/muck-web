import { describe, expect, it } from 'vitest'
import { aimRay, createPropHitboxes, enemyHitbox, ENEMY_BODY_LIFT, ENEMY_MODEL_SCALE, pickTarget, rayDistance } from './aim'
import { EYE_HEIGHT, REACH } from './constants'
import { createPropWorld, TRUNK_BOTTOM_RADIUS, TRUNK_TOP_RADIUS, TRUNK_HEIGHT, type PropPlacement } from './props'
import { heightAt } from './world/terrain'

const tree = (id: number, x: number, z: number, y = 0): PropPlacement => ({
  id,
  kind: 'tree',
  x,
  y,
  z,
  radius: TRUNK_BOTTOM_RADIUS,
  rotX: 0,
  rotY: 0,
  scaleX: 1,
  scaleY: 1,
  scaleZ: 1,
})

/** Un jugador de pie a la altura de la base de los árboles (y = 0) mirando en horizontal hacia +X. */
const lookingEast = (x: number, z: number, y = 0) => ({ pos: { x, y, z }, yaw: -Math.PI / 2, pitch: 0 })

describe('aim', () => {
  it('aimRay sale de los ojos y mira según yaw y pitch', () => {
    const ray = aimRay({ pos: { x: 1, y: 2, z: 3 }, yaw: 0, pitch: 0 })
    expect(ray).toMatchObject({ ox: 1, oy: 2 + EYE_HEIGHT, oz: 3 })
    expect(ray.dx).toBeCloseTo(0)
    expect(ray.dy).toBeCloseTo(0)
    expect(ray.dz).toBeCloseTo(-1)
    const up = aimRay({ pos: { x: 0, y: 0, z: 0 }, yaw: -Math.PI / 2, pitch: Math.PI / 4 })
    expect(up.dx).toBeCloseTo(Math.SQRT1_2)
    expect(up.dy).toBeCloseTo(Math.SQRT1_2)
    expect(Math.hypot(up.dx, up.dy, up.dz)).toBeCloseTo(1)
  })

  it('el tronco se toca a la distancia de su cara, que está entre el radio inscrito y el nominal', () => {
    const { boxes } = createPropHitboxes([tree(0, 100, 0)])
    // A la altura de los ojos el tronco es más estrecho que en la base.
    const ray = aimRay(lookingEast(98, 0))
    const y = EYE_HEIGHT
    const r = TRUNK_BOTTOM_RADIUS + ((TRUNK_TOP_RADIUS - TRUNK_BOTTOM_RADIUS) * y) / TRUNK_HEIGHT
    const d = rayDistance(ray, boxes[0])
    expect(d).toBeGreaterThanOrEqual(2 - r - 1e-9)
    expect(d).toBeLessThanOrEqual(2 - r * Math.cos(Math.PI / 6) + 1e-9)
  })

  it('no toca lo que está detrás, al lado ni más allá del alcance', () => {
    const { boxes } = createPropHitboxes([tree(0, 100, 0)])
    expect(rayDistance(aimRay(lookingEast(102, 0)), boxes[0])).toBe(Infinity)
    expect(rayDistance(aimRay(lookingEast(98, 2)), boxes[0])).toBe(Infinity)
    const world = createPropWorld([tree(0, 100, 0)])
    const hitboxes = createPropHitboxes(world.placements)
    expect(pickTarget(aimRay(lookingEast(100 - REACH - 0.5, 0)), world.grid, hitboxes, [])).toBeNull()
    expect(pickTarget(aimRay(lookingEast(100 - REACH + 0.5, 0)), world.grid, hitboxes, [])).toBe(world.props[0])
  })

  it('elige lo más cercano; los muertos no tapan lo de detrás', () => {
    // Los ojos a la altura del centro del enemigo, que está sobre el terreno.
    const y = heightAt(101.5, 0) + ENEMY_BODY_LIFT * ENEMY_MODEL_SCALE - EYE_HEIGHT
    const world = createPropWorld([tree(0, 101, 0, y), tree(1, 102.5, 0, y)])
    const hitboxes = createPropHitboxes(world.placements)
    const ray = aimRay(lookingEast(100, 0, y))
    expect(pickTarget(ray, world.grid, hitboxes, [])).toBe(world.props[0])
    world.props[0].alive = false
    expect(pickTarget(ray, world.grid, hitboxes, [])).toBe(world.props[1])
    // Un enemigo delante del árbol gana; muerto, no cuenta.
    const enemy = { alive: true, pos: { x: 101.5, z: 0 }, yaw: 0 }
    expect(pickTarget(ray, world.grid, hitboxes, [enemy])).toBe(enemy)
    enemy.alive = false
    expect(pickTarget(ray, world.grid, hitboxes, [enemy])).toBe(world.props[1])
  })

  it('el enemigo se toca en el centro de su cuerpo, gire como gire', () => {
    const [x, z] = [100, 0]
    for (const yaw of [0, 1, 2, 3]) {
      const box = enemyHitbox(x, z, yaw)
      const centre = heightAt(x, z) + ENEMY_BODY_LIFT * ENEMY_MODEL_SCALE
      const from = { pos: { x: x - 2, y: centre - EYE_HEIGHT, z }, yaw: -Math.PI / 2, pitch: 0 }
      const d = rayDistance(aimRay(from), box)
      expect(d).toBeGreaterThan(1.3)
      expect(d).toBeLessThan(1.7)
    }
  })

  it('desde dentro no se toca', () => {
    const box = enemyHitbox(0, 0, 0)
    const inside = { pos: { x: 0, y: box.y + 0.9 - EYE_HEIGHT, z: 0 }, yaw: 0, pitch: 0 }
    expect(rayDistance(aimRay(inside), box)).toBe(Infinity)
  })
})
