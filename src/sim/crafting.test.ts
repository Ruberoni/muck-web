import { describe, expect, it } from 'vitest'
import { HEALTH_MAX, STATION_RANGE, STEP } from './constants'
import { Simulation } from './Simulation'
import { structureSpot } from './structures'
import { canCraft, craft, isRecipeId, RECIPE_IDS, RECIPES } from './crafting'
import { Inventory, type ItemId } from './inventory'
import { newStation, type StationSlot } from './stations'

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

describe('estaciones con ranuras en la partida', () => {
  const setup = (difficulty: 'normal' | 'hard' = 'normal') => {
    const sim = new Simulation(1)
    sim.addPlayer(0)
    sim.rules = { players: 2, difficulty }
    sim.addPlayer(1)
    const { player, inventory } = sim.slot(0)
    inventory.add('iron_ore', 9)
    inventory.add('wood', 9)
    const furnace = sim.structures.place(structureSpot(player.pos, 0, 0.8, sim.obstacles), 'furnace')!
    const tend = (who: number, ...ops: { slot: StationSlot; from: number | null; all: boolean }[]) => {
      let seq = sim.slot(who).appliedSeq
      const tick = sim.tick + 1
      const actions = ops.map((op) => ({ kind: 'station' as const, id: furnace.id, ...op, seq: ++seq, tick }))
      return sim.step(new Map([[who, { move: { tick, buttons: 0, yaw: 0, pitch: 0 }, actions }]]))
    }
    const slotOf = (item: ItemId) => inventory.slots.indexOf(item)
    const load = () => tend(0, { slot: 'input', from: slotOf('iron_ore'), all: true }, { slot: 'fuel', from: slotOf('wood'), all: false })
    const wait = (seconds: number) => {
      const list = []
      for (let i = 0; i < Math.round(seconds / STEP); i++) {
        Object.assign(player, { health: HEALTH_MAX, hunger: 100 })
        list.push(...sim.step(new Map()))
      }
      return list
    }
    return { sim, player, inventory, furnace, tend, load, wait }
  }

  it('se carga desde el inventario, trabaja sola y lo terminado se queda en la salida', () => {
    const { inventory, furnace, load, wait } = setup()
    expect(load()).toContainEqual(expect.objectContaining({ type: 'stationChanged', id: furnace.id }))
    expect(inventory.toJSON()).toEqual({ wood: 8 })
    expect(furnace.station!.input).toEqual({ item: 'iron_ore', amount: 9 })
    expect(furnace.station!.fuel).toEqual({ item: 'wood', amount: 1 })
    // Al empezar coge la madera, y la ranura de combustible se vacía.
    expect(wait(STEP)).toContainEqual(expect.objectContaining({ type: 'stationChanged', id: furnace.id }))
    expect(furnace.station!.fuel).toBeNull()
    expect(furnace.station!.burn).toBeGreaterThan(0)
    expect(wait(14.8).some((e) => e.type === 'stationChanged')).toBe(false)
    expect(furnace.station!.output).toBeNull()
    expect(wait(0.3)).toContainEqual(expect.objectContaining({ type: 'stationChanged', id: furnace.id }))
    expect(furnace.station!.output).toEqual({ item: 'iron_bar', amount: 1 })
    // Sin más madera se para.
    wait(20)
    expect(furnace.station!.output!.amount).toBe(1)
  })

  it('cualquiera saca la salida a su inventario', () => {
    const { sim, furnace, load, wait, tend } = setup()
    load()
    wait(15.1)
    const other = sim.slot(1)
    sim.teleport(1, furnace.x + 1.5, furnace.z, 0, 0)
    tend(1, { slot: 'output', from: null, all: true })
    expect(other.inventory.count('iron_bar')).toBe(1)
    expect(furnace.station!.output).toBeNull()
  })

  it('lo que no va a una ranura no se mete, y lejos no se toca', () => {
    const { sim, inventory, furnace, tend } = setup()
    tend(0, { slot: 'input', from: inventory.slots.indexOf('wood'), all: true })
    expect(furnace.station!.input).toBeNull()
    expect(inventory.count('wood')).toBe(9)
    sim.teleport(0, furnace.x + STATION_RANGE + 2, furnace.z, 0, 0)
    sim.step(new Map())
    tend(0, { slot: 'input', from: inventory.slots.indexOf('iron_ore'), all: true })
    expect(furnace.station!.input).toBeNull()
    expect(inventory.count('iron_ore')).toBe(9)
  })

  it('la dificultad alarga el trabajo: las estaciones y lo que se rompe', () => {
    const { sim, furnace, load, wait } = setup('hard')
    load()
    wait(1)
    expect(furnace.station!.time).toBeCloseTo((15 * 55) / 45, 6)
    const tree = sim.world.props.find((p) => p.kind === 'tree')!
    expect(tree.maxHp).toBe(Math.ceil((16 * 55) / 45))
    expect(tree.hp).toBe(tree.maxHp)
    const bush = sim.world.props.find((p) => p.kind === 'bush')!
    expect(bush.maxHp).toBe(6)
  })

  it('lo que hay dentro se guarda con la partida', () => {
    const { sim, furnace, load, wait } = setup()
    load()
    wait(3)
    const copy = Simulation.fromJSON(JSON.parse(JSON.stringify(sim.toJSON())))
    expect(copy.structures.list[0].station).toEqual(furnace.station)
    expect(copy.structures.list[0].station).not.toBe(furnace.station)
  })

  it('una partida guardada sin ranuras las recibe vacías', () => {
    const { sim } = setup()
    const saved = JSON.parse(JSON.stringify(sim.toJSON()))
    for (const s of saved.structures.list) delete s.station
    const copy = Simulation.fromJSON(saved)
    expect(copy.structures.list[0].station).toEqual(newStation())
  })
})
