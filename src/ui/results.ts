import type { PlayerId } from '../sim/events'
import type { MatchEnd, MatchResult } from '../sim/match'

const TITLES: Record<MatchEnd, string> = {
  lost: 'Fin de la partida',
  surrendered: 'Os habéis rendido',
  escaped: '¡Habéis escapado!',
}

const clockText = (seconds: number) => `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, '0')} s`

/** Las líneas de la pantalla final: cómo acabó, hasta dónde se llegó, quién se salvó y quién murió más. */
export function resultLines(result: MatchResult, nameOf: (id: PlayerId) => string): string[] {
  const { end, day, seconds, players } = result
  const lines = [TITLES[end], `Día ${day} · ${clockText(seconds)}`]
  if (end === 'escaped') {
    for (const { id, escaped } of players) lines.push(`${nameOf(id)}: ${escaped ? 'se salvó' : 'se quedó en la isla'}`)
  }
  const worst = Math.max(0, ...players.map((p) => p.deaths))
  if (players.length > 1 && worst > 0) {
    const names = players.filter((p) => p.deaths === worst).map((p) => nameOf(p.id))
    lines.push(`Más muertes: ${names.join(', ')} (${worst})`)
  }
  return lines
}
