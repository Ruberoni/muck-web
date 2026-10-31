import { describe, expect, it } from 'vitest'
import {
  HEALTH_MAX,
  HEALTH_REGEN_DELAY,
  HEALTH_REGEN_HUNGER,
  HEALTH_REGEN_PER_SEC,
  HUNGER_DRAIN_PER_SEC,
  HUNGER_MAX,
  STARVE_DAMAGE_PER_SEC,
  STEP,
} from './constants'
import { eat, hurt, isDead, NO_HEALING, stepSurvival, type Vitals } from './survival'

const vitals = (health: number, hunger: number): Vitals => ({ health, hunger, ...NO_HEALING })

const run = (v: Vitals, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / STEP); i++) stepSurvival(v, STEP)
}

describe('supervivencia', () => {
  it('el hambre baja con el tiempo y no pasa de 0', () => {
    const v = vitals(HEALTH_MAX, HUNGER_MAX)
    run(v, 10)
    expect(v.hunger).toBeCloseTo(HUNGER_MAX - HUNGER_DRAIN_PER_SEC * 10, 6)
    run(v, HUNGER_MAX / HUNGER_DRAIN_PER_SEC)
    expect(v.hunger).toBe(0)
  })

  it('con hambre a 0 la vida baja hasta morir', () => {
    const v = vitals(HEALTH_MAX, 0)
    run(v, 10)
    expect(v.health).toBeCloseTo(HEALTH_MAX - STARVE_DAMAGE_PER_SEC * 10, 6)
    expect(isDead(v)).toBe(false)
    run(v, HEALTH_MAX / STARVE_DAMAGE_PER_SEC)
    expect(v.health).toBe(0)
    expect(isDead(v)).toBe(true)
  })

  it('la vida se regenera por encima del umbral de hambre y no en el umbral', () => {
    const fed = vitals(50, HUNGER_MAX)
    run(fed, 5)
    expect(fed.health).toBeGreaterThan(50)

    // Sin drenaje de por medio: un solo paso desde justo el umbral.
    const hungry = vitals(50, HEALTH_REGEN_HUNGER + HUNGER_DRAIN_PER_SEC * STEP)
    stepSurvival(hungry, STEP)
    expect(hungry.health).toBe(50)
  })

  it('la vida no supera el máximo', () => {
    const v = vitals(HEALTH_MAX - 0.001, HUNGER_MAX)
    run(v, 1)
    expect(v.health).toBe(HEALTH_MAX)
  })

  it('comer sube el hambre hasta el máximo y no se come lleno', () => {
    const v = vitals(HEALTH_MAX, 50)
    expect(eat(v, { food: 15 })).toBe(true)
    expect(v.hunger).toBe(65)
    v.hunger = HUNGER_MAX - 5
    expect(eat(v, { food: 15 })).toBe(true)
    expect(v.hunger).toBe(HUNGER_MAX)
    expect(eat(v, { food: 15 })).toBe(false)
  })

  it('lo que cura se puede tomar con el hambre llena si falta vida, y no se gasta si no mejora nada', () => {
    const v = vitals(50, HUNGER_MAX)
    expect(eat(v, { food: 0, heal: 25 })).toBe(true)
    expect(v.health).toBe(75)
    expect(eat(v, { food: 10, heal: 40 })).toBe(true)
    expect(v.health).toBe(HEALTH_MAX)
    expect(eat(v, { food: 0, heal: 25 })).toBe(false)
    // Lo que solo llena no se come por faltar vida.
    v.health = 50
    expect(eat(v, { food: 15 })).toBe(false)
  })

  it('lo que no llena no se gasta por tener hambre si la vida está llena', () => {
    const v = vitals(HEALTH_MAX, 50)
    expect(eat(v, { food: 0, heal: 25 })).toBe(false)
    expect(eat(v, { food: 0, regen: { perSec: 2, seconds: 5 } })).toBe(false)
    expect(v.regenLeft).toBe(0)
  })

  it('lo que cura poco a poco se suma a la regeneración natural, acaba solo y otro solo renueva el tiempo', () => {
    const regen = { food: 0, regen: { perSec: 2, seconds: 10 } }
    const v = vitals(20, HUNGER_MAX)
    expect(eat(v, regen)).toBe(true)
    run(v, 5)
    expect(v.regenLeft).toBeCloseTo(5, 6)
    expect(v.health).toBeCloseTo(20 + (2 + HEALTH_REGEN_PER_SEC) * 5, 6)
    expect(eat(v, regen)).toBe(true)
    expect(v.regenLeft).toBe(10)
    expect(v.regenPerSec).toBe(2)
    run(v, 12)
    expect(v.regenLeft).toBe(0)
    expect(v.regenPerSec).toBe(0)
    const healed = v.health
    run(v, 1)
    expect(v.health).toBeCloseTo(healed + HEALTH_REGEN_PER_SEC, 6)
  })

  it('recibir daño pausa la regeneración natural; la de un consumible sigue y el hambre a 0 sigue quitando vida', () => {
    const v = vitals(100, HUNGER_MAX)
    hurt(v, 30)
    expect(v.health).toBe(70)
    expect(v.healDelay).toBe(HEALTH_REGEN_DELAY)
    run(v, HEALTH_REGEN_DELAY - 1)
    expect(v.health).toBe(70)
    // Otro golpe vuelve a empezar la cuenta.
    hurt(v, 10)
    run(v, HEALTH_REGEN_DELAY - 1)
    expect(v.health).toBe(60)
    run(v, 2)
    expect(v.healDelay).toBe(0)
    expect(v.health).toBeCloseTo(61, 1)

    const potion = vitals(50, HUNGER_MAX)
    hurt(potion, 10)
    eat(potion, { food: 0, regen: { perSec: 2, seconds: 5 } })
    run(potion, 5)
    expect(potion.health).toBeCloseTo(50, 6)

    const starving = vitals(50, 0)
    hurt(starving, 10)
    run(starving, 2)
    expect(starving.health).toBeCloseTo(40 - STARVE_DAMAGE_PER_SEC * 2, 6)
  })

  it('muriendo de hambre, lo que cura poco a poco no salva si la vida llega a 0', () => {
    const v = vitals(0.01, 0)
    eat(v, { food: 0, regen: { perSec: 1, seconds: 5 } })
    stepSurvival(v, STEP)
    expect(isDead(v)).toBe(true)
  })

  it('el daño no baja de 0', () => {
    const v = vitals(5, HUNGER_MAX)
    hurt(v, 30)
    expect(v.health).toBe(0)
    expect(isDead(v)).toBe(true)
  })
})
