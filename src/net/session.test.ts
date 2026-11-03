import { describe, expect, it } from 'vitest'
import { pickIsland } from '../sim/islands'
import { DEFAULT_ISLAND } from '../sim/world/island'
import { LocalSession } from './session'

describe('LocalSession', () => {
  it('numera las acciones a continuación de la última aplicada, también tras reiniciar', () => {
    const session = new LocalSession(5)
    const { sim } = session
    expect(sim.slot(session.me)).toBe(session.slot)
    const move = { buttons: 0, yaw: 0, pitch: 0 }
    session.step(move, [{ kind: 'select', slot: 2 }, { kind: 'select', slot: 3 }])
    expect(sim.tick).toBe(1)
    expect(session.slot.appliedSeq).toBe(2)
    expect(session.slot.inventory.selected).toBe(3)
    session.reset()
    session.step(move, [{ kind: 'select', slot: 4 }])
    expect(session.slot.appliedSeq).toBe(3)
    expect(session.slot.inventory.selected).toBe(4)
  })

  it('cada partida en solitario es en una isla nueva, con la misma simulación y el mismo jugador', () => {
    const session = new LocalSession(5)
    const { sim, slot } = session
    expect(sim.island).toBe(DEFAULT_ISLAND)
    session.start({ players: 1, difficulty: 'normal' })
    expect(sim.island).not.toBe(DEFAULT_ISLAND)
    const island = pickIsland(9)
    session.start({ players: 1, difficulty: 'normal' }, island)
    expect(session.sim).toBe(sim)
    expect(session.slot).toBe(slot)
    expect(sim.island).toBe(island)
    expect(slot.player.pos).toMatchObject({ x: sim.spawnCenter.x, z: sim.spawnCenter.z })
  })

  it('cada sesión sin semilla tiene la suya', () => {
    expect(new LocalSession().sim.toJSON().rng).not.toBe(new LocalSession().sim.toJSON().rng)
  })
})
