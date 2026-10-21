import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { RemotePlayer } from '../net/client'
import type { Shown } from '../net/interp'
import { playerColor, RemotePlayerView } from './RemotePlayerView'

const shown = (id: number, x: number, data: Partial<RemotePlayer> = {}): Shown<RemotePlayer> => ({
  id,
  pose: { x, y: 2, z: 5, yaw: 1, pitch: 0.3 },
  data: { item: null, health: 100, alive: true, connection: 'present', ...data },
})

/** Las mallas de un modelo con el color de su cuerpo. */
const bodyColor = (model: THREE.Object3D) => ((model.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial).color

describe('RemotePlayerView', () => {
  it('un modelo por jugador, en su pose, de su color; quita a los que ya no están', () => {
    const view = new RemotePlayerView()
    view.update(0.016, [shown(1, 10), shown(2, -3)])
    expect(view.group.children).toHaveLength(2)
    const [first, second] = view.group.children
    expect(first.position.toArray()).toEqual([10, 2, 5])
    expect(first.rotation.y).toBe(1)
    expect(bodyColor(first).equals(playerColor(1))).toBe(true)
    expect(bodyColor(first).equals(bodyColor(second))).toBe(false)
    view.update(0.016, [shown(2, -2)])
    expect(view.group.children).toEqual([second])
    expect(second.position.x).toBe(-2)
  })

  it('lleva en la mano lo que dice el snap y lo cambia al cambiar', () => {
    const view = new RemotePlayerView()
    const items = () => {
      let count = 0
      view.group.traverse((o) => (count += o instanceof THREE.Group && o.parent?.parent?.parent === view.group ? 1 : 0))
      return count
    }
    view.update(0.016, [shown(1, 0, { item: 'stone_axe' })])
    expect(items()).toBe(1)
    view.update(0.016, [shown(1, 0, { item: 'wood' })])
    expect(items()).toBe(1)
    view.update(0.016, [shown(1, 0, { item: null })])
    expect(items()).toBe(0)
  })

  it('golpea con su evento y vuelve al reposo; los muertos quedan tumbados', () => {
    const view = new RemotePlayerView()
    view.update(0.016, [shown(1, 0)])
    const model = view.group.children[0]
    const arm = model.children[2]
    const rest = arm.rotation.x
    view.present([{ type: 'playerSwing', id: 1, item: null, target: null }])
    view.update(0.1, [shown(1, 0)])
    expect(arm.rotation.x).not.toBeCloseTo(rest)
    view.update(0.5, [shown(1, 0)])
    expect(arm.rotation.x).toBeCloseTo(rest)
    view.update(0.016, [shown(1, 0, { alive: false })])
    expect(model.rotation.z).toBeCloseTo(Math.PI / 2)
  })
})
