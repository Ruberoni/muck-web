import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { EventLog, type SimEventData } from '../sim/events'
import { DAY_FRACTION } from '../sim/world/daycycle'
import { createPropWorld, type PropData } from '../sim/props'
import { PropView } from '../view/PropView'
import { mulberry32 } from '../sim/random'
import { heightAt, ROCK_LEVEL, SAND_LEVEL } from '../sim/world/terrain'
import { BERRY_REGROW, ENEMY_RADIUS, EYE_HEIGHT, HIT_COOLDOWN, PICKUP_DELAY, PLAYER_RADIUS, STEP } from '../sim/constants'
import { Enemies } from './enemies'
import { aimPose, Interaction } from './interaction'
import { Inventory } from '../sim/inventory'
import { Pickups } from './pickups'

const NIGHT = DAY_FRACTION + 0.1
const DAY = 0.3

const world = createPropWorld()
const view = new PropView(world.placements)

/** Primer punto de hierba, en espiral desde el centro, sin props en `clearance` metros. */
function clearSpot(clearance: number) {
  for (let i = 0; i < 4000; i++) {
    const angle = i * 0.5
    const r = angle * 0.4
    const x = Math.cos(angle) * r
    const z = Math.sin(angle) * r
    const h = heightAt(x, z)
    if (h < SAND_LEVEL + 0.3 || h > ROCK_LEVEL) continue
    if (world.props.every((p) => Math.hypot(p.x - x, p.z - z) - p.radius > clearance)) return { x, z }
  }
  throw new Error('sin hueco libre')
}

const spot = clearSpot(8)

/** Tipos de los eventos, sin los que no interesan en cada prueba. */
const types = (events: SimEventData[], ignore: string[] = []) => events.map((e) => e.type).filter((t) => !ignore.includes(t))

function setup() {
  const events: SimEventData[] = []
  const emit = (e: SimEventData) => void events.push(e)
  const inventory = new Inventory()
  const enemies = new Enemies([world.grid], mulberry32(7), emit)
  const pickups = new Pickups([world.grid], mulberry32(3), emit)
  const interaction = new Interaction(world, view, inventory, pickups, enemies, emit)
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 600)
  camera.rotation.order = 'YXZ'
  const aimAt = (prop: PropData) => {
    const isFree = (x: number, z: number) => world.props.every((o) => o === prop || !o.alive || Math.hypot(o.x - x, o.z - z) > o.radius + 0.4)
    const pose = aimPose(prop, isFree)
    const eyeY = heightAt(pose.x, pose.z) + EYE_HEIGHT
    camera.position.set(pose.x, eyeY, pose.z)
    camera.rotation.set(Math.atan2(pose.aimY - eyeY, pose.horizontal), pose.yaw, 0)
    camera.updateMatrixWorld()
    interaction.updateTarget(camera)
  }
  const hold = (seconds: number, attack = true) => {
    for (let i = 0; i < Math.round(seconds / STEP); i++) {
      interaction.updateTarget(camera)
      interaction.step(STEP, attack)
    }
  }
  return { events, inventory, enemies, pickups, interaction, aimAt, hold }
}

