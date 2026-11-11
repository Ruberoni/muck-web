import { STAMINA_REGEN_DELAY } from './constants'
import type { ItemId } from './inventory'
import type { Player } from './player'

/** Los huecos del equipo: lo que se lleva puesto, fuera de las casillas. Las cuatro piezas de armadura y el escudo. */
export type EquipSlot = 'head' | 'chest' | 'legs' | 'feet' | 'shield'
export type ArmorSlot = Exclude<EquipSlot, 'shield'>

export const ARMOR_SLOTS: readonly ArmorSlot[] = ['head', 'chest', 'legs', 'feet']
export const EQUIP_SLOTS: readonly EquipSlot[] = [...ARMOR_SLOTS, 'shield']

/** De qué es una pieza de armadura: el modelo del jugador la tiñe de su color. */
export type ArmorTier = 'iron' | 'mithril'
export const ARMOR_TIERS: readonly ArmorTier[] = ['iron', 'mithril']

export interface EquipDef {
  slot: EquipSlot
  /** Cada pieza de armadura quita siempre esta parte del daño (se suman); el escudo para esta parte de lo que llega de frente al bloquear. */
  reduce: number
  tier?: ArmorTier
}

/**
 * Las cuatro piezas de hierro quitan juntas un 25 % (el peto solo de antes, un 20 %), y las de mithril un 42 % (antes,
 * un 35 %): el peto es la mayor y las botas la menor. Se pueden mezclar.
 */
export const EQUIP_DEFS: Partial<Record<ItemId, EquipDef>> = {
  iron_helmet: { slot: 'head', reduce: 0.05, tier: 'iron' },
  iron_chestplate: { slot: 'chest', reduce: 0.11, tier: 'iron' },
  iron_leggings: { slot: 'legs', reduce: 0.06, tier: 'iron' },
  iron_boots: { slot: 'feet', reduce: 0.03, tier: 'iron' },
  mithril_helmet: { slot: 'head', reduce: 0.08, tier: 'mithril' },
  mithril_chestplate: { slot: 'chest', reduce: 0.19, tier: 'mithril' },
  mithril_leggings: { slot: 'legs', reduce: 0.1, tier: 'mithril' },
  mithril_boots: { slot: 'feet', reduce: 0.05, tier: 'mithril' },
  wood_shield: { slot: 'shield', reduce: 0.7 },
  iron_shield: { slot: 'shield', reduce: 0.8 },
  crystal_shield: { slot: 'shield', reduce: 0.9 },
}

export type Equipped = Record<EquipSlot, ItemId | null>

export const noEquipment = (): Equipped => ({ head: null, chest: null, legs: null, feet: null, shield: null })

const defOf = (item: ItemId | null) => (item ? EQUIP_DEFS[item] : undefined)

/** Lo que quita la armadura puesta: la suma de sus piezas. */
export const armorReduce = (equipped: Equipped) => ARMOR_SLOTS.reduce((sum, slot) => sum + (defOf(equipped[slot])?.reduce ?? 0), 0)

/**
 * La armadura puesta en un número, para el cable: por cada pieza (en el orden de ARMOR_SLOTS) una cifra en base 3,
 * 0 sin nada, 1 de hierro y 2 de mithril. De 0 a 80.
 */
export function armorCode(equipped: Equipped): number {
  let code = 0
  for (let i = ARMOR_SLOTS.length - 1; i >= 0; i--) {
    const tier = defOf(equipped[ARMOR_SLOTS[i]])?.tier
    code = code * 3 + (tier ? ARMOR_TIERS.indexOf(tier) + 1 : 0)
  }
  return code
}

/** De qué es cada pieza que lleva, según `armorCode` (null: no la lleva). */
export function armorOf(code: number): Record<ArmorSlot, ArmorTier | null> {
  const out = {} as Record<ArmorSlot, ArmorTier | null>
  for (const slot of ARMOR_SLOTS) {
    const digit = code % 3
    out[slot] = digit ? ARMOR_TIERS[digit - 1] : null
    code = Math.floor(code / 3)
  }
  return out
}

/** El hueco donde se pone `item`, o null si no se pone. */
export const equipSlotOf = (item: ItemId | null | undefined): EquipSlot | null => (item && EQUIP_DEFS[item]?.slot) || null

/** El escudo cubre 60° a cada lado de la mirada. */
export const BLOCK_ARC_COS = Math.cos((60 * Math.PI) / 180)
/** Bloqueando se anda a la mitad, sin correr. */
export const BLOCK_SPEED_FACTOR = 0.5
/** Resistencia que gasta cada punto de daño parado: sin ella el escudo baja. */
export const BLOCK_STAMINA_PER_DAMAGE = 0.6

/** Lo que cubre al jugador ante un golpe: si bloquea, hacia dónde mira y dónde está. */
export interface Guard {
  blocking: boolean
  yaw: number
  pos: { x: number; z: number }
}

/**
 * El daño que llega de un golpe de `damage` que viene de `from` (sin él, de todas partes: no se para). El escudo, si
 * se bloquea y el golpe llega de frente, para su parte; la armadura quita la suya de lo que pasa. `blocked`: lo parado.
 */
export function damageTaken(damage: number, equipped: Equipped, guard: Guard, from?: { x: number; z: number }): { damage: number; blocked: number } {
  let blocked = 0
  const shield = equipped.shield && EQUIP_DEFS[equipped.shield]
  if (shield && guard.blocking && from && facing(guard, from)) blocked = damage * shield.reduce
  return { damage: (damage - blocked) * (1 - armorReduce(equipped)), blocked }
}

/** Si `from` queda dentro del frente que cubre el escudo. Encima del jugador, cuenta como de frente. */
function facing({ yaw, pos }: Guard, from: { x: number; z: number }): boolean {
  const dx = from.x - pos.x
  const dz = from.z - pos.z
  const distance = Math.hypot(dx, dz)
  if (distance < 1e-6) return true
  // forward = (-sin(yaw), -cos(yaw))
  return (-Math.sin(yaw) * dx - Math.cos(yaw) * dz) / distance >= BLOCK_ARC_COS
}

/** Lo que cuesta parar `blocked` de daño: sin resistencia el escudo baja hasta recuperarse, como al agotarse corriendo. */
export function spendGuard(player: Pick<Player, 'stamina' | 'exhausted' | 'sprintLocked' | 'blocking' | 'regenDelay'>, blocked: number) {
  player.stamina = Math.max(0, player.stamina - blocked * BLOCK_STAMINA_PER_DAMAGE)
  player.regenDelay = STAMINA_REGEN_DELAY
  if (player.stamina > 0) return
  player.exhausted = player.sprintLocked = true
  player.blocking = false
}
