import { describe, expect, it } from 'vitest'
import { PROP_DEFS } from './constants'
import { SpatialGrid, type Collider } from './collision'
import {
  BIRCH_BAND,
  BIRCH_COUNT,
  buildPropPlacements,
  createPropWorld,
  DARKPINE_BAND,
  DARKPINE_COUNT,
  findSpawn,
  generatePropPlacements,
  IRON_ORE_BAND,
  IRON_ORE_COUNT,
  MITHRIL_ORE_BAND,
  MITHRIL_ORE_COUNT,
  resetProp,
  SPAWN_EXCLUSION,
  type PropKind,
  type PropPlacement,
} from './props'
import { Simulation } from './Simulation'
import { heightAt, MAX_SLOPE, ROCK_LEVEL, SAND_LEVEL, slopeAt } from './world/terrain'

/** Los props de antes del PR 8 (árboles, rocas y arbustos): sus ids, posiciones y el hash del mundo no cambian. */
const ORIGINAL_COUNT = 180 + 60 + 45
/** Los tipos de cada franja, con su cantidad exacta, su franja y la pendiente máxima. */
const BANDED = [
  { kind: 'birch', count: BIRCH_COUNT, band: BIRCH_BAND, slope: MAX_SLOPE },
  { kind: 'iron_ore', count: IRON_ORE_COUNT, band: IRON_ORE_BAND, slope: MAX_SLOPE * 1.5 },
  { kind: 'darkpine', count: DARKPINE_COUNT, band: DARKPINE_BAND, slope: MAX_SLOPE },
  { kind: 'mithril_ore', count: MITHRIL_ORE_COUNT, band: MITHRIL_ORE_BAND, slope: MAX_SLOPE * 1.5 },
] as const

const gridOf = (placements: readonly PropPlacement[]) => {
  const grid = new SpatialGrid<Collider>()
  for (const { x, z, radius } of placements) grid.insert({ x, z, radius, alive: true })
  return grid
}

