import { describe, expect, it } from 'vitest'
import { deliver } from './builds'
import { Btn } from './commands'
import { ENEMY_DEFS, HEALTH_MAX, METEOR_SPAWN_MIN, MOTOR_TIME, PLANE_HP, PLANE_REPAIR_WOOD, STEP, TOTEM_HOLD } from './constants'
import type { SimEvent } from './events'
import { Simulation } from './Simulation'
import { STRUCTURE_DEFS, structureSpot } from './structures'

const RULES = { players: 2, difficulty: 'normal' } as const

/** Una partida de dos con el tótem activado: el avión ya ha caído. */
function setup() {
  const sim = new Simulation(1)
  sim.addPlayer(0)
  sim.addPlayer(1)
  sim.rules = RULES
  const { player, inventory } = sim.slot(0)
  const totem = sim.structures.place({ ...structureSpot(player.pos, 0, STRUCTURE_DEFS.totem.radius, sim.obstacles), valid: true }, 'totem')!
  for (const item of ['stone', 'dark_wood', 'iron_bar', 'meteor_fragment', 'boss_trophy'] as const) inventory.add(item, 500)
  for (let i = 0; i < 3; i++) deliver(totem, inventory, RULES)
  inventory.clear()

  const keepAlive = () => {
    for (const s of sim.inWorld()) if (s.alive) Object.assign(s.player, { health: HEALTH_MAX, hunger: 100 })
  }
  const useKey = (seconds: number) => {
    const list: SimEvent[] = []
    for (let i = 0; i < Math.round(seconds / STEP); i++) {
      keepAlive()
      list.push(...sim.step(new Map([[0, { move: { tick: sim.tick + 1, buttons: Btn.Use, yaw: 0, pitch: 0 }, actions: [] }]])))
    }
    return list
  }
  const wait = (seconds: number) => {
    const list: SimEvent[] = []
    for (let i = 0; i < Math.round(seconds / STEP); i++) {
      keepAlive()
      list.push(...sim.step(new Map()))
    }
    return list
  }
  const crash = useKey(TOTEM_HOLD + 0.1)
  sim.step(new Map())
  const structure = sim.structures.list.find((s) => s.kind === 'plane')!
  const plane = structure.plane!
  /** Se pone al lado y lo repara. */
  const repair = () => {
    sim.teleport(0, structure.x + structure.radius + 1.5, structure.z, 0, 0)
    sim.step(new Map())
    inventory.add('wood', 500)
    inventory.add('iron_bar', 500)
    inventory.add('plane_engine', 1)
    deliver(structure, inventory, RULES)
    deliver(structure, inventory, RULES)
    inventory.clear()
  }
  return { sim, player, inventory, totem, structure, plane, crash, useKey, wait, repair }
}

describe('el avión', () => {
  it('cae en llamas al activar el tótem, lejos de él, y se anuncia', () => {
    const { totem, structure, crash } = setup()
    expect(crash).toContainEqual(expect.objectContaining({ type: 'planeCrashed', id: structure.id, x: structure.x, z: structure.z }))
    expect(Math.hypot(structure.x - totem.x, structure.z - totem.z)).toBeGreaterThanOrEqual(METEOR_SPAWN_MIN)
  })

  it('sin reparar no arranca', () => {
    const { sim, structure, plane, useKey } = setup()
    sim.teleport(0, structure.x + structure.radius + 1.5, structure.z, 0, 0)
    sim.step(new Map())
    useKey(0.1)
    expect(plane.running).toBe(false)
  })

  it('reparado, cualquiera arranca el motor, y al calentar despegan quienes están a bordo', () => {
    const { sim, player, plane, repair, useKey, wait } = setup()
    repair()
    useKey(0.1)
    expect(plane.running).toBe(true)
    expect(wait(MOTOR_TIME - 1).some((e) => e.type === 'matchEnded')).toBe(false)
    sim.teleport(1, 0, 0, 0, 0)
    const ended = wait(2).find((e) => e.type === 'matchEnded')
    expect(ended).toMatchObject({ result: { end: 'escaped', players: [{ id: 0, escaped: true }, { id: 1, escaped: false }] } })
    expect(player.health).toBeGreaterThan(0)
  })

  it('si no hay nadie a bordo espera, listo', () => {
    const { sim, plane, repair, useKey, wait } = setup()
    repair()
    useKey(0.1)
    sim.teleport(0, 0, 0, 0, 0)
    sim.teleport(1, 0, 0, 0, 0)
    expect(wait(MOTOR_TIME + 5).some((e) => e.type === 'matchEnded')).toBe(false)
    expect(plane.heat).toBe(MOTOR_TIME)
    expect(sim.result).toBeNull()
  })

  it('con el motor en marcha los mobs van a por él, aunque haya jugadores más cerca', () => {
    const { sim, player, structure, plane, repair, useKey, wait } = setup()
    repair()
    useKey(0.1)
    const goblin = sim.enemies.spawnAt(player.pos.x - 3, player.pos.z)
    wait(0.5)
    expect(Math.hypot(goblin.pos.x - player.pos.x, goblin.pos.z - player.pos.z)).toBeGreaterThan(0)
    const before = Math.hypot(goblin.pos.x - structure.x, goblin.pos.z - structure.z)
    wait(1)
    expect(Math.hypot(goblin.pos.x - structure.x, goblin.pos.z - structure.z)).toBeLessThan(before + 1)
    wait(10)
    expect(plane.hp).toBeLessThan(PLANE_HP)
    expect(player.health).toBe(HEALTH_MAX)
  })

  it('los jefes no se dejan distraer', () => {
    const { sim, player, repair, useKey, wait } = setup()
    repair()
    useKey(0.1)
    const guardian = sim.enemies.spawnAt(player.pos.x + 6, player.pos.z, 'guardian')
    wait(0.1)
    expect(guardian.target).toBe(0)
    expect(ENEMY_DEFS.guardian.guard).toBeDefined()
  })

  it('sin vida se apaga pero no se destruye: se repara y se vuelve a arrancar', () => {
    const { sim, inventory, structure, plane, repair, useKey, wait } = setup()
    repair()
    useKey(0.1)
    plane.hp = 5
    const goblin = sim.enemies.spawnAt(structure.x + structure.radius + 1.2, structure.z)
    goblin.attackCooldown = 0
    wait(2)
    expect(plane).toMatchObject({ hp: 0, running: false, heat: 0 })
    expect(sim.structures.list).toContain(structure)
    useKey(0.05)
    wait(0.1)
    expect(plane.hp).toBe(0)
    inventory.add('wood', PLANE_REPAIR_WOOD)
    useKey(0.05)
    expect(plane.hp).toBe(PLANE_HP)
    expect(inventory.count('wood')).toBe(0)
    wait(0.1)
    useKey(0.05)
    expect(plane.running).toBe(true)
  })

  it('se guarda con la partida', () => {
    const { sim, plane, repair, useKey, wait } = setup()
    repair()
    useKey(0.1)
    wait(10)
    const copy = Simulation.fromJSON(JSON.parse(JSON.stringify(sim.toJSON())))
    expect(copy.structures.flying?.plane).toEqual(plane)
  })
})
