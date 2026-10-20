import { beforeEach, describe, expect, it } from 'vitest'
import { DAY_FRACTION } from './world/daycycle'
import { createPropWorld } from './props'
import { mulberry32 } from './random'
import { heightAt, ROCK_LEVEL, SAND_LEVEL, WATER_LEVEL } from './world/terrain'
import {
  ENEMY_ATTACK_INTERVAL,
  ENEMY_DAMAGE,
  ENEMY_DEF,
  ENEMY_GAP,
  ENEMY_RADIUS,
  ENEMY_REACH,
  ENEMY_SPAWN_MAX,
  ENEMY_SPAWN_MIN,
  EYE_HEIGHT,
  PLAYER_RADIUS,
  STEP,
  WADE_DEPTH,
} from './constants'
import { ENEMY_AIM_HEIGHT, Enemies, enemyCap, type EnemyData } from './enemies'
import { hitDamage, Interaction } from './interaction'
import { Inventory, type ItemId } from './inventory'
import { Pickups } from './pickups'

const NIGHT = DAY_FRACTION + 0.1
const DAY = 0.3
const CONTACT = PLAYER_RADIUS + ENEMY_RADIUS

const world = createPropWorld()

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
const dist = (e: EnemyData, p: { x: number; z: number }) => Math.hypot(e.pos.x - p.x, e.pos.z - p.z)

describe('enemigos nocturnos', () => {
  let enemies: Enemies
  let player: { x: number; z: number }
  beforeEach(() => {
    enemies = new Enemies([world.grid], mulberry32(7))
    player = { ...spot }
  })

  /** Simula `seconds` y devuelve el daño total al jugador. */
  const run = (seconds: number, phase = NIGHT, day = 1) => {
    let damage = 0
    for (let i = 0; i < Math.round(seconds / STEP); i++) damage += enemies.step(STEP, player, phase, day)
    return damage
  }

  it('cada noche caben más a la vez, hasta un máximo', () => {
    expect(enemyCap(1)).toBe(3)
    expect(enemyCap(2)).toBe(5)
    expect(enemyCap(100)).toBe(12)
  })

  it('de día no aparece ninguno', () => {
    run(60, DAY)
    expect(enemies.list).toHaveLength(0)
  })

  it('al anochecer aparecen en tierra, lejos del jugador, sin pasar del máximo', () => {
    run(STEP)
    expect(enemies.list).toHaveLength(1)
    const [first] = enemies.list
    const d = dist(first, player)
    expect(d).toBeGreaterThanOrEqual(ENEMY_SPAWN_MIN - 0.5)
    expect(d).toBeLessThanOrEqual(ENEMY_SPAWN_MAX + 0.5)
    expect(heightAt(first.pos.x, first.pos.z)).toBeGreaterThan(WATER_LEVEL)
    run(60)
    expect(enemies.list).toHaveLength(enemyCap(1))
  })

  it('persiguen al jugador hasta tenerlo a su alcance, dejando un hueco', () => {
    const e = enemies.spawnAt(player.x + 5, player.z)
    run(0.5)
    expect(dist(e, player)).toBeLessThan(5 - 2)
    run(1.5)
    expect(dist(e, player)).toBeCloseTo(CONTACT + ENEMY_GAP, 5)
    expect(ENEMY_GAP).toBeLessThan(ENEMY_REACH)
  })

  it('pegado al jugador ataca tras la espera y luego a intervalos fijos', () => {
    enemies.spawnAt(player.x + CONTACT + 0.1, player.z)
    expect(run(0.45)).toBe(0)
    expect(run(0.1)).toBe(ENEMY_DAMAGE)
    expect(run(ENEMY_ATTACK_INTERVAL - 0.1)).toBe(0)
    expect(run(0.1)).toBe(ENEMY_DAMAGE)
  })

  it('no entran en agua profunda: quien nada lejos de la orilla está a salvo', () => {
    // Desde el hueco libre hacia fuera hasta pasar 4 m de agua profunda.
    const dir = { x: spot.x / Math.hypot(spot.x, spot.z), z: spot.z / Math.hypot(spot.x, spot.z) }
    let shore = 0
    let r = 0
    for (; r < 200; r += 0.25) {
      const h = heightAt(spot.x + dir.x * r, spot.z + dir.z * r)
      if (h >= WATER_LEVEL - WADE_DEPTH) shore = r
      else if (r - shore > 4) break
    }
    expect(r).toBeLessThan(200)
    player = { x: spot.x + dir.x * r, z: spot.z + dir.z * r }
    const e = enemies.spawnAt(spot.x + dir.x * (shore - 6), spot.z + dir.z * (shore - 6))
    expect(run(10)).toBe(0)
    expect(heightAt(e.pos.x, e.pos.z)).toBeGreaterThanOrEqual(WATER_LEVEL - WADE_DEPTH)
    // Llegó hasta la orilla, pero no hasta el jugador.
    expect(dist(e, player)).toBeLessThan(6)
    expect(dist(e, player)).toBeGreaterThan(CONTACT + ENEMY_REACH)
  })

  it('al amanecer desaparecen', () => {
    run(30)
    expect(enemies.list.length).toBeGreaterThan(0)
    const e = enemies.list[0]
    run(STEP, DAY)
    expect(enemies.list).toHaveLength(0)
    expect(e.alive).toBe(false)
  })

  it('un golpe los empuja hacia atrás y les quita vida; al llegar a 0 mueren', () => {
    const e = enemies.spawnAt(player.x + 1.5, player.z)
    expect(enemies.hit(e, 2, player, 0)).toBe(false)
    expect(e.hp).toBe(ENEMY_DEF.hp - 2)
    run(0.3)
    expect(dist(e, player)).toBeGreaterThan(1.5)
    expect(enemies.hit(e, 10, player, 0)).toBe(true)
    expect(e.hp).toBe(0)
    expect(enemies.list).not.toContain(e)
  })

  it('reset los quita todos', () => {
    run(30)
    enemies.reset()
    expect(enemies.list).toHaveLength(0)
    // La siguiente aparición es inmediata al anochecer.
    run(STEP)
    expect(enemies.list).toHaveLength(1)
  })
})

