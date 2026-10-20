import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { BERRIES_PER_BUSH, WOBBLE_DURATION } from '../sim/constants'
import { generatePropPlacements } from '../sim/props'
import { PropView, type PropInstance } from './PropView'

const placements = generatePropPlacements()
const tree = placements.find((p) => p.kind === 'tree')!
const bush = placements.find((p) => p.kind === 'bush')!

const m = new THREE.Matrix4()
const isHidden = ({ mesh, index }: PropInstance) => {
  mesh.getMatrixAt(index, m)
  return new THREE.Vector3().setFromMatrixScale(m).length() === 0
}
const atBase = ({ mesh, index, base }: PropInstance) => {
  mesh.getMatrixAt(index, m)
  return m.equals(base)
}

describe('PropView', () => {
  it('construye una instancia por pieza: tronco y copa, roca, arbusto y una por baya', () => {
    const view = new PropView(placements)
    expect(view.instancesOf(tree.id)).toHaveLength(2)
    expect(view.instancesOf(placements.find((p) => p.kind === 'rock')!.id)).toHaveLength(1)
    expect(view.instancesOf(bush.id).filter((i) => i.berry !== undefined)).toHaveLength(BERRIES_PER_BUSH)
    expect(view.instancesOf(tree.id).every(atBase)).toBe(true)
  })

  it('un golpe en un prop ya roto no lo vuelve a mostrar', () => {
    const view = new PropView(placements)
    view.present([{ type: 'propDestroyed', id: tree.id, by: 0 }])
    view.present([{ type: 'propHit', id: tree.id, hp: 1, by: 0 }])
    view.update(WOBBLE_DURATION / 2)
    view.update(WOBBLE_DURATION)
    expect(view.instancesOf(tree.id).every(isHidden)).toBe(true)
  })

  it('las bayas siguen la vida del arbusto en berryTaken y berryGrew', () => {
    const view = new PropView(placements)
    const visible = () => view.instancesOf(bush.id).filter((i) => i.berry !== undefined && !isHidden(i)).length
    view.present([
      { type: 'berryTaken', id: bush.id, hp: 5, by: 0 },
      { type: 'berryTaken', id: bush.id, hp: 4, by: 0 },
    ])
    expect(visible()).toBe(4)
    view.update(WOBBLE_DURATION / 2)
    expect(visible()).toBe(4)
    view.present([{ type: 'berryGrew', id: bush.id, hp: 5 }])
    expect(visible()).toBe(5)
    view.update(WOBBLE_DURATION)
    expect(view.instancesOf(bush.id).filter((i) => !isHidden(i)).every(atBase)).toBe(true)
  })

  it('reset devuelve todas las instancias a su matriz base', () => {
    const view = new PropView(placements)
    view.present([
      { type: 'propDestroyed', id: tree.id, by: 0 },
      { type: 'berryTaken', id: bush.id, hp: 0, by: 0 },
    ])
    view.update(WOBBLE_DURATION / 2)
    view.reset()
    for (const p of [tree, bush]) expect(view.instancesOf(p.id).every(atBase)).toBe(true)
  })
})
