import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { Enemies } from '../sim/enemies'
import { DAY_FRACTION } from '../sim/world/daycycle'
import { ENEMY_DEFS, ENEMY_TYPES, STEP } from '../sim/constants'
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
    expect(model().scale.y).toBeCloseTo(ENEMY_DEFS.goblin.scale)
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
    expect(model().scale.y).toBeLessThan(ENEMY_DEFS.goblin.scale)
    frame(0.3)
    expect(view.group.children).toHaveLength(0)
  })

  it('de día siguen ahí', () => {
    const { enemies, view, frame } = setup()
    enemies.spawnAt(10, 20)
    enemies.spawnAt(-10, 20)
    frame()
    enemies.step(STEP, [{ id: 0, pos: { x: 0, z: 0 }, alive: true }], DAY_FRACTION / 2, 1)
    frame(0.5)
    expect(view.group.children).toHaveLength(2)
  })

  it('un golpe que aguanta (sin empujón) no le corta el paso', () => {
    const { enemies, view, frame, model } = setup()
    const e = enemies.spawnAt(10, 20)
    frame()
    view.present([{ type: 'enemyHit', id: e.id, hp: 4, kx: 0, kz: 0, by: 0, efficacy: 'normal' }])
    // Se mueve: bota al andar, porque no se ha aturdido.
    let highest = 0
    for (let i = 1; i <= 12; i++) {
      e.prev.x = e.pos.x
      e.pos.x += 0.1
      frame()
      highest = Math.max(highest, model().position.y)
    }
    expect(highest).toBeGreaterThan(model().position.y - 0.2)
    view.present([{ type: 'enemyHit', id: e.id, hp: 3, kx: 1, kz: 0, by: 0, efficacy: 'normal' }])
    expect(model()).toBeDefined()
  })

  it('cada tipo tiene su modelo, su escala y su color', () => {
    const { enemies, view, frame } = setup()
    for (const [i, type] of ENEMY_TYPES.entries()) enemies.spawnAt(i * 5, 0, type)
    frame()
    const models = view.group.children as THREE.Group[]
    ENEMY_TYPES.forEach((type, i) => expect(models[i].scale.y).toBeCloseTo(ENEMY_DEFS[type].scale))
    const colors = models.map((m) => (m.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>).material.color.getHexString())
    expect(new Set(colors).size).toBe(ENEMY_TYPES.length)
  })

  it('el destello dice si el golpe fue eficaz o resistido', () => {
    const { enemies, view, frame, body } = setup()
    const e = enemies.spawnAt(10, 20)
    frame()
    const flash = (efficacy: 'effective' | 'resisted') => {
      view.present([{ type: 'enemyHit', id: e.id, hp: 4, kx: 0, kz: 0, by: 0, efficacy }])
      frame(0)
      return body().material.emissive.getHexString()
    }
    expect(flash('effective')).toBe('ffc21f')
    expect(flash('resisted')).toBe('8e8e8e')
  })

  it('antes de embestir se agacha y brilla, y embistiendo se inclina', () => {
    const { enemies, view, frame, model, body } = setup()
    const e = enemies.spawnAt(10, 20, 'giant')
    frame()
    const scale = model().scale.y
    view.present([{ type: 'enemyCharge', id: e.id, state: 'crouch' }])
    frame(0)
    expect(model().scale.y).toBeLessThan(scale)
    expect(body().material.emissive.getHexString()).toBe('ff3b2f')
    view.present([{ type: 'enemyCharge', id: e.id, state: 'rush' }])
    frame(0)
    expect(model().rotation.x).toBeGreaterThan(0)
    view.present([{ type: 'enemyCharge', id: e.id, state: 'idle' }])
    frame(0)
    expect(model().rotation.x).toBe(0)
    expect(model().scale.y).toBeCloseTo(scale)
  })

  it('un golpe lo pone rojo un momento', () => {
    const { enemies, view, frame, body } = setup()
    const e = enemies.spawnAt(10, 20)
    frame()
    view.present([{ type: 'enemyHit', id: e.id, hp: 4, kx: 1, kz: 0, by: 0, efficacy: 'normal' }])
    frame(0.05)
    expect(body().material.emissive.equals(HURT)).toBe(true)
    frame(0.2)
    expect(body().material.emissive.equals(HURT)).toBe(false)
  })

  it('todos comparten material, también el del destello', () => {
    const { enemies, view, frame } = setup()
    const a = enemies.spawnAt(10, 20)
    enemies.spawnAt(-10, 20)
    const c = enemies.spawnAt(0, 30)
    frame()
    view.present([{ type: 'enemyHit', id: a.id, hp: 4, kx: 1, kz: 0, by: 0, efficacy: 'normal' }, { type: 'enemyHit', id: c.id, hp: 4, kx: 1, kz: 0, by: 0, efficacy: 'normal' }])
    frame(0.05)
    const materials = view.group.children.map((m) => ((m as THREE.Group).children[0] as THREE.Mesh).material)
    expect(materials[0]).toBe(materials[2])
    expect(materials[1]).not.toBe(materials[0])
    frame(0.2)
    expect(new Set(view.group.children.map((m) => ((m as THREE.Group).children[0] as THREE.Mesh).material)).size).toBe(1)
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
