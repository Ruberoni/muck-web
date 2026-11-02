import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { CharacterRig, chooseLocomotion } from './CharacterRig'

const NAMES = ['Idle', 'Walk', 'Run', 'Run_Back', 'Run_Left', 'Run_Right', 'Sword_Slash', 'Punch_Right', 'Interact', 'HitRecieve', 'Death']

/** Un esqueleto mínimo con los huesos que se usan. */
function body() {
  const root = new THREE.Group()
  const names = ['Hips', 'Abdomen', 'Chest', 'Head', 'Middle1R']
  let parent: THREE.Object3D = root
  for (const name of names) {
    const bone = new THREE.Bone()
    bone.name = name
    parent.add(bone)
    parent = bone
  }
  const leg = new THREE.Bone()
  leg.name = 'UpperLegL'
  root.children[0].add(leg)
  return root
}

/** Una animación que deja cada hueso en un giro propio, para saber cuál manda. */
function clip(name: string, angle: number) {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle).toArray()
  return new THREE.AnimationClip(name, 1, [
    new THREE.QuaternionKeyframeTrack('Chest.quaternion', [0, 1], [...q, ...q]),
    new THREE.QuaternionKeyframeTrack('UpperLegL.quaternion', [0, 1], [...q, ...q]),
  ])
}

const clips = () => NAMES.map((name, i) => clip(name, 0.1 * (i + 1)))
const angleOf = (rig: CharacterRig, name: string) => 2 * Math.acos(Math.min(1, Math.abs(rig.object.getObjectByName(name)!.quaternion.w)))
const run = (rig: CharacterRig, seconds: number, forward = 0, side = 0, alive = true) => {
  for (let i = 0; i < seconds * 60; i++) rig.update(1 / 60, forward, side, 0, alive)
}

describe('CharacterRig', () => {
  it('elige la animación por cómo se mueve', () => {
    expect(chooseLocomotion(0, 0)).toBe('Idle')
    expect(chooseLocomotion(2, 0)).toBe('Walk')
    expect(chooseLocomotion(6, 0)).toBe('Run')
    expect(chooseLocomotion(-6, 0)).toBe('Run_Back')
    expect(chooseLocomotion(1, 6)).toBe('Run_Right')
    expect(chooseLocomotion(1, -6)).toBe('Run_Left')
  })

  it('quieta usa el reposo, y al correr pasa a correr', () => {
    const rig = new CharacterRig(body(), clips())
    run(rig, 0.5)
    expect(angleOf(rig, 'UpperLegL')).toBeCloseTo(0.1, 2)
    run(rig, 1, 6)
    expect(angleOf(rig, 'UpperLegL')).toBeCloseTo(0.3, 2)
  })

  it('una acción mueve el torso y deja las piernas, y al acabar el torso vuelve', () => {
    const rig = new CharacterRig(body(), clips())
    run(rig, 0.5, 6)
    rig.act('Sword_Slash', 0.4)
    expect(rig.busy).toBe(true)
    run(rig, 0.3, 6)
    expect(angleOf(rig, 'Chest')).toBeCloseTo(0.7, 1)
    expect(angleOf(rig, 'UpperLegL')).toBeCloseTo(0.3, 2)
    run(rig, 0.6, 6)
    expect(rig.busy).toBe(false)
    expect(angleOf(rig, 'Chest')).toBeCloseTo(0.3, 2)
  })

  it('muere una vez y al volver se levanta', () => {
    const rig = new CharacterRig(body(), clips())
    run(rig, 0.5)
    run(rig, 1.5, 0, 0, false)
    expect(angleOf(rig, 'UpperLegL')).toBeCloseTo(1.1, 2)
    run(rig, 0.5)
    expect(angleOf(rig, 'UpperLegL')).toBeCloseTo(0.1, 2)
  })

  it('la mirada no se acumula aunque la animación no cambie', () => {
    const rig = new CharacterRig(body(), clips())
    const head = rig.object.getObjectByName('Head')!
    for (let i = 0; i < 5; i++) rig.update(1 / 60, 0, 0, 0.5, true)
    const once = head.quaternion.clone()
    for (let i = 0; i < 60; i++) rig.update(1 / 60, 0, 0, 0.5, true)
    expect(head.quaternion.angleTo(once)).toBeLessThan(1e-6)
    rig.update(1 / 60, 0, 0, 0, true)
    expect(head.quaternion.angleTo(once)).toBeGreaterThan(0.1)
  })

  it('lo que lleva en la mano va con su hueso', () => {
    const rig = new CharacterRig(body(), clips())
    expect(rig.hand.parent?.name).toBe('Middle1R')
  })

  it('mira a −Z, como los demás avatares', () => {
    const inner = body()
    const rig = new CharacterRig(inner, clips())
    expect(rig.object.children).toContain(inner)
    expect(inner.rotation.y).toBeCloseTo(Math.PI)
  })
})
