import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { Enemies } from '../sim/enemies'
import { DAY_FRACTION } from '../sim/world/daycycle'
import { ENEMY_MODEL_SCALE } from '../sim/aim'
import { STEP } from '../sim/constants'
import { EnemyView } from './EnemyView'

const HURT = new THREE.Color('#ff3b2f')

function setup() {
  const enemies = new Enemies([])
  const view = new EnemyView()
  const frame = (dt = STEP, alpha = 1) => view.update(dt, enemies.list, alpha)
  const model = () => view.group.children[0] as THREE.Group
  const body = () => model().children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
  return { enemies, view, frame, model, body }
}

describe('EnemyView', () => {
  it('crea un modelo por enemigo, en su posición y mirando a donde mira', () => {
    const { enemies, view, frame, model } = setup()
    const e = enemies.spawnAt(10, 20)
    e.yaw = 1
    frame()
    expect(view.group.children).toHaveLength(1)
    expect(model().position.x).toBeCloseTo(10)
    expect(model().position.z).toBeCloseTo(20)
    expect(model().rotation.y).toBe(1)
    expect(model().scale.y).toBeCloseTo(ENEMY_MODEL_SCALE)
  })

  it('interpola entre el paso anterior y el actual', () => {
    const { enemies, frame, model } = setup()
    const e = enemies.spawnAt(10, 20)
    e.pos.x = 11
    frame(0, 0.25)
    expect(model().position.x).toBeCloseTo(10.25)
  })

  it('al salir de la lista se desvanece encogiéndose y luego desaparece', () => {
    const { enemies, view, frame, model } = setup()
    const e = enemies.spawnAt(10, 20)
    frame()
    enemies.hit(e, 100, { x: 0, z: 20 }, 0)
    frame(0.1)
    expect(view.group.children).toHaveLength(1)
    expect(model().scale.y).toBeLessThan(ENEMY_MODEL_SCALE)
    frame(0.3)
    expect(view.group.children).toHaveLength(0)
  })

  it('al amanecer se desvanecen todos', () => {
    const { enemies, view, frame } = setup()
    enemies.spawnAt(10, 20)
    enemies.spawnAt(-10, 20)
    frame()
    enemies.step(STEP, { x: 0, z: 0 }, DAY_FRACTION / 2, 1)
    frame(0.5)
    expect(view.group.children).toHaveLength(0)
  })

  it('un golpe lo pone rojo un momento', () => {
    const { enemies, view, frame, body } = setup()
    const e = enemies.spawnAt(10, 20)
    frame()
    view.present([{ type: 'enemyHit', id: e.id, hp: 4, kx: 1, kz: 0, by: 0 }])
    frame(0.05)
    expect(body().material.emissive.equals(HURT)).toBe(true)
    frame(0.2)
    expect(body().material.emissive.equals(HURT)).toBe(false)
  })

  it('al atacar se lanza hacia delante y vuelve', () => {
    const { enemies, view, frame, model } = setup()
    const e = enemies.spawnAt(10, 20)
    frame()
    view.present([{ type: 'enemyAttack', id: e.id, target: 0 }])
    frame(0.1)
    // yaw 0: mira hacia +Z.
    expect(model().position.z).toBeGreaterThan(20.2)
    frame(0.2)
    expect(model().position.z).toBeCloseTo(20)
  })

  it('bota al andar, pero no quieto', () => {
    const { enemies, frame, model } = setup()
    const e = enemies.spawnAt(10, 20)
    frame()
    const ground = model().position.y
    for (let i = 0; i < 5; i++) frame()
    expect(model().position.y).toBe(ground)
    let bobbed = false
    for (let i = 0; i < 10; i++) {
      e.prev.x = e.pos.x
      e.pos.x += 0.08
      frame()
      bobbed ||= model().position.y > ground + 0.01
    }
    expect(bobbed).toBe(true)
  })

  it('reset quita los modelos sin desvanecerlos', () => {
    const { enemies, view, frame } = setup()
    enemies.spawnAt(10, 20)
    frame()
    enemies.reset()
    view.reset()
    expect(view.group.children).toHaveLength(0)
  })
})
