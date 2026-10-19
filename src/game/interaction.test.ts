import * as THREE from 'three'
import { beforeEach, describe, expect, it } from 'vitest'
import { createProps, type PropData } from '../world/props'
import { heightAt } from '../world/terrain'
import { EYE_HEIGHT, PROP_DEFS, STEP } from './constants'
import { aimPose, Interaction } from './interaction'
import { Inventory } from './inventory'

function setup() {
  const world = createProps()
  const inventory = new Inventory()
  const interaction = new Interaction(world, inventory)
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 600)
  camera.rotation.order = 'YXZ'

  const aimAt = (prop: PropData) => {
    const isFree = (x: number, z: number) =>
      world.props.every((o) => o === prop || !o.alive || Math.hypot(o.x - x, o.z - z) > o.radius + 0.4)
    const pose = aimPose(prop, isFree)
    const eyeY = heightAt(pose.x, pose.z) + EYE_HEIGHT
    camera.position.set(pose.x, eyeY, pose.z)
    camera.rotation.set(Math.atan2(pose.aimY - eyeY, pose.horizontal), pose.yaw, 0)
    camera.updateMatrixWorld()
    interaction.updateTarget(camera)
  }
  const hold = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds / STEP); i++) {
      interaction.updateTarget(camera)
      interaction.step(STEP, true)
    }
  }
  return { world, inventory, interaction, camera, aimAt, hold }
}

describe('recolección', () => {
  let ctx: ReturnType<typeof setup>
  beforeEach(() => {
    ctx = setup()
  })

  const firstOf = (kind: PropData['kind']) => ctx.world.props.find((p) => p.kind === kind)!

  it('apunta al prop y mantener el ataque 1,2 s da exactamente 3 golpes', () => {
    const tree = firstOf('tree')
    ctx.aimAt(tree)
    expect(ctx.interaction.target).toBe(tree)
    ctx.hold(1.2)
    expect(tree.alive).toBe(false)
    expect(tree.hp).toBe(0)
    expect(ctx.inventory.count('wood')).toBe(4)
  })

  it('una roca necesita 4 golpes y da piedra', () => {
    const rock = firstOf('rock')
    ctx.aimAt(rock)
    expect(ctx.interaction.target).toBe(rock)
    ctx.hold(1.2)
    expect(rock.hp).toBe(1)
    expect(rock.alive).toBe(true)
    ctx.hold(0.4)
    expect(rock.alive).toBe(false)
    expect(ctx.inventory.count('stone')).toBe(3)
  })

  it('tras destruirlo el raycast ya no lo selecciona', () => {
    const tree = firstOf('tree')
    ctx.aimAt(tree)
    ctx.hold(1.2)
    ctx.interaction.updateTarget(ctx.camera)
    expect(ctx.interaction.target).not.toBe(tree)
  })

  it('un wobble activo no revive un prop destruido', () => {
    const tree = firstOf('tree')
    ctx.aimAt(tree)
    ctx.hold(0.81) // 3 golpes: el último llega con el wobble del segundo aún activo
    expect(tree.alive).toBe(false)
    ctx.interaction.updateAnimations(0.05)
    ctx.interaction.updateAnimations(0.2)
    const m = new THREE.Matrix4()
    for (const { mesh, index } of tree.instances) {
      mesh.getMatrixAt(index, m)
      expect(new THREE.Vector3().setFromMatrixScale(m).length()).toBe(0)
    }
  })

  it('el wobble termina restaurando la matriz base en tronco y copa', () => {
    const tree = firstOf('tree')
    ctx.aimAt(tree)
    ctx.hold(STEP)
    ctx.interaction.updateAnimations(0.05)
    const m = new THREE.Matrix4()
    const [trunk, foliage] = tree.instances
    trunk.mesh.getMatrixAt(trunk.index, m)
    expect(m.equals(trunk.base)).toBe(false)
    ctx.interaction.updateAnimations(0.2)
    for (const { mesh, index, base } of tree.instances) {
      mesh.getMatrixAt(index, m)
      expect(m.equals(base)).toBe(true)
    }
    expect(foliage.base.equals(trunk.base)).toBe(true)
  })
})

describe('bayas y reaparición', () => {
  let ctx: ReturnType<typeof setup>
  beforeEach(() => {
    ctx = setup()
  })

  const firstBush = () => ctx.world.props.find((p) => p.kind === 'bush')!
  const wait = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds / STEP); i++) ctx.interaction.step(STEP, false)
  }
  const isHidden = (prop: PropData) => {
    const m = new THREE.Matrix4()
    return prop.instances.every(({ mesh, index }) => {
      mesh.getMatrixAt(index, m)
      return new THREE.Vector3().setFromMatrixScale(m).length() === 0
    })
  }

  it('un clic en un arbusto da bayas y lo oculta', () => {
    const bush = firstBush()
    ctx.aimAt(bush)
    expect(ctx.interaction.target).toBe(bush)
    ctx.hold(STEP)
    expect(bush.alive).toBe(false)
    expect(isHidden(bush)).toBe(true)
    expect(ctx.inventory.count('berry')).toBe(PROP_DEFS.bush.drop.amount)
  })

  it('el arbusto vuelve a crecer pasado su tiempo, y no antes', () => {
    const bush = firstBush()
    const regrow = PROP_DEFS.bush.regrow!
    ctx.aimAt(bush)
    ctx.hold(STEP)
    wait(regrow - 1)
    expect(bush.alive).toBe(false)
    wait(1)
    expect(bush.alive).toBe(true)
    expect(bush.hp).toBe(bush.maxHp)
    const m = new THREE.Matrix4()
    for (const { mesh, index, base } of bush.instances) {
      mesh.getMatrixAt(index, m)
      expect(m.equals(base)).toBe(true)
    }
    ctx.interaction.updateTarget(ctx.camera)
    expect(ctx.interaction.target).toBe(bush)
  })

  it('árboles y rocas no vuelven a crecer solos', () => {
    const tree = ctx.world.props.find((p) => p.kind === 'tree')!
    ctx.aimAt(tree)
    ctx.hold(1.2)
    wait(PROP_DEFS.bush.regrow! * 2)
    expect(tree.alive).toBe(false)
  })

  it('reset restaura props destruidos y dañados y cancela las reapariciones', () => {
    const tree = ctx.world.props.find((p) => p.kind === 'tree')!
    const rock = ctx.world.props.find((p) => p.kind === 'rock')!
    const bush = firstBush()
    ctx.aimAt(tree)
    ctx.hold(1.2)
    ctx.aimAt(rock)
    ctx.hold(STEP)
    ctx.aimAt(bush)
    ctx.hold(STEP)
    expect(rock.hp).toBe(rock.maxHp - 1)

    ctx.interaction.reset()
    for (const prop of [tree, rock, bush]) {
      expect(prop.alive).toBe(true)
      expect(prop.hp).toBe(prop.maxHp)
      expect(isHidden(prop)).toBe(false)
    }
    expect(ctx.interaction.target).toBe(null)
  })

  it('tras reset no queda ninguna reaparición antigua pendiente', () => {
    const bush = firstBush()
    const regrow = PROP_DEFS.bush.regrow!
    ctx.aimAt(bush)
    ctx.hold(STEP)
    wait(regrow / 2)
    ctx.interaction.reset()
    ctx.aimAt(bush)
    ctx.hold(STEP)
    // El temporizador antiguo habría vencido aquí; el nuevo aún no.
    wait(regrow / 2 + 1)
    expect(bush.alive).toBe(false)
  })
})
