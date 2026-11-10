import { describe, expect, it, vi } from 'vitest'
import { deliver, phaseCost } from './builds'
import { Btn } from './commands'
import { HEALTH_MAX, LIT_SHARE, OIL_MAX, OIL_SECONDS, RESPAWN_DAY_DELAY, RESPAWN_LIGHTHOUSE_DELAY, STEP } from './constants'
import { clockOf } from './match'
import { Simulation } from './Simulation'
import { STRUCTURE_DEFS, structureSpot } from './structures'
import { DAY_FRACTION, NIGHT_LENGTH } from './world/daycycle'

const RULES = { players: 3, difficulty: 'normal' } as const

// Varios simulan campanas enteras, minutos de partida.
vi.setConfig({ testTimeout: 30_000 })

/** Una partida justo antes de la noche `day` (por defecto, la Noche Eterna), con un faro acabado al lado. */
function setup(day = 6) {
  const sim = new Simulation(1)
  sim.addPlayer(0)
  sim.addPlayer(1)
  sim.rules = RULES
  const { player, inventory } = sim.slot(0)
  const lighthouse = sim.structures.place({ ...structureSpot(player.pos, 0, STRUCTURE_DEFS.lighthouse.radius, sim.obstacles), valid: true }, 'lighthouse')!
  for (const item of ['stone', 'wood', 'iron_bar', 'mithril_bar', 'crystal'] as const) inventory.add(item, 500)
  for (let i = 0; i < 3; i++) deliver(lighthouse, inventory, RULES)
  inventory.clear()
  sim.setDay(day)
  sim.setPhase(DAY_FRACTION - 0.005)

  const keepAlive = () => {
    for (const slot of sim.inWorld()) if (slot.alive) Object.assign(slot.player, { health: HEALTH_MAX, hunger: 100 })
  }
  /** Un paso con la tecla de uso pulsada. */
  const press = () => {
    keepAlive()
    const tick = sim.tick + 1
    const events = sim.step(new Map([[0, { move: { tick, buttons: Btn.Use, yaw: 0, pitch: 0 }, actions: [] }]]))
    events.push(...sim.step(new Map()))
    return events
  }
  const run = (seconds: number) => {
    const list = []
    for (let i = 0; i < Math.round(seconds / STEP); i++) {
      keepAlive()
      list.push(...sim.step(new Map()))
    }
    return list
  }
  /** Hasta que caiga la Noche Eterna. */
  const fall = () => {
    for (let i = 0; i < 300 && !sim.clock.eternal; i++) run(STEP)
  }
  return { sim, player, inventory, lighthouse, fire: lighthouse.fire!, press, run, fall }
}

