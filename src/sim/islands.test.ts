import { describe, expect, it } from 'vitest'
import { islandProblems, pickIsland } from './islands'
import { findSpawn, createPropWorld, generatePropPlacements } from './props'
import { Simulation } from './Simulation'
import { createIsland, DEFAULT_ISLAND } from './world/island'

const SEEDS = [1, 2, 3, 42, 777, 2026, 31337, 0xdeadbeef]

describe('islas aleatorias', () => {
  it('la de siempre se puede jugar', () => {
    expect(islandProblems(DEFAULT_ISLAND)).toEqual([])
  })

  it.each(SEEDS)('con la semilla %i sale una isla jugable, y siempre la misma', (seed) => {
    const island = pickIsland(seed)
    expect(islandProblems(island)).toEqual([])
    expect(pickIsland(seed).seed).toBe(island.seed)
    expect(createIsland(island.seed).heightAt(13, -27)).toBe(island.heightAt(13, -27))
  })

  it('cada semilla da otra isla: otro terreno, otros biomas y otros props', () => {
    const islands = SEEDS.map(pickIsland)
    expect(new Set(islands.map((i) => i.seed)).size).toBe(SEEDS.length)
    expect(new Set(islands.map((i) => i.heightAt(20, 30).toFixed(3))).size).toBeGreaterThan(SEEDS.length / 2)
    const firstTrees = islands.map((i) => generatePropPlacements(i).find((p) => p.kind === 'tree')!)
    expect(new Set(firstTrees.map((p) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`)).size).toBe(SEEDS.length)
    const spawns = islands.map((i) => findSpawn(createPropWorld(generatePropPlacements(i)).grid, i))
    expect(new Set(spawns.map((s) => `${s.x.toFixed(1)},${s.z.toFixed(1)}`)).size).toBeGreaterThan(1)
  })

  it('una partida en otra isla cambia todo lo que sale de ella y sigue con el mismo tick y los mismos jugadores', () => {
    const sim = new Simulation(1)
    const slot = sim.addPlayer(0)
    sim.addPlayer(1)
    for (let i = 0; i < 10; i++) sim.step(new Map())
    const tick = sim.tick
    const island = pickIsland(42)
    sim.startMatch({ players: 2, difficulty: 'normal' }, island)
    expect(sim.island).toBe(island)
    expect(sim.world.placements).toBe(generatePropPlacements(island))
    expect(sim.tick).toBe(tick)
    expect(sim.slot(0)).toBe(slot)
    expect(slot.spawn).toEqual(sim.spawnCenter)
    expect(slot.player.pos).toMatchObject({ x: sim.spawnCenter.x, z: sim.spawnCenter.z })
    expect(sim.env.heightAt(5, 5)).toBe(island.heightAt(5, 5))
    // El faro, el tótem y la tumba, en la isla nueva.
    expect(sim.structures.list.map((s) => s.kind).sort()).toEqual(['grave', 'lighthouse', 'totem'])
  })

  it('se guarda con su isla y se restaura en ella', () => {
    const island = pickIsland(7)
    const sim = new Simulation(1, undefined, island)
    sim.addPlayer(0)
    const copy = Simulation.fromJSON(JSON.parse(JSON.stringify(sim.toJSON())))
    expect(copy.island.seed).toBe(island.seed)
    expect(copy.world.placements).toEqual(sim.world.placements)
  })
})
