import { describe, expect, it } from 'vitest'
import { clampToRim, terrainColor, toMinimap } from './minimap'
import { ROCK_LEVEL, SAND_LEVEL } from '../sim/world/terrain'

/** Punto a `dist` por delante (forward) y `side` a la derecha de quien mira a `yaw`. */
const offset = (yaw: number, dist: number, side = 0) => ({
  dx: -Math.sin(yaw) * dist + Math.cos(yaw) * side,
  dz: -Math.cos(yaw) * dist - Math.sin(yaw) * side,
})

describe('toMinimap', () => {
  it.each([0, 1, Math.PI / 2, Math.PI, -2.5])('lo que hay delante queda arriba y lo de la derecha a la derecha (yaw %s)', (yaw) => {
    const ahead = offset(yaw, 10)
    const p = toMinimap(ahead.dx, ahead.dz, yaw)
    expect(p.x).toBeCloseTo(0)
    expect(p.y).toBeCloseTo(-10)

    const right = offset(yaw, 0, 4)
    const q = toMinimap(right.dx, right.dz, yaw)
    expect(q.x).toBeCloseTo(4)
    expect(q.y).toBeCloseTo(0)
  })

  it('con yaw 0 el norte (-Z) queda arriba y el este (+X) a la derecha', () => {
    expect(toMinimap(0, -5, 0)).toEqual({ x: 0, y: -5 })
    expect(toMinimap(5, 0, 0)).toEqual({ x: 5, y: 0 })
  })
})

describe('clampToRim', () => {
  it('no toca un punto dentro del círculo', () => {
    const p = { x: 3, y: -4 }
    expect(clampToRim(p, 10)).toBe(false)
    expect(p).toEqual({ x: 3, y: -4 })
  })

  it('lleva un punto lejano al borde manteniendo la dirección', () => {
    const p = { x: 30, y: -40 }
    expect(clampToRim(p, 10)).toBe(true)
    expect(p.x).toBeCloseTo(6)
    expect(p.y).toBeCloseTo(-8)
  })
})

describe('terrainColor', () => {
  it('usa los mismos tramos que la isla: agua, arena, hierba y roca', () => {
    const sand = terrainColor((0 + SAND_LEVEL) / 2, false)
    const grass = terrainColor((SAND_LEVEL + ROCK_LEVEL) / 2, false)
    expect(terrainColor(-1, false)[2]).toBeGreaterThan(terrainColor(-1, false)[0])
    expect(sand[0]).toBeGreaterThan(sand[2])
    expect(grass[1]).toBeGreaterThan(grass[0])
    expect(terrainColor(ROCK_LEVEL + 1, false)).toEqual(terrainColor(4, true))
  })

  it('el agua profunda es más oscura que la de la orilla', () => {
    const sum = (c: number[]) => c.reduce((a, b) => a + b)
    expect(sum(terrainColor(-4, false))).toBeLessThan(sum(terrainColor(-0.2, false)))
  })
})
