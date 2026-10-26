import { describe, expect, it } from 'vitest'
import { Btn, type Action, type ActionData, type Move } from './commands'
import { EYE_HEIGHT, HIT_COOLDOWN, STEP } from './constants'
import { aimPose } from './interaction'
import { generatePropPlacements, type PropData } from './props'
import { Simulation } from './Simulation'
import { DAY_FRACTION } from './world/daycycle'
import { heightAt } from './world/terrain'

const placements = generatePropPlacements()
const NIGHT = DAY_FRACTION + 0.05

/** Comandos de un tick: botones, orientación y acciones (sin numerar). */
interface Command {
  buttons?: number
  yaw?: number
  pitch?: number
  actions?: ActionData[]
}

/** Simulación con un solo jugador, el 0, como la de LocalSession. */
function solo(seed: number) {
  const sim = new Simulation(seed, placements)
  sim.addPlayer(0)
  return sim
}

/** Como LocalSession: numera las acciones a continuación de la última aplicada. */
function step(sim: Simulation, { buttons = 0, yaw = sim.slot(0).player.yaw, pitch = sim.slot(0).player.pitch, actions = [] }: Command = {}) {
  const tick = sim.tick + 1
  let seq = sim.slot(0).appliedSeq
  const move: Move = { tick, buttons, yaw, pitch }
  return sim.step(new Map([[0, { move, actions: actions.map((a): Action => ({ ...a, seq: ++seq, tick })) }]]))
}

/** Teletransporta al jugador delante del prop, mirándolo, y devuelve la orientación para los `Move`. */
function aimAt(sim: Simulation, prop: PropData) {
  const isFree = (x: number, z: number) => sim.world.props.every((o) => o === prop || !o.alive || Math.hypot(o.x - x, o.z - z) > o.radius + 0.4)
  const pose = aimPose(prop, isFree)
  const pitch = Math.atan2(pose.aimY - heightAt(pose.x, pose.z) - EYE_HEIGHT, pose.horizontal)
  sim.teleport(0, pose.x, pose.z, pose.yaw, pitch)
  return { yaw: pose.yaw, pitch }
}

const firstTree = (sim: Simulation) => sim.world.props.find((p) => p.kind === 'tree')!

