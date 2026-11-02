import { BUILD_DEFS, isBuilt, phaseCost } from '../sim/builds'
import { GRAVE_HOLD, MOTOR_TIME, OIL_MAX, PLANE_REPAIR_WOOD, TOTEM_HOLD } from '../sim/constants'
import { ITEM_NAMES } from '../sim/inventory'
import type { MatchRules } from '../sim/match'
import type { Structure } from '../sim/structures'

/** Lo que dice el HUD delante de algo que se usa con E. `awake`: si el tótem está activado. */
export function usePrompt(structure: Structure, rules: MatchRules, awake: boolean): string {
  if (structure.kind === 'grave') return structure.opened ? 'Tumba abierta' : awake ? `Tumba — Mantén E ${GRAVE_HOLD} s para abrirla` : 'Tumba dormida'
  const def = BUILD_DEFS[structure.kind]!
  const { build } = structure
  if (!build || isBuilt(structure)) {
    const { fire } = structure
    if (structure.kind === 'totem') return structure.awake ? `${def.name} · Despierto` : `${def.name} — Mantén E ${TOTEM_HOLD} s para activarlo. No se puede deshacer`
    const { plane } = structure
    if (plane?.hp === 0) return `${def.name} · Averiado — E para repararlo (${PLANE_REPAIR_WOOD} de madera)`
    if (plane?.running) return plane.heat >= MOTOR_TIME ? `${def.name} · Listo para despegar` : `${def.name} · Calentando el motor`
    if (plane) return `${def.name} — E para arrancar el motor`
    if (!fire) return def.name
    if (!fire.burning && fire.left <= 0 && fire.oil === 0) return `${def.name} · Sin aceite — hazlo en el destilador y cárgalo con E`
    return `${def.name} · Aceite ${fire.oil}/${OIL_MAX} — E para cargar aceite o ${fire.burning ? 'apagarlo' : 'encenderlo'}`
  }
  const { name } = def.phases[build.phase]
  const left = phaseCost(structure.kind, build.phase, rules)
    .map(({ item, amount }) => `${build.delivered[item] ?? 0}/${amount} ${ITEM_NAMES[item].toLowerCase()}`)
    .join(', ')
  return `${def.name} · ${name}: ${left} — E para entregar`
}
