import { HEALTH_MAX } from './constants'
import type { Inventory } from './inventory'

/**
 * Las mejoras permanentes del mercader: duran lo que la partida (una isla nueva empieza de cero) y cada nivel
 * multiplica el valor anterior por `factor` (1 → 1,5 → 2,25…). Se pagan con monedas o con materiales, y el precio
 * sube con los niveles que ya se tengan, no con los que tenga la sala: cada uno compra los suyos.
 */

export type BoostId = 'damage' | 'health' | 'regen' | 'stamina' | 'hunger' | 'knockback'

export interface BoostDef {
  name: string
  /** Por cuánto se multiplica su valor con cada nivel. El del hambre baja el gasto, así que es menor que 1. */
  factor: number
  /** Lo que hace, para la tienda. */
  text: string
  /** Cómo se lee el efecto con su número: "×1,5", "×0,5"… */
  show: (value: number) => string
}

export const BOOST_DEFS: Record<BoostId, BoostDef> = {
  damage: { name: 'Fuerza', factor: 1.5, text: 'Cada golpe hace más daño, con armas y con herramientas', show: (v) => `×${round(v)} al daño` },
  health: { name: 'Vitalidad', factor: 1.5, text: 'Más vida máxima', show: (v) => `${Math.round(HEALTH_MAX * v)} de vida máxima` },
  regen: { name: 'Recuperación', factor: 1.5, text: 'La vida se regenera más deprisa', show: (v) => `×${round(v)} a la regeneración` },
  stamina: { name: 'Aguante', factor: 1.5, text: 'La resistencia se recupera más deprisa', show: (v) => `×${round(v)} a la resistencia` },
  hunger: { name: 'Metabolismo', factor: 0.5, text: 'El hambre baja más despacio', show: (v) => `×${round(v)} de hambre` },
  knockback: { name: 'Empuje', factor: 2, text: 'Los golpes empujan más a los enemigos', show: (v) => `×${round(v)} al empuje` },
}

export const BOOST_IDS = Object.keys(BOOST_DEFS) as BoostId[]

/** Lo que se paga con monedas, y las dos alternativas en materiales (su precio del primer nivel). */
export const BOOST_PAYMENTS = ['coin', 'mithril_bar', 'iron_bar'] as const
export type BoostPayment = (typeof BOOST_PAYMENTS)[number]

const PAYMENT_NAMES: Record<BoostPayment, string> = { coin: 'monedas', mithril_bar: 'lingotes de mithril', iron_bar: 'lingotes de hierro' }
/** Lo que cuesta el primer nivel con cada material, al cambio de sus monedas. */
const PAYMENT_BASE: Record<BoostPayment, number> = { coin: 100, mithril_bar: 25, iron_bar: 60 }

/** Monedas del primer nivel y lo que suma cada nivel comprado. */
export const BOOST_PRICE = 100
export const BOOST_PRICE_RISE = 50

/** Los niveles comprados: solo van los que tienen alguno, porque esto viaja en cada `snap`. */
export type BoostLevels = Partial<Record<BoostId, number>>

const round = (value: number) => Math.round(value * 100) / 100

export const isBoostId = (value: unknown): value is BoostId => typeof value === 'string' && Object.hasOwn(BOOST_DEFS, value)
export const isBoostPayment = (value: unknown): value is BoostPayment => typeof value === 'string' && (BOOST_PAYMENTS as readonly string[]).includes(value)

export const levelOf = (boosts: BoostLevels | undefined, id: BoostId) => boosts?.[id] ?? 0

/** Por cuánto va multiplicado `id` con estos niveles. */
export const boostFactor = (boosts: BoostLevels | undefined, id: BoostId) => BOOST_DEFS[id].factor ** levelOf(boosts, id)

/**
 * El daño de un golpe con sus mejoras, redondeado: la vida de props y enemigos es entera y así se queda (sin
 * decimales en las barras ni en el cable). Con `damage` 0 devuelve 0: lo que no se puede golpear sigue sin poder.
 */
export const boostedDamage = (damage: number, boosts: BoostLevels | undefined) => (damage > 0 ? Math.max(1, Math.round(damage * boostFactor(boosts, 'damage'))) : 0)

/** La vida máxima con sus mejoras. */
export const maxHealthOf = (boosts: BoostLevels | undefined) => Math.round(HEALTH_MAX * boostFactor(boosts, 'health'))

/** Lo que cuesta el siguiente nivel pagando con `pay`, redondeado hacia arriba. */
export function boostCost(boosts: BoostLevels | undefined, id: BoostId, pay: BoostPayment) {
  const level = levelOf(boosts, id)
  const coins = BOOST_PRICE + BOOST_PRICE_RISE * level
  return pay === 'coin' ? coins : Math.ceil((PAYMENT_BASE[pay] * coins) / BOOST_PRICE)
}

/** El precio en texto, con el nombre de lo que se paga. */
export const boostCostText = (boosts: BoostLevels | undefined, id: BoostId, pay: BoostPayment) => `${boostCost(boosts, id, pay)} ${PAYMENT_NAMES[pay]}`

/** Por qué no se puede comprar el siguiente nivel de `id` pagando con `pay` (null: se puede). */
export function boostProblem(boosts: BoostLevels | undefined, id: BoostId, pay: BoostPayment, inventory: Inventory): string | null {
  const cost = boostCost(boosts, id, pay)
  if (inventory.count(pay) < cost) return `Faltan ${cost - inventory.count(pay)}`
  return null
}

/**
 * Compra el siguiente nivel de `id` si se puede pagar: quita el pago y devuelve el nivel nuevo (null si no se pudo).
 * Los niveles se cambian por un objeto nuevo, nunca en el sitio: las copias del jugador (predicción, guardado)
 * comparten la referencia y no deben enterarse de una compra hecha sobre otra.
 */
export function buyBoost(player: { boosts?: BoostLevels; health: number }, id: BoostId, pay: BoostPayment, inventory: Inventory): number | null {
  if (boostProblem(player.boosts, id, pay, inventory)) return null
  inventory.remove(pay, boostCost(player.boosts, id, pay))
  const before = maxHealthOf(player.boosts)
  const level = levelOf(player.boosts, id) + 1
  player.boosts = { ...player.boosts, [id]: level }
  // Subir la vida máxima también cura lo que sube: si no, el nivel nuevo no se notaría hasta regenerar.
  if (id === 'health') player.health += maxHealthOf(player.boosts) - before
  return level
}
