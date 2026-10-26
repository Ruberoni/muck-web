import { describe, expect, it } from 'vitest'
import type { PlayerCommands } from './commands'
import { GAME_OVER_DELAY, HEALTH_MAX, RESPAWN_DAY_DELAY, STEP } from './constants'
import type { PlayerId, SimEvent } from './events'
import { generatePropPlacements } from './props'
import { Simulation } from './Simulation'
import { DAY_FRACTION, DAY_LENGTH } from './world/daycycle'

const placements = generatePropPlacements()
const NIGHT = DAY_FRACTION + 0.05
const DAY_TICKS = Math.round(RESPAWN_DAY_DELAY / STEP)
const GAME_OVER_TICKS = Math.round(GAME_OVER_DELAY / STEP)

/** Una sala (o, con `coop` false, una partida de un jugador) con `n` jugadores. */
function withPlayers(n: number, coop = true) {
  const sim = new Simulation(3, placements)
  sim.coop = coop
  for (let i = 0; i < n; i++) sim.addPlayer()
  return sim
}

/** Un tick en el que todos se quedan quietos. */
const idle = (sim: Simulation) => sim.step(new Map<PlayerId, PlayerCommands>())

/** Sin vida ni hambre: muere al final del siguiente tick. */
function kill(sim: Simulation, id: PlayerId) {
  Object.assign(sim.slot(id).player, { health: 0, hunger: 0 })
  return idle(sim)
}

/** Avanza hasta que pase `type` (como mucho `max` ticks) y devuelve sus eventos. */
function until(sim: Simulation, type: SimEvent['type'], max: number) {
  for (let i = 0; i < max; i++) {
    const events = idle(sim)
    if (events.some((e) => e.type === type)) return events
  }
  throw new Error(`sin ${type} en ${max} ticks`)
}

