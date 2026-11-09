import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DAY_FRACTION } from './world/daycycle'
import { SpatialGrid, type Collider } from './collision'
import { createPropWorld } from './props'
import { mulberry32 } from './random'
import { DAY_LENGTH } from './world/daycycle'
import { heightAt, ROCK_LEVEL, SAND_LEVEL, WATER_LEVEL } from './world/terrain'
import {
  ENEMY_DEFS,
  ENEMY_SPAWN_MAX,
  type EnemyType,
  BOSS_SPAWN_MAX,
  BOSS_SPAWN_MIN,
  ENEMY_SPAWN_MIN,
  EYE_HEIGHT,
  PLAYER_RADIUS,
  SPAWN_WARN,
  STEP,
  WADE_DEPTH,
  WALK_SPEED,
  WATER_SPEED_FACTOR,
} from './constants'
import { bossOfNight, bossScale, Enemies, enemyAimHeight, enemyCap, ENEMY_SWIM_MAX, spawnChance, spawnType, type EnemyData } from './enemies'
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

const spot = clearSpot(7)
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

  it('se anuncian con humo y salen SPAWN_WARN segundos después, donde se anunciaron', () => {
    const events: SimEventData[] = []
    enemies = new Enemies([world.grid], mulberry32(7), (e) => events.push(e))
    run(STEP)
    expect(enemies.list).toHaveLength(0)
    const incoming = events.find((e) => e.type === 'enemyIncoming')
    expect(incoming).toBeDefined()
    run(SPAWN_WARN - 2 * STEP)
    expect(enemies.list).toHaveLength(0)
    run(2 * STEP)
    expect(enemies.list).toHaveLength(1)
    if (incoming?.type !== 'enemyIncoming') throw new Error('sin aviso')
    // En el mismo paso ya da el primero: `prev` es donde apareció.
    expect(enemies.list[0].prev).toEqual({ x: incoming.x, z: incoming.z })
    // Lo anunciado cuenta para el tope y sobrevive a guardar y cargar.
    run(4.9)
    const saved = enemies.save()
    const copy = new Enemies([world.grid], mulberry32(7))
    copy.load(saved)
    expect(copy.save()).toEqual(saved)
  })

  it('con el faro encendido no aparece ninguno', () => {
    enemies.calm = true
    run(60)
    expect(enemies.list).toHaveLength(0)
    enemies.calm = false
    run(SPAWN_WARN + STEP)
    expect(enemies.list).toHaveLength(1)
  })

  it('desde la noche 2 salen perros, sobre todo en la pradera, y en manada', () => {
    expect(spawnChance('dog', 1, 'meadow')).toBe(0)
    expect(spawnChance('dog', 4, 'meadow')).toBeGreaterThan(spawnChance('dog', 4, 'mountain'))
    // En la pradera, tras el gólem (0,1) y el espíritu (0,15) vienen los perros (0,25).
    expect(spawnType(0.3, 4, 'meadow')).toBe('dog')
    const events: SimEventData[] = []
    enemies = new Enemies([world.grid], mulberry32(3), (e) => events.push(e))
    enemies['queueSpawn']({ id: 0, pos: player, alive: true }, [{ id: 0, pos: player, alive: true }], () => 'dog', 10)
    const dogs = events.filter((e) => e.type === 'enemyIncoming' && e.enemy === 'dog')
    expect(dogs.length).toBeGreaterThanOrEqual(2)
    // Sin sitio hasta el tope, solo uno.
    events.length = 0
    enemies['queueSpawn']({ id: 0, pos: player, alive: true }, [{ id: 0, pos: player, alive: true }], () => 'dog', 1)
    expect(events.filter((e) => e.type === 'enemyIncoming')).toHaveLength(1)
  })

  it('de día no aparece ninguno', () => {
    run(60, DAY)
    expect(enemies.list).toHaveLength(0)
  })

  it('al anochecer aparecen en tierra, lejos del jugador, sin pasar del máximo', () => {
    run(SPAWN_WARN + STEP)
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

  it('nadan: en el agua van más despacio que el jugador, pero quien se queda en ella no está a salvo', () => {
    // Desde el hueco libre hacia fuera hasta pasar 4 m de agua donde ya no se hace pie.
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
    let fastest = 0
    let damage = 0
    for (let i = 0; i < Math.round(10 / STEP); i++) {
      const before = { ...e.pos }
      for (const d of enemies.step(STEP, [{ id: 0, pos: player, alive: true }], NIGHT, 1)) damage += d.damage
      if (heightAt(before.x, before.z) < WATER_LEVEL - WADE_DEPTH && dist(e, player) > CONTACT + 0.5) fastest = Math.max(fastest, Math.hypot(e.pos.x - before.x, e.pos.z - before.z) / STEP)
    }
    expect(damage).toBeGreaterThan(0)
    expect(fastest).toBeGreaterThan(0)
    expect(fastest).toBeLessThanOrEqual(ENEMY_SWIM_MAX + 1e-6)
    expect(ENEMY_SWIM_MAX).toBeLessThan(WALK_SPEED * WATER_SPEED_FACTOR)
  })

  it('la primera noche solo hay trasgos; desde la segunda, también gólems, espíritus y perros', () => {
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
    expect(seen).toEqual(new Set(['goblin', 'golem', 'spirit', 'dog']))
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
    // La siguiente aparición se anuncia al momento y sale SPAWN_WARN segundos después.
    run(SPAWN_WARN + STEP)
    expect(enemies.list).toHaveLength(1)
  })
})

