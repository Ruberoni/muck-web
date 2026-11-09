import { describe, expect, it } from 'vitest'
import { DAZED_DAMAGE, ENEMY_DEFS, SPECIAL_GAP, STEP } from './constants'
import { Enemies } from './enemies'
import { Hazards, ticks } from './hazards'
import { mulberry32 } from './random'
import type { SimEventData } from './events'

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
