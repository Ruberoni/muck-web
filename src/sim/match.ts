import type { PlayerId } from './events'

export type Difficulty = 'easy' | 'normal' | 'hard' | 'ultra'

export interface DifficultyDef {
  name: string
  /** Parte del tiempo hasta la Noche Eterna que cuesta cada prioridad (armas, faro, tótem). */
  cost: number
  /** Por cuánto se multiplica lo que añaden los saltos de los mobs. */
  jumps: number
  /** Vidas de una partida en solitario. */
  lives: number
}

export const DIFFICULTY_DEFS: Record<Difficulty, DifficultyDef> = {
  easy: { name: 'Fácil', cost: 0.3, jumps: 0.75, lives: 3 },
  normal: { name: 'Normal', cost: 0.45, jumps: 1, lives: 2 },
  hard: { name: 'Difícil', cost: 0.55, jumps: 1.25, lives: 1 },
  ultra: { name: 'Ultrahard', cost: 0.65, jumps: 1.5, lives: 1 },
}

export const DIFFICULTIES = Object.keys(DIFFICULTY_DEFS) as Difficulty[]
export const isDifficulty = (value: unknown): value is Difficulty => DIFFICULTIES.includes(value as Difficulty)

/** Las reglas de una partida: se fijan al empezar y no cambian aunque alguien se vaya. */
export interface MatchRules {
  /** Jugadores con los que empezó. */
  players: number
  difficulty: Difficulty
}

export const DEFAULT_RULES: MatchRules = { players: 1, difficulty: 'normal' }

/** Cómo acaba una partida. */
export type MatchEnd = 'lost' | 'surrendered' | 'escaped'

export interface MatchResult {
  end: MatchEnd
  /** Día (o noche) en que acabó. */
  day: number
  /** Segundos de partida. */
  seconds: number
  players: { id: PlayerId; deaths: number; escaped: boolean }[]
}
