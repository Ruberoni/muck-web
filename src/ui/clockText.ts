import { TRAIT_NAMES, type ThreatState } from '../sim/threat'
import type { DayClock } from '../sim/world/daycycle'

const minutes = (seconds: number) => {
  const left = Math.max(0, Math.ceil(seconds))
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
}

/** Nivel de los mobs y próximo rasgo, en la Noche Eterna. */
export const threatText = ({ eternal, level, next }: ThreatState) => (eternal ? `Mobs nivel ${level} · Próximo: ${TRAIT_NAMES[next]}` : null)

/** El día (o la noche) y lo que falta: hasta que caiga la Noche Eterna o, dentro de ella, hasta la campana. */
export function clockTexts(clock: DayClock): { title: string; countdown: string } {
  const { day, elapsed, eternal, eternalAt, nextMorning } = clock
  if (eternal) return { title: `Noche Eterna · Noche ${day}`, countdown: `Campana en ${minutes(nextMorning - elapsed)}` }
  return { title: `Día ${day}`, countdown: Number.isFinite(eternalAt) ? `Noche Eterna en ${minutes(eternalAt - elapsed)}` : '' }
}
