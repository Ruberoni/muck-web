import { TOOL_DEFS, type ToolDef } from '../sim/constants'
import { ITEM_NAMES, type ItemId } from '../sim/inventory'
import type { PropKind } from '../sim/props'
import { canDamage, requiredTool, type ToolRequirement } from '../sim/tiers'

const FAMILY_NAMES: Record<ToolDef['family'], string> = { axe: 'hacha', pickaxe: 'pico' }

/** "pico de madera": la herramienta más baja que cumple el requisito, en minúscula, para "Necesitas …". */
export function toolName({ family, tier }: ToolRequirement): string {
  let best: { item: ItemId; tier: number } | null = null
  for (const [item, def] of Object.entries(TOOL_DEFS) as [ItemId, ToolDef][]) {
    if (def.family === family && def.tier >= tier && (!best || def.tier < best.tier)) best = { item, tier: def.tier }
  }
  // Un nivel sin herramienta todavía (no debería pasar: cada recurso entra con la suya).
  if (!best) return `${FAMILY_NAMES[family]} de nivel ${tier}`
  const name = ITEM_NAMES[best.item]
  return name[0].toLowerCase() + name.slice(1)
}

/** Lo que le falta a quien lleva `item` para dañar un prop ("pico de madera"), o null si ya puede. */
export function missingTool(item: ItemId | null, kind: PropKind): string | null {
  const required = requiredTool(kind)
  return required && !canDamage(item, kind) ? toolName(required) : null
}
