import {
  HEALTH_MAX,
  HEALTH_REGEN_HUNGER,
  HEALTH_REGEN_PER_SEC,
  HUNGER_DRAIN_PER_SEC,
  HUNGER_MAX,
  STARVE_DAMAGE_PER_SEC,
} from './constants'

export interface Vitals {
  health: number
  hunger: number
}

/** Un paso fijo: el hambre baja siempre; a cero quita vida y por encima del umbral la regenera. */
export function stepSurvival(v: Vitals, dt: number) {
  v.hunger = Math.max(0, v.hunger - HUNGER_DRAIN_PER_SEC * dt)
  if (v.hunger <= 0) v.health = Math.max(0, v.health - STARVE_DAMAGE_PER_SEC * dt)
  else if (v.hunger > HEALTH_REGEN_HUNGER) v.health = Math.min(HEALTH_MAX, v.health + HEALTH_REGEN_PER_SEC * dt)
}

/** Con el hambre llena no se come (no se desperdicia la comida). */
export function eat(v: Vitals, food: number): boolean {
  if (v.hunger >= HUNGER_MAX) return false
  v.hunger = Math.min(HUNGER_MAX, v.hunger + food)
  return true
}

export const isDead = (v: Vitals) => v.health <= 0
