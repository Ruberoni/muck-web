import { describe, expect, it } from 'vitest'
import { HIT_COOLDOWN, STEP } from './constants'
import { createCombat, startSwing, stepStrike } from './interaction'
import { swingCooldown, swingImpact } from './tiers'

/** Un paso como en `useHands`: primero lo que pega, después lo que empieza. */
function tick(combat: ReturnType<typeof createCombat>, item: Parameters<typeof startSwing>[4], attack = true, cancel = false) {
  const strike = stepStrike(combat, STEP, item, cancel)
  const swing = startSwing(combat, STEP, attack, false, item)
  return { swing, strike }
}

describe('el golpe del jugador', () => {
  it('empieza y pega swingImpact segundos después, nunca en el mismo paso', () => {
    const combat = createCombat()
    expect(tick(combat, 'stone_axe')).toEqual({ swing: true, strike: false })
    const steps = Math.ceil(swingImpact('stone_axe') / STEP - 1e-6)
    for (let i = 1; i < steps; i++) expect(tick(combat, 'stone_axe', false).strike).toBe(false)
    expect(tick(combat, 'stone_axe', false).strike).toBe(true)
    expect(combat.strikeLeft).toBe(0)
  })

  it('pega antes de poder empezar el siguiente, con cualquier arma', () => {
    for (const item of [null, 'wood_sword', 'meteor_sword', 'iron_axe', 'mithril_pickaxe'] as const) expect(swingImpact(item), String(item)).toBeLessThan(swingCooldown(item))
    expect(swingCooldown(null)).toBe(HIT_COOLDOWN)
  })

  it('se pierde si cambia lo que se lleva en la mano o si se levanta el escudo', () => {
    const swapped = createCombat()
    tick(swapped, 'stone_axe')
    expect(tick(swapped, 'wood_sword', false).strike).toBe(false)
    expect(swapped.strikeLeft).toBe(0)
    const blocked = createCombat()
    tick(blocked, 'stone_axe')
    expect(tick(blocked, 'stone_axe', false, true).strike).toBe(false)
    for (let i = 0; i < 30; i++) expect(tick(blocked, 'stone_axe', false).strike).toBe(false)
  })
})
