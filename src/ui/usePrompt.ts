import { BUILD_DEFS, isBuilt, phaseCost } from '../sim/builds'
import { GRAVE_HOLD, MOTOR_TIME, OIL_MAX, PLANE_REPAIR_WOOD, TOTEM_HOLD } from '../sim/constants'
import { ITEM_NAMES, type ItemId } from '../sim/inventory'
import { workFactor, type MatchRules } from '../sim/match'
import { burnLeft, isLit, STATION_DEFS } from '../sim/stations'
import type { Structure, StructureKind } from '../sim/structures'
import { STATION_NAMES } from './recipes'

/**
 * Lo que dice el HUD delante de algo que se usa con la tecla de uso; `key` es su nombre legible (`bindingLabel`), para
 * que el aviso siga a la tecla asignada. `awake`: si el tótem está activado.
 */
export function usePrompt(structure: Structure, rules: MatchRules, awake: boolean, key: string): string {
  if (structure.kind === 'grave') return structure.opened ? 'Tumba abierta' : awake ? `Tumba — Mantén ${key} ${GRAVE_HOLD} s para abrirla` : 'Tumba dormida'
  const def = BUILD_DEFS[structure.kind]!
  const { build } = structure
  if (!build || isBuilt(structure)) {
    const { fire } = structure
    if (structure.kind === 'totem') return structure.awake ? `${def.name} · Despierto` : `${def.name} — Mantén ${key} ${TOTEM_HOLD} s para activarlo. No se puede deshacer`
    const { plane } = structure
    if (plane?.hp === 0) return `${def.name} · Averiado — ${key} para repararlo (${PLANE_REPAIR_WOOD} de madera)`
    if (plane?.running) return plane.heat >= MOTOR_TIME ? `${def.name} · Listo para despegar` : `${def.name} · Calentando el motor`
    if (plane) return `${def.name} — ${key} para arrancar el motor`
    if (!fire) return def.name
    if (!fire.burning && fire.left <= 0 && fire.oil === 0) return `${def.name} · Sin aceite — hazlo en el destilador y cárgalo con ${key}`
    return `${def.name} · Aceite ${fire.oil}/${OIL_MAX} — ${key} para cargar aceite o ${fire.burning ? 'apagarlo' : 'encenderlo'}`
  }
  const { name } = def.phases[build.phase]
  const left = phaseCost(structure.kind, build.phase, rules)
    .map(({ item, amount }) => `${build.delivered[item] ?? 0}/${amount} ${ITEM_NAMES[item].toLowerCase()}`)
    .join(', ')
  return `${def.name} · ${name}: ${left} — ${key} para entregar`
}

const STATION_VERBS: Partial<Record<StructureKind, string>> = { campfire: 'cocinar', furnace: 'fundir', distiller: 'destilar' }

/** Segundos como `m:ss`, o `h:mm:ss` desde una hora, redondeando hacia arriba. */
export function clockTime(seconds: number): string {
  const total = Math.ceil(Math.max(0, seconds) - 1e-9)
  const s = String(total % 60).padStart(2, '0')
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600)
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

/**
 * Lo que dice el HUD al lado de una estación de procesar (la fogata, el horno o el destilador), con la tecla que la abre.
 * La fogata dice si está encendida y cuánto fuego le queda, contando la leña de la ranura.
 */
export function stationPrompt(structure: Structure, key: string): string {
  const name = STATION_NAMES[structure.kind]
  const verb = STATION_VERBS[structure.kind]
  const { station } = structure
  if (structure.kind === 'campfire' && station) {
    if (!isLit(station)) return `${name} · Apagada — ${key} para echarle leña`
    return `${name} · Encendida ${clockTime(burnLeft(structure.kind, station))} — ${key} para ${verb}`
  }
  return verb ? `${name} — ${key} para ${verb}` : `${name} — ${key} para abrirla`
}

/**
 * Lo que procesa una estación, para su pantalla: «1 carne cruda → carne asada (10 s)», con los tiempos de esta partida.
 * En la fogata se añade cuánto arde cada madera.
 */
export function stationProcessText(kind: StructureKind, rules: MatchRules): string {
  const def = STATION_DEFS[kind]
  if (!def) return ''
  const factor = workFactor(rules)
  const lines = def.processes.map((p) => `${p.amount} ${ITEM_NAMES[p.input].toLowerCase()} → ${ITEM_NAMES[p.output].toLowerCase()} (${seconds(p.time * factor)})`)
  if (def.alwaysBurns && def.fuel) {
    const fuels = (Object.entries(def.fuel) as [ItemId, number][]).map(([item, time]) => `${ITEM_NAMES[item].toLowerCase()} ${seconds(time)}`)
    lines.push(`Arde: ${fuels.join(', ')}`)
  }
  return lines.join(' · ')
}

/** «10 s», «1 min», «1,5 min». */
function seconds(time: number): string {
  if (time < 60) return `${Math.round(time)} s`
  const min = Math.round((time / 60) * 10) / 10
  return `${String(min).replace('.', ',')} min`
}
