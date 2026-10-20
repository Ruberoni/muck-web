/** Duración de un ciclo completo (día + noche) en segundos de juego. */
export const DAY_LENGTH = 360
/** Fracción del ciclo con el sol sobre el horizonte. */
export const DAY_FRACTION = 0.65
/** La partida empieza a media mañana del día 1. */
export const START_PHASE = 0.12

/** Módulo siempre positivo, igual que THREE.MathUtils.euclideanModulo. */
export const euclideanModulo = (n: number, m: number) => ((n % m) + m) % m

/** Reloj de la partida. Fase 0 = amanecer; el día cambia en cada amanecer. */
export class DayClock {
  elapsed = 0

  step(dt: number) {
    this.elapsed += dt
  }

  reset() {
    this.elapsed = 0
  }

  /** Ciclos completos desde el primer amanecer, con decimales. */
  private get cycles() {
    return START_PHASE + this.elapsed / DAY_LENGTH
  }

  get day() {
    return Math.floor(this.cycles) + 1
  }

  /** Posición dentro del ciclo actual, en [0, 1). */
  get phase() {
    return this.cycles - Math.floor(this.cycles)
  }

  set phase(value: number) {
    const target = Math.floor(this.cycles) + euclideanModulo(value, 1)
    this.elapsed = (target - START_PHASE) * DAY_LENGTH
  }
}

/** De noche el sol está bajo el horizonte. */
export const isNight = (phase: number) => euclideanModulo(phase, 1) >= DAY_FRACTION