describe('jefes', () => {
  const GIANT = ENEMY_DEFS.giant
  const BOSS_PHASE = DAY_FRACTION + 21 / DAY_LENGTH
  const DUSK = DAY_FRACTION + 1 / DAY_LENGTH
  let enemies: Enemies
  let player: { x: number; z: number }
  beforeEach(() => {
    enemies = new Enemies([world.grid], mulberry32(7))
    player = { ...spot }
  })
  const prey = () => [{ id: 0, pos: player, alive: true }]
  const step = (phase: number, day: number) => enemies.step(STEP, prey(), phase, day)
  const bosses = () => enemies.list.filter((e) => ENEMY_DEFS[e.type].boss)

  it('se turnan: el trasgo gigante en las noches 3, 9 y 15, y el lanzarrocas en la 6 y la 12', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 15].map(bossOfNight)).toEqual([null, null, 'giant', null, null, 'thrower', null, null, 'giant', 'thrower', 'giant'])
  })

  it('el lanzarrocas sale igual que el gigante', () => {
    for (let i = 0; i < 60; i++) step(BOSS_PHASE, 6)
    expect(bosses().map((e) => e.type)).toEqual(['thrower'])
    expect(dist(bosses()[0], player)).toBeGreaterThanOrEqual(25)
  })

  it('sale una vez, a los 20 s de anochecer y a 38–50 m, sin contar para el tope', () => {
    step(DUSK, 3)
    expect(bosses()).toHaveLength(0)
    // Se mide nada más salir: luego camina hacia el jugador.
    for (let i = 0; i < 60 && !bosses().length; i++) step(BOSS_PHASE, 3)
    expect(bosses()).toHaveLength(1)
    const [boss] = bosses()
    const distance = Math.hypot(boss.prev.x - player.x, boss.prev.z - player.z)
    expect(distance).toBeGreaterThanOrEqual(BOSS_SPAWN_MIN - 0.5)
    expect(distance).toBeLessThanOrEqual(BOSS_SPAWN_MAX + 0.5)
    for (let i = 0; i < Math.round((SPAWN_WARN + 0.5) / STEP); i++) step(BOSS_PHASE, 3)
    expect(bosses()).toHaveLength(1)
    expect(enemies.list.filter((e) => e.type === 'goblin').length).toBeGreaterThan(0)
    // Muerto no vuelve a salir esa noche, ni al recargar la partida.
    enemies.hit(boss, boss.hp, player, 0)
    const reloaded = new Enemies([world.grid], mulberry32(7))
    reloaded.load(enemies.save())
    for (let i = 0; i < 30; i++) reloaded.step(STEP, prey(), BOSS_PHASE, 3)
    expect(reloaded.list.filter((e) => ENEMY_DEFS[e.type].boss)).toHaveLength(0)
  })

  it('no cuenta para el tope de enemigos', () => {
    // Falta uno para el tope, sin contar al jefe: tiene que salir.
    for (let i = 0; i < enemyCap(2) - 1; i++) enemies.spawnAt(spot.x + 30 + i, spot.z)
    enemies.spawnAt(spot.x, spot.z + 30, 'giant')
    for (let i = 0; i < 600; i++) step(BOSS_PHASE, 2)
    expect(enemies.list.filter((e) => !ENEMY_DEFS[e.type].boss)).toHaveLength(enemyCap(2))
  })

  it('no desaparece al amanecer, y si sigue vivo no sale otro', () => {
    for (let i = 0; i < 2; i++) step(BOSS_PHASE, 3)
    const [boss] = bosses()
    for (let i = 0; i < 60; i++) step(0.3, 4)
    expect(bosses()).toEqual([boss])
    for (let i = 0; i < 60; i++) step(BOSS_PHASE, 9)
    expect(bosses()).toEqual([boss])
  })

  it('vida y botín crecen con los jugadores', () => {
    expect(bossScale(1)).toBe(1)
    expect(bossScale(3)).toBe(3)
    expect(enemies.spawnAt(0, 0, 'giant').maxHp).toBe(GIANT.hp)
    const crowd = enemies.spawnAt(5, 0, 'giant', 3)
    expect(crowd).toMatchObject({ hp: GIANT.hp * 3, maxHp: GIANT.hp * 3, lootScale: 2 })
    expect(enemies.spawnAt(9, 0, 'goblin', 3).maxHp).toBe(GOBLIN.hp)
  })

  describe('embestida', () => {
    /** Un gigante quieto a `distance` metros de un jugador que se mantiene donde está. */
    const facing = (distance: number) => {
      const boss = enemies.spawnAt(player.x + distance, player.z, 'giant')
      const charge = () => {
        let damage = 0
        for (let i = 0; i < 120; i++) for (const hit of step(0.3, 3)) damage += hit.damage
        return damage
      }
      return { boss, charge }
    }

    it('a su distancia se agacha, carga en línea recta y pega', () => {
      const { boss, charge } = facing(7)
      step(0.3, 3)
      expect(boss.charge.state).toBe('crouch')
      const x = boss.pos.x
      for (let i = 0; i < 30; i++) step(0.3, 3)
      // Agachado no se mueve.
      expect(boss.pos.x).toBe(x)
      expect(charge()).toBeGreaterThanOrEqual(GIANT.damage)
      expect(dist(boss, player)).toBeLessThan(3)
    })

    it('apartándose se esquiva: la dirección se fija al salir', () => {
      const { boss } = facing(7)
      const CHARGE = GIANT.charge!
      for (let i = 0; i < Math.round(CHARGE.windup / STEP) + 1; i++) step(0.3, 3)
      expect(boss.charge.state).toBe('rush')
      player.z += 4
      let damage = 0
      for (let i = 0; i < Math.round(CHARGE.time / STEP); i++) for (const hit of step(0.3, 3)) damage += hit.damage
      expect(damage).toBe(0)
      expect(boss.charge).toMatchObject({ state: 'dazed', cooldown: expect.any(Number) })
    })

    it('tras embestir queda aturdido, sin moverse ni atacar, y recibe el doble', () => {
      const { boss, charge } = facing(7)
      for (let i = 0; i < 120 && boss.charge.state !== 'dazed'; i++) step(0.3, 3)
      expect(boss.charge.state).toBe('dazed')
      const { x, z } = boss.pos
      const { hp } = boss
      enemies.hit(boss, 100, player, 0)
      expect(boss.hp).toBe(hp - 200)
      // Hasta que se recupera no hace nada.
      let damage = 0
      for (let i = 0; i < Math.round(GIANT.charge!.dazed / STEP) - 2; i++) for (const hit of step(0.3, 3)) damage += hit.damage
      expect(damage).toBe(0)
      expect(boss.pos).toEqual({ x, z })
      charge()
      expect(boss.charge.state).not.toBe('dazed')
    })

    it('muy cerca o muy lejos no embiste, y tras embestir espera', () => {
      expect(facing(3).boss.charge.state).toBe('idle')
      const near = facing(3).boss
      step(0.3, 3)
      expect(near.charge.state).toBe('idle')
      enemies.reset()
      const far = enemies.spawnAt(player.x + 20, player.z, 'giant')
      step(0.3, 3)
      expect(far.charge.state).toBe('idle')
    })

    it('se para al chocar con un prop', () => {
      const grid = new SpatialGrid<Collider>()
      const rock = { x: spot.x + 3, z: spot.z, radius: 1.5, alive: true }
      grid.insert(rock)
      enemies = new Enemies([grid], mulberry32(7))
      const boss = enemies.spawnAt(spot.x + 8, spot.z, 'giant')
      for (let i = 0; i < 90 && boss.charge.state !== 'rush'; i++) step(0.3, 3)
      expect(boss.charge.state).toBe('rush')
      let damage = 0
      for (let i = 0; i < 30; i++) for (const hit of step(0.3, 3)) damage += hit.damage
      expect(boss.charge.state).toBe('dazed')
      expect(boss.pos.x).toBeGreaterThan(rock.x + rock.radius)
      expect(damage).toBe(0)
    })
  })

  describe('lanzarrocas', () => {
    const THROWER = ENEMY_DEFS.thrower
    const RANGED = THROWER.ranged!
    const INTERVAL = Math.round(THROWER.attackInterval / STEP)
    const WINDUP = Math.round(THROWER.windup / STEP)
    let events: SimEventData[]
    let rocks: { tick: number; from: { x: number; y: number; z: number }; target: number; damage: number }[]
    let tick: number

    beforeEach(() => {
      events = []
      rocks = []
      tick = 0
      enemies = new Enemies([], mulberry32(7), (e) => events.push(e), (from, target, damage) => rocks.push({ tick, from, target, damage }))
    })

    /** Un lanzarrocas a `distance` metros, sin aparición de otros: es de día. */
    const facing = (distance: number) => enemies.spawnAt(player.x + distance, player.z, 'thrower')
    const run = (steps: number) => {
      let damage = 0
      for (let i = 0; i < steps; i++) {
        tick++
        for (const hit of step(0.3, 6)) damage += hit.damage
      }
      return damage
    }
    /** Que no lance, para ver solo cómo se mueve. */
    const holdFire = (boss: EnemyData) => {
      boss.charge.cooldown = 1000
    }

    it('se acerca hasta su distancia y no más', () => {
      const boss = facing(30)
      holdFire(boss)
      run(60 * 6)
      expect(dist(boss, player)).toBeCloseTo(RANGED.max, 3)
    })

    it('entre medias se queda donde está', () => {
      const boss = facing(11)
      holdFire(boss)
      const { x, z } = boss.pos
      run(60)
      expect(boss.pos).toEqual({ x, z })
    })

    it('si te acercas retrocede, sin dejar de mirarte, y se le alcanza corriendo', () => {
      const boss = facing(4)
      holdFire(boss)
      run(1)
      expect(boss.yaw).toBeCloseTo(-Math.PI / 2, 6)
      run(60 * 2)
      expect(dist(boss, player)).toBeCloseTo(RANGED.flee, 3)
      expect(THROWER.speed).toBeLessThan(WALK_SPEED)
    })

    it('cada 2,5 s se para, avisa 0,7 s y lanza; no pega por su cuenta', () => {
      const boss = facing(12)
      run(1)
      expect(boss.charge.state).toBe('aim')
      expect(events).toContainEqual({ type: 'enemyCharge', id: boss.id, state: 'aim' })
      expect(run(WINDUP - 1)).toBe(0)
      expect(rocks).toEqual([])
      run(1)
      expect(boss.charge.state).toBe('idle')
      expect(rocks).toEqual([{ tick: WINDUP + 1, from: { x: boss.pos.x, y: heightAt(boss.pos.x, boss.pos.z) + RANGED.height, z: boss.pos.z }, target: 0, damage: THROWER.damage }])
      expect(events.at(-1)).toEqual({ type: 'enemyAttack', id: boss.id, target: 0 })
      expect(run(INTERVAL * 2)).toBe(0)
      expect(rocks.map((r) => r.tick)).toEqual([WINDUP + 1, WINDUP + 1 + INTERVAL, WINDUP + 1 + INTERVAL * 2])
    })

    it('mientras avisa no se mueve', () => {
      const boss = facing(3)
      run(1)
      const { x, z } = boss.pos
      run(WINDUP - 1)
      expect(boss.charge.state).toBe('aim')
      expect(boss.pos).toEqual({ x, z })
    })

    it('más allá de su alcance no lanza', () => {
      const boss = facing(RANGED.range + 3)
      run(10)
      expect(boss.charge.state).toBe('idle')
    })

    it('sin nadie a quien lanzar se queda quieto', () => {
      const boss = facing(12)
      const { x, z } = boss.pos
      enemies.step(STEP, [], 0.3, 6)
      expect(boss.charge.state).toBe('idle')
      expect(boss.pos).toEqual({ x, z })
    })

    it('un golpe no lo interrumpe', () => {
      const boss = facing(12)
      run(1)
      enemies.hit(boss, 10, player, 0)
      expect(boss.charge.state).toBe('aim')
      run(WINDUP)
      expect(rocks).toHaveLength(1)
    })
  })
})