describe('Simulation', () => {
  it('con la misma semilla y los mismos comandos da el mismo resultado', () => {
    const run = () => {
      const sim = solo(42)
      const look = aimAt(sim, firstTree(sim))
      sim.setPhase(NIGHT)
      const events = []
      for (let i = 0; i < 600; i++) events.push(...step(sim, { ...look, buttons: i % 120 < 60 ? Btn.Attack : Btn.Fwd }))
      return { state: JSON.stringify(sim.toJSON()), events: JSON.stringify(events) }
    }
    expect(run()).toEqual(run())
  })

  it('un clic (swing) golpea aunque el ataque no esté mantenido', () => {
    const sim = solo(1)
    const tree = firstTree(sim)
    const look = aimAt(sim, tree)
    const events = step(sim, { ...look, actions: [{ kind: 'swing' }] })
    expect(events.map((e) => e.type)).toContain('playerSwing')
    expect(tree.hp).toBe(tree.maxHp - 1)
  })

  it('un clic durante el cooldown queda pendiente y golpea al acabar, sin duplicar con el ataque mantenido', () => {
    const sim = solo(1)
    const look = aimAt(sim, firstTree(sim))
    const swings: number[] = []
    const run = (ticks: number, command: Command) => {
      for (let i = 0; i < ticks; i++) {
        if (step(sim, { ...look, ...command }).some((e) => e.type === 'playerSwing')) swings.push(sim.tick)
        command = { ...command, actions: [] }
      }
    }
    // Clic con el botón mantenido: un solo golpe.
    run(1, { buttons: Btn.Attack, actions: [{ kind: 'swing' }] })
    // Suelta y vuelve a hacer clic a media espera: el golpe llega justo al acabar el cooldown.
    run(5, {})
    run(1, { actions: [{ kind: 'swing' }] })
    run(60, {})
    const cooldownTicks = Math.round(HIT_COOLDOWN / STEP)
    expect(swings).toEqual([1, 1 + cooldownTicks])
  })

  it('una acción con seq ya aplicado se descarta', () => {
    const sim = solo(1)
    sim.slot(0).inventory.add('wood', 1)
    sim.slot(0).inventory.add('stone', 1)
    const move = (tick: number): Move => ({ tick, buttons: 0, yaw: 0, pitch: 0 })
    sim.step(new Map([[0, { move: move(1), actions: [{ seq: 1, tick: 1, kind: 'select', slot: 1 }] }]]))
    expect(sim.slot(0).inventory.selected).toBe(1)
    // Reenviada (p. ej. porque no llegó el ack): no se vuelve a aplicar.
    sim.slot(0).inventory.select(0)
    sim.step(new Map([[0, { move: move(2), actions: [{ seq: 1, tick: 1, kind: 'select', slot: 1 }] }]]))
    expect(sim.slot(0).inventory.selected).toBe(0)
    expect(sim.slot(0).appliedSeq).toBe(1)
  })

  it('el reloj sale del tick; setPhase y reset lo cambian y lo avisan con un evento', () => {
    const sim = solo(1)
    for (let i = 0; i < 60; i++) step(sim)
    expect(sim.clock.elapsed).toBeCloseTo(1, 9)
    sim.setPhase(NIGHT)
    expect(sim.clock.phase).toBeCloseTo(NIGHT, 4)
    expect(step(sim).map((e) => e.type)).toContain('clockSet')

    sim.slot(0).inventory.add('wood', 3)
    sim.reset()
    expect(sim.clock.elapsed).toBe(0)
    expect(sim.slot(0).inventory.toJSON()).toEqual({})
    const events = step(sim)
    expect(events[0]).toMatchObject({ type: 'worldReset', worldStartTick: sim.tick - 1 })
  })

  it('serializar, restaurar y seguir da lo mismo que no serializar', () => {
    const a = solo(7)
    const { inventory, player } = a.slot(0)
    inventory.add('wood', 20)
    inventory.add('stone', 10)
    inventory.add('berry', 3)
    player.hunger = 50
    const tree = firstTree(a)
    const look = aimAt(a, tree)

    // Lo que se hace en cada tick; lo mismo para las dos simulaciones a partir del corte.
    const script = (sim: Simulation, t: number): Command => {
      if (t === 150) sim.setPhase(NIGHT)
      const slot = sim.slot(0).inventory.slots.indexOf('campfire')
      const actions: ActionData[] =
        t === 100 ? [{ kind: 'craft', recipe: 'campfire' }]
        : t === 101 && slot >= 0 ? [{ kind: 'select', slot }]
        : t === 110 ? [{ kind: 'place' }]
        : t === 111 ? [{ kind: 'select', slot: 0 }]
        : t === 120 ? [{ kind: 'eat' }]
        : t === 130 ? [{ kind: 'move', from: 1, to: 15 }]
        : t % 47 === 0 ? [{ kind: 'swing' }]
        : []
      if (t < 90) return { ...look, buttons: Btn.Attack }
      if (t < 150) return { ...look, actions }
      // De noche: anda en círculos, salta y golpea de vez en cuando mientras llegan los enemigos.
      const buttons = Btn.Fwd | (t % 90 === 0 ? Btn.Jump : 0) | (t % 200 < 100 ? Btn.Sprint : 0) | (t % 60 < 20 ? Btn.Attack : 0)
      return { yaw: look.yaw + t * 0.01, pitch: 0, buttons, actions }
    }

    const SPLIT = 500
    for (let t = 1; t <= SPLIT; t++) step(a, script(a, t))
    expect(tree.alive).toBe(false)
    expect(a.structures.list.length).toBe(1)
    expect(a.enemies.list.length).toBeGreaterThan(0)
    expect(a.slot(0).inventory.slots[15]).not.toBe(null)

    const b = Simulation.fromJSON(JSON.parse(JSON.stringify(a.toJSON())), placements)
    expect(JSON.stringify(b.toJSON())).toBe(JSON.stringify(a.toJSON()))
    const seen = new Set<string>()
    for (let t = SPLIT + 1; t <= SPLIT + 900; t++) {
      const eventsA = step(a, script(a, t))
      const eventsB = step(b, script(b, t))
      expect(JSON.stringify(eventsB)).toBe(JSON.stringify(eventsA))
      for (const e of eventsA) seen.add(e.type)
    }
    // Tras el corte siguen pasando cosas que dependen del estado restaurado.
    expect([...seen]).toEqual(expect.arrayContaining(['enemySpawn', 'enemyAttack', 'playerHurt', 'playerSwing']))
    expect(JSON.stringify(b.toJSON())).toBe(JSON.stringify(a.toJSON()))
    expect(b.slot(0).inventory.slots).toEqual(a.slot(0).inventory.slots)
  })
})
