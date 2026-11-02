import { describe, expect, it } from 'vitest'
import { HEALTH_MAX, MAX_JOBS, STATION_RANGE, STEP } from './constants'
import { Simulation } from './Simulation'
import { structureSpot } from './structures'
import { canCraft, craft, isRecipeId, RECIPE_IDS, RECIPES } from './crafting'
import { Inventory, type ItemId } from './inventory'

const recipe = (result: ItemId) => RECIPES.find((r) => r.result === result)!

describe('crafteo', () => {
  it('gasta los ingredientes y añade la herramienta', () => {
    const inv = new Inventory()
    inv.add('wood', 8)
    inv.add('stone', 6)
    expect(craft(inv, recipe('stone_pickaxe'))).toBe(true)
    expect(inv.count('wood')).toBe(5)
    expect(inv.count('stone')).toBe(1)
    expect(inv.count('stone_pickaxe')).toBe(1)
  })

  it('sin ingredientes suficientes no toca nada', () => {
    const inv = new Inventory()
    inv.add('wood', 4)
    expect(canCraft(inv, recipe('wood_axe'))).toBe(false)
    expect(craft(inv, recipe('wood_axe'))).toBe(false)
    expect(inv.toJSON()).toEqual({ wood: 4 })
  })

  it('gastar toda la madera libera su casilla para la herramienta', () => {
    const inv = new Inventory()
    inv.add('wood', 5)
    expect(craft(inv, recipe('wood_axe'))).toBe(true)
    expect(inv.has('wood')).toBe(false)
    expect(inv.slots[0]).toBe('wood_axe')
  })

  it('la fogata cuesta madera y piedra', () => {
    const inv = new Inventory()
    inv.add('wood', 6)
    inv.add('stone', 2)
    expect(canCraft(inv, recipe('campfire'))).toBe(false)
    inv.add('stone', 1)
    expect(craft(inv, recipe('campfire'))).toBe(true)
    expect(inv.toJSON()).toEqual({ campfire: 1 })
  })

  it('con el inventario lleno solo se fabrica si un ingrediente se agota', () => {
    // Un inventario reducido: con los objetos que hay, el de 27 casillas no se llena.
    const inv = new Inventory(4)
    inv.add('wood', 10)
    for (let i = 1; i < 4; i++) inv.add(`item${i}` as ItemId, 1)
    expect(canCraft(inv, recipe('wood_axe'))).toBe(false)
    inv.remove('wood', 5)
    expect(craft(inv, recipe('wood_axe'))).toBe(true)
    expect(inv.slots[0]).toBe('wood_axe')
  })

  it('cada receta tiene un id distinto y solo esos ids son válidos', () => {
    expect(new Set(RECIPE_IDS).size).toBe(RECIPES.length)
    for (const id of RECIPE_IDS) expect(isRecipeId(id)).toBe(true)
    for (const bad of [0, 4, '', 'adamantite_pickaxe', 'toString', '__proto__', null, undefined]) expect(isRecipeId(bad)).toBe(false)
  })
})

describe('estaciones con tiempo', () => {
  const setup = (difficulty: 'normal' | 'hard' = 'normal') => {
    const sim = new Simulation(1)
    sim.addPlayer(0)
    sim.rules = { players: 2, difficulty }
    sim.addPlayer(1)
    const { player, inventory } = sim.slot(0)
    inventory.add('iron_ore', 9)
    inventory.add('wood', 9)
    const furnace = sim.structures.place(structureSpot(player.pos, 0, 0.8, sim.obstacles), 'furnace')!
    const smelt = (times = 1) => {
      let seq = sim.slot(0).appliedSeq
      const tick = sim.tick + 1
      const actions = Array.from({ length: times }, () => ({ kind: 'craft' as const, recipe: 'iron_bar' as const, seq: ++seq, tick }))
      return sim.step(new Map([[0, { move: { tick, buttons: 0, yaw: 0, pitch: 0 }, actions }]]))
    }
    const wait = (seconds: number) => {
      const list = []
      for (let i = 0; i < Math.round(seconds / STEP); i++) {
        Object.assign(player, { health: HEALTH_MAX, hunger: 100 })
        list.push(...sim.step(new Map()))
      }
      return list
    }
    return { sim, player, inventory, furnace, smelt, wait }
  }

  it('gasta los ingredientes al cargar, trabaja sola y lo terminado sale junto a ella, para cualquiera', () => {
    const { sim, inventory, furnace, smelt, wait } = setup()
    expect(smelt()).toContainEqual(expect.objectContaining({ type: 'stationQueued', id: furnace.id, recipe: 'iron_bar', time: 15 }))
    expect(inventory.toJSON()).toMatchObject({ iron_ore: 8, wood: 8 })
    expect(inventory.count('iron_bar')).toBe(0)
    expect(wait(14.9).some((e) => e.type === 'stationDone')).toBe(false)
    const done = wait(0.2)
    expect(done).toContainEqual(expect.objectContaining({ type: 'stationDone', id: furnace.id }))
    expect(done).toContainEqual(expect.objectContaining({ type: 'pickupSpawn', item: 'iron_bar' }))
    expect(sim.pickups.list.map((p) => p.item)).toEqual(['iron_bar'])
  })

  it('tiene una cola de 5, y solo avanza el primero', () => {
    const { furnace, smelt, wait } = setup()
    smelt(MAX_JOBS + 2)
    expect(furnace.jobs).toHaveLength(MAX_JOBS)
    wait(16)
    expect(furnace.jobs).toHaveLength(MAX_JOBS - 1)
    expect(furnace.jobs[0].left).toBeCloseTo(14, 1)
    expect(furnace.jobs[1].left).toBe(15)
  })

  it('lejos no se puede cargar', () => {
    const { sim, furnace, smelt } = setup()
    sim.teleport(0, furnace.x + STATION_RANGE + 2, furnace.z, 0, 0)
    sim.step(new Map())
    smelt()
    expect(furnace.jobs).toEqual([])
  })

  it('la dificultad alarga el trabajo: las estaciones y lo que se rompe', () => {
    const { sim, furnace, smelt } = setup('hard')
    smelt()
    expect(furnace.jobs[0].time).toBeCloseTo((15 * 55) / 45, 6)
    const tree = sim.world.props.find((p) => p.kind === 'tree')!
    expect(tree.maxHp).toBe(Math.ceil((16 * 55) / 45))
    expect(tree.hp).toBe(tree.maxHp)
    const bush = sim.world.props.find((p) => p.kind === 'bush')!
    expect(bush.maxHp).toBe(6)
  })

  it('la cola se guarda con la partida', () => {
    const { sim, furnace, smelt, wait } = setup()
    smelt(2)
    wait(3)
    const copy = Simulation.fromJSON(JSON.parse(JSON.stringify(sim.toJSON())))
    expect(copy.structures.list[0].jobs).toEqual(furnace.jobs)
    expect(copy.structures.list[0].jobs).not.toBe(furnace.jobs)
  })
})