describe('muerte en una sala', () => {
  it('el inventario (hotbar y mochila) cae en un montón por objeto donde murió', () => {
    const sim = withPlayers(2)
    const { inventory, player } = sim.slot(1)
    inventory.add('wood', 7)
    inventory.add('stone', 3)
    inventory.add('stone_axe', 1)
    // La mochila también cae.
    inventory.move(1, 20)
    const at = { ...player.pos }
    const events = kill(sim, 1)

    expect(events.filter((e) => e.type === 'playerDied')).toEqual([expect.objectContaining({ id: 1 })])
    const piles = events.filter((e) => e.type === 'pickupSpawn')
    expect(piles.map((e) => [e.item, e.amount]).sort()).toEqual([['stone', 3], ['stone_axe', 1], ['wood', 7]])
    expect(inventory.toJSON()).toEqual({})
    for (const p of sim.pickups.list) expect(Math.hypot(p.pos.x - at.x, p.pos.z - at.z)).toBeLessThan(0.5)
    // El otro no se los lleva por estar cerca: los recoge quien pase por encima, como cualquier objeto.
    expect(sim.slot(1).alive).toBe(false)
  })

  it('de día reaparece a los 30 s en su punto de aparición, con todo lleno y sin nada', () => {
    const sim = withPlayers(2)
    sim.teleport(1, sim.spawnCenter.x + 20, sim.spawnCenter.z, 1.2, 0.3)
    const died = kill(sim, 1)[0].tick
    const slot = sim.slot(1)
    expect(slot.respawnAt).toBe(died + DAY_TICKS)

    const events = until(sim, 'playerRespawn', DAY_TICKS + 1)
    expect(sim.tick).toBe(died + DAY_TICKS)
    expect(events.find((e) => e.type === 'playerRespawn')).toMatchObject({ id: 1, x: slot.spawn.x, z: slot.spawn.z })
    expect(slot).toMatchObject({ alive: true, respawnAt: null })
    expect(slot.player).toMatchObject({ health: HEALTH_MAX, pos: expect.objectContaining({ x: slot.spawn.x, z: slot.spawn.z }) })
    // Sigue mirando a donde miraba: la orientación es del ratón del cliente.
    expect(slot.player.yaw).toBe(1.2)
  })

  it('de noche reaparece al amanecer', () => {
    const sim = withPlayers(2)
    sim.setPhase(NIGHT)
    const day = sim.clock.day
    kill(sim, 1)
    const slot = sim.slot(1)
    // Lo que queda de noche: (1 − fase) del ciclo.
    expect((slot.respawnAt! - sim.tick) * STEP).toBeCloseTo((1 - NIGHT) * DAY_LENGTH, 0)
    until(sim, 'playerRespawn', Math.round(DAY_LENGTH / STEP))
    expect(sim.clock.day).toBe(day + 1)
    expect(sim.clock.phase).toBeLessThan(0.001)
  })

  it('un muerto no se mueve ni pasa hambre, y no reaparece mientras no está en el mundo', () => {
    const sim = withPlayers(2)
    const died = kill(sim, 1)[0].tick
    const { player } = sim.slot(1)
    const pos = { ...player.pos }
    sim.setConnection(1, 'gone')
    for (let i = 0; i < DAY_TICKS + 10; i++) idle(sim)
    expect(sim.slot(1).alive).toBe(false)
    expect(player.pos).toEqual(pos)
    // Al volver, reaparece en el siguiente tick.
    sim.setConnection(1, 'present')
    const events = idle(sim)
    expect(events.some((e) => e.type === 'playerRespawn' && e.id === 1)).toBe(true)
    expect(sim.tick).toBeGreaterThan(died + DAY_TICKS)
  })

  it('con todos muertos, game over y a los pocos segundos la isla se reinicia', () => {
    const sim = withPlayers(2)
    sim.slot(0).inventory.add('wood', 2)
    kill(sim, 0)
    expect(sim.pickups.list).toHaveLength(1)
    const events = kill(sim, 1)
    const over = events.find((e) => e.type === 'gameOver')
    expect(over).toMatchObject({ day: 1 })

    // Mientras dura, nadie reaparece aunque le toque.
    const reset = until(sim, 'worldReset', GAME_OVER_TICKS + 1)
    expect(sim.tick).toBe(over!.tick + GAME_OVER_TICKS)
    expect(reset[0]).toMatchObject({ type: 'worldReset', worldStartTick: sim.tick })
    expect(reset.some((e) => e.type === 'playerRespawn')).toBe(false)
    expect(sim.inWorld().map((s) => [s.alive, s.respawnAt])).toEqual([[true, null], [true, null]])
    expect(sim.pickups.list).toHaveLength(0)
    expect(sim.clock.day).toBe(1)
  })

  it('los que no están en el mundo no cuentan: si el único vivo se va, game over', () => {
    const sim = withPlayers(2)
    kill(sim, 0)
    expect(sim.inWorld().some((s) => s.alive)).toBe(true)
    sim.setConnection(1, 'gone')
    expect(idle(sim).some((e) => e.type === 'gameOver')).toBe(true)
  })

  it('si entra o vuelve alguien vivo durante la cuenta atrás, el game over se cancela', () => {
    const sim = withPlayers(2)
    kill(sim, 0)
    sim.setConnection(1, 'gone')
    expect(idle(sim).some((e) => e.type === 'gameOver')).toBe(true)
    idle(sim)
    // Vuelve el que estaba vivo (una reconexión, por ejemplo).
    sim.setConnection(1, 'present')
    const events = idle(sim)
    expect(events.map((e) => e.type)).toContain('gameOverCancelled')
    // El muerto sigue esperando su reaparición y la isla no se reinicia.
    const respawn = until(sim, 'playerRespawn', DAY_TICKS + 1)
    expect(respawn.some((e) => e.type === 'worldReset')).toBe(false)
    expect(sim.slot(0).alive).toBe(true)

    // Un jugador nuevo también lo cancela.
    kill(sim, 0)
    kill(sim, 1)
    sim.addPlayer()
    expect(idle(sim).map((e) => e.type)).toContain('gameOverCancelled')
    for (let i = 0; i < GAME_OVER_TICKS + 1; i++) expect(idle(sim).some((e) => e.type === 'worldReset')).toBe(false)
  })

  it('respawnAt y el game over pendiente sobreviven a toJSON/fromJSON', () => {
    const sim = withPlayers(2)
    kill(sim, 0)
    kill(sim, 1)
    const copy = Simulation.fromJSON(JSON.parse(JSON.stringify(sim.toJSON())), placements)
    copy.coop = true
    expect(copy.slot(0).respawnAt).toBe(sim.slot(0).respawnAt)
    for (let i = 0; i < GAME_OVER_TICKS; i++) expect(JSON.stringify(idle(copy))).toBe(JSON.stringify(idle(sim)))
    expect(copy.toJSON()).toEqual(sim.toJSON())
  })
})

describe('muerte con un jugador', () => {
  it('como siempre: se queda muerto con su inventario y sin game over (el cliente reinicia la isla)', () => {
    const sim = withPlayers(1, false)
    sim.slot(0).inventory.add('wood', 4)
    const events = kill(sim, 0)
    expect(events.map((e) => e.type)).toEqual(['playerDied'])
    for (let i = 0; i < DAY_TICKS + GAME_OVER_TICKS; i++) expect(idle(sim)).toEqual([])
    expect(sim.slot(0)).toMatchObject({ alive: false, respawnAt: null })
    expect(sim.slot(0).inventory.toJSON()).toEqual({ wood: 4 })
  })
})
