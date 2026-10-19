import * as THREE from 'three'
import { beforeEach, describe, expect, it } from 'vitest'
import { createProps, type PropData, type PropInstance } from '../world/props'
import { heightAt } from '../world/terrain'
import { BERRIES_PER_BUSH, BERRY_REGROW, EYE_HEIGHT, HIT_COOLDOWN, STEP } from './constants'
import { aimPose, hitDamage, Interaction } from './interaction'
import { Inventory, type ItemId } from './inventory'

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

describe('bayas', () => {
  let ctx: ReturnType<typeof setup>
  beforeEach(() => {
    ctx = setup()
  })

  const firstBush = () => ctx.world.props.find((p) => p.kind === 'bush')!
  const wait = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds / STEP); i++) ctx.interaction.step(STEP, false)
  }
  const isHidden = ({ mesh, index }: PropInstance) => {
    const m = new THREE.Matrix4()
    mesh.getMatrixAt(index, m)
    return new THREE.Vector3().setFromMatrixScale(m).length() === 0
  }
  const visibleBerries = (bush: PropData) => bush.instances.filter((i) => i.berry !== undefined && !isHidden(i)).length

  it('cada arbusto tiene una baya visible por punto de vida', () => {
    const bush = firstBush()
    expect(bush.maxHp).toBe(BERRIES_PER_BUSH)
    expect(bush.instances.filter((i) => i.berry !== undefined)).toHaveLength(BERRIES_PER_BUSH)
    expect(visibleBerries(bush)).toBe(BERRIES_PER_BUSH)
  })

  it('cada clic quita una baya y da una; el arbusto se queda', () => {
    const bush = firstBush()
    ctx.aimAt(bush)
    expect(ctx.interaction.target).toBe(bush)
    ctx.hold(STEP)
    expect(ctx.inventory.count('berry')).toBe(1)
    expect(bush.hp).toBe(BERRIES_PER_BUSH - 1)
    expect(visibleBerries(bush)).toBe(BERRIES_PER_BUSH - 1)
    expect(bush.alive).toBe(true)
    expect(isHidden(bush.instances[0])).toBe(false)
  })

  it('vaciado sigue en pie y apuntable, y más clics no dan nada', () => {
    const bush = firstBush()
    ctx.aimAt(bush)
    ctx.hold(HIT_COOLDOWN * (BERRIES_PER_BUSH + 2))
    expect(ctx.inventory.count('berry')).toBe(BERRIES_PER_BUSH)
    expect(bush.hp).toBe(0)
    expect(bush.alive).toBe(true)
    expect(visibleBerries(bush)).toBe(0)
    expect(ctx.interaction.target).toBe(bush)
  })

  it('el wobble no vuelve a mostrar las bayas recogidas', () => {
    const bush = firstBush()
    ctx.aimAt(bush)
    ctx.hold(STEP)
    ctx.interaction.updateAnimations(0.05)
    expect(visibleBerries(bush)).toBe(BERRIES_PER_BUSH - 1)
    ctx.interaction.updateAnimations(0.2)
    expect(visibleBerries(bush)).toBe(BERRIES_PER_BUSH - 1)
  })

  it('las bayas vuelven de una en una y el arbusto vacío se llena en 6 rebrotes', () => {
    const bush = firstBush()
    ctx.aimAt(bush)
    ctx.hold(HIT_COOLDOWN * BERRIES_PER_BUSH)
    expect(bush.hp).toBe(0)
    // El primer rebrote cuenta desde la primera baya recogida.
    wait(BERRY_REGROW - HIT_COOLDOWN * BERRIES_PER_BUSH - 0.1)
    expect(bush.hp).toBe(0)
    wait(0.2)
    expect(bush.hp).toBe(1)
    expect(visibleBerries(bush)).toBe(1)
    wait(BERRY_REGROW)
    expect(bush.hp).toBe(2)
    wait(BERRY_REGROW * BERRIES_PER_BUSH)
    expect(bush.hp).toBe(BERRIES_PER_BUSH)
    const m = new THREE.Matrix4()
    for (const { mesh, index, base } of bush.instances) {
      mesh.getMatrixAt(index, m)
      expect(m.equals(base)).toBe(true)
    }
  })

  it('árboles y rocas no vuelven a crecer solos', () => {
    const tree = ctx.world.props.find((p) => p.kind === 'tree')!
    const rock = ctx.world.props.find((p) => p.kind === 'rock')!
    ctx.aimAt(tree)
    ctx.hold(1.2)
    ctx.aimAt(rock)
    ctx.hold(1.6)
    wait(BERRY_REGROW * BERRIES_PER_BUSH * 2)
    expect(tree.alive).toBe(false)
    expect(rock.alive).toBe(false)
  })

  it('reset restaura props destruidos y dañados y cancela los rebrotes', () => {
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
      expect(prop.instances.some(isHidden)).toBe(false)
    }
    expect(ctx.interaction.target).toBe(null)
  })

  it('tras reset no queda ningún rebrote antiguo pendiente', () => {
    const bush = firstBush()
    ctx.aimAt(bush)
    ctx.hold(STEP)
    wait(BERRY_REGROW / 2)
    ctx.interaction.reset()
    ctx.aimAt(bush)
    ctx.hold(STEP)
    // El temporizador antiguo habría vencido aquí; el nuevo aún no.
    wait(BERRY_REGROW / 2 + 1)
    expect(bush.hp).toBe(BERRIES_PER_BUSH - 1)
  })
})

describe('herramientas', () => {
  let ctx: ReturnType<typeof setup>
  beforeEach(() => {
    ctx = setup()
  })

  const firstOf = (kind: PropData['kind']) => ctx.world.props.find((p) => p.kind === kind)!
  const equip = (item: ItemId) => {
    ctx.inventory.add(item, 1)
    ctx.inventory.select(ctx.inventory.slots.indexOf(item))
  }

  it('cada herramienta multiplica el daño solo contra su tipo de prop', () => {
    expect(hitDamage(null, 'tree')).toBe(1)
    expect(hitDamage('wood', 'tree')).toBe(1)
    expect(hitDamage('wood_axe', 'tree')).toBe(2)
    expect(hitDamage('stone_axe', 'tree')).toBe(4)
    expect(hitDamage('stone_axe', 'rock')).toBe(1)
    expect(hitDamage('wood_pickaxe', 'rock')).toBe(2)
    expect(hitDamage('stone_pickaxe', 'rock')).toBe(4)
    expect(hitDamage('stone_pickaxe', 'tree')).toBe(1)
  })

  it('con hacha de madera un árbol cae en 2 golpes', () => {
    equip('wood_axe')
    const tree = firstOf('tree')
    ctx.aimAt(tree)
    ctx.hold(STEP)
    expect(tree.hp).toBe(1)
    ctx.hold(0.4)
    expect(tree.alive).toBe(false)
    expect(ctx.inventory.count('wood')).toBe(4)
  })

  it('con pico de piedra una roca cae de un golpe y la vida no baja de 0', () => {
    equip('stone_pickaxe')
    const rock = firstOf('rock')
    ctx.aimAt(rock)
    ctx.hold(STEP)
    expect(rock.alive).toBe(false)
    expect(rock.hp).toBe(0)
    expect(ctx.inventory.count('stone')).toBe(3)
  })

  it('el pico no ayuda contra los árboles', () => {
    equip('stone_pickaxe')
    const tree = firstOf('tree')
    ctx.aimAt(tree)
    ctx.hold(STEP)
    expect(tree.hp).toBe(2)
  })
})
