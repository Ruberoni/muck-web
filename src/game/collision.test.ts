import { describe, expect, it } from 'vitest'
import { resolveCircle, SpatialGrid, type Collider } from './collision'
import { createPlayer, stepPlayer, type PlayerEnv } from './player'

const EPS = 1e-4
const R = 0.4
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z)

function gridOf(...colliders: Collider[]) {
  const grid = new SpatialGrid<Collider>()
  colliders.forEach((c) => grid.insert(c))
  return grid
}

describe('resolveCircle', () => {
  it('empuja fuera de un círculo', () => {
    const c = { x: 0, z: 0, radius: 1, alive: true }
    const pos = { x: 0.5, z: 0 }
    expect(resolveCircle(pos, R, gridOf(c))).toBe(true)
    expect(dist(pos, c)).toBeGreaterThanOrEqual(1 + R - EPS)
  })

  it('con dos props juntos queda fuera de ambos', () => {
    const a = { x: 0, z: 0, radius: 0.5, alive: true }
    const b = { x: 1.2, z: 0, radius: 0.5, alive: true }
    const pos = { x: 0.6, z: 0.3 }
    resolveCircle(pos, R, gridOf(a, b))
    expect(dist(pos, a)).toBeGreaterThanOrEqual(a.radius + R - EPS)
    expect(dist(pos, b)).toBeGreaterThanOrEqual(b.radius + R - EPS)
  })

  it('un prop grande en el borde de celdas se encuentra desde la celda vecina', () => {
    const big = { x: 7.9, z: 7.9, radius: 2.2, alive: true }
    const pos = { x: 9.5, z: 9.5 }
    resolveCircle(pos, R, gridOf(big))
    expect(dist(pos, big)).toBeGreaterThanOrEqual(big.radius + R - EPS)
  })

  it('ignora los props muertos', () => {
    const pos = { x: 0.2, z: 0 }
    expect(resolveCircle(pos, R, gridOf({ x: 0, z: 0, radius: 1, alive: false }))).toBe(false)
    expect(pos).toEqual({ x: 0.2, z: 0 })
  })

  it('no hay túnel corriendo 1 s contra un tronco fino', () => {
    const trunk = { x: 0, z: -5, radius: 0.35, alive: true }
    const grid = gridOf(trunk)
    const env: PlayerEnv = { heightAt: () => 5, collide: (p) => resolveCircle(p, R, grid) }
    const player = createPlayer(env, 0, 0)
    for (let i = 0; i < 60; i++) stepPlayer(player, { forward: true, back: false, left: false, right: false, sprint: true, jump: false }, env, 1 / 60)
    expect(player.pos.z).toBeGreaterThan(trunk.z)
    expect(dist(player.pos, trunk)).toBeGreaterThanOrEqual(trunk.radius + R - EPS)
  })
})
