import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { RemotePlayer } from '../net/client'
import type { Shown } from '../net/interp'
import { playerCss } from '../ui/playerColor'
import { CharacterRig } from './CharacterRig'
import { playerColor, RemotePlayerView } from './RemotePlayerView'

const shown = (id: number, x: number, data: Partial<RemotePlayer> = {}): Shown<RemotePlayer> => ({
  id,
  pose: { x, y: 2, z: 5, yaw: 1, pitch: 0.3 },
  data: { item: null, shield: null, blocking: false, armor: 0, health: 100, alive: true, connection: 'present', ping: 0, ...data },
})

/** Las mallas de un modelo con el color de su cuerpo. */
const bodyColor = (model: THREE.Object3D) => ((model.children[0].children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial).color

const CLIPS = ['Idle', 'Walk', 'Run', 'Run_Back', 'Run_Left', 'Run_Right', 'Sword_Slash', 'Punch_Right', 'Interact', 'HitRecieve', 'Death']

/** Un personaje mínimo, sin malla: basta para ver qué hace la vista con él. */
function rig() {
  const body = new THREE.Group()
  const hand = new THREE.Bone()
  hand.name = 'Middle1R'
  body.add(hand)
  return new CharacterRig(body, CLIPS.map((name) => new THREE.AnimationClip(name, 1, [])))
}

describe('RemotePlayerView con personajes', () => {
  it('pide la skin de cada jugador una vez, y al llegar sustituye a las cajas', async () => {
    const character = rig()
    const load = vi.fn(async () => character)
    const view = new RemotePlayerView(load)
    view.update(0.016, [shown(1, 0)], () => 3)
    view.update(0.016, [shown(1, 0)], () => 3)
    expect(load).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledWith(3)
    const [model] = view.group.children
    expect(model.children[0].visible).toBe(true)
    await Promise.resolve()
    await Promise.resolve()
    expect(model.children[0].visible).toBe(false)
    expect(model.children).toContain(character.object)
  })

  it('si no carga, sigue con las cajas', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const view = new RemotePlayerView(() => Promise.reject(new Error('sin red')))
    view.update(0.016, [shown(1, 0)])
    await new Promise((resolve) => setTimeout(resolve))
    expect(view.group.children[0].children[0].visible).toBe(true)
    warn.mockRestore()
  })

  it('lo que lleva pasa a la mano del personaje', async () => {
    const character = rig()
    const view = new RemotePlayerView(async () => character)
    view.update(0.016, [shown(1, 0, { item: 'stone_axe' })])
    await Promise.resolve()
    await Promise.resolve()
    view.update(0.016, [shown(1, 0, { item: 'stone_axe' })])
    expect(character.hand.children).toHaveLength(1)
    view.update(0.016, [shown(1, 0, { item: null })])
    expect(character.hand.children).toHaveLength(0)
  })

  it('golpear ocupa el torso, y con personaje los muertos no se tumban: caen con su animación', async () => {
    const character = rig()
    const view = new RemotePlayerView(async () => character)
    view.update(0.016, [shown(1, 0)])
    await Promise.resolve()
    await Promise.resolve()
    view.present([{ type: 'playerSwing', id: 1, item: 'stone_sword', target: null }])
    expect(character.busy).toBe(true)
    view.update(0.016, [shown(1, 0, { alive: false })])
    expect(view.group.children[0].rotation.z).toBe(0)
  })

  it('recibir un golpe no corta lo que esté haciendo', async () => {
    const character = rig()
    const act = vi.spyOn(character, 'act')
    const view = new RemotePlayerView(async () => character)
    view.update(0.016, [shown(1, 0)])
    await Promise.resolve()
    await Promise.resolve()
    view.present([{ type: 'playerHurt', id: 1, dmg: 10 }])
    expect(act).toHaveBeenLastCalledWith('HitRecieve', expect.any(Number))
    view.present([{ type: 'playerSwing', id: 1, item: null, target: null }])
    expect(act).toHaveBeenLastCalledWith('Punch_Right', expect.any(Number))
    view.present([{ type: 'playerHurt', id: 1, dmg: 10 }])
    expect(act).toHaveBeenLastCalledWith('Punch_Right', expect.any(Number))
  })
})

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

  it('el color del avatar es el mismo que el del HUD', () => {
    for (const id of [0, 1, 2, 7]) {
      const css = new THREE.Color(playerCss(id))
      expect(css.getHex()).toBe(playerColor(id).getHex())
    }
  })

  it('lleva en la mano lo que dice el snap y lo cambia al cambiar', () => {
    const view = new RemotePlayerView()
    const items = () => {
      let count = 0
      view.group.traverse((o) => (count += o instanceof THREE.Group && o.parent?.parent?.parent?.parent === view.group ? 1 : 0))
      return count
    }
    view.update(0.016, [shown(1, 0, { item: 'stone_axe' })])
    expect(items()).toBe(1)
    view.update(0.016, [shown(1, 0, { item: 'wood' })])
    expect(items()).toBe(1)
    view.update(0.016, [shown(1, 0, { item: null })])
    expect(items()).toBe(0)
  })

  it('el escudo cuelga a su izquierda, delante al bloquear, y no se ve si no lleva o está muerto', () => {
    const view = new RemotePlayerView()
    const shieldOf = () => view.group.children[0].children[1]
    view.update(0.016, [shown(1, 0, { shield: 'iron_shield' })])
    const shield = shieldOf()
    expect(shield).toBeDefined()
    expect(shield.position.x).toBeLessThan(0)
    const lowered = shield.position.z
    view.update(0.016, [shown(1, 0, { shield: 'iron_shield', blocking: true })])
    expect(shieldOf()).toBe(shield)
    expect(shield.position.z).toBeLessThan(lowered)
    view.update(0.016, [shown(1, 0, { shield: 'iron_shield', alive: false })])
    expect(shieldOf()).toBeUndefined()
    view.update(0.016, [shown(1, 0, { shield: 'wood_shield' })])
    expect(shieldOf()).toBeDefined()
    view.update(0.016, [shown(1, 0)])
    expect(shieldOf()).toBeUndefined()
  })

  it('golpea con su evento y vuelve al reposo; los muertos quedan tumbados', () => {
    const view = new RemotePlayerView()
    view.update(0.016, [shown(1, 0)])
    const model = view.group.children[0]
    const arm = model.children[0].children[2]
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
