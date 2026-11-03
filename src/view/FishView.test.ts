import { describe, expect, it } from 'vitest'
import { WATER_LEVEL } from '../sim/world/terrain'
import { FishView } from './FishView'

describe('FishView', () => {
  it('da vueltas cerca de su presa, con la aleta fuera del agua, se lanza al morder y se va con ella', () => {
    const view = new FishView()
    const at = { x: 10, z: -5 }
    const fishes = [{ target: 2, biteIn: 1 }]
    view.update(0.016, fishes, (id) => (id === 2 ? at : null))
    expect(view.count).toBe(1)
    const [fish] = view.group.children
    const distance = () => Math.hypot(fish.position.x - at.x, fish.position.z - at.z)
    expect(distance()).toBeCloseTo(3.2, 1)
    expect(fish.position.y).toBeLessThan(WATER_LEVEL)
    view.present([{ type: 'fishBite', id: 2 }])
    for (let i = 0; i < 14; i++) view.update(0.016, fishes, () => at)
    expect(distance()).toBeLessThan(2)
    // Sin presa a la vista, no se dibuja; sin pez en la lista, tampoco.
    view.update(0.016, fishes, () => null)
    expect(view.count).toBe(0)
    view.update(0.016, fishes, () => at)
    view.update(0.016, [], () => at)
    expect(view.group.children).toHaveLength(0)
  })
})