describe('eventos de la simulación', () => {
  it('golpear un árbol hasta romperlo: golpe, vida restante, rotura y la madera que cae', () => {
    const ctx = setup()
    const tree = world.props.find((p) => p.kind === 'tree' && p.alive)!
    ctx.aimAt(tree)
    ctx.hold(1.2)
    const target = { kind: 'prop', id: tree.id }
    expect(ctx.events.slice(0, 6)).toEqual([
      { type: 'playerSwing', id: 0, item: null, target },
      { type: 'propHit', id: tree.id, hp: 2, by: 0 },
      { type: 'playerSwing', id: 0, item: null, target },
      { type: 'propHit', id: tree.id, hp: 1, by: 0 },
      { type: 'playerSwing', id: 0, item: null, target },
      { type: 'propDestroyed', id: tree.id, by: 0 },
    ])
    expect(types(ctx.events.slice(6))).toEqual(['pickupSpawn', 'pickupSpawn', 'pickupSpawn', 'pickupSpawn'])
    expect(ctx.events[6]).toMatchObject({ item: 'wood', amount: 1 })
    // Golpes al aire después de romperlo.
    ctx.events.length = 0
    ctx.hold(HIT_COOLDOWN)
    expect(ctx.events).toEqual([{ type: 'playerSwing', id: 0, item: null, target: null }])
  })

  it('las bayas: cogerla y que vuelva a crecer', () => {
    const ctx = setup()
    const bush = world.props.find((p) => p.kind === 'bush')!
    ctx.aimAt(bush)
    ctx.hold(STEP)
    expect(ctx.events).toEqual([
      { type: 'playerSwing', id: 0, item: null, target: { kind: 'prop', id: bush.id } },
      { type: 'berryTaken', id: bush.id, hp: bush.maxHp - 1, by: 0 },
    ])
    ctx.events.length = 0
    ctx.hold(BERRY_REGROW, false)
    expect(ctx.events).toEqual([{ type: 'berryGrew', id: bush.id, hp: bush.maxHp }])
  })

  it('recoger del suelo emite una recogida por pieza', () => {
    const ctx = setup()
    const y = heightAt(spot.x, spot.z)
    ctx.pickups.drop('stone', 2, spot.x, y + 1, spot.z)
    const away = { x: spot.x + 100, y: 0, z: spot.z }
    for (let i = 0; i < Math.round((PICKUP_DELAY + 0.5) / STEP); i++) ctx.pickups.step(STEP, away, ctx.inventory)
    const ids = ctx.pickups.list.map((p) => p.id)
    ctx.events.length = 0
    for (const p of [...ctx.pickups.list]) ctx.pickups.step(STEP, { ...p.pos }, ctx.inventory)
    expect(ctx.events).toEqual(ids.map((id) => ({ type: 'pickupCollected', id, by: 0 })))
  })

  it('enemigos: aparecen, atacan, reciben golpes, mueren y se desvanecen al amanecer', () => {
    const ctx = setup()
    const player = { ...spot }
    const run = (seconds: number, phase = NIGHT) => {
      for (let i = 0; i < Math.round(seconds / STEP); i++) ctx.enemies.step(STEP, player, phase, 1)
    }
    run(STEP)
    // Aparece y en el mismo paso ya da el primer paso: `prev` es donde apareció.
    const { x, z } = ctx.enemies.list[0].prev
    expect(ctx.events).toEqual([{ type: 'enemySpawn', id: 0, x, z }])

    const e = ctx.enemies.spawnAt(player.x + PLAYER_RADIUS + ENEMY_RADIUS + 0.1, player.z)
    ctx.events.length = 0
    run(0.6)
    expect(ctx.events).toContainEqual({ type: 'enemyAttack', id: e.id, target: 0 })

    ctx.events.length = 0
    ctx.enemies.hit(e, 2, player, 3)
    expect(ctx.events).toEqual([{ type: 'enemyHit', id: e.id, hp: e.hp, kx: e.knock.x, kz: e.knock.z, by: 3 }])
    expect(e.knock.x).toBeGreaterThan(0)
    ctx.events.length = 0
    ctx.enemies.hit(e, 100, player, 3)
    expect(ctx.events).toEqual([{ type: 'enemyDied', id: e.id, by: 3 }])

    ctx.events.length = 0
    run(STEP, DAY)
    expect(ctx.events).toEqual([{ type: 'enemiesDespawn' }])
    run(1, DAY)
    expect(types(ctx.events)).toEqual(['enemiesDespawn'])
  })

  it('el registro sella cada evento con el tick en curso y se vacía al leerlo', () => {
    const log = new EventLog()
    log.tick = 5
    log.emit({ type: 'playerAte', id: 0 })
    log.tick = 6
    log.emit({ type: 'enemiesDespawn' })
    expect(log.drain()).toEqual([
      { type: 'playerAte', id: 0, tick: 5 },
      { type: 'enemiesDespawn', tick: 6 },
    ])
    expect(log.drain()).toEqual([])
  })
})
