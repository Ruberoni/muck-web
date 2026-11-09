import { describe, expect, it, vi } from 'vitest'
import { DAY_FRACTION, DAY_LENGTH } from './world/daycycle'
import { ENEMY_DEFS, STEP } from './constants'
import { Enemies } from './enemies'
import { mulberry32 } from './random'
import { Simulation } from './Simulation'
import { MOB_MAX_SPEED, NO_SCALING, Threat, type MobScaling, type MobTrait } from './threat'

const GOBLIN = ENEMY_DEFS.goblin
const NIGHT = DAY_FRACTION + 21 / DAY_LENGTH

/** Lo que vale un trasgo con esta amenaza. */
function goblin(threat: Threat, day: number, difficulty: 'easy' | 'normal' | 'hard' | 'ultra' = 'normal') {
  const scaling: MobScaling = { ...NO_SCALING }
  threat.apply(day, difficulty, scaling)
  return { hp: Math.round(GOBLIN.hp * scaling.hp), damage: GOBLIN.damage * scaling.damage, speed: GOBLIN.speed * scaling.speed }
}

/** Una campana a oscuras en la que toca `trait`. */
function ring(threat: Threat, trait: MobTrait) {
  threat.state.next = trait
  threat.rise(() => 0)
}

describe('la amenaza', () => {
  it('el ejemplo del trasgo, noche a noche', () => {
    const threat = new Threat()
    expect(goblin(threat, 1)).toEqual({ hp: 70, damage: 10, speed: 5 })
    expect(goblin(threat, 5)).toEqual({ hp: 84, damage: 10, speed: 5 })

    threat.fall(() => 0)
    expect(goblin(threat, 6)).toMatchObject({ hp: 126, damage: 13 })
    expect(goblin(threat, 6).speed).toBeCloseTo(5.75, 6)

    for (let i = 0; i < 3; i++) ring(threat, 'strong')
    expect(goblin(threat, 9).hp).toBe(192)
    expect(goblin(threat, 9).damage).toBeCloseTo(17.3, 1)
    for (let i = 0; i < 3; i++) ring(threat, 'fast')
    expect(goblin(threat, 12).speed).toBeCloseTo(7.24, 2)

    threat.awaken()
    expect(goblin(threat, 12).hp).toBe(287)
    expect(goblin(threat, 12).damage).toBeCloseTo(22.5, 1)
    expect(goblin(threat, 12).speed).toBeCloseTo(7.97, 2)
  })

  it('los saltos dan lo mismo en cualquier orden: el tótem puede activarse antes', () => {
    const a = new Threat()
    a.fall(() => 0)
    a.awaken()
    const b = new Threat()
    b.awaken()
    b.fall(() => 0)
    expect(goblin(a, 6)).toEqual(goblin(b, 6))
  })

  it('la dificultad multiplica lo que añaden los saltos, no el total', () => {
    const threat = new Threat()
    threat.fall(() => 0)
    expect(goblin(threat, 5, 'easy').hp).toBe(Math.round(84 * 1.375))
    expect(goblin(threat, 5, 'ultra').hp).toBe(Math.round(84 * 1.75))
  })

  it('agresivos: atacan y aparecen un 10 % más seguido', () => {
    const threat = new Threat()
    ring(threat, 'aggressive')
    const scaling = { ...NO_SCALING }
    threat.apply(1, 'normal', scaling)
    expect(scaling.attackInterval).toBeCloseTo(0.9, 6)
    expect(scaling.spawnInterval).toBeCloseTo(0.9, 6)
  })

  it('anuncia el siguiente rasgo antes de que toque', () => {
    const threat = new Threat()
    threat.fall(mulberry32(3))
    const announced = threat.state.next
    expect(threat.rise(mulberry32(4))).toBe(announced)
    expect(threat.state.level).toBe(1)
  })
})

describe('las noches normales iluminadas', () => {
  it('cada una resta lo que habría subido la vida, sin bajar de la base', () => {
    const threat = new Threat()
    expect(goblin(threat, 4).hp).toBe(Math.round(GOBLIN.hp * 1.15))
    threat.lightNight()
    expect(goblin(threat, 4).hp).toBe(Math.round(GOBLIN.hp * 1.1))
    for (let i = 0; i < 4; i++) threat.lightNight()
    expect(goblin(threat, 5).hp).toBe(GOBLIN.hp)
  })
})