describe('combate', () => {
  const setup = () => {
    const inventory = new Inventory()
    const enemies = new Enemies([world.grid], mulberry32(7))
    const pickups = new Pickups([world.grid], mulberry32(3))
    const interaction = new Interaction(world, inventory, pickups, enemies)
    const enemy = enemies.spawnAt(spot.x + 1.5, spot.z)
    const eyeY = heightAt(spot.x, spot.z) + EYE_HEIGHT
    const aimY = heightAt(enemy.pos.x, enemy.pos.z) + ENEMY_AIM_HEIGHT
    // forward = (-sin(yaw), -cos(yaw)): yaw = -π/2 mira hacia +X.
    const viewer = { pos: { x: spot.x, y: eyeY - EYE_HEIGHT, z: spot.z }, yaw: -Math.PI / 2, pitch: Math.atan2(aimY - eyeY, 1.5) }
    interaction.updateTarget(viewer)
    const hold = (seconds: number) => {
      for (let i = 0; i < Math.round(seconds / STEP); i++) {
        interaction.updateTarget(viewer)
        interaction.step(STEP, true)
      }
    }
    const equip = (item: ItemId) => {
      inventory.add(item, 1)
      inventory.select(inventory.slots.indexOf(item))
    }
    const meat = () => pickups.list.filter((p) => p.item === 'raw_meat')
    return { inventory, enemies, interaction, enemy, hold, equip, meat }
  }

  it('las herramientas pegan más fuerte que la mano, sea hacha o pico', () => {
    expect(hitDamage(null, 'enemy')).toBe(1)
    expect(hitDamage('wood', 'enemy')).toBe(1)
    expect(hitDamage('wood_axe', 'enemy')).toBe(2)
    expect(hitDamage('wood_pickaxe', 'enemy')).toBe(2)
    expect(hitDamage('stone_axe', 'enemy')).toBe(3)
    expect(hitDamage('stone_pickaxe', 'enemy')).toBe(3)
  })

  it('el raycast apunta al enemigo', () => {
    const { interaction, enemy } = setup()
    expect(interaction.target).toBe(enemy)
  })

  it('con hacha de piedra cae en 2 golpes y suelta carne cruda al suelo', () => {
    const { inventory, enemies, interaction, enemy, hold, equip, meat } = setup()
    const { x, z } = enemy.pos
    equip('stone_axe')
    hold(STEP)
    expect(enemy.hp).toBe(ENEMY_DEF.hp - 3)
    hold(0.4)
    expect(enemy.alive).toBe(false)
    expect(enemies.list).toHaveLength(0)
    expect(inventory.count('raw_meat')).toBe(0)
    expect(meat()).toHaveLength(ENEMY_DEF.drop.amount)
    expect(Math.hypot(meat()[0].pos.x - x, meat()[0].pos.z - z)).toBeLessThan(0.01)
    expect(interaction.target).not.toBe(enemy)
  })

  it('a mano hacen falta 6 golpes', () => {
    const { enemy, hold, meat } = setup()
    hold(0.4 * 5 + STEP)
    expect(enemy.hp).toBe(0)
    expect(meat()).toHaveLength(1)
  })
})
