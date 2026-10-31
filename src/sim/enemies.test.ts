import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DAY_FRACTION } from './world/daycycle'
import { createPropWorld } from './props'
import { mulberry32 } from './random'
import { heightAt, ROCK_LEVEL, SAND_LEVEL, WATER_LEVEL } from './world/terrain'
import {
  ENEMY_DEFS,
  ENEMY_SPAWN_MAX,
  type EnemyType,
  ENEMY_SPAWN_MIN,
  EYE_HEIGHT,
  PLAYER_RADIUS,
  STEP,
  WADE_DEPTH,
} from './constants'
import { Enemies, enemyAimHeight, enemyCap, spawnChance, spawnType, type EnemyData } from './enemies'
import type { SimEventData } from './events'
import { createCombat, Interaction, type Fighter } from './interaction'
import { attackDamage, hitEfficacy } from './tiers'
import { Inventory, type ItemId } from './inventory'
import { Pickups } from './pickups'

const NIGHT = DAY_FRACTION + 0.1
const DAY = 0.3
const GOBLIN = ENEMY_DEFS.goblin
const CONTACT = PLAYER_RADIUS + GOBLIN.radius

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
    for (let i = 0; i < Math.round(seconds / STEP); i++) {
      for (const d of enemies.step(STEP, [{ id: 0, pos: player, alive: true }], phase, day)) damage += d.damage
    }
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
    expect(dist(e, player)).toBeCloseTo(CONTACT + GOBLIN.gap, 5)
    expect(GOBLIN.gap).toBeLessThan(GOBLIN.reach)
  })

  it('pegado al jugador ataca tras la espera y luego a intervalos fijos', () => {
    enemies.spawnAt(player.x + CONTACT + 0.1, player.z)
    expect(run(0.45)).toBe(0)
    expect(run(0.1)).toBe(GOBLIN.damage)
    expect(run(GOBLIN.attackInterval - 0.1)).toBe(0)
    expect(run(0.1)).toBe(GOBLIN.damage)
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
    expect(dist(e, player)).toBeGreaterThan(CONTACT + GOBLIN.reach)
  })

  it('la primera noche solo hay trasgos; desde la segunda, también gólems y espíritus', () => {
    enemies = new Enemies([world.grid], mulberry32(7))
    run(60, NIGHT, 1)
    expect(new Set(enemies.list.map((e) => e.type))).toEqual(new Set(['goblin']))

    enemies = new Enemies([world.grid], mulberry32(7))
    const seen = new Set<string>()
    for (let i = 0; i < 40; i++) {
      run(5, NIGHT, 5)
      for (const e of enemies.list) seen.add(e.type)
      enemies.reset()
    }
    expect(seen).toEqual(new Set(['goblin', 'golem', 'spirit']))
  })

  it('el gólem sale sobre todo en la montaña y el espíritu en el bosque, y cada noche más hasta su máximo', () => {
    expect(spawnChance('golem', 1, 'mountain')).toBe(0)
    expect(spawnChance('golem', 3, 'mountain')).toBeGreaterThan(spawnChance('golem', 2, 'mountain'))
    expect(spawnChance('golem', 4, 'mountain')).toBe(spawnChance('golem', 40, 'mountain'))
    expect(spawnChance('golem', 9, 'mountain')).toBeGreaterThan(spawnChance('golem', 9, 'forest'))
    expect(spawnChance('spirit', 9, 'forest')).toBeGreaterThan(spawnChance('spirit', 9, 'mountain'))
    expect(spawnChance('goblin', 9, 'forest')).toBe(0)
    // Siempre hay sitio para los trasgos.
    for (const biome of ['beach', 'meadow', 'forest', 'mountain'] as const) {
      expect(spawnChance('golem', 9, biome) + spawnChance('spirit', 9, biome)).toBeLessThan(1)
      expect(spawnType(0.999, 9, biome)).toBe('goblin')
    }
    expect(spawnType(0, 9, 'mountain')).toBe('golem')
    expect(spawnType(0.62, 9, 'mountain')).toBe('spirit')
    expect(spawnType(0, 1, 'mountain')).toBe('goblin')
  })

  it('el gólem nunca se aturde ni retrocede, y el espíritu sí', () => {
    const golem = enemies.spawnAt(player.x + 3, player.z, 'golem')
    enemies.hit(golem, 10, player, 0)
    expect(golem.hp).toBe(ENEMY_DEFS.golem.hp - 10)
    expect(golem).toMatchObject({ stagger: 0, knock: { x: 0, z: 0 } })
    const spirit = enemies.spawnAt(player.x - 3, player.z, 'spirit')
    enemies.hit(spirit, 10, player, 0)
    expect(spirit.stagger).toBe(ENEMY_DEFS.spirit.stagger)
  })

  it('de día no sale ninguno nuevo y los que había siguen persiguiendo y pegando', () => {
    run(30)
    const count = enemies.list.length
    expect(count).toBeGreaterThan(0)
    const e = enemies.list[0]
    const damage = run(30, DAY)
    expect(enemies.list).toHaveLength(count)
    expect(e.alive).toBe(true)
    expect(damage).toBeGreaterThan(0)
  })

  it('los supervivientes cuentan para el tope de la noche siguiente; reiniciar los quita', () => {
    for (let i = 0; i < enemyCap(2); i++) enemies.spawnAt(spot.x + i, spot.z + 20)
    run(20, NIGHT, 2)
    expect(enemies.list).toHaveLength(enemyCap(2))
    enemies.reset()
    expect(enemies.list).toHaveLength(0)
  })

  it('golpeado sin parar sigue atacando: tras aturdirse aguanta un rato', () => {
    const e = enemies.spawnAt(player.x + CONTACT + GOBLIN.gap, player.z)
    let lastAttack = 0
    let longest = 0
    let attacks = 0
    for (let tick = 1; tick <= 600; tick++) {
      if (tick % 15 === 0) enemies.hit(e, 0, player, 0)
      const hits = enemies.step(STEP, [{ id: 0, pos: player, alive: true }], NIGHT, 1)
      if (!hits.length) continue
      attacks++
      longest = Math.max(longest, tick - lastAttack)
      lastAttack = tick
    }
    expect(attacks).toBeGreaterThan(5)
    // Lo peor es un golpe justo antes de que ataque: su intervalo (1,2 s) más el aturdimiento y volver a su alcance.
    expect(longest * STEP).toBeLessThanOrEqual(1.65)
  })

  it.each([0.25, 0.3, 0.4, 0.5, 0.6, 1])('golpeado cada %s s nunca tarda más de 1,65 s en atacar', (every) => {
    const e = enemies.spawnAt(player.x + CONTACT + GOBLIN.gap, player.z)
    const period = Math.round(every / STEP)
    let lastAttack = 0
    let longest = 0
    for (let tick = 1; tick <= 1800; tick++) {
      if (tick % period === 0) enemies.hit(e, 0, player, 0)
      if (!enemies.step(STEP, [{ id: 0, pos: player, alive: true }], NIGHT, 1).length) continue
      if (lastAttack) longest = Math.max(longest, tick - lastAttack)
      lastAttack = tick
    }
    expect(longest * STEP).toBeLessThanOrEqual(1.65)
  })

  it('mientras aguanta, un golpe quita vida pero no lo aturde, no lo empuja ni le retrasa el ataque', () => {
    const e = enemies.spawnAt(player.x + 1.5, player.z)
    enemies.hit(e, 1, player, 0)
    expect(e.stagger).toBe(GOBLIN.stagger)
    expect(e.staggerGuard).toBe(GOBLIN.stagger + GOBLIN.staggerGap)
    run(GOBLIN.stagger + 0.1)
    expect(e.stagger).toBe(0)
    const { attackCooldown } = e
    const hp = e.hp
    const events: SimEventData[] = []
    const watched = new Enemies([world.grid], mulberry32(7), (event) => events.push(event))
    watched.load(enemies.save())
    const same = watched.list[0]
    watched.hit(same, 5, player, 0)
    expect(same.hp).toBe(hp - 5)
    expect(same.stagger).toBe(0)
    expect(same.attackCooldown).toBe(attackCooldown)
    expect(events).toEqual([{ type: 'enemyHit', id: same.id, hp: same.hp, kx: 0, kz: 0, by: 0, efficacy: 'normal' }])
    // Pasado el aguante, otro golpe vuelve a aturdirlo.
    run(GOBLIN.staggerGap)
    enemies.hit(e, 1, player, 0)
    expect(e.stagger).toBe(GOBLIN.stagger)
  })

  it('con `stagger` a 0 nunca se aturde', () => {
    const { stagger } = GOBLIN
    GOBLIN.stagger = 0
    const e = enemies.spawnAt(player.x + 1.5, player.z)
    enemies.hit(e, 1, player, 0)
    GOBLIN.stagger = stagger
    expect(e.stagger).toBe(0)
    expect(e.knock).toEqual({ x: 0, z: 0 })
  })

  it('un golpe los empuja hacia atrás y les quita vida; al llegar a 0 mueren', () => {
    const e = enemies.spawnAt(player.x + 1.5, player.z)
    expect(enemies.hit(e, 20, player, 0)).toBe(false)
    expect(e.hp).toBe(GOBLIN.hp - 20)
    run(0.3)
    expect(dist(e, player)).toBeGreaterThan(1.5)
    expect(enemies.hit(e, GOBLIN.hp, player, 0)).toBe(true)
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
  const setup = (type: EnemyType = 'goblin') => {
    const inventory = new Inventory()
    const enemies = new Enemies([world.grid], mulberry32(7))
    const pickups = new Pickups([world.grid], mulberry32(3))
    const interaction = new Interaction(world, pickups, enemies)
    const enemy = enemies.spawnAt(spot.x + 1.5, spot.z, type)
    const eyeY = heightAt(spot.x, spot.z) + EYE_HEIGHT
    const aimY = heightAt(enemy.pos.x, enemy.pos.z) + enemyAimHeight(type)
    // forward = (-sin(yaw), -cos(yaw)): yaw = -π/2 mira hacia +X.
    const viewer = { pos: { x: spot.x, y: eyeY - EYE_HEIGHT, z: spot.z }, yaw: -Math.PI / 2, pitch: Math.atan2(aimY - eyeY, 1.5) }
    const fighter: Fighter = { id: 0, player: viewer, inventory, combat: createCombat(), target: null }
    interaction.updateTarget(fighter)
    const hold = (seconds: number) => {
      for (let i = 0; i < Math.round(seconds / STEP); i++) {
        interaction.updateTarget(fighter)
        interaction.step(fighter, STEP, true)
      }
    }
    const equip = (item: ItemId) => {
      inventory.add(item, 1)
      inventory.select(inventory.slots.indexOf(item))
    }
    const meat = () => pickups.list.filter((p) => p.item === 'raw_meat')
    return { inventory, enemies, fighter, enemy, hold, equip, meat, pickups }
  }

  it('las herramientas pegan más fuerte que la mano, sea hacha o pico', () => {
    expect(attackDamage(null, 'goblin')).toBe(10)
    expect(attackDamage('wood', 'goblin')).toBe(10)
    expect(attackDamage('wood_axe', 'goblin')).toBe(20)
    expect(attackDamage('wood_pickaxe', 'goblin')).toBe(20)
    expect(attackDamage('stone_axe', 'goblin')).toBe(30)
    expect(attackDamage('stone_pickaxe', 'goblin')).toBe(30)
  })

  it('el raycast apunta al enemigo', () => {
    const { fighter, enemy } = setup()
    expect(fighter.target).toBe(enemy)
  })

  it('con hacha de piedra cae en 3 golpes y suelta carne cruda al suelo', () => {
    const { inventory, enemies, fighter, enemy, hold, equip, meat } = setup()
    const { x, z } = enemy.pos
    equip('stone_axe')
    hold(STEP)
    expect(enemy.hp).toBe(GOBLIN.hp - 30)
    hold(0.8)
    expect(enemy.alive).toBe(false)
    expect(enemies.list).toHaveLength(0)
    expect(inventory.count('raw_meat')).toBe(0)
    expect(meat()).toHaveLength(GOBLIN.loot[0].amount)
    expect(Math.hypot(meat()[0].pos.x - x, meat()[0].pos.z - z)).toBeLessThan(0.01)
    expect(fighter.target).not.toBe(enemy)
  })

  it('a mano hacen falta 7 golpes', () => {
    const { enemy, hold, meat } = setup()
    hold(0.4 * 6 + STEP)
    expect(enemy.hp).toBe(0)
    expect(meat()).toHaveLength(1)
  })

  it.each([
    ['golem', ['iron_ore', 'stone', 'stone', 'stone']],
    ['spirit', ['birch_wood', 'wood', 'wood', 'wood', 'wood']],
  ] as const)('el %s suelta lo suyo al morir', (type, loot) => {
    const { enemy, hold, equip, pickups } = setup(type)
    equip('wood_sword')
    enemy.hp = 1
    hold(STEP)
    expect(pickups.list.map((p) => p.item).sort()).toEqual(loot)
  })

  it('el gólem se rompe con el pico y el espíritu se tala con el hacha, y el golpe dice si fue eficaz', () => {
    expect(attackDamage('stone_pickaxe', 'golem')).toBe(60)
    expect(attackDamage('stone_axe', 'golem')).toBe(15)
    expect(attackDamage('stone_sword', 'golem')).toBe(25)
    expect(attackDamage(null, 'golem')).toBe(5)
    expect(attackDamage('stone_axe', 'spirit')).toBe(60)
    expect(attackDamage('stone_pickaxe', 'spirit')).toBe(15)
    expect(attackDamage('stone_sword', 'spirit')).toBe(25)
    expect(attackDamage(null, 'spirit')).toBe(5)
    expect(hitEfficacy('stone_pickaxe', 'golem')).toBe('effective')
    expect(hitEfficacy('stone_axe', 'golem')).toBe('resisted')
    expect(hitEfficacy('stone_sword', 'golem')).toBe('normal')
  })

  it('al morir suelta todo su botín', () => {
    const { loot } = GOBLIN
    GOBLIN.loot = [{ item: 'raw_meat', amount: 1 }, { item: 'stone', amount: 2 }]
    const { hold, equip, pickups } = setup()
    equip('mithril_axe')
    hold(0.4 + STEP)
    GOBLIN.loot = loot
    expect(pickups.list.map((p) => p.item).sort()).toEqual(['raw_meat', 'stone', 'stone'])
  })
})

