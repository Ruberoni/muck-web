import { describe, expect, it } from 'vitest'
import type { PlayerCommands } from './commands'
import { maxHealthOf } from './boosts'
import { GAME_OVER_DELAY, HEALTH_MAX, RESPAWN_DAY_DELAY, RESPAWN_SHIELD, STEP } from './constants'
import type { PlayerId, SimEvent } from './events'
import { DIFFICULTIES, DIFFICULTY_DEFS, type Difficulty } from './match'
import { generatePropPlacements } from './props'
import { Simulation } from './Simulation'
import { DAY_FRACTION, DAY_LENGTH } from './world/daycycle'

const placements = generatePropPlacements()
const NIGHT = DAY_FRACTION + 0.05
const DAY_TICKS = Math.round(RESPAWN_DAY_DELAY / STEP)
const GAME_OVER_TICKS = Math.round(GAME_OVER_DELAY / STEP)

/** Una partida de `n` jugadores. */
function withPlayers(n: number, difficulty: Difficulty = 'normal') {
  const sim = new Simulation(3, placements)
  sim.rules = { players: n, difficulty }
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

/** Avanza hasta que pase `type` (como mucho `max` ticks, con `each` antes de cada uno) y devuelve sus eventos. */
function until(sim: Simulation, type: SimEvent['type'], max: number, each = () => {}) {
  for (let i = 0; i < max; i++) {
    each()
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

  it('las mejoras del mercader sobreviven a la muerte, y se reaparece con su vida máxima', () => {
    const sim = withPlayers(2)
    const { player } = sim.slot(1)
    player.boosts = { damage: 2, health: 1 }
    kill(sim, 1)
    until(sim, 'playerRespawn', DAY_TICKS + 1)
    expect(player.boosts).toEqual({ damage: 2, health: 1 })
    expect(player.health).toBe(maxHealthOf(player.boosts))
    expect(player.health).toBeGreaterThan(HEALTH_MAX)
  })

  it('al reaparecer pasa 3 s sin recibir daño ni ser objetivo, aunque tenga un enemigo encima', () => {
    const sim = withPlayers(2)
    sim.teleport(0, sim.spawnCenter.x + 40, sim.spawnCenter.z, 0, 0)
    kill(sim, 1)
    const slot = sim.slot(1)
    until(sim, 'playerRespawn', DAY_TICKS + 1, () => sim.enemies.reset())
    expect(slot.shieldUntil).toBe(sim.tick + Math.round(RESPAWN_SHIELD / STEP))
    const { x, z } = slot.player.pos
    const enemy = sim.enemies.spawnAt(x + 1.3, z)

    for (let i = 0; i < Math.round(RESPAWN_SHIELD / STEP) - 1; i++) {
      expect(idle(sim).filter((e) => e.type === 'playerHurt')).toEqual([])
      expect(enemy.target).not.toBe(1)
    }
    const copy = Simulation.fromJSON(JSON.parse(JSON.stringify(sim.toJSON())), placements)
    expect(copy.slot(1).shieldUntil).toBe(slot.shieldUntil)
    // Se había ido a por el otro: tiene que volver.
    const hurt: SimEvent[] = []
    for (let i = 0; i < 360; i++) hurt.push(...idle(sim))
    expect(enemy.target).toBe(1)
    expect(hurt.filter((e) => e.type === 'playerHurt')).toContainEqual(expect.objectContaining({ id: 1 }))
  })

  it('reiniciar quita la protección', () => {
    const sim = withPlayers(1)
    sim.slot(0).shieldUntil = 1000
    sim.reset()
    expect(sim.slot(0).shieldUntil).toBe(0)
  })

  it('de noche reaparece al amanecer', () => {
    const sim = withPlayers(2)
    sim.setPhase(NIGHT)
    const day = sim.clock.day
    kill(sim, 1)
    const slot = sim.slot(1)
    // Lo que queda de noche: (1 − fase) del ciclo.
    expect((slot.respawnAt! - sim.tick) * STEP).toBeCloseTo((1 - NIGHT) * DAY_LENGTH, 0)
    // Sin enemigos: el otro jugador tiene que seguir vivo hasta el amanecer.
    until(sim, 'playerRespawn', Math.round(DAY_LENGTH / STEP), () => sim.enemies.reset())
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

  it('con todos muertos, game over y a los pocos segundos acaba la partida; empezar otra restaura la isla', () => {
    const sim = withPlayers(2)
    sim.slot(0).inventory.add('wood', 2)
    kill(sim, 0)
    expect(sim.pickups.list).toHaveLength(1)
    const events = kill(sim, 1)
    const over = events.find((e) => e.type === 'gameOver')
    expect(over).toMatchObject({ day: 1 })

    // Mientras dura, nadie reaparece aunque le toque.
    const ended = until(sim, 'matchEnded', GAME_OVER_TICKS + 1)
    expect(sim.tick).toBe(over!.tick + GAME_OVER_TICKS)
    expect(ended[0]).toMatchObject({ type: 'matchEnded', result: { end: 'lost', day: 1, players: [{ id: 0, deaths: 1 }, { id: 1, deaths: 1 }] } })
    expect(ended.some((e) => e.type === 'playerRespawn')).toBe(false)

    sim.startMatch({ players: 2, difficulty: 'hard' })
    expect(idle(sim)[0]).toMatchObject({ type: 'worldReset' })
    expect(sim.inWorld().map((s) => [s.alive, s.respawnAt, s.deaths])).toEqual([[true, null, 0], [true, null, 0]])
    expect(sim.pickups.list).toHaveLength(0)
    expect(sim.clock.day).toBe(1)
    expect(sim.result).toBeNull()
    expect(sim.rules.difficulty).toBe('hard')
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
    // El muerto sigue esperando su reaparición y la partida no acaba.
    const respawn = until(sim, 'playerRespawn', DAY_TICKS + 1)
    expect(respawn.some((e) => e.type === 'matchEnded')).toBe(false)
    expect(sim.slot(0).alive).toBe(true)

    // Un jugador nuevo también lo cancela.
    kill(sim, 0)
    kill(sim, 1)
    sim.addPlayer()
    expect(idle(sim).map((e) => e.type)).toContain('gameOverCancelled')
    for (let i = 0; i < GAME_OVER_TICKS + 1; i++) expect(idle(sim).some((e) => e.type === 'matchEnded')).toBe(false)
  })

  it('respawnAt y el game over pendiente sobreviven a toJSON/fromJSON', () => {
    const sim = withPlayers(2)
    kill(sim, 0)
    kill(sim, 1)
    const copy = Simulation.fromJSON(JSON.parse(JSON.stringify(sim.toJSON())), placements)
    expect(copy.slot(0).respawnAt).toBe(sim.slot(0).respawnAt)
    for (let i = 0; i < GAME_OVER_TICKS; i++) expect(JSON.stringify(idle(copy))).toBe(JSON.stringify(idle(sim)))
    expect(copy.toJSON()).toEqual(sim.toJSON())
  })
})

describe('Noche Eterna', () => {
  /** Una partida a punto de que caiga la Noche Eterna. */
  function nearEternal() {
    const sim = withPlayers(3)
    sim.setDay(5)
    sim.setPhase(0.99)
    sim.setDay(6)
    sim.setPhase(DAY_FRACTION - 0.0001)
    return sim
  }

  it('avisa al caer y en cada campana, y lo que dependía del amanecer pasa con ella', () => {
    const sim = nearEternal()
    const fallen = until(sim, 'eternalNight', 120)
    expect(sim.clock.eternal).toBe(true)
    expect(fallen.some((e) => e.type === 'bell')).toBe(false)

    // Muerto en la Noche Eterna se espera a la siguiente campana.
    kill(sim, 0)
    const { respawnAt } = sim.slot(0)
    expect(respawnAt).toBe(sim.nextDawnTick())
    const ring = until(sim, 'bell', 60 * 60 * 6)
    expect(ring.find((e) => e.type === 'bell')).toMatchObject({ night: 7 })
    expect(sim.tick).toBe(respawnAt)
    expect(sim.slot(0).alive).toBe(true)
  })

  it('guardar en plena Noche Eterna no cambia nada', () => {
    const sim = nearEternal()
    until(sim, 'eternalNight', 120)
    const copy = Simulation.fromJSON(JSON.parse(JSON.stringify(sim.toJSON())), placements)
    expect(copy.clock.eternal).toBe(true)
    expect(copy.clock.day).toBe(sim.clock.day)
    expect(copy.clock.phase).toBe(sim.clock.phase)
    expect(copy.nextDawnTick()).toBe(sim.nextDawnTick())
  })
})

describe('partida en solitario', () => {
  it('3 vidas en fácil, 2 en normal y 1 en difícil o ultrahard', () => {
    expect(DIFFICULTIES.map((d) => DIFFICULTY_DEFS[d].lives)).toEqual([3, 2, 1, 1])
  })

  it('con vidas de sobra suelta el inventario y reaparece', () => {
    const sim = withPlayers(1, 'easy')
    sim.slot(0).inventory.add('wood', 4)
    expect(kill(sim, 0).map((e) => e.type)).toContain('playerDied')
    expect(sim.slot(0).inventory.toJSON()).toEqual({})
    expect(sim.pickups.list.map((p) => [p.item, p.amount])).toEqual([['wood', 4]])
    const events = until(sim, 'playerRespawn', DAY_TICKS + 1)
    expect(events.some((e) => e.type === 'gameOver')).toBe(false)
    expect(sim.slot(0)).toMatchObject({ alive: true, deaths: 1 })
  })

  it('al gastar la última se acaba la partida, sin reaparecer', () => {
    const sim = withPlayers(1, 'normal')
    kill(sim, 0)
    until(sim, 'playerRespawn', DAY_TICKS + 1)
    expect(kill(sim, 0).some((e) => e.type === 'gameOver')).toBe(true)
    const ended = until(sim, 'matchEnded', GAME_OVER_TICKS + 1)
    expect(ended.find((e) => e.type === 'matchEnded')).toMatchObject({ result: { end: 'lost', players: [{ id: 0, deaths: 2 }] } })
    expect(ended.some((e) => e.type === 'playerRespawn')).toBe(false)
    expect(sim.slot(0).alive).toBe(false)
  })

  it('en difícil la primera muerte acaba la partida', () => {
    const sim = withPlayers(1, 'hard')
    expect(kill(sim, 0).some((e) => e.type === 'gameOver')).toBe(true)
  })

  it('rendirse acaba la partida una vez', () => {
    const sim = withPlayers(1)
    sim.finish('surrendered')
    sim.finish('lost')
    expect(idle(sim).filter((e) => e.type === 'matchEnded')).toMatchObject([{ result: { end: 'surrendered' } }])
    expect(sim.result?.end).toBe('surrendered')
  })
})
