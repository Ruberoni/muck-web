import type { Inventory, ItemId } from './inventory'

/**
 * El mercader: un puesto fijo en la isla, como el faro y el tótem. Vende pociones y lo que ayuda a remontar (el incienso
 * y el amuleto) y compra lo que sobra, barato. Las monedas salen sobre todo de los mobs: vender materiales da algo,
 * pero cuesta más tiempo que matar.
 */

/** Lo que vende: su precio y, para lo que más ayuda a remontar, cuánto sube cada vez que se compra en la partida. */
export interface Offer {
  item: ItemId
  price: number
  /** Cada compra multiplica el precio por (1 + rise): +50 % es 0,5. */
  rise?: number
}

export const OFFERS: readonly Offer[] = [
  { item: 'healing_potion', price: 8 },
  { item: 'speed_potion', price: 10 },
  { item: 'stamina_potion', price: 8 },
  { item: 'stone_potion', price: 12 },
  { item: 'calm_incense', price: 25, rise: 0.5 },
  { item: 'forget_amulet', price: 40, rise: 0.5 },
]

/** Lo que compra: `amount` de ese objeto por `coins` monedas. Lo que no puede perderse (piezas del avión, trofeos…) no. */
export const PURCHASES: Partial<Record<ItemId, { amount: number; coins: number }>> = {
  wood: { amount: 10, coins: 1 },
  stone: { amount: 10, coins: 1 },
  raw_meat: { amount: 3, coins: 1 },
  iron_bar: { amount: 1, coins: 1 },
  mithril_bar: { amount: 1, coins: 3 },
}

/** Lo que guarda el puesto: cuántas veces se ha comprado cada cosa que sube de precio (compartido en la sala). */
export interface ShopState {
  bought: Partial<Record<ItemId, number>>
}

export const newShop = (): ShopState => ({ bought: {} })
export const copyShop = (s: ShopState): ShopState => ({ bought: { ...s.bought } })

export const offerOf = (item: ItemId) => OFFERS.find((o) => o.item === item) ?? null

/** El precio de `offer` ahora, con lo que ya se ha comprado. */
export const priceOf = (offer: Offer, shop: ShopState) => Math.round(offer.price * (1 + (offer.rise ?? 0)) ** (shop.bought[offer.item] ?? 0))

/** Una compra o una venta, tal como la manda el jugador. */
export interface ShopOp {
  op: 'buy' | 'sell'
  item: ItemId
}

/** Por qué no se puede comprar `offer` (null: se puede). `available`: si hace algo ahora (el amuleto, solo con rasgos). */
export function buyProblem(offer: Offer, shop: ShopState, inventory: Inventory, available = true): string | null {
  if (!available) return 'Ahora no hace nada'
  const price = priceOf(offer, shop)
  if (inventory.count('coin') < price) return `Faltan ${price - inventory.count('coin')} monedas`
  // Si las monedas se acaban, su casilla queda libre para lo comprado.
  if (!inventory.canAdd(offer.item) && inventory.count('coin') > price) return 'No te cabe'
  return null
}

/** Por qué no se puede vender `item` (null: se puede). */
export function sellProblem(item: ItemId, inventory: Inventory): string | null {
  const deal = PURCHASES[item]
  if (!deal) return 'No lo compra'
  if (inventory.count(item) < deal.amount) return `Hacen falta ${deal.amount}`
  if (!inventory.canAdd('coin') && inventory.count(item) > deal.amount) return 'No te caben las monedas'
  return null
}

/**
 * Hace la compra o la venta en `inventory` si se puede, y apunta en `shop` lo comprado. `available`: si lo que se compra
 * hace algo ahora. Devuelve si ha cambiado algo.
 */
export function trade(shop: ShopState, inventory: Inventory, { op, item }: ShopOp, available = true): boolean {
  if (op === 'buy') {
    const offer = offerOf(item)
    if (!offer || buyProblem(offer, shop, inventory, available)) return false
    inventory.remove('coin', priceOf(offer, shop))
    inventory.add(item, 1)
    if (offer.rise) shop.bought[item] = (shop.bought[item] ?? 0) + 1
    return true
  }
  if (sellProblem(item, inventory)) return false
  const deal = PURCHASES[item]!
  inventory.remove(item, deal.amount)
  inventory.add('coin', deal.coins)
  return true
}
