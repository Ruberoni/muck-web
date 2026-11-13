import { LIT_SHARE, MOTOR_TIME, OIL_MAX, PLANE_BOARD, PLANE_HP, PLANE_WAIT } from '../sim/constants'
import type { Structure } from '../sim/structures'
import { TRAIT_NAMES, type ThreatState } from '../sim/threat'
import { NIGHT_LENGTH, type DayClock } from '../sim/world/daycycle'
import { compassName } from './minimap'

const minutes = (seconds: number) => {
  const left = Math.max(0, Math.ceil(seconds - 1e-9))
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
}

/** Nivel de los mobs y próximo rasgo, en la Noche Eterna. */
export const threatText = ({ eternal, level, next }: ThreatState) => (eternal ? `Mobs nivel ${level} · Próximo: ${TRAIT_NAMES[next]}` : null)

/** Cómo va el motor del avión, si está en marcha; con alguien a bordo, lo que falta para despegar y cuántos han subido. */
export function planeText(structures: readonly Structure[]): string | null {
  const plane = structures.find((s) => s.plane?.running)?.plane
  if (!plane) return null
  const hp = `Avión ${Math.ceil((plane.hp / PLANE_HP) * 100)} %`
  if (plane.wait !== null) return `Despega en ${minutes(plane.wait)} · ${plane.aboard}/${plane.expected} a bordo · ${hp}`
  return `Motor: ${Math.floor(Math.min(plane.heat, MOTOR_TIME))}/${MOTOR_TIME} s · ${hp}`
}

/**
 * El aviso de que alguien ha subido al avión caliente: `dx`/`dz`, del jugador al avión; `radius`, el del avión. A quien ya
 * está a bordo no se le dice hacia dónde está.
 */
export function boardingBanner(dx: number, dz: number, radius: number): string {
  const head = `¡El avión despega en ${PLANE_WAIT} s!`
  if (Math.hypot(dx, dz) - radius <= PLANE_BOARD) return `${head} Esperando a los demás`
  return `${head} Está al ${compassName(dx, dz)}`
}

/** Cómo va la noche iluminada, si hay un faro. */
export function lightText(structures: readonly Structure[], clock: DayClock): string | null {
  const fires = structures.filter((s) => s.fire && (s.fire.oil > 0 || s.fire.burning || s.fire.lit > 0)).map((s) => s.fire!)
  if (!fires.length) return null
  const lit = Math.max(...fires.map((f) => f.lit))
  const oil = Math.max(...fires.map((f) => f.oil))
  const needed = (clock.eternal ? clock.bellLength : NIGHT_LENGTH) * LIT_SHARE
  return `Faro: ${Math.min(100, Math.floor((lit / needed) * 100))} % · Aceite ${oil}/${OIL_MAX}`
}

/** El día (o la noche) y lo que falta: hasta que caiga la Noche Eterna o, dentro de ella, hasta la campana. */
export function clockTexts(clock: DayClock): { title: string; countdown: string } {
  const { day, elapsed, eternal, eternalAt, nextMorning } = clock
  if (eternal) return { title: `Noche Eterna · Noche ${day}`, countdown: `Campana en ${minutes(nextMorning - elapsed)}` }
  return { title: `Día ${day}`, countdown: Number.isFinite(eternalAt) ? `Noche Eterna en ${minutes(eternalAt - elapsed)}` : '' }
}
