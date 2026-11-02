import { BUILD_DEFS, isBuilt, phaseCost } from '../sim/builds'
import { ITEM_NAMES } from '../sim/inventory'
import type { MatchRules } from '../sim/match'
import type { Structure } from '../sim/structures'

/** Lo que dice el HUD delante de algo que se usa con E. */
export function usePrompt(structure: Structure, rules: MatchRules): string {
  const def = BUILD_DEFS[structure.kind]!
  const { build } = structure
  if (!build || isBuilt(structure)) return def.name
  const { name } = def.phases[build.phase]
  const left = phaseCost(structure.kind, build.phase, rules)
    .map(({ item, amount }) => `${build.delivered[item] ?? 0}/${amount} ${ITEM_NAMES[item].toLowerCase()}`)
    .join(', ')
  return `${def.name} · ${name}: ${left} — E para entregar`
}
