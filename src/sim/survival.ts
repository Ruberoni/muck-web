import {
  HEALTH_MAX,
  HEALTH_REGEN_DELAY,
  HEALTH_REGEN_HUNGER,
  HEALTH_REGEN_PER_SEC,
  HUNGER_DRAIN_PER_SEC,
  HUNGER_MAX,
  STARVE_DAMAGE_PER_SEC,
  type ConsumableDef,
} from './constants'

export interface Vitals {
  health: number
  hunger: number
  /** Segundos que faltan para que vuelva la regeneración natural: recibir daño la pausa. */
  healDelay: number
  /** Curación poco a poco (ConsumableDef.regen): segundos que le quedan y vida por segundo. */
  regenLeft: number
  regenPerSec: number
}

/** Los campos de `Vitals` que empiezan a cero: sin pausa ni curación en marcha. */
export const NO_HEALING = { healDelay: 0, regenLeft: 0, regenPerSec: 0 }

/**
 * Un paso fijo: el hambre baja siempre; a cero quita vida y por encima del umbral la regenera, salvo justo después
 * de recibir daño. La curación de un consumible va aparte y no se pausa: es para mitad de una pelea.
 */
export function stepSurvival(v: Vitals, dt: number) {
  v.hunger = Math.max(0, v.hunger - HUNGER_DRAIN_PER_SEC * dt)
  v.healDelay = Math.max(0, v.healDelay - dt)
  if (v.hunger <= 0) v.health = Math.max(0, v.health - STARVE_DAMAGE_PER_SEC * dt)
  else if (v.hunger > HEALTH_REGEN_HUNGER && v.healDelay <= 0) v.health = Math.min(HEALTH_MAX, v.health + HEALTH_REGEN_PER_SEC * dt)
  if (v.regenLeft <= 0 || v.health <= 0) return
  v.regenLeft = Math.max(0, v.regenLeft - dt)
  v.health = Math.min(HEALTH_MAX, v.health + v.regenPerSec * dt)
  if (v.regenLeft <= 0) v.regenPerSec = 0
}

/** Daño de fuera (enemigos): quita vida y pausa la regeneración natural. El hambre no pasa por aquí. */
export function hurt(v: Vitals, damage: number) {
  v.health = Math.max(0, v.health - damage)
  v.healDelay = HEALTH_REGEN_DELAY
}

/** Toma un consumible si mejora algo: llena y el hambre no está llena, o cura y la vida no lo está. Si no, no se gasta. */
export function eat(v: Vitals, def: ConsumableDef): boolean {
  const feeds = def.food > 0 && v.hunger < HUNGER_MAX
  const heals = v.health < HEALTH_MAX && (def.heal !== undefined || def.regen !== undefined)
  if (!feeds && !heals) return false
  v.hunger = Math.min(HUNGER_MAX, v.hunger + def.food)
  if (def.heal !== undefined) v.health = Math.min(HEALTH_MAX, v.health + def.heal)
  if (def.regen) {
    v.regenLeft = def.regen.seconds
    v.regenPerSec = def.regen.perSec
  }
  return true
}

export const isDead = (v: Vitals) => v.health <= 0
