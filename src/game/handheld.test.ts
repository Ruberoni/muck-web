import { describe, expect, it } from 'vitest'
import { ACTION_DURATION, actionPose, Handheld, type HandAction } from './handheld'
import { ITEM_NAMES, type ItemId } from './inventory'

describe('objeto en la mano', () => {
  it('hay modelo para cada objeto', () => {
    const hand = new Handheld(16 / 9)
    for (const item of Object.keys(ITEM_NAMES) as ItemId[]) {
      hand.setItem(item)
      expect(hand.item).toBe(item)
    }
    hand.setItem(null)
    expect(hand.item).toBeNull()
  })

  it('cada animación empieza y acaba en reposo', () => {
    for (const action of Object.keys(ACTION_DURATION) as HandAction[]) {
      for (const p of [0, 1]) {
        const pose = actionPose(action, p)
        for (const v of Object.values(pose)) expect(Math.abs(v)).toBeLessThan(1e-9)
      }
    }
  })

  it('el golpe echa el brazo atrás y luego golpea hacia delante', () => {
    expect(actionPose('swing', 0.25).rx).toBeGreaterThan(0)
    expect(actionPose('swing', 0.5).rx).toBeLessThan(-0.5)
    expect(actionPose('swing', 0.5).z).toBeLessThan(0)
  })

  it('la animación termina tras su duración', () => {
    const hand = new Handheld(1)
    hand.play('swing')
    hand.update(ACTION_DURATION.swing / 2, 0, true)
    expect(hand.action).toBe('swing')
    hand.update(ACTION_DURATION.swing, 0, true)
    expect(hand.action).toBeNull()
  })

  it('comiendo, el objeto no cambia hasta acabar; golpeando sí', () => {
    const hand = new Handheld(1)
    hand.setItem('berry')
    hand.play('eat')
    hand.setItem(null)
    expect(hand.item).toBe('berry')
    hand.update(ACTION_DURATION.eat + 0.01, 0, true)
    hand.setItem(null)
    expect(hand.item).toBeNull()

    hand.setItem('wood_axe')
    hand.play('eat', 'berry')
    expect(hand.item).toBe('berry')
    hand.update(ACTION_DURATION.eat + 0.01, 0, true)
    hand.setItem('wood_axe')
    expect(hand.item).toBe('wood_axe')

    hand.play('swing')
    hand.setItem('stone_axe')
    expect(hand.item).toBe('stone_axe')
    expect(hand.action).toBeNull()
  })
})
