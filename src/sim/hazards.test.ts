import { describe, expect, it } from 'vitest'
import { DAZED_DAMAGE, ENEMY_DEFS, SHELL_BROKEN_PACE, SPECIAL_GAP, STEP } from './constants'
import { Enemies } from './enemies'
import { Hazards, ticks } from './hazards'
import { mulberry32 } from './random'
import type { SimEventData } from './events'
import { Simulation } from './Simulation'

const at = (x: number, z: number, grounded = true) => ({ id: 0, pos: { x, z }, alive: true, grounded })

describe('los peligros de los jefes', () => {
  it('una zona avisa y daña una vez, en su tick, a quien esté dentro', () => {
    const hazards = new Hazards()
    hazards.add({ look: 'rock', x: 0, z: 0, radius: 2, startTick: 0, hitTick: 10, damage: 15 })
    for (let tick = 0; tick < 10; tick++) expect(hazards.step(tick, [at(0.5, 0)])).toEqual([])
    expect(hazards.step(10, [at(0.5, 0), { ...at(5, 0), id: 1 }])).toEqual([{ playerId: 0, damage: 15 }])
    expect(hazards.list).toHaveLength(0)
  })

  it('una onda crece desde su centro, da una vez y se esquiva saltando', () => {
    const run = (grounded: boolean) => {
      const hazards = new Hazards()
      hazards.add({ look: 'stomp', x: 0, z: 0, radius: 7, startTick: 0, hitTick: 0, damage: 20, ring: { speed: 12, width: 1.2 } })
      let damage = 0
      for (let tick = 0; tick < ticks(2); tick++) for (const d of hazards.step(tick, [at(4, 0, grounded)])) damage += d.damage
      return damage
    }
    expect(run(true)).toBe(20)
    expect(run(false)).toBe(0)
  })

  it('el suelo ardiendo quema a pulsos mientras dura', () => {
    const hazards = new Hazards()
    hazards.add({ look: 'fire', x: 0, z: 0, radius: 2, startTick: 0, hitTick: 0, endTick: ticks(2), pulse: ticks(0.5), damage: 4 })
    let damage = 0
    for (let tick = 0; tick <= ticks(3); tick++) for (const d of hazards.step(tick, [at(0, 0)])) damage += d.damage
    expect(damage).toBe(4 * 5)
  })

  it('el gigante avisa, pisa y queda agotado recibiendo el doble; luego espera', () => {
    const events: SimEventData[] = []
    const specials: string[] = []
    const enemies = new Enemies([], mulberry32(1), (e) => events.push(e), undefined, undefined, (_e, id) => specials.push(id))
    const boss = enemies.spawnAt(0, 0, 'giant')
    const player = { id: 0, pos: { x: 3, z: 0 }, alive: true }
    const stomp = ENEMY_DEFS.giant.specials!.find((s) => s.id === 'stomp')!
    let t = 0
    while (!specials.length && t < 5) {
      enemies.step(STEP, [player], 0.3, 3)
      player.pos.x = boss.pos.x + 3
      t += STEP
    }
    expect(specials).toEqual(['stomp'])
    expect(t).toBeGreaterThanOrEqual(stomp.windup - STEP)
    expect(boss.special.recover).toBe(true)
    const hp = boss.hp
    enemies.hit(boss, 100, player.pos, 0)
    expect(hp - boss.hp).toBeCloseTo(Math.max(0, 100) * DAZED_DAMAGE, 0)
    // Tras lo agotado y la espera común no repite enseguida.
    for (let i = 0; i < Math.round((stomp.recover + SPECIAL_GAP * 0.5) / STEP); i++) {
      enemies.step(STEP, [player], 0.3, 3)
      player.pos.x = boss.pos.x + 3
    }
    expect(specials).toEqual(['stomp'])
    expect(events.some((e) => e.type === 'enemySpecial')).toBe(true)
  })
})