describe('los mobs con la amenaza', () => {
  const setup = () => {
    const enemies = new Enemies([], mulberry32(7))
    enemies.scaling = { hp: 2, damage: 3, speed: 1.5, attackInterval: 0.5, spawnInterval: 1 }
    return enemies
  }
  const target = (x: number, z: number) => [{ id: 0, pos: { x, z }, alive: true }]

  it('los comunes salen con más vida, pero sueltan lo mismo', () => {
    const e = setup().spawnAt(0, 0)
    expect(e).toMatchObject({ hp: GOBLIN.hp * 2, maxHp: GOBLIN.hp * 2, lootScale: 1 })
  })

  it('los jefes y los guardianes no suben: su vida solo depende de los jugadores', () => {
    const enemies = setup()
    expect(enemies.spawnAt(0, 0, 'giant').maxHp).toBe(ENEMY_DEFS.giant.hp)
    expect(enemies.spawnAt(9, 0, 'guardian', 2)).toMatchObject({ maxHp: ENEMY_DEFS.guardian.hp * 2, lootScale: 2 })
  })

  it('andan más rápido, sin pasar del tope, y pegan más fuerte y más seguido', () => {
    const enemies = setup()
    enemies.scaling.speed = 10
    const e = enemies.spawnAt(10, 10)
    enemies.step(STEP, target(30, 10), 0.3, 1)
    expect(e.pos.x - 10).toBeCloseTo(MOB_MAX_SPEED * STEP, 6)

    enemies.reset()
    enemies.scaling.speed = 1
    const near = enemies.spawnAt(0.5, 0)
    near.attackCooldown = 0
    let hits = 0
    let total = 0
    for (let i = 0; i < 60 * 3; i++) {
      for (const { damage } of enemies.step(STEP, target(0, 0), 0.3, 1)) {
        hits++
        total += damage
      }
    }
    expect(total / hits).toBe(GOBLIN.damage * 3)
    expect(hits).toBeGreaterThanOrEqual(Math.floor(3 / (GOBLIN.attackInterval * 0.5)))
  })
})

// Llegar a una campana son minutos de partida.
vi.setConfig({ testTimeout: 30_000 })

describe('en la partida', () => {
  /** Una partida justo antes de que caiga la Noche Eterna. */
  function nearEternal() {
    const sim = new Simulation(1)
    sim.addPlayer(0)
    sim.rules = { players: 1, difficulty: 'normal' }
    sim.setDay(6)
    sim.setPhase(DAY_FRACTION - 0.0001)
    return sim
  }
  const until = (sim: Simulation, type: string) => {
    const seen = []
    for (let i = 0; i < 60 * 60 * 8; i++) {
      Object.assign(sim.slot(0).player, { health: 100, hunger: 100 })
      const events = sim.step(new Map())
      seen.push(...events)
      if (events.some((e) => e.type === type)) return seen
    }
    throw new Error(`sin ${type}`)
  }

  it('cae el primer salto y cada campana sube un nivel y lo anuncia', () => {
    const sim = nearEternal()
    const fell = until(sim, 'eternalNight')
    expect(fell.find((e) => e.type === 'mobsRose')).toMatchObject({ trait: null, threat: { eternal: true, level: 0 } })
    const announced = sim.threat.state.next
    const rang = until(sim, 'mobsRose')
    // En el mismo paso puede pasar algo más (un mob que pega): se mira la campana.
    expect([...rang].reverse().find((e) => e.type === 'mobsRose')).toMatchObject({ trait: announced, threat: { level: 1 } })
    expect(sim.enemies.scaling.hp).toBeGreaterThan(1.5)
  })

  it('se guarda y empezar otra partida la borra', () => {
    const sim = nearEternal()
    until(sim, 'eternalNight')
    const copy = Simulation.fromJSON(JSON.parse(JSON.stringify(sim.toJSON())))
    expect(copy.threat.state).toEqual(sim.threat.state)
    expect(copy.step(new Map()).length).toBeGreaterThanOrEqual(0)
    expect(copy.enemies.scaling).toEqual(sim.step(new Map()) && sim.enemies.scaling)
    sim.reset()
    expect(sim.threat.state).toMatchObject({ eternal: false, level: 0 })
  })

  it('el botín de un trasgo reforzado sigue siendo el suyo', () => {
    const sim = new Simulation(1)
    sim.addPlayer(0)
    sim.enemies.scaling.hp = 3
    expect(sim.enemies.spawnAt(0, 0).lootScale).toBe(1)
    expect(NIGHT).toBeGreaterThan(DAY_FRACTION)
  })
})

describe('las monedas de los mobs', () => {
  it('suben con la vida de los comunes, y los jefes dan las suyas', () => {
    const enemies = new Enemies([], mulberry32(1))
    expect(enemies.spawnAt(0, 0, 'goblin').coinScale).toBe(1)
    enemies.scaling.hp = 2.5
    expect(enemies.spawnAt(3, 0, 'goblin').coinScale).toBe(2.5)
    expect(enemies.spawnAt(6, 0, 'giant').coinScale).toBe(1)
    expect(ENEMY_DEFS.giant.loot.find((l) => l.item === 'coin')!.amount).toBeGreaterThan(ENEMY_DEFS.goblin.loot.find((l) => l.item === 'coin')!.amount)
  })
})
