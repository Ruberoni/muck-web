import { describe, expect, it } from 'vitest'
import { newStation } from '../sim/stations'
import { clampToRim, compassName, STRUCTURE_MARKS, structureColor, teammateMark, toMinimap } from './minimap'
import { ROCK_LEVEL, SAND_LEVEL } from '../sim/world/terrain'
import { terrainColor } from '../world/ground'

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

describe('compassName', () => {
  it('nombra hacia dónde queda algo, como en el minimapa: el norte es -Z', () => {
    const names = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]].map(([dx, dz]) => compassName(dx * 40, dz * 40))
    expect(names).toEqual(['norte', 'noreste', 'este', 'sureste', 'sur', 'suroeste', 'oeste', 'noroeste'])
  })

  it('redondea al más cercano, también a ambos lados del sur', () => {
    expect(compassName(10, -40)).toBe('norte')
    expect(compassName(30, -40)).toBe('noreste')
    expect(compassName(-1, 40)).toBe('sur')
    expect(compassName(1, 40)).toBe('sur')
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
  it('usa los mismos tramos en toda la isla: agua, arena, hierba y roca', () => {
    const sand = terrainColor((0 + SAND_LEVEL) / 2, false)
    const grass = terrainColor((SAND_LEVEL + ROCK_LEVEL) / 2, false)
    expect(terrainColor(-1, false)[2]).toBeGreaterThan(terrainColor(-1, false)[0])
    expect(sand[0]).toBeGreaterThan(sand[2])
    expect(grass[1]).toBeGreaterThan(grass[0])
    expect(terrainColor(ROCK_LEVEL + 1, false)).toEqual(terrainColor(4, true))
  })

  it('el bosque es más oscuro que la pradera y la montaña más gris, y se mezclan poco a poco', () => {
    const sum = (c: number[]) => c.reduce((a, b) => a + b)
    const h = 4
    const meadow = terrainColor(h, false)
    const forest = terrainColor(h, false, { forest: 1, mountain: 0 })
    const mountain = terrainColor(h, false, { forest: 0, mountain: 1 })
    expect(sum(forest)).toBeLessThan(sum(meadow))
    const half = terrainColor(h, false, { forest: 0.5, mountain: 0 })
    expect(sum(half)).toBeLessThan(sum(meadow))
    expect(sum(half)).toBeGreaterThan(sum(forest))
    expect(mountain[1] - mountain[0]).toBeLessThan(meadow[1] - meadow[0])
    // Arena y agua no dependen del bioma.
    expect(terrainColor(0.5, false, { forest: 1, mountain: 1 })).toEqual(terrainColor(0.5, false))
  })

  it('el agua profunda es más oscura que la de la orilla', () => {
    const sum = (c: number[]) => c.reduce((a, b) => a + b)
    expect(sum(terrainColor(-4, false))).toBeLessThan(sum(terrainColor(-0.2, false)))
  })
})

describe('teammateMark', () => {
  it('cerca: en su sitio, apuntando hacia donde mira respecto a la vista', () => {
    const viewYaw = 0.7
    const ahead = offset(viewYaw, 10)
    // Mira igual que yo: flecha hacia arriba.
    const same = teammateMark(ahead.dx, ahead.dz, viewYaw, viewYaw, 60)
    expect(same.far).toBe(false)
    expect(same.x).toBeCloseTo(0)
    expect(same.y).toBeCloseTo(-10)
    expect(same.angle).toBeCloseTo(0)
    // Mira 90° a mi derecha (yaw menor): la flecha gira 90° en el sentido de las agujas del reloj.
    const right = teammateMark(ahead.dx, ahead.dz, viewYaw - Math.PI / 2, viewYaw, 60)
    expect(right.angle).toBeCloseTo(Math.PI / 2)
    // La flecha girada apunta en pantalla donde queda su frente en el mapa.
    const front = toMinimap(-Math.sin(viewYaw - Math.PI / 2), -Math.cos(viewYaw - Math.PI / 2), viewYaw)
    expect(Math.sin(right.angle)).toBeCloseTo(front.x)
    expect(-Math.cos(right.angle)).toBeCloseTo(front.y)
  })

  it('lejos: fijado al borde y apuntando hacia él, mire a donde mire', () => {
    const behind = offset(0, -200)
    const mark = teammateMark(behind.dx, behind.dz, 1.2, 0, 60)
    expect(mark.far).toBe(true)
    expect(Math.hypot(mark.x, mark.y)).toBeCloseTo(60)
    expect(mark.y).toBeCloseTo(60)
    expect(Math.abs(mark.angle)).toBeCloseTo(Math.PI)
  })
})

describe('las fogatas en el minimapa', () => {
  it('encendida sale naranja y apagada, gris, de cerca y de lejos', () => {
    const lit = { kind: 'campfire', x: 0, z: 0, station: { ...newStation(), burn: 10 } } as const
    expect(structureColor(lit, false)).toBe(STRUCTURE_MARKS.campfire.near)
    expect(structureColor(lit, true)).toBe(STRUCTURE_MARKS.campfire.far)
    const out = { ...lit, station: newStation() }
    expect(structureColor(out, false)).not.toBe(STRUCTURE_MARKS.campfire.near)
    expect(structureColor(out, true)).not.toBe(STRUCTURE_MARKS.campfire.far)
  })
})
