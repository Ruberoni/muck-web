import { beforeEach, describe, expect, it } from 'vitest'
import { SpatialGrid, type Collider } from './collision'
import { ENEMY_DEFS, GRAVITY, HEALTH_REGEN_DELAY, PLAYER_RADIUS, STEP } from './constants'
import type { SimEventData } from './events'
import { aimedVelocity, projectilePos, PROJECTILE_DEFS, Projectiles } from './projectiles'
import { Simulation } from './Simulation'
import { heightAt, ROCK_LEVEL, SAND_LEVEL, WATER_LEVEL } from './world/terrain'

/** Un sitio de hierba, lejos de la orilla. */
function grassSpot() {
  for (let i = 0; i < 4000; i++) {
    const angle = i * 0.5
    const r = angle * 0.4
    const x = Math.cos(angle) * r
    const z = Math.sin(angle) * r
    const h = heightAt(x, z)
    if (h > SAND_LEVEL + 0.3 && h < ROCK_LEVEL) return { x, z, y: h }
  }
  throw new Error('sin hierba')
}

const spot = grassSpot()
const ROCK_DAMAGE = ENEMY_DEFS.thrower.damage

describe('proyectiles', () => {
  let events: SimEventData[]
  let grid: SpatialGrid<Collider>
  let projectiles: Projectiles
  beforeEach(() => {
    events = []
    grid = new SpatialGrid<Collider>()
    projectiles = new Projectiles([grid], (e) => events.push(e))
  })

  const high = { x: spot.x, y: spot.y + 2, z: spot.z }
  const ends = () => events.flatMap((e) => (e.type === 'projectileHit' ? [e.end] : []))

  /** Avanza desde el tick 1 hasta que no quede ninguno; devuelve el daño total. */
  const run = (players: Parameters<Projectiles['step']>[1] = []) => {
    let damage = 0
    for (let tick = 1; tick < 1000 && projectiles.list.length; tick++) for (const hit of projectiles.step(tick, players)) damage += hit.damage
    return damage
  }

  it('la trayectoria es balística y sale siempre de lo mismo, en cualquier tick', () => {
    const p = { from: { x: 1, y: 2, z: 3 }, vel: { x: 4, y: 5, z: 6 }, tick: 10 }
    const t = 30 * STEP
    expect(projectilePos(p, 40, { x: 0, y: 0, z: 0 })).toEqual({ x: 1 + 4 * t, y: 2 + 5 * t - (GRAVITY * t * t) / 2, z: 3 + 6 * t })
    expect(projectilePos(p, 10, { x: 0, y: 0, z: 0 })).toEqual(p.from)
  })

  it('apuntado, llega a donde se le dice', () => {
    const from = { x: 0, y: 2, z: 0 }
    const to = { x: 9, y: 3, z: -12 }
    const vel = aimedVelocity(from, to, 14)
    expect(Math.hypot(vel.x, vel.z)).toBeCloseTo(14, 6)
    const ticks = Math.round(15 / 14 / STEP)
    const at = projectilePos({ from, vel, tick: 0 }, ticks, { x: 0, y: 0, z: 0 })
    expect(Math.hypot(at.x - to.x, at.y - to.y, at.z - to.z)).toBeLessThan(0.5)
  })

  it('sale con su evento y choca con el suelo', () => {
    const p = projectiles.launch(0, 'rock', high, { x: 3, y: 0, z: 0 }, 10)
    expect(events[0]).toEqual({ type: 'projectileThrown', id: p.id, kind: 'rock', ...high, vx: 3, vy: 0, vz: 0 })
    expect(run()).toBe(0)
    expect(ends()).toEqual(['ground'])
  })

  it('sobre el agua choca en la superficie', () => {
    const from = { x: 95, y: 3, z: 0 }
    expect(heightAt(from.x, from.z)).toBeLessThan(WATER_LEVEL)
    projectiles.launch(0, 'rock', from, { x: 0, y: 0, z: 0 }, 10)
    run()
    const end = events.at(-1) as Extract<SimEventData, { type: 'projectileHit' }>
    expect(end.y).toBeLessThanOrEqual(WATER_LEVEL)
    expect(end.y).toBeGreaterThan(WATER_LEVEL - 0.5)
  })

  it('le da al jugador que se cruza, una vez', () => {
    projectiles.launch(0, 'rock', high, { x: 5, y: 2, z: 0 }, 15)
    const pos = { x: spot.x + 2, y: spot.y, z: spot.z }
    expect(run([{ id: 0, pos, alive: true }])).toBe(15)
    expect(ends()).toEqual(['player'])
  })

  it('no le da a quien está al lado, muerto o protegido, ni pasando por encima', () => {
    const shot = (pos: { x: number; y: number; z: number }, alive = true) => {
      events.length = 0
      projectiles.launch(0, 'rock', high, { x: 5, y: 2, z: 0 }, 15)
      return run([{ id: 0, pos, alive }])
    }
    expect(shot({ x: spot.x + 2, y: spot.y, z: spot.z + PLAYER_RADIUS + 1 })).toBe(0)
    expect(shot({ x: spot.x + 2, y: spot.y, z: spot.z }, false)).toBe(0)
    expect(shot({ x: spot.x + 2, y: spot.y - 5, z: spot.z })).toBe(0)
  })

  it('choca con los obstáculos, pero pasa por encima si va alto', () => {
    grid.insert({ x: spot.x + 2, z: spot.z, radius: 0.5, alive: true })
    projectiles.launch(0, 'rock', high, { x: 8, y: 0, z: 0 }, 10)
    run()
    expect(ends()).toEqual(['obstacle'])

    events.length = 0
    projectiles.launch(0, 'rock', { ...high, y: spot.y + 12 }, { x: 8, y: 2, z: 0 }, 10)
    run()
    expect(ends()).not.toContain('obstacle')
  })

  it('un obstáculo roto no lo para', () => {
    grid.insert({ x: spot.x + 2, z: spot.z, radius: 0.5, alive: false })
    projectiles.launch(0, 'rock', high, { x: 8, y: 0, z: 0 }, 10)
    run()
    expect(ends()).toEqual(['ground'])
  })

  it('se acaba si no toca nada', () => {
    projectiles.launch(0, 'rock', { ...high, y: 1000 }, { x: 0, y: 0, z: 0 }, 10)
    const life = Math.round(PROJECTILE_DEFS.rock.life / STEP)
    for (let tick = 1; tick < life; tick++) projectiles.step(tick, [])
    expect(projectiles.list).toHaveLength(1)
    projectiles.step(life, [])
    expect(ends()).toEqual(['expired'])
  })

  it('la copia del cliente sigue la trayectoria, se queda en el suelo y no choca sola', () => {
    const mirror = new Projectiles()
    mirror.add({ id: 7, kind: 'rock', from: high, vel: { x: 5, y: 2, z: 0 }, tick: 0, damage: 0 })
    mirror.follow(12)
    expect(mirror.list[0].pos).toEqual(projectilePos({ from: high, vel: { x: 5, y: 2, z: 0 }, tick: 0 }, 12, { x: 0, y: 0, z: 0 }))
    mirror.follow(600)
    expect(mirror.list).toHaveLength(1)
    const { pos } = mirror.list[0]
    expect(pos.y).toBeGreaterThanOrEqual(Math.min(heightAt(pos.x, pos.z), WATER_LEVEL))
    mirror.remove(7)
    expect(mirror.list).toHaveLength(0)
  })

  it('en la partida el golpe quita vida, pausa la regeneración y se guarda en vuelo', () => {
    const sim = new Simulation(1)
    sim.addPlayer(0)
    const { player } = sim.slot(0)
    sim.throwRock(player.pos.x + 5, player.pos.z, 0)
    for (let i = 0; i < 6; i++) sim.step(new Map())
    expect(sim.projectiles.list).toHaveLength(1)

    const copy = Simulation.fromJSON(JSON.parse(JSON.stringify(sim.toJSON())))
    const hurtIn = (s: Simulation) => {
      for (let i = 0; i < 90; i++) {
        const hit = s.step(new Map()).find((e) => e.type === 'playerHurt')
        if (hit) return hit
      }
      return null
    }
    expect(hurtIn(sim)).toMatchObject({ id: 0, dmg: ROCK_DAMAGE })
    expect(hurtIn(copy)).toMatchObject({ id: 0, dmg: ROCK_DAMAGE })
    expect(player.health).toBeLessThanOrEqual(100 - ROCK_DAMAGE + 1)
    expect(player.healDelay).toBeGreaterThan(HEALTH_REGEN_DELAY - 1)
    expect(sim.projectiles.list).toEqual([])

    sim.throwRock(player.pos.x + 5, player.pos.z, 0)
    sim.reset()
    expect(sim.projectiles.list).toEqual([])
  })

  describe('el lanzarrocas en la partida', () => {
    const setup = () => {
      const sim = new Simulation(1)
      sim.addPlayer(0)
      const { player } = sim.slot(0)
      const boss = sim.enemies.spawnAt(player.pos.x + 11, player.pos.z, 'thrower')
      // Solo la roca de siempre: los ataques especiales se prueban en hazards.test.ts.
      boss.special.gap = 1e9
      /** Avanza hasta el paso en que aparece un evento de tipo `type`. */
      const until = (type: SimEventData['type'], game = sim) => {
        for (let i = 0; i < 300; i++) {
          const found = game.step(new Map()).find((e) => e.type === type)
          if (found) return found
        }
        return null
      }
      return { sim, player, boss, until }
    }

    it('si te quedas quieto la roca te da', () => {
      const { player, until } = setup()
      expect(until('playerHurt')).toMatchObject({ id: 0, dmg: ROCK_DAMAGE })
      expect(player.healDelay).toBeGreaterThan(0)
    })

    it('apartándose se esquiva: va adonde estabas al soltarla', () => {
      const { sim, player, until } = setup()
      until('projectileThrown')
      sim.teleport(0, player.pos.x, player.pos.z + 4, 0, 0)
      for (let i = 0; i < 40; i++) expect(sim.step(new Map()).map((e) => e.type)).not.toContain('playerHurt')
      expect(player.health).toBe(100)
    })

    it('guardar la partida mientras avisa no cambia nada', () => {
      const { sim, boss, until } = setup()
      for (let i = 0; i < 5; i++) sim.step(new Map())
      expect(boss.charge.state).toBe('aim')
      const copy = Simulation.fromJSON(JSON.parse(JSON.stringify(sim.toJSON())))
      expect(until('projectileThrown', copy)).toEqual(until('projectileThrown'))
    })
  })
})
