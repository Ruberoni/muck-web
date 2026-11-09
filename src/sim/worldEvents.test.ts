import { beforeEach, describe, expect, it } from 'vitest'
import { resolveCircle } from './collision'
import {
  ENEMY_DEFS,
  HEALTH_REGEN_DELAY,
  METEOR_BLAST,
  METEOR_DAMAGE,
  METEOR_PHASE_MAX,
  METEOR_PHASE_MIN,
  METEOR_RADIUS,
  METEOR_SPAWN_MAX,
  METEOR_SPAWN_MIN,
  METEOR_WARNING,
  PLAYER_RADIUS,
  STEP,
} from './constants'
import type { SimEventData } from './events'
import { createPropWorld, findSpawn } from './props'
import { mulberry32 } from './random'
import { Simulation } from './Simulation'
import { structureSpot } from './structures'
import { biomeAt } from './world/biomes'
import { DAY_FRACTION } from './world/daycycle'
import { heightAt, MAX_SLOPE, slopeAt } from './world/terrain'
import { WorldEvents, type WorldEventTarget } from './worldEvents'

const world = createPropWorld()
const home = findSpawn(world.grid)
const WARNING = Math.round(METEOR_WARNING / STEP)
const AFTERNOON = 0.5
const GUARDIAN_ID = 7

