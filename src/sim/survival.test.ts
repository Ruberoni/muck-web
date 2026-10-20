import { describe, expect, it } from 'vitest'
import {
  HEALTH_MAX,
  HEALTH_REGEN_HUNGER,
  HUNGER_DRAIN_PER_SEC,
  HUNGER_MAX,
  STARVE_DAMAGE_PER_SEC,
  STEP,
} from './constants'
import { eat, isDead, stepSurvival, type Vitals } from './survival'

const run = (v: Vitals, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / STEP); i++) stepSurvival(v, STEP)
}

describe('supervivencia', () => {
  it('el hambre baja con el tiempo y no pasa de 0', () => {
    const v = { health: HEALTH_MAX, hunger: HUNGER_MAX }
    run(v, 10)
    expect(v.hunger).toBeCloseTo(HUNGER_MAX - HUNGER_DRAIN_PER_SEC * 10, 6)
    run(v, HUNGER_MAX / HUNGER_DRAIN_PER_SEC)
    expect(v.hunger).toBe(0)
  })

  it('con hambre a 0 la vida baja hasta morir', () => {
    const v = { health: HEALTH_MAX, hunger: 0 }
    run(v, 10)
    expect(v.health).toBeCloseTo(HEALTH_MAX - STARVE_DAMAGE_PER_SEC * 10, 6)
    expect(isDead(v)).toBe(false)
    run(v, HEALTH_MAX / STARVE_DAMAGE_PER_SEC)
    expect(v.health).toBe(0)
    expect(isDead(v)).toBe(true)
  })

  it('la vida se regenera por encima del umbral de hambre y no en el umbral', () => {
    const fed = { health: 50, hunger: HUNGER_MAX }
    run(fed, 5)
    expect(fed.health).toBeGreaterThan(50)

    // Sin drenaje de por medio: un solo paso desde justo el umbral.
    const hungry = { health: 50, hunger: HEALTH_REGEN_HUNGER + HUNGER_DRAIN_PER_SEC * STEP }
    stepSurvival(hungry, STEP)
    expect(hungry.health).toBe(50)
  })

  it('la vida no supera el máximo', () => {
    const v = { health: HEALTH_MAX - 0.001, hunger: HUNGER_MAX }
    run(v, 1)
    expect(v.health).toBe(HEALTH_MAX)
  })

  it('comer sube el hambre hasta el máximo y no se come lleno', () => {
    const v = { health: HEALTH_MAX, hunger: 50 }
    expect(eat(v, 15)).toBe(true)
    expect(v.hunger).toBe(65)
    v.hunger = HUNGER_MAX - 5
    expect(eat(v, 15)).toBe(true)
    expect(v.hunger).toBe(HUNGER_MAX)
    expect(eat(v, 15)).toBe(false)
  })
})
