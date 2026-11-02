import { describe, expect, it } from 'vitest'
import { isBuilt } from './builds'
import { RECIPE_IDS } from './crafting'
import { ITEM_NAMES } from './inventory'
import { Simulation } from './Simulation'
import { placeableOf } from './structures'
import { heightAt, WORLD_SIZE } from './world/terrain'

function match() {
  const sim = new Simulation(1)
  sim.addPlayer(0)
  sim.startMatch({ players: 1, difficulty: 'normal' })
  return sim
}

const find = (sim: Simulation, kind: 'lighthouse' | 'totem') => sim.structures.list.filter((s) => s.kind === kind)

describe('lo que ya viene puesto en la isla', () => {
  it('el faro y el tótem están desde el principio, uno de cada', () => {
    const sim = match()
    expect(find(sim, 'lighthouse')).toHaveLength(1)
    expect(find(sim, 'totem')).toHaveLength(1)
  })

  it('no se fabrican ni se llevan encima', () => {
    expect(RECIPE_IDS).not.toContain('lighthouse')
    expect(RECIPE_IDS).not.toContain('totem')
    expect(Object.keys(ITEM_NAMES)).not.toContain('lighthouse')
    expect(Object.keys(ITEM_NAMES)).not.toContain('totem')
    expect(placeableOf('lighthouse' as never)).toBeNull()
  })

  it('siguen pidiendo sus materiales: están por reparar', () => {
    const sim = match()
    expect(isBuilt(find(sim, 'lighthouse')[0])).toBe(false)
    expect(isBuilt(find(sim, 'totem')[0])).toBe(false)
  })

  it('están en el mismo sitio en cada partida, también al volver a empezar', () => {
    const sim = match()
    const where = () => [find(sim, 'lighthouse')[0], find(sim, 'totem')[0]].map(({ x, z }) => [x, z])
    const first = where()
    sim.startMatch({ players: 1, difficulty: 'easy' })
    expect(where()).toEqual(first)
    expect(find(sim, 'lighthouse')).toHaveLength(1)
    const other = match()
    expect(find(other, 'lighthouse')[0].x).toBe(first[0][0])
  })

  it('el faro está en lo alto de la isla, y no encima de ningún prop', () => {
    const sim = match()
    const [lighthouse] = find(sim, 'lighthouse')
    expect(heightAt(lighthouse.x, lighthouse.z)).toBeGreaterThan(8)
    for (const prop of sim.world.props) expect(Math.hypot(prop.x - lighthouse.x, prop.z - lighthouse.z) - prop.radius).toBeGreaterThan(lighthouse.radius)
  })

  it('el tótem queda lejos del faro y del punto de aparición', () => {
    const sim = match()
    const [lighthouse] = find(sim, 'lighthouse')
    const [totem] = find(sim, 'totem')
    expect(Math.hypot(totem.x - lighthouse.x, totem.z - lighthouse.z)).toBeGreaterThan(WORLD_SIZE * 0.25)
    expect(Math.hypot(totem.x - sim.spawnCenter.x, totem.z - sim.spawnCenter.z)).toBeGreaterThan(WORLD_SIZE * 0.25)
  })
})