describe('los ataques del guardián y del Coloso', () => {
  /** Un jefe a `distance` metros del jugador, quieto: hasta su primer ataque especial; devuelve cuál y lo que deja. */
  const first = (type: 'guardian' | 'colossus', distance: number) => {
    const sim = new Simulation(1)
    sim.addPlayer(0)
    const { player } = sim.slot(0)
    const boss = sim.enemies.spawnAt(player.pos.x + distance, player.pos.z, type)
    let attack: string | null = null
    for (let i = 0; i < ticks(4) && !attack; i++) {
      Object.assign(player, { health: 100 })
      for (const e of sim.step(new Map())) if (e.type === 'enemySpecial') attack = e.attack
    }
    const def = ENEMY_DEFS[type].specials!.find((s) => s.id === attack)!
    for (let i = 0; i < ticks(def.windup) + 1; i++) sim.step(new Map())
    return { sim, boss, player, attack, hazards: sim.hazards.list, projectiles: sim.projectiles.list }
  }

  it('el guardián, pegado, suelta un anillo de fuego que se esquiva saltando', () => {
    const { attack, hazards } = first('guardian', 2.5)
    expect(attack).toBe('fireRing')
    expect(hazards).toHaveLength(1)
    expect(hazards[0]).toMatchObject({ look: 'fire', ring: { speed: expect.any(Number) } })
  })

  it('el guardián, de lejos, prende tres charcos alrededor del jugador que queman a pulsos', () => {
    const { attack, hazards, player } = first('guardian', 10)
    expect(attack).toBe('burningGround')
    expect(hazards).toHaveLength(3)
    for (const h of hazards) {
      expect(h).toMatchObject({ look: 'fire', pulse: ticks(0.5) })
      expect(Math.hypot(h.x - player.pos.x, h.z - player.pos.z)).toBeLessThan(6)
      expect((h.endTick - h.hitTick) * STEP).toBeCloseTo(5)
    }
  })

  it('el Coloso, pegado, avisa y estalla a su alrededor', () => {
    const { attack, hazards, boss } = first('colossus', 2.5)
    expect(attack).toBe('pulse')
    expect(hazards).toHaveLength(1)
    expect(hazards[0]).toMatchObject({ look: 'crystal', x: boss.pos.x, z: boss.pos.z })
    expect(hazards[0].hitTick).toBeGreaterThan(hazards[0].startTick)
  })

  it('el Coloso levanta una fila de pilares hacia el jugador, uno tras otro', () => {
    const { attack, hazards, boss, player } = first('colossus', 10)
    expect(attack).toBe('pillars')
    expect(hazards).toHaveLength(6)
    const toward = Math.atan2(player.pos.z - boss.pos.z, player.pos.x - boss.pos.x)
    for (let i = 0; i < hazards.length; i++) {
      const h = hazards[i]
      expect(Math.atan2(h.z - boss.pos.z, h.x - boss.pos.x)).toBeCloseTo(toward, 1)
      if (i) expect(h.hitTick).toBeGreaterThan(hazards[i - 1].hitTick)
    }
  })

  it('el Coloso lanza un abanico de cinco esquirlas, la del centro hacia el jugador', () => {
    const { attack, projectiles } = first('colossus', 18)
    expect(attack).toBe('shardFan')
    expect(projectiles.filter((p) => p.kind === 'shard')).toHaveLength(5)
  })

  it('el haz de luz apunta 2 s y cae donde estaba el jugador al acabar, 0,8 s después', () => {
    const { attack, hazards, player } = first('colossus', 26)
    expect(attack).toBe('lightBeam')
    expect(hazards).toHaveLength(1)
    expect(hazards[0]).toMatchObject({ look: 'light' })
    expect(Math.hypot(hazards[0].x - player.pos.x, hazards[0].z - player.pos.z)).toBeLessThan(0.01)
    expect((hazards[0].hitTick - hazards[0].startTick) * STEP).toBeCloseTo(0.8, 1)
  })

  it('con la coraza rota, el Coloso repite antes', () => {
    const cooldownAfter = (broken: boolean) => {
      const enemies = new Enemies([], mulberry32(1), undefined, undefined, undefined, () => {})
      const boss = enemies.spawnAt(0, 0, 'colossus')
      if (broken) boss.shell = 0
      enemies.step(STEP, [{ id: 0, pos: { x: 2.5, z: 0 }, alive: true }], 0.3, 1)
      return boss.special.cooldowns.pulse!
    }
    expect(cooldownAfter(true) / cooldownAfter(false)).toBeCloseTo(SHELL_BROKEN_PACE, 2)
  })
})
