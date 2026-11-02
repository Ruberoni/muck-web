import { describe, expect, it } from 'vitest'
import { Btn } from './commands'
import { HEALTH_MAX, STEP, TOTEM_HOLD } from './constants'
import { deliver } from './builds'
import { Simulation } from './Simulation'
import { STRUCTURE_DEFS, structureSpot } from './structures'

const RULES = { players: 2, difficulty: 'normal' } as const

/** Una partida con un tótem acabado al lado. */
function setup() {
  const sim = new Simulation(1)
  sim.addPlayer(0)
  sim.rules = RULES
  const { player, inventory } = sim.slot(0)
  const totem = sim.structures.place(structureSpot(player.pos, 0, STRUCTURE_DEFS.totem.radius, sim.obstacles), 'totem')!
  const hold = (seconds: number) => {
    const list = []
    for (let i = 0; i < Math.round(seconds / STEP); i++) {
      Object.assign(player, { health: HEALTH_MAX, hunger: 100 })
      list.push(...sim.step(new Map([[0, { move: { tick: sim.tick + 1, buttons: Btn.Use, yaw: 0, pitch: 0 }, actions: [] }]])))
    }
    return list
  }
  const finish = () => {
    for (const item of ['stone', 'dark_wood', 'iron_bar', 'meteor_fragment', 'boss_trophy'] as const) inventory.add(item, 500)
    for (let i = 0; i < 3; i++) deliver(totem, inventory, RULES)
    inventory.clear()
  }
  return { sim, inventory, totem, hold, finish }
}

describe('el tótem', () => {
  it('el corazón pide fragmentos por jugador y un trofeo: sin ellos no se acaba', () => {
    const { inventory, totem, finish } = setup()
    expect(totem.build!.phase).toBe(0)
    finish()
    expect(totem.build!.phase).toBe(3)
    expect(inventory.toJSON()).toEqual({})
  })

  it('sin acabar no se activa, por mucho que se mantenga la tecla', () => {
    const { sim, totem, hold } = setup()
    hold(TOTEM_HOLD + 1)
    expect(totem.awake).toBeUndefined()
    expect(sim.threat.state.totem).toBe(false)
  })

  it('se activa manteniendo la tecla 3 s, sin vuelta atrás, y una vez', () => {
    const { sim, totem, hold, finish } = setup()
    finish()
    expect(hold(TOTEM_HOLD - 0.5).some((e) => e.type === 'totemActivated')).toBe(false)
    sim.step(new Map())
    expect(hold(TOTEM_HOLD - 0.5).some((e) => e.type === 'totemActivated')).toBe(false)
    const events = hold(TOTEM_HOLD + 1)
    expect(events.filter((e) => e.type === 'totemActivated')).toEqual([expect.objectContaining({ id: totem.id })])
    expect(events.find((e) => e.type === 'mobsRose')).toMatchObject({ trait: null, threat: { totem: true } })
    expect(totem.awake).toBe(true)
    expect(sim.enemies.scaling.hp).toBeCloseTo(1.5, 6)
    expect(hold(TOTEM_HOLD + 1).some((e) => e.type === 'totemActivated')).toBe(false)
  })

  it('se puede activar antes de la Noche Eterna: el salto de esta llega igual después', () => {
    const { sim, hold, finish } = setup()
    finish()
    hold(TOTEM_HOLD + 0.1)
    expect(sim.clock.eternal).toBe(false)
    sim.setDay(6)
    sim.setPhase(0.65 - 0.001)
    for (let i = 0; i < 120; i++) sim.step(new Map())
    expect(sim.threat.state).toMatchObject({ eternal: true, totem: true })
  })

  it('se guarda con la partida', () => {
    const { sim, hold, finish } = setup()
    finish()
    hold(TOTEM_HOLD + 0.1)
    const copy = Simulation.fromJSON(JSON.parse(JSON.stringify(sim.toJSON())))
    expect(copy.structures.list[0].awake).toBe(true)
    expect(copy.threat.state.totem).toBe(true)
  })
})
