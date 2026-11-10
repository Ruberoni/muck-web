import { describe, expect, it } from 'vitest'
import { islandProblems, pickIsland } from './islands'
import { FLOAT_DEPTH, PROP_DEFS, WORLD_BOUND_FACTOR } from './constants'
import { findSpawn, createPropWorld, generatePropPlacements, PROP_COUNTS, propCounts, type PropKind } from './props'
import { FUEL_SECONDS } from './stations'
import { WATER_LEVEL, WORLD_SIZE } from './world/terrain'
import { Simulation } from './Simulation'
import { createIsland, DEFAULT_ISLAND, ISLAND_SIZE } from './world/island'

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

  // Genera y valida las 8 islas enteras, con sus props y su punto de aparición: solo eso ya roza los 2 s, y con la
  // suite en paralelo los workers se pelean por la CPU y se pasaba de los 5 s por defecto. El timeout holgado evita
  // un rojo intermitente que taparía un fallo real; la lógica de la isla no cambia.
  it(
    'cada semilla da otra isla: otro terreno, otros biomas y otros props',
    () => {
      const islands = SEEDS.map(pickIsland)
      expect(new Set(islands.map((i) => i.seed)).size).toBe(SEEDS.length)
      expect(new Set(islands.map((i) => i.heightAt(20, 30).toFixed(3))).size).toBeGreaterThan(SEEDS.length / 2)
      const firstTrees = islands.map((i) => generatePropPlacements(i).find((p) => p.kind === 'tree')!)
      expect(new Set(firstTrees.map((p) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`)).size).toBe(SEEDS.length)
      const spawns = islands.map((i) => findSpawn(createPropWorld(generatePropPlacements(i)).grid, i))
      expect(new Set(spawns.map((s) => `${s.x.toFixed(1)},${s.z.toFixed(1)}`)).size).toBeGreaterThan(1)
    },
    20_000,
  )

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
    // El faro, el tótem, la tumba y el mercader, en la isla nueva.
    expect(sim.structures.list.map((s) => s.kind).sort()).toEqual(['grave', 'lighthouse', 'merchant', 'totem'])
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

describe('islas de partida', () => {
  const island = pickIsland(11)

  it('miden ISLAND_SIZE, el triple que la de siempre, y tienen más de todo', () => {
    expect(island.size).toBe(ISLAND_SIZE)
    expect(DEFAULT_ISLAND.size).toBe(WORLD_SIZE)
    const counts = propCounts(island)
    for (const [kind, count] of Object.entries(PROP_COUNTS)) expect(counts[kind as PropKind], kind).toBeGreaterThan(count * 4)
    // Y la de siempre no cambia.
    expect(propCounts(DEFAULT_ISLAND)).toEqual(PROP_COUNTS)
  })

  it('tienen lagos tierra adentro, que se vadean casi enteros y no tocan el mar', () => {
    expect(island.lakes.length).toBeGreaterThanOrEqual(3)
    expect(DEFAULT_ISLAND.lakes).toEqual([])
    for (const lake of island.lakes) {
      let wet = 0
      let wadeable = 0
      for (let i = 0; i < 200; i++) {
        const a = i * 2.4
        const r = Math.sqrt((i + 0.5) / 200) * lake.radius * 0.55
        const h = island.heightAt(lake.x + Math.cos(a) * r, lake.z + Math.sin(a) * r)
        if (h < WATER_LEVEL) wet++
        if (h > WATER_LEVEL - FLOAT_DEPTH) wadeable++
      }
      expect(wet).toBe(200)
      expect(wadeable / 200).toBeGreaterThan(0.6)
      // La orilla, en tierra.
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2
        expect(island.heightAt(lake.x + Math.cos(a) * lake.radius * 1.2, lake.z + Math.sin(a) * lake.radius * 1.2)).toBeGreaterThan(WATER_LEVEL)
      }
    }
  })

  it('se llega hasta casi el borde, y nada más', () => {
    const sim = new Simulation(1, undefined, island)
    const slot = sim.addPlayer(0)
    expect(sim.env.bound!()).toBeCloseTo(ISLAND_SIZE * WORLD_BOUND_FACTOR, 6)
    sim.teleport(0, ISLAND_SIZE, 0, Math.PI / 2, 0)
    for (let i = 0; i < 10; i++) sim.step(new Map())
    expect(Math.hypot(slot.player.pos.x, slot.player.pos.z)).toBeLessThanOrEqual(ISLAND_SIZE * WORLD_BOUND_FACTOR + 1e-6)
  })

  it('el árbol muerto sale en la playa y la montaña y da madera seca, que arde el doble', () => {
    const dead = generatePropPlacements(island).filter((p) => p.kind === 'deadtree')
    expect(dead).toHaveLength(propCounts(island).deadtree)
    const biomes = new Set(dead.map((p) => island.biomeAt(p.x, p.z)))
    expect([...biomes].every((b) => b !== 'forest')).toBe(true)
    expect(biomes.has('beach') || biomes.has('mountain')).toBe(true)
    expect(PROP_DEFS.deadtree).toMatchObject({ tool: 'axe', tier: 2, drop: { item: 'dry_wood' } })
    expect(FUEL_SECONDS.dry_wood).toBe(FUEL_SECONDS.wood! * 2)
  })
})
