import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { CharacterRig, chooseLocomotion } from './CharacterRig'
import { armorCode, noEquipment } from '../sim/equipment'

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

describe('la armadura en el personaje', () => {
  /** La náufraga en pequeño: sus partes del cuerpo y las piezas de armadura, con su parte de tinte. */
  function castaway() {
    const root = body()
    const tint = new THREE.MeshStandardMaterial({ color: '#7a5230' })
    tint.name = 'Armadura_Peto_Tinte'
    for (const name of ['Naufraga_Pelo', 'Naufraga_Cabeza', 'Naufraga_Torso', 'Naufraga_Piernas', 'Naufraga_Pies', 'Armadura_Casco', 'Armadura_Pantalon', 'Armadura_Botas']) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
      mesh.name = name
      root.add(mesh)
    }
    const chest = new THREE.Group()
    chest.name = 'Armadura_Peto'
    chest.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()), new THREE.Mesh(new THREE.BoxGeometry(), tint))
    root.add(chest)
    return root
  }
  const visible = (rig: CharacterRig, name: string) => rig.object.getObjectByName(name)!.visible

  it('sin armadura se ve el cuerpo entero; cada pieza puesta tapa su parte, y la cabeza siempre se ve', () => {
    const rig = new CharacterRig(castaway(), clips())
    for (const name of ['Naufraga_Pelo', 'Naufraga_Torso', 'Naufraga_Piernas', 'Naufraga_Pies']) expect(visible(rig, name)).toBe(true)
    for (const name of ['Armadura_Casco', 'Armadura_Peto', 'Armadura_Pantalon', 'Armadura_Botas']) expect(visible(rig, name)).toBe(false)
    rig.setArmor(armorCode({ ...noEquipment(), head: 'iron_helmet', legs: 'mithril_leggings' }))
    expect([visible(rig, 'Armadura_Casco'), visible(rig, 'Naufraga_Pelo')]).toEqual([true, false])
    expect([visible(rig, 'Armadura_Pantalon'), visible(rig, 'Naufraga_Piernas')]).toEqual([true, false])
    expect([visible(rig, 'Armadura_Peto'), visible(rig, 'Naufraga_Torso')]).toEqual([false, true])
    expect(visible(rig, 'Naufraga_Cabeza')).toBe(true)
    rig.setArmor(0)
    expect(visible(rig, 'Naufraga_Pelo')).toBe(true)
  })

  it('la parte de tinte va del color de su metal, y dos jugadores comparten el material', () => {
    const a = new CharacterRig(castaway(), clips())
    const b = new CharacterRig(castaway(), clips())
    const tintOf = (rig: CharacterRig) => (rig.object.getObjectByName('Armadura_Peto')!.children[1] as THREE.Mesh).material as THREE.MeshStandardMaterial
    a.setArmor(armorCode({ ...noEquipment(), chest: 'iron_chestplate' }))
    expect(tintOf(a).color.getHexString()).toBe(new THREE.Color('#c3c9d1').getHexString())
    a.setArmor(armorCode({ ...noEquipment(), chest: 'mithril_chestplate' }))
    expect(tintOf(a).color.getHexString()).toBe(new THREE.Color('#8fd0f2').getHexString())
    expect((a.object.getObjectByName('Armadura_Peto')!.children[0] as THREE.Mesh).material).not.toBe(tintOf(a))
    // Cada uno con su modelo, pero el mismo material teñido: no se clona uno por jugador.
    b.setArmor(armorCode({ ...noEquipment(), chest: 'mithril_chestplate' }))
    expect(tintOf(b).color.getHexString()).toBe(tintOf(a).color.getHexString())
  })
})
