import { describe, expect, it } from 'vitest'
import { LocalSession } from './session'

describe('LocalSession', () => {
  it('numera las acciones a continuación de la última aplicada, también tras reiniciar', () => {
    const session = new LocalSession(5)
    const { sim } = session
    const move = { buttons: 0, yaw: 0, pitch: 0 }
    session.step(move, [{ kind: 'select', slot: 2 }, { kind: 'select', slot: 3 }])
    expect(sim.tick).toBe(1)
    expect(sim.slot.appliedSeq).toBe(2)
    expect(sim.slot.inventory.selected).toBe(3)
    session.reset()
    session.step(move, [{ kind: 'select', slot: 4 }])
    expect(sim.slot.appliedSeq).toBe(3)
    expect(sim.slot.inventory.selected).toBe(4)
  })

  it('cada sesión sin semilla tiene la suya', () => {
    expect(new LocalSession().sim.toJSON().rng).not.toBe(new LocalSession().sim.toJSON().rng)
  })
})