describe('guardián', () => {
  const GUARDIAN = ENEMY_DEFS.guardian
  const { aggro, leash } = GUARDIAN.guard!
  const DAYTIME = 0.3
  let enemies: Enemies
  let guardian: EnemyData
  let player: { x: number; z: number }

  beforeEach(() => {
    enemies = new Enemies([], mulberry32(7))
    guardian = enemies.spawnAt(spot.x, spot.z, 'guardian')
    player = { x: spot.x + aggro + 5, z: spot.z }
  })

  const prey = (alive = true) => [{ id: 0, pos: player, alive }]
  const run = (steps: number, phase = DAYTIME, who = prey()) => {
    let damage = 0
    for (let i = 0; i < steps; i++) for (const hit of enemies.step(STEP, who, phase, 2)) damage += hit.damage
    return damage
  }

  it('se queda quieto mientras nadie vivo se acerque a 15 m', () => {
    run(60)
    expect(guardian.pos).toEqual(guardian.home)
    player.x = spot.x + aggro - 1
    run(60, DAYTIME, prey(false))
    expect(guardian.pos).toEqual(guardian.home)
    run(1)
    expect(guardian.target).toBe(0)
    expect(guardian.pos.x).toBeGreaterThan(spot.x)
  })

  it('persigue y pega como cualquiera, también de noche', () => {
    player.x = spot.x + 6
    expect(run(60 * 4)).toBeGreaterThanOrEqual(GUARDIAN.damage)
    expect(dist(guardian, player)).toBeLessThan(3)
    guardian.attackCooldown = 0
    expect(run(60 * 2, NIGHT)).toBeGreaterThanOrEqual(GUARDIAN.damage)
  })

  it('más lento que andar: se le puede dejar atrás', () => {
    expect(GUARDIAN.speed).toBeLessThan(WALK_SPEED)
  })

  it('si te alejas 25 m de su sitio te deja y vuelve, sin curarse', () => {
    player.x = spot.x + 6
    run(60 * 2)
    guardian.hp = 100
    const away = guardian.pos.x
    expect(away).toBeGreaterThan(spot.x)
    player.x = spot.x + leash + 1
    run(1)
    expect(guardian.target).toBeNull()
    run(60 * 3)
    expect(Math.hypot(guardian.pos.x - guardian.home.x, guardian.pos.z - guardian.home.z)).toBeLessThan(1e-9)
    expect(guardian.hp).toBe(100)
  })

  it('aunque esté pegado a ti, no sale de su sitio', () => {
    guardian.pos.x = guardian.prev.x = spot.x + leash - 1
    player.x = spot.x + leash + 0.5
    run(1)
    expect(guardian.target).toBeNull()
  })

  it('volviendo, se despierta otra vez si te acercas', () => {
    player.x = spot.x + leash + 1
    guardian.pos.x = guardian.prev.x = spot.x + 10
    run(1)
    expect(guardian.target).toBeNull()
    player.x = spot.x + 14
    run(1)
    expect(guardian.target).toBe(0)
  })

  it('sigue a quien persigue aunque otro esté más cerca, mientras no se aleje', () => {
    const other = { x: spot.x - 3, z: spot.z }
    player.x = spot.x + 10
    run(1)
    const both = [...prey(), { id: 1, pos: other, alive: true }]
    run(5, DAYTIME, both)
    expect(guardian.target).toBe(0)
    player.x = spot.x + leash + 1
    run(1, DAYTIME, both)
    expect(guardian.target).toBe(1)
  })

  it('un golpe no lo aturde ni lo empuja', () => {
    const { x } = guardian.pos
    enemies.hit(guardian, 10, player, 0)
    expect(guardian.stagger).toBe(0)
    expect(guardian.pos.x).toBe(x)
  })

  it('tiene 500 de vida por jugador', () => {
    expect(enemies.spawnAt(0, 0, 'guardian', 4).maxHp).toBe(GUARDIAN.hp * 4)
    expect(enemies.spawnAt(0, 0, 'guardian', 0).maxHp).toBe(GUARDIAN.hp)
  })

  it('no cuenta para el tope de enemigos ni como jefe', () => {
    for (let i = 0; i < enemyCap(2) - 1; i++) enemies.spawnAt(spot.x + 30 + i, spot.z)
    for (let i = 0; i < 600; i++) enemies.step(STEP, prey(), NIGHT, 2)
    expect(enemies.list.filter((e) => e.type !== 'guardian')).toHaveLength(enemyCap(2))
    expect(bossOfNight(3)).toBe('giant')
    for (let i = 0; i < 60; i++) enemies.step(STEP, prey(), DAY_FRACTION + 21 / DAY_LENGTH, 3)
    expect(enemies.list.filter((e) => e.type === 'giant')).toHaveLength(1)
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
    ['golem', ['coin', 'coin', 'iron_ore', 'stone', 'stone', 'stone']],
    ['spirit', ['birch_wood', 'coin', 'coin', 'wood', 'wood', 'wood', 'wood']],
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

  it('el botín de un jefe crece con su vida', () => {
    const { enemies, enemy, hold, equip, pickups } = setup()
    enemies.reset()
    const boss = enemies.spawnAt(enemy.pos.x, enemy.pos.z, 'giant', 3)
    equip('wood_sword')
    boss.hp = 1
    hold(STEP)
    expect(pickups.list.filter((p) => p.item === 'raw_meat')).toHaveLength(6)
    expect(pickups.list.filter((p) => p.item === 'iron_bar')).toHaveLength(4)
  })

  it('el botín del guardián va por jugador', () => {
    const { enemies, enemy, hold, equip, pickups } = setup()
    enemies.reset()
    const guardian = enemies.spawnAt(enemy.pos.x, enemy.pos.z, 'guardian', 3)
    equip('wood_sword')
    guardian.hp = 1
    hold(STEP)
    expect(pickups.list.filter((p) => p.item === 'meteor_fragment')).toHaveLength(9)
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