describe('colocación de props', () => {
  const placements = generatePropPlacements()
  const ofKind = (kind: PropKind) => placements.filter((p) => p.kind === kind)

  it('es determinista', () => {
    expect(buildPropPlacements()).toEqual(placements)
  })

  it('se calcula una vez y es de solo lectura', () => {
    expect(generatePropPlacements()).toBe(placements)
    expect(Object.isFrozen(placements)).toBe(true)
    expect(Object.isFrozen(placements[0])).toBe(true)
  })

  it('el id es el índice: árboles, rocas, arbustos y después abedules, menas de hierro, pinos oscuros y menas de mithril', () => {
    expect(placements.every((p, i) => p.id === i)).toBe(true)
    const kinds = placements.map((p) => p.kind)
    const order = ['tree', 'rock', 'bush', 'birch', 'iron_ore', 'darkpine', 'mithril_ore']
    for (let i = 1; i < kinds.length; i++) expect(order.indexOf(kinds[i])).toBeGreaterThanOrEqual(order.indexOf(kinds[i - 1]))
    for (const kind of order) expect(kinds).toContain(kind)
    expect(kinds.slice(0, ORIGINAL_COUNT).every((k) => k === 'tree' || k === 'rock' || k === 'bush')).toBe(true)
    // Los del PR 10 van detrás de los del PR 8: no mueven sus ids (ni sus posiciones, que vigila world.test.ts).
    expect(kinds.slice(ORIGINAL_COUNT, ORIGINAL_COUNT + BIRCH_COUNT + IRON_ORE_COUNT).every((k) => k === 'birch' || k === 'iron_ore')).toBe(true)
  })

  it.each(BANDED)('salen todos los de tipo $kind, en su franja de altura y pendiente', ({ kind, count, band, slope }) => {
    expect(ofKind(kind)).toHaveLength(count)
    for (const p of ofKind(kind)) {
      const h = heightAt(p.x, p.z)
      expect(h).toBeGreaterThanOrEqual(band.min)
      expect(h).toBeLessThanOrEqual(band.max)
      expect(slopeAt(p.x, p.z)).toBeLessThanOrEqual(slope)
    }
  })

  it('las franjas de las menas no se solapan: el hierro no se come las cimas', () => {
    expect(IRON_ORE_BAND.max).toBeLessThanOrEqual(MITHRIL_ORE_BAND.min)
  })

  it('las menas de mithril tienen escala 0,6–1 (las de hierro llegan a 1,6) y los pinos oscuros, 1,2–1,6', () => {
    const scales = (kind: PropKind) => ofKind(kind).flatMap((p) => [p.scaleX, p.scaleY, p.scaleZ])
    expect(Math.min(...scales('mithril_ore'))).toBeGreaterThanOrEqual(0.6)
    expect(Math.max(...scales('mithril_ore'))).toBeLessThanOrEqual(1)
    expect(Math.max(...scales('iron_ore'))).toBeGreaterThan(1.2)
    expect(Math.min(...scales('darkpine'))).toBeGreaterThanOrEqual(1.2)
    expect(Math.max(...scales('darkpine'))).toBeLessThanOrEqual(1.6)
  })

  it('los tipos nuevos no mueven el punto de aparición, quedan lejos de él y no se solapan con nada', () => {
    const before = findSpawn(gridOf(placements.slice(0, ORIGINAL_COUNT)))
    expect(findSpawn(gridOf(placements))).toEqual(before)
    expect(new Simulation(1).spawnCenter).toEqual(before)
    // Referencia en Node, como el hash del mundo: la de antes del PR 8.
    expect(before).toEqual({ x: 1.5590735034407721, z: -1.5521887162548624 })
    for (const p of placements.slice(ORIGINAL_COUNT)) {
      expect(Math.hypot(p.x - before.x, p.z - before.z) - p.radius).toBeGreaterThanOrEqual(SPAWN_EXCLUSION)
      for (const other of placements) {
        if (other === p) continue
        expect(Math.hypot(other.x - p.x, other.z - p.z)).toBeGreaterThan(other.radius + p.radius + 1)
      }
    }
  })

  it('árboles, abedules, pinos oscuros y arbustos solo giran en Y y escalan igual en los tres ejes', () => {
    for (const p of placements.filter((p) => PROP_DEFS[p.kind].family !== 'rock')) {
      expect(p.rotX).toBe(0)
      expect(p.scaleY).toBe(p.scaleX)
      expect(p.scaleZ).toBe(p.scaleX)
    }
  })

  it('los arbustos están en hierba y no se solapan con otros props', () => {
    for (const bush of placements.filter((p) => p.kind === 'bush')) {
      const h = heightAt(bush.x, bush.z)
      expect(h).toBeGreaterThan(SAND_LEVEL)
      expect(h).toBeLessThanOrEqual(ROCK_LEVEL)
      for (const other of placements) {
        if (other === bush) continue
        expect(Math.hypot(other.x - bush.x, other.z - bush.z)).toBeGreaterThan(other.radius + bush.radius)
      }
    }
  })
})

describe('estado de los props', () => {
  it('empiezan vivos y con la vida de su tipo; la rejilla los contiene a todos', () => {
    const world = createPropWorld()
    expect(world.props).toHaveLength(world.placements.length)
    for (const prop of world.props) {
      expect(prop.alive).toBe(true)
      expect(prop.hp).toBe(PROP_DEFS[prop.kind].hp)
      expect(prop.maxHp).toBe(prop.hp)
      expect(world.grid.query(prop.x, prop.z, 0)).toContain(prop)
    }
  })

  it('resetProp lo revive con la vida llena', () => {
    const [prop] = createPropWorld().props
    prop.hp = 0
    prop.alive = false
    resetProp(prop)
    expect(prop).toMatchObject({ hp: prop.maxHp, alive: true })
  })
})
