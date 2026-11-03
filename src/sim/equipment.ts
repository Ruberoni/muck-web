import { STAMINA_REGEN_DELAY } from './constants'
import type { ItemId } from './inventory'
import type { Player } from './player'

/** Los huecos del equipo: lo que se lleva puesto, fuera de las casillas. */
export type EquipSlot = 'chest' | 'shield'

export const EQUIP_SLOTS: readonly EquipSlot[] = ['chest', 'shield']

export interface EquipDef {
  slot: EquipSlot
  /** El pecho quita siempre esta parte del daño; el escudo para esta parte de lo que llega de frente al bloquear. */
  reduce: number
}

export const EQUIP_DEFS: Partial<Record<ItemId, EquipDef>> = {
  iron_chestplate: { slot: 'chest', reduce: 0.2 },
  mithril_chestplate: { slot: 'chest', reduce: 0.35 },
  wood_shield: { slot: 'shield', reduce: 0.7 },
  iron_shield: { slot: 'shield', reduce: 0.8 },
  crystal_shield: { slot: 'shield', reduce: 0.9 },
}

export type Equipped = Record<EquipSlot, ItemId | null>

export const noEquipment = (): Equipped => ({ chest: null, shield: null })

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
 * se bloquea y el golpe llega de frente, para su parte; el pecho quita la suya de lo que pasa. `blocked`: lo parado.
 */
export function damageTaken(damage: number, equipped: Equipped, guard: Guard, from?: { x: number; z: number }): { damage: number; blocked: number } {
  let blocked = 0
  const shield = equipped.shield && EQUIP_DEFS[equipped.shield]
  if (shield && guard.blocking && from && facing(guard, from)) blocked = damage * shield.reduce
  const chest = equipped.chest && EQUIP_DEFS[equipped.chest]
  return { damage: (damage - blocked) * (1 - (chest ? chest.reduce : 0)), blocked }
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