// Hasta que haya más tipos, se comprueba cambiando la definición del trasgo: nada debe depender de un valor fijo.
describe('los enemigos salen de ENEMY_DEFS', () => {
  const original = { ...GOBLIN }
  afterEach(() => void Object.assign(GOBLIN, original))

  const player = { ...spot }
  const prey = [{ id: 0, pos: player, alive: true }]

  it('los golpes para matar a un trasgo: la espada necesita alguno más, pero va más deprisa', () => {
    const hits = (item: ItemId | null) => Math.ceil(GOBLIN.hp / attackDamage(item, 'goblin'))
    expect(([null, 'wood_axe', 'stone_axe', 'iron_axe', 'mithril_axe'] as const).map(hits)).toEqual([7, 4, 3, 2, 2])
    expect((['wood_sword', 'stone_sword', 'iron_sword', 'mithril_sword'] as const).map(hits)).toEqual([5, 3, 2, 2])
  })

  it('la debilidad del enemigo multiplica el daño y dice la eficacia', () => {
    GOBLIN.weakness = { pickaxe: 2, axe: 0.5 }
    expect(attackDamage('wood_pickaxe', 'goblin')).toBe(40)
    expect(attackDamage('wood_axe', 'goblin')).toBe(10)
    expect(attackDamage('wood_sword', 'goblin')).toBe(16)
    expect(hitEfficacy('wood_pickaxe', 'goblin')).toBe('effective')
    expect(hitEfficacy('wood_axe', 'goblin')).toBe('resisted')
    expect(hitEfficacy('wood_sword', 'goblin')).toBe('normal')
    expect(hitEfficacy('wood', 'goblin')).toBe('normal')
  })

  it('vida, velocidad, daño y ritmo de ataque son los de su tipo', () => {
    Object.assign(GOBLIN, { hp: 100, speed: 8, damage: 33, attackInterval: 0.5, windup: 0 })
    const enemies = new Enemies([world.grid], mulberry32(7))
    const e = enemies.spawnAt(spot.x + 6, spot.z)
    expect(e).toMatchObject({ type: 'goblin', hp: 100, maxHp: 100 })
    enemies.step(STEP * 30, prey, NIGHT, 1)
    expect(dist(e, player)).toBeCloseTo(6 - 8 * STEP * 30, 5)
    let damage = 0
    for (let i = 0; i < 90; i++) for (const d of enemies.step(STEP, prey, NIGHT, 1)) damage += d.damage
    // Llega en unos 0,3 s y da 3 golpes, uno cada 0,5 s.
    expect(damage).toBe(33 * 3)
  })

  it('el radio cuenta para el jugador y para los demás enemigos', () => {
    GOBLIN.radius = 1.5
    const enemies = new Enemies([world.grid], mulberry32(7))
    const a = enemies.spawnAt(spot.x + 2, spot.z)
    const b = enemies.spawnAt(spot.x, spot.z + 2)
    for (let i = 0; i < 120; i++) enemies.step(STEP, prey, NIGHT, 1)
    expect(dist(a, player)).toBeGreaterThanOrEqual(PLAYER_RADIUS + 1.5 - 1e-6)
    expect(dist(b, player)).toBeGreaterThanOrEqual(PLAYER_RADIUS + 1.5 - 1e-6)
    expect(dist(a, b.pos)).toBeGreaterThanOrEqual(3 - 0.05)
  })

  it('el retroceso y el aturdimiento son los de su tipo', () => {
    Object.assign(GOBLIN, { knockback: 12, stagger: 0.6 })
    const enemies = new Enemies([world.grid], mulberry32(7))
    const e = enemies.spawnAt(spot.x + 2, spot.z)
    enemies.hit(e, 1, player, 0)
    expect(e.knock.x).toBeCloseTo(12)
    expect(e.stagger).toBe(0.6)
  })
})
