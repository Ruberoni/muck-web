import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../sim/random'
import { Pickups } from '../sim/pickups'
import { STEP } from '../sim/constants'
import { PickupView } from './PickupView'

describe('PickupView', () => {
  it('un modelo por pieza, colocado donde está en la simulación, y fuera al recogerla', () => {
    const pickups = new Pickups([], mulberry32(1))
    const view = new PickupView()
    pickups.drop('wood', 3, 0, 20, 0)
    view.update(pickups.list, 1)
    expect(view.group.children).toHaveLength(3)
    const [object] = view.group.children
    expect(object.position.x).toBe(pickups.list[0].pos.x)
    expect(object.position.y).toBe(pickups.list[0].pos.y)

    pickups.list.splice(0, 1)
    view.update(pickups.list, 1)
    expect(view.group.children).toHaveLength(2)
    expect(view.group.children).not.toContain(object)
  })

  it('interpola entre el paso anterior y el actual', () => {
    const pickups = new Pickups([], mulberry32(1))
    const view = new PickupView()
    pickups.drop('stone', 1, 0, 20, 0)
    pickups.step(STEP, { x: 100, y: 0, z: 0 }, { add: () => false, canAdd: () => false })
    const [p] = pickups.list
    view.update(pickups.list, 0.5)
    expect(view.group.children[0].position.x).toBeCloseTo((p.prev.x + p.pos.x) / 2)
  })

  it('reset quita todos los modelos', () => {
    const pickups = new Pickups([], mulberry32(1))
    const view = new PickupView()
    pickups.drop('wood', 2, 0, 20, 0)
    view.update(pickups.list, 1)
    view.reset()
    expect(view.group.children).toHaveLength(0)
  })
})
