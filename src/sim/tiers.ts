import { BASE_DAMAGE, PROP_DEFS, TOOL_DEFS, type ToolFamily } from './constants'
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

/** Daño contra un enemigo: el ataque de la herramienta, sea cual sea su familia; a mano o con otra cosa, 1. */
export function attackDamage(item: ItemId | null): number {
  return (item ? TOOL_DEFS[item]?.attack : undefined) ?? BASE_DAMAGE
}
