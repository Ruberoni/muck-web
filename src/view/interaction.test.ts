import * as THREE from 'three'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPropWorld, growBerries, type PropData } from '../sim/props'
import { PropView, type PropInstance } from './PropView'
import { heightAt } from '../sim/world/terrain'
import { BERRIES_PER_BUSH, BERRY_REGROW, EYE_HEIGHT, HIT_COOLDOWN, STEP } from '../sim/constants'
import type { SimEventData } from '../sim/events'
import { aimPose, createCombat, Interaction, type Fighter } from '../sim/interaction'
import { Inventory, type ItemId } from '../sim/inventory'
import { Pickups } from '../sim/pickups'

function setup() {
  const world = createPropWorld()
  const view = new PropView(world.placements)
  const inventory = new Inventory()
  const pickups = new Pickups([world.grid], () => 0.5)
  /** Todo lo emitido, en orden. */
  const events: SimEventData[] = []
  // La vista recibe cada evento al momento, como si se presentara al final de cada paso.
  const emit = (e: SimEventData) => {
    events.push(e)
    view.present([e])
  }
  const interaction = new Interaction(world, pickups, undefined, emit)
  // Desde dónde y hacia dónde mira el jugador.
  const viewer = { pos: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0 }
  const fighter: Fighter = { id: 0, player: viewer, inventory, combat: createCombat(), target: null }

  const aimAt = (prop: PropData) => {
    const isFree = (x: number, z: number) =>
      world.props.every((o) => o === prop || !o.alive || Math.hypot(o.x - x, o.z - z) > o.radius + 0.4)
    const pose = aimPose(prop, isFree)
    const y = heightAt(pose.x, pose.z)
    Object.assign(viewer, { pos: { x: pose.x, y, z: pose.z }, yaw: pose.yaw, pitch: Math.atan2(pose.aimY - y - EYE_HEIGHT, pose.horizontal) })
    interaction.updateTarget(fighter)
  }
  const hold = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds / STEP); i++) {
      interaction.updateTarget(fighter)
      step(true)
    }
  }
  /** Un paso fijo: rebrote y golpe, en el orden de Game. */
  const step = (attack: boolean) => {
    growBerries(world.props, STEP, emit)
    return interaction.step(fighter, STEP, attack)
  }
  /** Piezas de `item` en el suelo. */
  const onGround = (item: ItemId) => pickups.list.filter((p) => p.item === item).length
  const reset = () => {
    interaction.reset()
    fighter.combat = createCombat()
    fighter.target = null
    view.reset()
  }
  /** Pone `item` en la mano. */
  const equip = (item: ItemId) => {
    inventory.add(item, 1)
    inventory.select(inventory.slots.indexOf(item))
  }
  return { world, view, inventory, pickups, events, interaction, viewer, fighter, aimAt, hold, step, onGround, reset, equip }
}