describe('meteoritos', () => {
  let events: SimEventData[]
  let worldEvents: WorldEvents
  let tick: number
  let guardianAlive: boolean
  const player = (x: number, z: number, alive = true): WorldEventTarget => ({ id: 0, pos: { x, z }, alive })
  const players = [player(home.x, home.z)]

  beforeEach(() => {
    events = []
    tick = 0
    guardianAlive = false
    worldEvents = new WorldEvents([world.grid], mulberry32(3), (e) => events.push(e), { spawn: () => GUARDIAN_ID, alive: () => guardianAlive })
  })

  const step = (phase: number, day: number, who = players) => worldEvents.step(++tick, who, phase, day)
  const count = (type: SimEventData['type']) => events.filter((e) => e.type === type).length
  /** Un día entero, de amanecer a medianoche; devuelve las fases a las que se anunció algo. */
  const fullDay = (day: number) => {
    const phases: number[] = []
    for (let phase = 0; phase < 0.9; phase += 0.0005) {
      const before = count('meteorIncoming')
      step(phase, day)
      if (count('meteorIncoming') > before) phases.push(phase)
    }
    return phases
  }
  /** Cae uno en (x, z) y se deja que llegue al suelo; devuelve el daño de ese paso. */
  const strike = (x: number, z: number, day: number, who = players) => {
    worldEvents.fall(tick, x, z)
    for (let i = 1; i < WARNING; i++) step(AFTERNOON, day, who)
    return step(AFTERNOON, day, who)
  }

  it('el primer día no cae ninguno', () => {
    expect(fullDay(1)).toEqual([])
    expect(events).toEqual([])
  })

  it('desde el día 2, uno al día, a una hora al azar de media mañana o mediodía', () => {
    const phases = [2, 3, 4, 5, 6].map(fullDay)
    for (const day of phases) {
      expect(day).toHaveLength(1)
      expect(day[0]).toBeGreaterThanOrEqual(METEOR_PHASE_MIN)
      expect(day[0]).toBeLessThanOrEqual(METEOR_PHASE_MAX + 0.001)
    }
    expect(new Set(phases.flat()).size).toBe(phases.length)
  })

  it('se anuncia 6 s antes de caer, y mientras tanto no choca con nada', () => {
    worldEvents.fall(tick, home.x, home.z)
    expect(events).toEqual([{ type: 'meteorIncoming', x: home.x, y: heightAt(home.x, home.z), z: home.z, landTick: WARNING }])
    for (let i = 1; i < WARNING; i++) step(AFTERNOON, 2)
    expect(count('meteorLanded')).toBe(0)
    expect(resolveCircle({ ...home }, PLAYER_RADIUS, worldEvents.grid)).toBe(false)
    step(AFTERNOON, 2)
    expect(count('meteorLanded')).toBe(1)
    expect(worldEvents.meteor).toMatchObject({ landed: true, radius: METEOR_RADIUS })
    expect(resolveCircle({ ...home }, PLAYER_RADIUS, worldEvents.grid)).toBe(true)
  })

  it('cae en hierba libre, a 40–70 m de un jugador vivo', () => {
    let found = 0
    const dead = player(-30, 30, false)
    const living = player(home.x, home.z)
    for (let i = 0; i < 300; i++) {
      const spot = worldEvents.findSpot([dead, living])
      if (!spot) continue
      found++
      const { x, z } = spot
      expect(['meadow', 'forest']).toContain(biomeAt(x, z))
      expect(slopeAt(x, z)).toBeLessThanOrEqual(MAX_SLOPE)
      const distance = Math.hypot(x - home.x, z - home.z)
      expect(distance).toBeGreaterThanOrEqual(METEOR_SPAWN_MIN)
      expect(distance).toBeLessThanOrEqual(METEOR_SPAWN_MAX)
      expect(world.props.every((prop) => Math.hypot(prop.x - x, prop.z - z) >= METEOR_BLAST)).toBe(true)
    }
    // Si no encuentra sitio a la primera, lo vuelve a intentar en el paso siguiente.
    expect(found).toBeGreaterThan(180)
  })

  it('en la Noche Eterna cae con la campana: sin esto no habría fragmentos para el tótem', () => {
    const midnight = 0.825
    worldEvents.step(++tick, players, midnight, 6, true)
    expect(count('meteorIncoming')).toBe(1)
    for (let i = 0; i < WARNING; i++) step(midnight, 6)
    worldEvents.step(++tick, players, midnight, 6, true)
    expect(worldEvents.meteor?.coolDay).toBe(6)
    // Enfriado, se va con la siguiente campana y cae otro.
    worldEvents.step(++tick, players, midnight, 7, true)
    expect(count('meteorGone')).toBe(1)
    // Si no encuentra sitio a la primera, lo vuelve a intentar en el paso siguiente.
    for (let i = 0; i < 10 && count('meteorIncoming') < 2; i++) worldEvents.step(++tick, players, midnight, 7, true)
    expect(count('meteorIncoming')).toBe(2)
  })

  it('sin nadie vivo espera, y de noche no cae', () => {
    const nobody = [player(home.x, home.z, false)]
    for (let phase = 0; phase < 0.5; phase += 0.001) step(phase, 2, nobody)
    expect(events).toEqual([])
    step(DAY_FRACTION + 0.01, 2)
    expect(events).toEqual([])
    step(0.5, 2)
    expect(count('meteorIncoming')).toBe(1)
  })

  it('mientras viva su guardián sigue caliente: no cae otro ni desaparece al amanecer', () => {
    guardianAlive = true
    strike(home.x, home.z, 2)
    const { meteor } = worldEvents
    expect(meteor).toMatchObject({ guardian: GUARDIAN_ID, coolDay: null })
    fullDay(3)
    expect(worldEvents.meteor).toBe(meteor)
    expect(count('meteorIncoming')).toBe(1)
    expect(count('meteorCooled')).toBe(0)
    // Muerto el guardián, se enfría en ese momento y dura hasta el amanecer siguiente.
    guardianAlive = false
    step(AFTERNOON, 3)
    expect(events.at(-1)).toEqual({ type: 'meteorCooled', day: 3 })
    fullDay(3)
    expect(worldEvents.meteor).toBe(meteor)
    // Al amanecer siguiente ya no está, y ese día vuelve a caer otro.
    step(0, 4)
    expect(count('meteorGone')).toBe(1)
    expect(fullDay(4)).toHaveLength(1)
  })

  it('al caer hace daño a quien está a menos de 4 m', () => {
    const near = (metres: number, alive = true) => {
      worldEvents.reset()
      return strike(home.x + metres, home.z, 2, [player(home.x, home.z, alive)])
    }
    expect(near(METEOR_BLAST - 0.1)).toEqual([{ playerId: 0, damage: METEOR_DAMAGE }])
    expect(near(METEOR_BLAST + 0.1)).toEqual([])
    expect(near(1, false)).toEqual([])
  })

  it('al amanecer siguiente desaparece, y ya no choca', () => {
    strike(home.x, home.z, 2)
    step(AFTERNOON, 2)
    expect(events.at(-1)).toEqual({ type: 'meteorCooled', day: 2 })
    step(0.9, 2)
    expect(worldEvents.meteor).not.toBeNull()
    step(0, 3)
    expect(events.at(-1)).toEqual({ type: 'meteorGone' })
    expect(worldEvents.meteor).toBeNull()
    expect(resolveCircle({ ...home }, PLAYER_RADIUS, worldEvents.grid)).toBe(false)
  })

  it('el que se fuerza sustituye al que hubiera, y ya no cae otro ese día', () => {
    strike(home.x, home.z, 2)
    worldEvents.fall(tick, home.x + 50, home.z)
    expect(count('meteorGone')).toBe(1)
    expect(fullDay(2)).toEqual([])
  })

  describe('en la partida', () => {
    const setup = () => {
      const sim = new Simulation(1)
      sim.addPlayer(0)
      const { player } = sim.slot(0)
      const run = (ticks: number, game = sim) => {
        const list: SimEventData[] = []
        for (let i = 0; i < ticks; i++) list.push(...game.step(new Map()))
        return list
      }
      return { sim, player, run }
    }

    it('sale solo el día 2, con su hora', () => {
      const { sim, run } = setup()
      sim.setDay(2)
      sim.setPhase(METEOR_PHASE_MIN - 0.01)
      run(1)
      const seen: SimEventData[] = []
      for (let i = 0; i < 8000 && !seen.length; i++) seen.push(...run(1).filter((e) => e.type === 'meteorIncoming'))
      expect(seen).toHaveLength(1)
      expect(sim.clock.phase).toBeLessThanOrEqual(METEOR_PHASE_MAX + 0.001)
      expect(run(WARNING).map((e) => e.type)).toContain('meteorLanded')
    })

    it('al caer sale su guardián, por jugador, junto a la roca; muerto, la roca se enfría y se va', () => {
      const { sim, player, run } = setup()
      sim.addPlayer(1)
      const [x, z] = [player.pos.x + 30, player.pos.z]
      sim.meteor(x, z)
      run(WARNING + 1)
      const guardian = sim.enemies.list.find((e) => e.type === 'guardian')!
      expect(guardian.maxHp).toBe(ENEMY_DEFS.guardian.hp * 2)
      expect(Math.hypot(guardian.pos.x - x, guardian.pos.z - z)).toBeLessThan(METEOR_BLAST)
      expect(sim.worldEvents.meteor).toMatchObject({ guardian: guardian.id, coolDay: null })

      const { day } = sim.clock
      sim.setDay(day + 1)
      run(1)
      expect(sim.worldEvents.meteor).not.toBeNull()

      sim.enemies.hit(guardian, guardian.hp, player.pos, 0)
      expect(run(1)).toContainEqual(expect.objectContaining({ type: 'meteorCooled', day: day + 1 }))
      expect(sim.worldEvents.meteor).not.toBeNull()
      sim.setDay(day + 2)
      expect(run(1).map((e) => e.type)).toContain('meteorGone')
    })

    it('quien está debajo recibe el daño, se pausa su regeneración y lo aparta la roca', () => {
      const { sim, player, run } = setup()
      sim.meteor(player.pos.x, player.pos.z)
      const list = run(WARNING + 1)
      expect(list).toContainEqual(expect.objectContaining({ type: 'playerHurt', id: 0, dmg: METEOR_DAMAGE }))
      expect(player.health).toBeLessThanOrEqual(100 - METEOR_DAMAGE + 1)
      expect(player.healDelay).toBeGreaterThan(HEALTH_REGEN_DELAY - 1)
      run(2)
      const { x, z } = sim.worldEvents.meteor!
      expect(Math.hypot(player.pos.x - x, player.pos.z - z)).toBeGreaterThanOrEqual(METEOR_RADIUS + PLAYER_RADIUS - 1e-6)
    })

    it('estorba a los enemigos, a lo que vuela y a lo que se coloca', () => {
      const { sim, player, run } = setup()
      const [x, z] = [player.pos.x + 20, player.pos.z]
      sim.meteor(x, z)
      run(WARNING + 1)
      const enemy = sim.enemies.spawnAt(x, z)
      run(1)
      expect(Math.hypot(enemy.pos.x - x, enemy.pos.z - z)).toBeGreaterThanOrEqual(METEOR_RADIUS)
      expect(sim.obstacles).toContain(sim.worldEvents.grid)
      expect(structureSpot({ x: x - 2, z }, -Math.PI / 2, 0.5, sim.obstacles).valid).toBe(false)
    })

    it('guardar la partida mientras cae o en el suelo no cambia nada', () => {
      const { sim, player, run } = setup()
      sim.meteor(player.pos.x + 20, player.pos.z)
      run(10)
      const falling = Simulation.fromJSON(JSON.parse(JSON.stringify(sim.toJSON())))
      expect(run(WARNING).map((e) => e.type)).toEqual(run(0, falling).concat(run(WARNING, falling)).map((e) => e.type))
      expect(falling.worldEvents.meteor).toEqual(sim.worldEvents.meteor)

      const landed = Simulation.fromJSON(JSON.parse(JSON.stringify(sim.toJSON())))
      const { x, z } = sim.worldEvents.meteor!
      expect(resolveCircle({ x, z }, PLAYER_RADIUS, landed.worldEvents.grid)).toBe(true)
    })

    it('reiniciar la partida lo quita', () => {
      const { sim, player, run } = setup()
      sim.meteor(player.pos.x + 20, player.pos.z)
      run(WARNING + 1)
      sim.reset()
      expect(sim.worldEvents.meteor).toBeNull()
      expect(sim.toJSON().worldEvents).toEqual({ meteor: null, day: 0, fallPhase: null })
    })

    it('sin nadie vivo, forzarlo sin decir dónde no hace nada', () => {
      const { sim } = setup()
      sim.slot(0).alive = false
      sim.meteor()
      expect(sim.worldEvents.meteor).toBeNull()
    })
  })
})
