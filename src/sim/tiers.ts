import {
  BASE_DAMAGE,
  ENEMY_DEFS,
  HAND_ATTACK,
  HIT_COOLDOWN,
  PROP_DEFS,
  TOOL_DEFS,
  type EnemyType,
  type HitEfficacy,
  type ToolFamily,
  type WeaponClass,
} from './constants'
import type { ItemId } from './inventory'
import type { PropKind } from './props'

/** La herramienta mínima para dañar un prop: su familia y su nivel. */
export interface ToolRequirement {
  family: ToolFamily
  tier: number
}

/**
 * Daño de un golpe contra un prop con el objeto en la mano (null = mano vacía); 0 = no se puede con esto.
 * Nivel 0 (árbol, arbusto): cualquier cosa sirve, y una herramienta de su familia hace su daño (si no, 1).
 * Desde el nivel 1, solo una herramienta de su familia de ese nivel o más; con cualquier otra cosa, 0.
 * Los arbustos no usan el daño: cada golpe quita una baya (Interaction.harvest).
 */
export function propDamage(item: ItemId | null, kind: PropKind): number {
  const def = PROP_DEFS[kind]
  const tool = item ? TOOL_DEFS[item] : undefined
  const fits = tool !== undefined && tool.family === def.tool
  if (def.tier === 0) return fits ? tool.damage : BASE_DAMAGE
  return fits && tool.tier >= def.tier ? tool.damage : 0
}

/** Si un golpe con `item` hace algo al prop. El cliente lo usa para avisar sin evento nuevo (clank, "Necesitas…"). */
export const canDamage = (item: ItemId | null, kind: PropKind) => propDamage(item, kind) > 0

/** Lo que hace falta para dañar un prop, o null si sirve cualquier cosa (nivel 0). Para el HUD. */
export function requiredTool(kind: PropKind): ToolRequirement | null {
  const { tool, tier } = PROP_DEFS[kind]
  return tool && tier > 0 ? { family: tool, tier } : null
}

/** Con qué golpea quien lleva `item`: una familia de herramienta o, con cualquier otra cosa, la mano. */
export const weaponClass = (item: ItemId | null): WeaponClass => (item && TOOL_DEFS[item]?.family) || 'hand'

/** Si `item` es una espada: su golpe alcanza a los enemigos de alrededor (Interaction). */
export const isSword = (item: ItemId | null) => weaponClass(item) === 'sword'

/** Segundos entre golpes con `item`. */
export const swingCooldown = (item: ItemId | null) => (item ? TOOL_DEFS[item]?.cooldown : undefined) ?? HIT_COOLDOWN

const weakness = (item: ItemId | null, type: EnemyType) => ENEMY_DEFS[type].weakness[weaponClass(item)] ?? 1

/** Daño contra un enemigo: el ataque de lo que se lleva (a mano o con otra cosa, HAND_ATTACK), por su debilidad a ello y menos su armadura. */
export function attackDamage(item: ItemId | null, type: EnemyType): number {
  const attack = ((item ? TOOL_DEFS[item]?.attack : undefined) ?? HAND_ATTACK) * weakness(item, type)
  return Math.max(1, attack - (ENEMY_DEFS[type].armor ?? 0))
}

/** Si `item` le hace más o menos daño de lo normal a un enemigo. */
export function hitEfficacy(item: ItemId | null, type: EnemyType): HitEfficacy {
  const k = weakness(item, type)
  return k > 1 ? 'effective' : k < 1 ? 'resisted' : 'normal'
}