describe('el faro', () => {
  it('la cuenta del diseño: un destilador no llega a lo que pide una noche iluminada', () => {
    const needed = (players: number) => Math.ceil((clockOf(players).bell * LIT_SHARE) / OIL_SECONDS)
    const perDistiller = (players: number) => Math.floor(clockOf(players).bell / 60)
    expect([1, 2, 3, 4, 5].map(needed)).toEqual([7, 6, 6, 5, 5])
    expect([1, 2, 3, 4, 5].map(perDistiller)).toEqual([6, 5, 5, 4, 4])
    for (const players of [1, 2, 3, 4, 5]) expect(perDistiller(players)).toBeLessThan(needed(players))
  })

  it('guarda hasta 10 de aceite, y lo que sobra se queda en el inventario', () => {
    const { inventory, fire, press } = setup()
    inventory.add('oil', OIL_MAX + 3)
    press()
    expect(fire.oil).toBe(OIL_MAX)
    expect(inventory.count('oil')).toBe(3)
  })

  it('enciende también antes de la Noche Eterna', () => {
    const { inventory, fire, press } = setup(3)
    inventory.add('oil', 2)
    press()
    press()
    expect(fire).toMatchObject({ burning: true, oil: 1 })
    expect(fire.left).toBeCloseTo(OIL_SECONDS, 0)
  })

  it('una noche normal iluminada no suma vida a los mobs', () => {
    const { sim, fire, press, run } = setup(3)
    fire.oil = OIL_MAX
    press()
    const events = run(NIGHT_LENGTH + 5).map((e) => e.type)
    expect(sim.clock.day).toBe(4)
    expect(events).toContain('nightLit')
    expect(sim.threat.state.litNights).toBe(1)
  })

  it('una noche normal a oscuras sí suma, y sin campana', () => {
    const { sim, run } = setup(3)
    const events = run(NIGHT_LENGTH + 5).map((e) => e.type)
    expect(sim.clock.day).toBe(4)
    expect(events).not.toContain('nightLit')
    expect(events).not.toContain('bell')
    expect(sim.threat.state.litNights).toBe(0)
  })

  it('de día arde y gasta, pero no cuenta para la noche', () => {
    const { sim, fire, press, run } = setup(3)
    sim.setPhase(0.1)
    fire.oil = 2
    press()
    run(10)
    expect(fire.burning).toBe(true)
    expect(fire.left).toBeLessThan(OIL_SECONDS)
    expect(fire.lit).toBe(0)
  })

  it('lo que ardió antes de la Noche Eterna no cuenta para la primera campana', () => {
    const { sim, fire, run, fall } = setup()
    fire.lit = clockOf(3).bell
    fall()
    expect(fire.lit).toBe(0)
    expect(run(clockOf(3).bell).map((e) => e.type)).not.toContain('nightLit')
    expect(sim.threat.state.level).toBe(1)
  })

  it('en una noche normal, con el faro encendido se reaparece en él a los 60 s; de día se sigue esperando 30 s', () => {
    const { sim, fire, lighthouse, press, run } = setup(3)
    fire.oil = OIL_MAX
    press()
    run(5)
    const other = sim.slot(1)
    Object.assign(other.player, { health: 0, hunger: 0 })
    sim.step(new Map())
    expect((other.respawnAt! - sim.tick) * STEP).toBeCloseTo(RESPAWN_LIGHTHOUSE_DELAY, 0)
    run(RESPAWN_LIGHTHOUSE_DELAY)
    expect(Math.hypot(other.player.pos.x - lighthouse.x, other.player.pos.z - lighthouse.z)).toBeLessThan(lighthouse.radius + 3)

    sim.setPhase(0.2)
    Object.assign(other.player, { health: 0, hunger: 0 })
    sim.step(new Map())
    expect((other.respawnAt! - sim.tick) * STEP).toBeCloseTo(RESPAWN_DAY_DELAY, 0)
  })

  it('sin aceite no enciende, y se apaga al acabarse', () => {
    const { inventory, fire, press, run, fall } = setup()
    fall()
    press()
    expect(fire.burning).toBe(false)
    inventory.add('oil', 1)
    press()
    press()
    expect(fire.burning).toBe(true)
    expect(run(OIL_SECONDS + 1).some((e) => e.type === 'fireChanged')).toBe(true)
    expect(fire.burning).toBe(false)
  })

  it('se puede apagar y guarda lo que le quedaba a la unidad', () => {
    const { inventory, fire, press, run, fall } = setup()
    fall()
    inventory.add('oil', 1)
    press()
    press()
    run(10)
    press()
    expect(fire.burning).toBe(false)
    const { left } = fire
    expect(left).toBeGreaterThan(15)
    run(10)
    expect(fire.left).toBe(left)
    press()
    expect(fire.burning).toBe(true)
  })

  it('con dos tercios del tiempo encendido la noche queda iluminada y los mobs no suben', () => {
    const { sim, fire, press, run, fall } = setup()
    fall()
    const { bell } = clockOf(3)
    fire.oil = OIL_MAX
    press()
    run(bell / 2)
    fire.oil = OIL_MAX
    const rang = run(bell / 2 + 1).map((e) => e.type)
    expect(rang).toContain('bell')
    expect(rang).toContain('nightLit')
    expect(sim.threat.state.level).toBe(0)
  })

  it('una noche a oscuras los mobs suben, aunque ardiera un rato', () => {
    const { sim, inventory, press, run, fall } = setup()
    fall()
    inventory.add('oil', 1)
    press()
    press()
    const rang = run(clockOf(3).bell).map((e) => e.type)
    expect(rang).toContain('bell')
    expect(rang).not.toContain('nightLit')
    expect(sim.threat.state.level).toBe(1)
  })

  it('cada campana una unidad dura un 10 % menos', () => {
    const { sim, fire, press, run, fall } = setup()
    fall()
    run(clockOf(3).bell * 2 + 1)
    expect(sim.clock.bells).toBe(2)
    fire.oil = 1
    press()
    expect(fire.left).toBeCloseTo(OIL_SECONDS * 0.81, 0)
  })

  it('con el faro encendido se reaparece en él a los 60 s; apagado, en la campana y en el punto inicial', () => {
    const { sim, fire, lighthouse, press, run, fall } = setup()
    fall()
    fire.oil = OIL_MAX
    press()
    const other = sim.slot(1)
    const kill = () => {
      Object.assign(other.player, { health: 0, hunger: 0 })
      sim.step(new Map())
    }
    kill()
    expect(other.alive).toBe(false)
    expect((other.respawnAt! - sim.tick) * STEP).toBeCloseTo(RESPAWN_LIGHTHOUSE_DELAY, 0)
    fire.oil = OIL_MAX
    run(RESPAWN_LIGHTHOUSE_DELAY)
    expect(other.alive).toBe(true)
    expect(Math.hypot(other.player.pos.x - lighthouse.x, other.player.pos.z - lighthouse.z)).toBeLessThan(lighthouse.radius + 3)

    fire.burning = false
    kill()
    expect(other.respawnAt).toBe(sim.nextDawnTick())
  })

  it('se guarda con la partida', () => {
    const { sim, fire, press, fall } = setup()
    fall()
    fire.oil = 4
    press()
    const copy = Simulation.fromJSON(JSON.parse(JSON.stringify(sim.toJSON())))
    expect(copy.structures.list[0].fire).toEqual(fire)
    expect(copy.structures.burning?.id).toBe(sim.structures.burning?.id)
  })

  it('la lámpara pide mithril: hay que llegar a él', () => {
    expect(phaseCost('lighthouse', 2, RULES).map((c) => c.item)).toContain('mithril_bar')
  })
})
