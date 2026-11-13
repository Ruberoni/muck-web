import type { GameState } from '../../game/states'
import type { MatchEnd } from '../../sim/match'

/** Las pantallas del menú: una a la vez, sin scroll. null: en partida, sin menú. */
export type Screen = 'home' | 'invite' | 'join' | 'solo-difficulty' | 'room' | 'countdown' | 'pause' | 'dead' | 'results' | 'loading'

/** Las que se abren encima de otra y vuelven a ella (con "Volver" o Esc). */
export type SubScreen = 'controls' | 'settings' | 'difficulty-room'

/** Las que se eligen desde el inicio (y vuelven a él con "Volver" o Esc). */
export type Choice = 'join' | 'solo-difficulty'

/** Todo lo que decide la pantalla: el estado del juego y lo que el menú ha ido eligiendo. */
export interface ScreenInput {
  state: GameState
  /**
   * El aviso que el juego ha puesto encima del estado: `ready`, la partida de la sala ha empezado y falta entrar (el
   * estado es `paused`). `retry` no cambia de pantalla: el botón principal vuelve a pedir el ratón.
   */
  overlay: 'ready' | 'retry' | null
  /** En una sala (conectado o reconectando). */
  inRoom: boolean
  /** La pantalla final que hay a la vista (null: ninguna, o ya cerrada). */
  results: MatchEnd | null
  /** Con el lobby cargado (bandera multijugador): sin él no hay ni salas ni invitaciones. */
  hasLobby: boolean
  /** El código de la sala de la URL (`?room=`), si lo hay. */
  inviteCode: string | null
  /** Lo elegido en el inicio, si se ha salido de él. */
  choice: Choice | null
  /** Cargando los modelos al abrir el juego (solo cuenta en el menú: no tapa una partida). */
  loading: boolean
}

/** La pantalla que toca. Las sub-pantallas (`SubScreen`) van aparte, en una pila encima de esta. */
export function screenFor(input: ScreenInput): Screen | null {
  const { state } = input
  if (state === 'playing' || state === 'spectating' || state === 'inventory') return null
  if (state === 'paused') return input.overlay === 'ready' ? 'countdown' : 'pause'
  if (state === 'dead') return input.results && input.results !== 'lost' ? 'results' : 'dead'
  // menu
  if (input.loading) return 'loading'
  if (input.hasLobby && input.inRoom) return input.results ? 'results' : 'room'
  if (input.choice === 'solo-difficulty') return 'solo-difficulty'
  if (input.hasLobby && input.choice === 'join') return 'join'
  if (input.hasLobby && input.inviteCode) return 'invite'
  return 'home'
}

/** A qué pantalla vuelve "Volver" (o Esc) desde una elegida en el inicio; null si no se vuelve a ninguna. */
export const backFrom = (screen: Screen | null): 'home' | null => (screen === 'join' || screen === 'solo-difficulty' ? 'home' : null)

/**
 * Qué hace Esc en el menú: `back` cierra la sub-pantalla de arriba o vuelve al inicio; `resume` es la pausa, que
 * reanuda (si `escapeResumes` lo deja); `none`, nada (la sala, la cuenta atrás, el inicio, la muerte…).
 */
export function escapeAction(screen: Screen | null, subScreens: number): 'back' | 'resume' | 'none' {
  if (subScreens > 0) return 'back'
  if (backFrom(screen)) return 'back'
  return screen === 'pause' ? 'resume' : 'none'
}
