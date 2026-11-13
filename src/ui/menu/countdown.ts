/** Segundos de la cuenta atrás antes de "¡Entrar!". */
export const COUNTDOWN_SECONDS = 3

/** El número que se ve a los `elapsedMs` de empezar la cuenta atrás (3, 2, 1), o null si ya toca entrar. */
export function countdownNumber(elapsedMs: number): number | null {
  const left = COUNTDOWN_SECONDS - Math.floor(Math.max(0, elapsedMs) / 1000)
  return left > 0 ? left : null
}