describe('recolección', () => {
  let ctx: ReturnType<typeof setup>
  beforeEach(() => {
    ctx = setup()
  })

  const firstOf = (kind: PropData['kind']) => ctx.world.props.find((p) => p.kind === kind)!

  it('apunta al prop y mantener el ataque 1,2 s da exactamente 3 golpes y la madera cae al suelo', () => {
    const tree = firstOf('tree')
    ctx.aimAt(tree)
    expect(ctx.fighter.target).toBe(tree)
    ctx.hold(1.2)
    expect(tree.alive).toBe(false)
    expect(tree.hp).toBe(0)
    expect(ctx.onGround('wood')).toBe(4)
    expect(ctx.inventory.count('wood')).toBe(0)
  })

  it('step devuelve cada golpe y marca el que suelta algo', () => {
    const tree = firstOf('tree')
    ctx.aimAt(tree)
    const hits: { kind: string; dropped: boolean }[] = []
    for (let i = 0; i < Math.round(1.2 / STEP); i++) {
      ctx.interaction.updateTarget(ctx.fighter)
      const hit = ctx.interaction.step(ctx.fighter, STEP, true)
      if (hit) hits.push({ kind: hit.target?.kind ?? 'aire', dropped: hit.dropped })
    }
    expect(hits).toEqual([
      { kind: 'tree', dropped: false },
      { kind: 'tree', dropped: false },
      { kind: 'tree', dropped: true },
    ])
  })

  it('sin objetivo también golpea al aire y espera el cooldown', () => {
    ctx.fighter.target = null
    expect(ctx.interaction.step(ctx.fighter, STEP, true)).toEqual({ target: null, dropped: false })
    expect(ctx.interaction.step(ctx.fighter, STEP, true)).toBeNull()
    const tree = firstOf('tree')
    ctx.aimAt(tree)
    ctx.interaction.step(ctx.fighter, STEP, true)
    expect(tree.hp).toBe(tree.maxHp)
    ctx.hold(HIT_COOLDOWN)
    expect(tree.hp).toBe(tree.maxHp - 1)
  })

  it('con pico de madera una roca necesita 2 golpes y da piedra', () => {
    ctx.equip('wood_pickaxe')
    const rock = firstOf('rock')
    ctx.aimAt(rock)
    expect(ctx.fighter.target).toBe(rock)
    ctx.hold(0.4)
    expect(rock.hp).toBe(2)
    expect(rock.alive).toBe(true)
    ctx.hold(0.4)
    expect(rock.alive).toBe(false)
    expect(ctx.onGround('stone')).toBe(3)
  })

  it('tras destruirlo el raycast ya no lo selecciona', () => {
    const tree = firstOf('tree')
    ctx.aimAt(tree)
    ctx.hold(1.2)
    ctx.interaction.updateTarget(ctx.fighter)
    expect(ctx.fighter.target).not.toBe(tree)
  })

  it('un wobble activo no revive un prop destruido', () => {
    const tree = firstOf('tree')
    ctx.aimAt(tree)
    ctx.hold(0.81) // 3 golpes: el último llega con el wobble del segundo aún activo
    expect(tree.alive).toBe(false)
    ctx.view.update(0.05)
    ctx.view.update(0.2)
    const m = new THREE.Matrix4()
    for (const { mesh, index } of ctx.view.instancesOf(tree.id)) {
      mesh.getMatrixAt(index, m)
      expect(new THREE.Vector3().setFromMatrixScale(m).length()).toBe(0)
    }
  })

  it('el wobble termina restaurando la matriz base en tronco y copa', () => {
    const tree = firstOf('tree')
    ctx.aimAt(tree)
    ctx.hold(STEP)
    ctx.view.update(0.05)
    const m = new THREE.Matrix4()
    const [trunk, foliage] = ctx.view.instancesOf(tree.id)
    trunk.mesh.getMatrixAt(trunk.index, m)
    expect(m.equals(trunk.base)).toBe(false)
    ctx.view.update(0.2)
    for (const { mesh, index, base } of ctx.view.instancesOf(tree.id)) {
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
    for (let i = 0; i < Math.round(seconds / STEP); i++) ctx.step(false)
  }
  const isHidden = ({ mesh, index }: PropInstance) => {
    const m = new THREE.Matrix4()
    mesh.getMatrixAt(index, m)
    return new THREE.Vector3().setFromMatrixScale(m).length() === 0
  }
  const visibleBerries = (bush: PropData) => ctx.view.instancesOf(bush.id).filter((i) => i.berry !== undefined && !isHidden(i)).length

  it('cada arbusto tiene una baya visible por punto de vida', () => {
    const bush = firstBush()
    expect(bush.maxHp).toBe(BERRIES_PER_BUSH)
    expect(ctx.view.instancesOf(bush.id).filter((i) => i.berry !== undefined)).toHaveLength(BERRIES_PER_BUSH)
    expect(visibleBerries(bush)).toBe(BERRIES_PER_BUSH)
  })

  it('cada clic quita una baya y da una; el arbusto se queda', () => {
    const bush = firstBush()
    ctx.aimAt(bush)
    expect(ctx.fighter.target).toBe(bush)
    ctx.hold(STEP)
    expect(ctx.inventory.count('berry')).toBe(1)
    expect(ctx.pickups.list).toHaveLength(0)
    expect(bush.hp).toBe(BERRIES_PER_BUSH - 1)
    expect(visibleBerries(bush)).toBe(BERRIES_PER_BUSH - 1)
    expect(bush.alive).toBe(true)
    expect(isHidden(ctx.view.instancesOf(bush.id)[0])).toBe(false)
  })

  it('con la hotbar llena la baya se queda en el arbusto', () => {
    const bush = firstBush()
    ctx.aimAt(bush)
    vi.spyOn(ctx.inventory, 'canAdd').mockReturnValue(false)
    expect(ctx.interaction.step(ctx.fighter, STEP, true)).toEqual({ target: bush, dropped: false })
    expect(bush.hp).toBe(BERRIES_PER_BUSH)
    expect(visibleBerries(bush)).toBe(BERRIES_PER_BUSH)
    expect(ctx.inventory.count('berry')).toBe(0)
  })

  it('vaciado sigue en pie y apuntable, y más clics no dan nada', () => {
    const bush = firstBush()
    ctx.aimAt(bush)
    ctx.hold(HIT_COOLDOWN * (BERRIES_PER_BUSH + 2))
    expect(ctx.inventory.count('berry')).toBe(BERRIES_PER_BUSH)
    expect(bush.hp).toBe(0)
    expect(bush.alive).toBe(true)
    expect(visibleBerries(bush)).toBe(0)
    expect(ctx.fighter.target).toBe(bush)
  })

  it('el wobble no vuelve a mostrar las bayas recogidas', () => {
    const bush = firstBush()
    ctx.aimAt(bush)
    ctx.hold(STEP)
    ctx.view.update(0.05)
    expect(visibleBerries(bush)).toBe(BERRIES_PER_BUSH - 1)
    ctx.view.update(0.2)
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
    for (const { mesh, index, base } of ctx.view.instancesOf(bush.id)) {
      mesh.getMatrixAt(index, m)
      expect(m.equals(base)).toBe(true)
    }
  })

  it('árboles y rocas no vuelven a crecer solos', () => {
    const tree = ctx.world.props.find((p) => p.kind === 'tree')!
    const rock = ctx.world.props.find((p) => p.kind === 'rock')!
    ctx.aimAt(tree)
    ctx.hold(1.2)
    ctx.equip('wood_pickaxe')
    ctx.aimAt(rock)
    ctx.hold(0.8)
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
    ctx.equip('wood_pickaxe')
    ctx.aimAt(rock)
    ctx.hold(STEP)
    ctx.aimAt(bush)
    ctx.hold(STEP)
    expect(rock.hp).toBe(rock.maxHp - 2)

    ctx.reset()
    for (const prop of [tree, rock, bush]) {
      expect(prop.alive).toBe(true)
      expect(prop.hp).toBe(prop.maxHp)
      expect(ctx.view.instancesOf(prop.id).some(isHidden)).toBe(false)
    }
    expect(ctx.fighter.target).toBe(null)
  })

  it('tras reset no queda ningún rebrote antiguo pendiente', () => {
    const bush = firstBush()
    ctx.aimAt(bush)
    ctx.hold(STEP)
    wait(BERRY_REGROW / 2)
    ctx.reset()
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
  const equip = (item: ItemId) => ctx.equip(item)

  it.each([null, 'wood', 'wood_axe', 'stone_axe'] as const)('con %s la roca no pierde vida: el golpe se da, pero sin propHit', (item) => {
    if (item) equip(item)
    const rock = firstOf('rock')
    ctx.aimAt(rock)
    ctx.hold(1.6)
    expect(rock.hp).toBe(rock.maxHp)
    expect(rock.alive).toBe(true)
    expect(ctx.onGround('stone')).toBe(0)
    const swings = ctx.events.filter((e) => e.type === 'playerSwing')
    expect(swings).toHaveLength(4)
    expect(swings.every((e) => e.type === 'playerSwing' && e.item === item && e.target?.id === rock.id)).toBe(true)
    expect(ctx.events.some((e) => e.type === 'propHit' || e.type === 'propDestroyed')).toBe(false)
  })

  it('con hacha de madera un árbol cae en 2 golpes', () => {
    equip('wood_axe')
    const tree = firstOf('tree')
    ctx.aimAt(tree)
    ctx.hold(STEP)
    expect(tree.hp).toBe(1)
    ctx.hold(0.4)
    expect(tree.alive).toBe(false)
    expect(ctx.onGround('wood')).toBe(4)
  })

  it('con pico de piedra una roca cae de un golpe y la vida no baja de 0', () => {
    equip('stone_pickaxe')
    const rock = firstOf('rock')
    ctx.aimAt(rock)
    ctx.hold(STEP)
    expect(rock.alive).toBe(false)
    expect(rock.hp).toBe(0)
    expect(ctx.onGround('stone')).toBe(3)
  })

  it('el pico no ayuda contra los árboles', () => {
    equip('stone_pickaxe')
    const tree = firstOf('tree')
    ctx.aimAt(tree)
    ctx.hold(STEP)
    expect(tree.hp).toBe(2)
  })

  it('el pico de piedra pica la mena de hierro en 3 golpes y da mineral; el de madera no le hace nada', () => {
    const ore = firstOf('iron_ore')
    equip('wood_pickaxe')
    ctx.aimAt(ore)
    ctx.hold(STEP)
    expect(ore.hp).toBe(ore.maxHp)
    expect(ctx.events.some((e) => e.type === 'propHit')).toBe(false)
    ctx.reset()
    equip('stone_pickaxe')
    ctx.aimAt(ore)
    ctx.hold(STEP + HIT_COOLDOWN * 2)
    expect(ore.alive).toBe(false)
    expect(ctx.onGround('iron_ore')).toBe(3)
  })

  it('el abedul solo cae con hacha de piedra o mejor, y da madera de abedul', () => {
    const birch = firstOf('birch')
    equip('wood_axe')
    ctx.aimAt(birch)
    ctx.hold(STEP)
    expect(birch.hp).toBe(birch.maxHp)
    expect(ctx.events.some((e) => e.type === 'propHit')).toBe(false)
    ctx.reset()
    equip('stone_axe')
    ctx.aimAt(birch)
    ctx.hold(STEP + HIT_COOLDOWN * 2)
    expect(birch.alive).toBe(false)
    expect(ctx.onGround('birch_wood')).toBe(4)
  })

  it('la mena de mithril pide pico de hierro (3 golpes) y da 4 minerales; el pico de mithril la pica en 2', () => {
    const ore = firstOf('mithril_ore')
    equip('stone_pickaxe')
    ctx.aimAt(ore)
    ctx.hold(STEP)
    expect(ore.hp).toBe(ore.maxHp)
    expect(ctx.events.some((e) => e.type === 'propHit')).toBe(false)
    ctx.reset()
    equip('iron_pickaxe')
    ctx.aimAt(ore)
    ctx.hold(STEP + HIT_COOLDOWN * 2)
    expect(ore.alive).toBe(false)
    expect(ctx.onGround('mithril_ore')).toBe(4)
    ctx.reset()
    const other = ctx.world.props.find((p) => p.kind === 'mithril_ore' && p.alive)!
    equip('mithril_pickaxe')
    ctx.aimAt(other)
    ctx.hold(STEP + HIT_COOLDOWN)
    expect(other.alive).toBe(false)
  })

  it('el pino oscuro solo cae con hacha de hierro (3 golpes) o de mithril (2), y da madera oscura', () => {
    const pine = firstOf('darkpine')
    equip('stone_axe')
    ctx.aimAt(pine)
    ctx.hold(STEP)
    expect(pine.hp).toBe(pine.maxHp)
    expect(ctx.events.some((e) => e.type === 'propHit')).toBe(false)
    ctx.reset()
    equip('iron_axe')
    ctx.aimAt(pine)
    ctx.hold(STEP + HIT_COOLDOWN * 2)
    expect(pine.alive).toBe(false)
    expect(ctx.onGround('dark_wood')).toBe(4)
    ctx.reset()
    const other = ctx.world.props.find((p) => p.kind === 'darkpine' && p.alive)!
    equip('mithril_axe')
    ctx.aimAt(other)
    ctx.hold(STEP + HIT_COOLDOWN)
    expect(other.alive).toBe(false)
  })
})
