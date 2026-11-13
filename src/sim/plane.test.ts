import { describe, expect, it } from 'vitest'
import { deliver } from './builds'
import { Btn } from './commands'
import { ENEMY_DEFS, HEALTH_MAX, METEOR_SPAWN_MIN, MOTOR_TIME, PLANE_HP, PLANE_REPAIR_WOOD, PLANE_WAIT, STEP, TOTEM_HOLD } from './constants'
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
  const wait = (seconds: number) => steps(Math.round(seconds / STEP))
  const steps = (n: number) => {
    const list: SimEvent[] = []
    for (let i = 0; i < n; i++) {
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
  /** Pone al jugador `id` a bordo, junto al avión. */
  const board = (id: number) => sim.teleport(id, structure.x + structure.radius + 1.5, structure.z, 0, 0)
  /** Lo aleja del avión. */
  const away = (id: number) => sim.teleport(id, 0, 0, 0, 0)
  /** Repara, arranca y espera a que el motor esté caliente, sin nadie a bordo. */
  const hot = () => {
    repair()
    useKey(0.1)
    away(0)
    away(1)
    wait(MOTOR_TIME + 1)
    expect(plane.heat).toBe(MOTOR_TIME)
  }
  return { sim, player, inventory, totem, structure, plane, crash, useKey, wait, steps, repair, board, away, hot }
}

const ended = (list: SimEvent[]) => list.find((e) => e.type === 'matchEnded')

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

  it('reparado, cualquiera arranca el motor, y al calentar espera PLANE_WAIT a los que faltan', () => {
    const { sim, player, plane, repair, useKey, wait } = setup()
    repair()
    useKey(0.1)
    expect(plane.running).toBe(true)
    expect(wait(MOTOR_TIME - 1).some((e) => e.type === 'matchEnded')).toBe(false)
    sim.teleport(1, 0, 0, 0, 0)
    const boarding = wait(2)
    expect(ended(boarding)).toBeUndefined()
    expect(boarding.filter((e) => e.type === 'planeBoarding')).toHaveLength(1)
    expect(plane).toMatchObject({ aboard: 1, expected: 2 })
    expect(plane.wait).toBeGreaterThan(PLANE_WAIT - 2)
    expect(ended(wait(PLANE_WAIT - 3))).toBeUndefined()
    expect(ended(wait(2))).toMatchObject({ result: { end: 'escaped', players: [{ id: 0, escaped: true }, { id: 1, escaped: false }] } })
    expect(player.health).toBeGreaterThan(0)
  })

  it('la cuenta dura exactamente PLANE_WAIT desde que sube el primero', () => {
    const { sim, plane, hot, board, steps } = setup()
    hot()
    board(0)
    const start = steps(1)
    expect(start).toContainEqual(expect.objectContaining({ type: 'planeChanged', plane: expect.objectContaining({ wait: PLANE_WAIT, aboard: 1, expected: 2 }) }))
    const until = plane.until!
    expect(until).toBe(sim.tick + Math.round(PLANE_WAIT / STEP))
    expect(ended(steps(until - sim.tick - 1))).toBeUndefined()
    expect(ended(steps(1))).toMatchObject({ result: { players: [{ id: 0, escaped: true }, { id: 1, escaped: false }] } })
  })

  it('si suben todos, despega en el acto', () => {
    const { hot, board, steps } = setup()
    hot()
    board(0)
    board(1)
    const list = steps(1)
    expect(list.some((e) => e.type === 'planeBoarding')).toBe(false)
    expect(ended(list)).toMatchObject({ result: { end: 'escaped', players: [{ id: 0, escaped: true }, { id: 1, escaped: true }] } })
  })

  it('si el que falta llega a mitad de la cuenta, despega en ese momento con todos', () => {
    const { hot, board, wait, steps } = setup()
    hot()
    board(0)
    expect(ended(wait(20))).toBeUndefined()
    board(1)
    expect(ended(steps(1))).toMatchObject({ result: { players: [{ id: 0, escaped: true }, { id: 1, escaped: true }] } })
  })

  it('si se bajan todos, la cuenta se cancela y la próxima vez empieza entera', () => {
    const { sim, plane, hot, board, away, wait, steps } = setup()
    hot()
    board(0)
    wait(40)
    const first = plane.until!
    away(0)
    expect(steps(1)).toContainEqual(expect.objectContaining({ type: 'planeChanged', plane: expect.objectContaining({ until: null, wait: null, aboard: 0 }) }))
    wait(5)
    board(0)
    expect(steps(1).filter((e) => e.type === 'planeBoarding')).toHaveLength(1)
    expect(plane.until).toBe(sim.tick + Math.round(PLANE_WAIT / STEP))
    expect(ended(steps(first - sim.tick + 60))).toBeUndefined()
    expect(ended(steps(plane.until! - sim.tick))).toBeDefined()
  })

  it('a un muerto se le espera hasta el límite, no más; si reaparece y sube, despega en ese momento', () => {
    const { sim, plane, hot, board, steps } = setup()
    hot()
    const dead = sim.slot(1)
    dead.player.health = 0
    sim.step(new Map())
    expect(dead.alive).toBe(false)
    board(0)
    steps(1)
    expect(plane).toMatchObject({ aboard: 1, expected: 2 })
    expect(plane.until).not.toBeNull()
    // Que reaparezca en 30 s (de día o de noche, para que no dependa del reloj).
    dead.respawnAt = sim.tick + Math.round(30 / STEP)
    expect(ended(steps(Math.round(30 / STEP) + 1))).toBeUndefined()
    expect(dead.alive).toBe(true)
    board(1)
    expect(ended(steps(1))).toMatchObject({ result: { players: [{ id: 0, escaped: true }, { id: 1, escaped: true }] } })
  })

  it('con un muerto que no llega a tiempo, despega al acabar la cuenta sin él', () => {
    const { sim, plane, hot, board, steps } = setup()
    hot()
    sim.slot(1).player.health = 0
    sim.step(new Map())
    board(0)
    steps(1)
    sim.slot(1).respawnAt = plane.until! + 600
    expect(ended(steps(plane.until! - sim.tick))).toMatchObject({ result: { players: [{ id: 0, escaped: true }, { id: 1, escaped: false }] } })
  })

  it('quien se queda sin vida en el último paso de la cuenta no se salva', () => {
    const { sim, player, plane, hot, board, steps } = setup()
    hot()
    board(0)
    steps(1)
    steps(plane.until! - sim.tick - 1)
    player.health = 0
    const list = sim.step(new Map())
    expect(ended(list)).toBeUndefined()
    expect(sim.slot(0).alive).toBe(false)
    expect(plane.until).toBeNull()
  })

  it('a quien se ha ido (gone) no se le espera; a quien se une durante la cuenta sí, pero no la reinicia', () => {
    const gone = setup()
    gone.hot()
    gone.sim.setConnection(1, 'gone')
    gone.board(0)
    expect(ended(gone.steps(1))).toMatchObject({ result: { players: [{ id: 0, escaped: true }, { id: 1, escaped: false }] } })

    const { sim, plane, hot, board, wait, steps } = setup()
    hot()
    sim.setConnection(1, 'gone')
    sim.addPlayer(2)
    board(0)
    steps(1)
    const until = plane.until!
    wait(20)
    sim.setConnection(1, 'present')
    sim.addPlayer(3)
    wait(1)
    expect(plane).toMatchObject({ aboard: 1, expected: 4, until })
    expect(ended(steps(until - sim.tick - 1))).toBeUndefined()
    expect(ended(steps(1))).toMatchObject({ result: { players: [{ id: 0, escaped: true }, { escaped: false }, { escaped: false }, { escaped: false }] } })
  })

  it('si los mobs lo dejan sin vida durante la cuenta, se apaga y la cuenta se cancela', () => {
    const { sim, structure, plane, hot, board, wait } = setup()
    hot()
    board(0)
    wait(1)
    expect(plane.until).not.toBeNull()
    plane.hp = 5
    const goblin = sim.enemies.spawnAt(structure.x - structure.radius - 1.2, structure.z)
    goblin.attackCooldown = 0
    wait(2)
    expect(plane).toMatchObject({ hp: 0, running: false, heat: 0, until: null, wait: null })
    expect(sim.result).toBeNull()
  })

  it('no avisa de quién va a bordo más de dos veces por segundo', () => {
    const { sim, structure, hot, board, steps } = setup()
    hot()
    board(0)
    steps(1)
    let changes = 0
    for (let i = 0; i < 60; i++) {
      // El jugador 1 entra y sale del borde en cada paso.
      sim.teleport(1, structure.x + structure.radius + (i % 2 ? 7.9 : 8.1), structure.z, 0, 0)
      changes += steps(1).filter((e) => e.type === 'planeChanged').length
    }
    expect(changes).toBeLessThanOrEqual(2)
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

  it('la copia del cliente descuenta la espera y se queda en 0', () => {
    const { sim, plane, hot, board, steps } = setup()
    hot()
    board(0)
    steps(1)
    sim.structures.follow(10, false)
    expect(plane.wait).toBeCloseTo(PLANE_WAIT - 10)
    sim.structures.follow(PLANE_WAIT, false)
    expect(plane.wait).toBe(0)
  })

  it('se guarda con la partida, también a mitad de la cuenta', () => {
    const { sim, plane, repair, useKey, wait, hot, board } = setup()
    repair()
    useKey(0.1)
    wait(10)
    expect(Simulation.fromJSON(JSON.parse(JSON.stringify(sim.toJSON()))).structures.flying?.plane).toEqual(plane)
    hot()
    board(0)
    wait(10)
    const copy = Simulation.fromJSON(JSON.parse(JSON.stringify(sim.toJSON())))
    expect(copy.structures.flying?.plane).toEqual(plane)
    expect(copy.structures.flying?.plane?.until).not.toBeNull()
  })
})
