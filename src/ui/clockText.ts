import { LIT_SHARE, OIL_MAX } from '../sim/constants'
import type { Structure } from '../sim/structures'
import { TRAIT_NAMES, type ThreatState } from '../sim/threat'
import type { DayClock } from '../sim/world/daycycle'

const minutes = (seconds: number) => {
  const left = Math.max(0, Math.ceil(seconds))
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
}

/** Nivel de los mobs y próximo rasgo, en la Noche Eterna. */
export const threatText = ({ eternal, level, next }: ThreatState) => (eternal ? `Mobs nivel ${level} · Próximo: ${TRAIT_NAMES[next]}` : null)

/** Cómo va la noche iluminada, si hay un faro. */
export function lightText(structures: readonly Structure[], clock: DayClock): string | null {
  if (!clock.eternal) return null
  const fires = structures.filter((s) => s.fire && (s.fire.oil > 0 || s.fire.burning || s.fire.lit > 0)).map((s) => s.fire!)
  if (!fires.length) return null
  const lit = Math.max(...fires.map((f) => f.lit))
  const oil = Math.max(...fires.map((f) => f.oil))
  const needed = clock.bellLength * LIT_SHARE
  return `Faro: ${Math.min(100, Math.floor((lit / needed) * 100))} % · Aceite ${oil}/${OIL_MAX}`
}

/** El día (o la noche) y lo que falta: hasta que caiga la Noche Eterna o, dentro de ella, hasta la campana. */
export function clockTexts(clock: DayClock): { title: string; countdown: string } {
  const { day, elapsed, eternal, eternalAt, nextMorning } = clock
  if (eternal) return { title: `Noche Eterna · Noche ${day}`, countdown: `Campana en ${minutes(nextMorning - elapsed)}` }
  return { title: `Día ${day}`, countdown: Number.isFinite(eternalAt) ? `Noche Eterna en ${minutes(eternalAt - elapsed)}` : '' }
}
