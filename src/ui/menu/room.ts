import { MAX_PLAYERS, type MatchInfo } from '../../net/protocol'
import type { Difficulty } from '../../sim/match'
import type { PlayerId } from '../../sim/events'

/** Un puesto de la sala: alguien (con su corona si es el anfitrión) o un hueco libre (null). */
export interface Seat {
  id: PlayerId
  name: string
  host: boolean
  me: boolean
}

/** Lo que pinta la sala de espera, sacado del último `match` (null: aún no ha llegado). */
export interface RoomModel {
  /** Siempre MAX_PLAYERS puestos: primero los que están, en el orden de la sala, y luego los huecos. */
  seats: (Seat | null)[]
  /** Cuántos hay. */
  count: number
  isHost: boolean
  /** Esperando en el lobby (también tras acabar una partida); si no, la partida está en marcha. */
  lobby: boolean
  difficulty: Difficulty
}

export function roomModel(match: MatchInfo | null, me: PlayerId): RoomModel {
  const players = match?.players ?? []
  const seats: (Seat | null)[] = players.slice(0, MAX_PLAYERS).map(({ id, name }) => ({ id, name, host: id === match!.host, me: id === me }))
  while (seats.length < MAX_PLAYERS) seats.push(null)
  return {
    seats,
    count: players.length,
    isHost: !!match && match.host === me,
    lobby: match?.phase === 'lobby',
    difficulty: match?.difficulty ?? 'normal',
  }
}

/** Lo que cambia la lista de puestos: si es igual que la última vez no se rehace (ni parpadea). */
export const seatsKey = (model: RoomModel) => model.seats.map((s) => (s ? `${s.id}:${s.name}:${s.host ? 'h' : ''}${s.me ? 'm' : ''}` : '-')).join('|')

/** La etiqueta de un puesto, al lado del nombre. */
export function seatNote(seat: Seat): string {
  if (seat.host && seat.me) return 'anfitrión · tú'
  if (seat.host) return 'anfitrión'
  return seat.me ? 'tú' : ''
}
