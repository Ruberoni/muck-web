import { describe, expect, it } from 'vitest'
import { BUILD_DEFS, deliver, isBuilt, phaseCost, usableNear } from './builds'
import { Btn } from './commands'
import { HEALTH_MAX, STATION_RANGE, STEP } from './constants'
import { Inventory } from './inventory'
import { Simulation } from './Simulation'
import { STRUCTURE_DEFS, structureSpot, Structures, type Structure } from './structures'
import { heightAt, WATER_LEVEL } from './world/terrain'

const GROUP = { players: 3, difficulty: 'normal' } as const
const SOLO = { players: 1, difficulty: 'normal' } as const

function site(): Structure {
  return new Structures().place({ x: 0, y: 5, z: 0, valid: true }, 'lighthouse')!
}

describe('construcciones compartidas', () => {
  it('el coste provisional es la mitad del diseño, y con un jugador el 60 % de eso', () => {
    expect(phaseCost('lighthouse', 0, GROUP)).toEqual([{ item: 'stone', amount: 60 }])
    expect(phaseCost('lighthouse', 0, SOLO)).toEqual([{ item: 'stone', amount: 36 }])
    expect(phaseCost('lighthouse', 2, GROUP)).toEqual([{ item: 'iron_bar', amount: 10 }, { item: 'mithril_bar', amount: 5 }])
  })

  it('se entrega lo que se tenga, sin pasarse, y la barra lo refleja', () => {
    const lighthouse = site()
    const inventory = new Inventory()
    inventory.add('stone', 40)
    expect(deliver(lighthouse, inventory, GROUP)).toEqual({ changed: true, finished: null })
    expect(inventory.count('stone')).toBe(0)
    expect(lighthouse.build).toMatchObject({ phase: 0, delivered: { stone: 40 } })
    expect(lighthouse.build!.progress).toBeCloseTo(40 / 135, 6)
    inventory.add('stone', 50)
    expect(deliver(lighthouse, inventory, GROUP)).toEqual({ changed: true, finished: 'Cimiento' })
    expect(inventory.count('stone')).toBe(30)
    expect(lighthouse.build).toMatchObject({ phase: 1, delivered: {} })
  })

  it('sin nada que entregar no cambia nada', () => {
    const lighthouse = site()
    const inventory = new Inventory()
    inventory.add('wood', 9)
    expect(deliver(lighthouse, inventory, GROUP)).toEqual({ changed: false, finished: null })
    expect(inventory.count('wood')).toBe(9)
  })

  it('acabadas todas las fases está construido', () => {
    const lighthouse = site()
    const inventory = new Inventory()
    for (const item of ['stone', 'wood', 'iron_bar', 'mithril_bar'] as const) inventory.add(item, 500)
    for (let i = 0; i < BUILD_DEFS.lighthouse!.phases.length; i++) {
      expect(isBuilt(lighthouse)).toBe(false)
      deliver(lighthouse, inventory, GROUP)
    }
    expect(isBuilt(lighthouse)).toBe(true)
    expect(lighthouse.build!.progress).toBe(1)
    expect(deliver(lighthouse, inventory, GROUP).changed).toBe(false)
  })

  it('lo grande se coloca más lejos, para no dejar al jugador dentro', () => {
    const { radius } = STRUCTURE_DEFS.lighthouse
    const spot = structureSpot({ x: 0, z: 0 }, 0, radius, [])
    expect(Math.hypot(spot.x, spot.z)).toBeGreaterThan(radius + 0.4)
  })

  it('la tecla de uso alcanza a lo cercano, y a lo más cercano', () => {
    const near = { ...site(), x: 2 }
    const far = { ...site(), x: 4 }
    const pos = { x: 0, y: 0, z: 0 }
    expect(usableNear([far, near], pos)).toBe(near)
    expect(usableNear([{ ...near, x: STATION_RANGE + near.radius + 1 }], pos)).toBeNull()
  })

  describe('en la partida', () => {
    const setup = () => {
      const sim = new Simulation(1)
      sim.addPlayer(0)
      sim.rules = GROUP
      const { player, inventory } = sim.slot(0)
      const structure = sim.structures.place(structureSpot(player.pos, 0, STRUCTURE_DEFS.lighthouse.radius, sim.obstacles), 'lighthouse')!
      /** Un paso con la tecla de uso pulsada o no. */
      const press = (use: boolean) => {
        const tick = sim.tick + 1
        Object.assign(player, { health: HEALTH_MAX, hunger: 100 })
        return sim.step(new Map([[0, { move: { tick, buttons: use ? Btn.Use : 0, yaw: 0, pitch: 0 }, actions: [] }]]))
      }
      return { sim, player, inventory, structure, press }
    }

    it('pulsar entrega una vez, aunque se mantenga', () => {
      const { sim, inventory, structure, press } = setup()
      inventory.add('stone', 10)
      expect(press(true)).toContainEqual(expect.objectContaining({ type: 'buildProgress', id: structure.id, finished: null }))
      inventory.add('stone', 10)
      expect(press(true).some((e) => e.type === 'buildProgress')).toBe(false)
      expect(sim.slot(0).useHeld).toBeCloseTo(2 * STEP, 6)
      press(false)
      expect(sim.slot(0).useHeld).toBe(0)
      press(true)
      expect(structure.build!.delivered.stone).toBe(20)
    })

    it('lejos no llega', () => {
      const { sim, player, inventory, structure, press } = setup()
      inventory.add('stone', 10)
      sim.teleport(0, player.pos.x + 30, player.pos.z, 0, 0)
      press(true)
      expect(structure.build!.delivered).toEqual({})
    })

    it('la obra se guarda con la partida', () => {
      const { sim, inventory, structure, press } = setup()
      inventory.add('stone', 10)
      press(true)
      const copy = Simulation.fromJSON(JSON.parse(JSON.stringify(sim.toJSON())))
      expect(copy.structures.list[0].build).toEqual(structure.build)
      expect(copy.structures.list[0].build).not.toBe(structure.build)
    })

    it('quien se va deja lo imprescindible en el suelo, y si cae al agua aparece en la orilla', () => {
      const { sim, player, inventory } = setup()
      inventory.add('meteor_fragment', 3)
      inventory.add('wood', 5)
      sim.dropKeyItems(0)
      expect(inventory.toJSON()).toEqual({ wood: 5 })
      expect(sim.pickups.list.map((p) => [p.item, p.amount])).toEqual([['meteor_fragment', 3]])

      const sea = { x: 95, z: 0 }
      expect(heightAt(sea.x, sea.z)).toBeLessThan(WATER_LEVEL)
      sim.pickups.clear()
      sim.pickups.dropPile('meteor_fragment', 3, sea.x, player.pos.y + 2, sea.z)
      sim.pickups.dropPile('wood', 3, sea.x, player.pos.y + 2, sea.z)
      for (let i = 0; i < 120; i++) sim.step(new Map())
      const [fragment, wood] = sim.pickups.list
      expect(heightAt(fragment.pos.x, fragment.pos.z)).toBeGreaterThan(WATER_LEVEL)
      expect(heightAt(wood.pos.x, wood.pos.z)).toBeLessThan(WATER_LEVEL)
    })
  })
})
