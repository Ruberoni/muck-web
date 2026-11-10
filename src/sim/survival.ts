import {
  HEALTH_MAX,
  STAMINA_MAX,
  STAMINA_RECOVER_THRESHOLD,
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
  /** Efectos con tiempo (ConsumableDef.breath, speed, guard): segundos que les quedan y por cuánto multiplican. */
  breathLeft: number
  speedLeft: number
  speedMul: number
  guardLeft: number
  guardMul: number
}

/** Lo que se recupera de la resistencia al tomar algo que la devuelve (los campos del jugador). */
export interface Breath {
  stamina: number
  exhausted: boolean
  sprintLocked: boolean
}

/** Los campos de `Vitals` que empiezan a cero: sin pausa, curación ni efectos en marcha. */
export const NO_HEALING = { healDelay: 0, regenLeft: 0, regenPerSec: 0, breathLeft: 0, speedLeft: 0, speedMul: 1, guardLeft: 0, guardMul: 1 }

/** Por cuánto se multiplica ahora la velocidad y el daño recibido. */
export const speedFactor = (v: Vitals) => (v.speedLeft > 0 ? v.speedMul : 1)
export const guardFactor = (v: Vitals) => (v.guardLeft > 0 ? v.guardMul : 1)

/**
 * Un paso fijo: el hambre baja siempre; a cero quita vida y por encima del umbral la regenera, salvo justo después
 * de recibir daño. La curación de un consumible va aparte y no se pausa: es para mitad de una pelea.
 */
export function stepSurvival(v: Vitals, dt: number) {
  v.hunger = Math.max(0, v.hunger - HUNGER_DRAIN_PER_SEC * dt)
  v.healDelay = Math.max(0, v.healDelay - dt)
  if (v.hunger <= 0) v.health = Math.max(0, v.health - STARVE_DAMAGE_PER_SEC * dt)
  else if (v.hunger > HEALTH_REGEN_HUNGER && v.healDelay <= 0) v.health = Math.min(HEALTH_MAX, v.health + HEALTH_REGEN_PER_SEC * dt)
  v.breathLeft = Math.max(0, v.breathLeft - dt)
  v.speedLeft = Math.max(0, v.speedLeft - dt)
  if (v.speedLeft <= 0) v.speedMul = 1
  v.guardLeft = Math.max(0, v.guardLeft - dt)
  if (v.guardLeft <= 0) v.guardMul = 1
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

/**
 * Toma un consumible si mejora algo: llena y el hambre no está llena, cura y la vida no lo está, devuelve resistencia
 * que falta o da un efecto con tiempo. Si no, no se gasta.
 */
/** Si comerlo serviría de algo ahora (sin hambre ni heridas, una baya no): sin cambiar nada. */
export const useful = (v: Vitals & Partial<Breath>, def: ConsumableDef) => eat({ ...v }, def)

export function eat(v: Vitals & Partial<Breath>, def: ConsumableDef): boolean {
  const feeds = def.food > 0 && v.hunger < HUNGER_MAX
  const heals = v.health < HEALTH_MAX && (def.heal !== undefined || def.regen !== undefined)
  const rests = def.stamina !== undefined && v.stamina !== undefined && v.stamina < STAMINA_MAX
  const effect = def.breath !== undefined || def.speed !== undefined || def.guard !== undefined || def.world !== undefined
  if (!feeds && !heals && !rests && !effect) return false
  if (def.stamina !== undefined && v.stamina !== undefined) {
    v.stamina = Math.min(STAMINA_MAX, v.stamina + def.stamina)
    // Llena, se puede volver a correr al momento (sin soltar Mayúsculas).
    if (v.stamina >= STAMINA_RECOVER_THRESHOLD) v.exhausted = false
    v.sprintLocked = false
  }
  if (def.breath !== undefined) v.breathLeft = def.breath
  if (def.speed) {
    v.speedLeft = def.speed.seconds
    v.speedMul = def.speed.factor
  }
  if (def.guard) {
    v.guardLeft = def.guard.seconds
    v.guardMul = def.guard.factor
  }
  v.hunger = Math.min(HUNGER_MAX, v.hunger + def.food)
  if (def.heal !== undefined) v.health = Math.min(HEALTH_MAX, v.health + def.heal)
  if (def.regen) {
    v.regenLeft = def.regen.seconds
    v.regenPerSec = def.regen.perSec
  }
  return true
}

export const isDead = (v: Vitals) => v.health <= 0
