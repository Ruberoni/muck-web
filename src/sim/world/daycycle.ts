/** Duración de un ciclo completo (día + noche) de referencia, en segundos de juego. */
export const DAY_LENGTH = 360
/** Fase a la que anochece. El día dura lo que digan las reglas, pero esta fase no cambia: cielo, sol y `isNight` la dan por fija. */
export const DAY_FRACTION = 0.65
/** La partida empieza a media mañana del día 1. */
export const START_PHASE = 0.12
/** Segundos de noche: los mismos para todos. */
export const NIGHT_LENGTH = DAY_LENGTH * (1 - DAY_FRACTION)
/** La fase a la que se queda la Noche Eterna: medianoche. */
const MIDNIGHT = (1 + DAY_FRACTION) / 2

/** Módulo siempre positivo, igual que THREE.MathUtils.euclideanModulo. */
export const euclideanModulo = (n: number, m: number) => ((n % m) + m) % m

/** Cómo corre el reloj: lo fijan las reglas de la partida (`clockOf`). */
export interface ClockRules {
  /** Segundos de luz de cada día. */
  daylight: number
  /** Día en cuya noche cae la Noche Eterna: desde ahí no vuelve a amanecer. */
  eternalDay: number
  /** Segundos entre campanas en la Noche Eterna. */
  bell: number
}

/** Sin reglas: el ciclo de referencia, sin Noche Eterna. */
const ENDLESS: ClockRules = { daylight: DAY_LENGTH * DAY_FRACTION, eternalDay: Infinity, bell: 0 }

/**
 * Reloj de la partida. Fase 0 = amanecer; el día cambia en cada amanecer. En la Noche Eterna ya no amanece: la fase se
 * queda en medianoche y el día sube con cada campana, así que lo que sale "cada noche" sigue saliendo.
 */
export class DayClock {
  elapsed = 0
  private rules = ENDLESS

  configure(rules: ClockRules) {
    this.rules = rules
  }

  step(dt: number) {
    this.elapsed += dt
  }

  reset() {
    this.elapsed = 0
  }

  private get cycle() {
    return this.rules.daylight + NIGHT_LENGTH
  }

  /** Segundos que `elapsed` empieza por detrás del primer amanecer. */
  private get startOffset() {
    return (START_PHASE / DAY_FRACTION) * this.rules.daylight
  }

  /** `elapsed` al que cae la Noche Eterna. */
  get eternalAt() {
    return (this.rules.eternalDay - 1) * this.cycle + this.rules.daylight - this.startOffset
  }

  get eternal() {
    return this.elapsed >= this.eternalAt
  }

  /** Noches enteras que han pasado desde que cayó la Noche Eterna. */
  private get bells() {
    return Math.floor((this.elapsed - this.eternalAt) / this.rules.bell)
  }

  /** Segundos desde el primer amanecer, dentro del ciclo actual. */
  private get intoCycle() {
    return euclideanModulo(this.elapsed + this.startOffset, this.cycle)
  }

  get day() {
    if (this.eternal) return this.rules.eternalDay + this.bells
    return Math.floor((this.elapsed + this.startOffset) / this.cycle) + 1
  }

  /** Posición dentro del ciclo actual, en [0, 1). */
  get phase() {
    if (this.eternal) return Math.min(MIDNIGHT, DAY_FRACTION + ((this.elapsed - this.eternalAt) / NIGHT_LENGTH) * (1 - DAY_FRACTION))
    const t = this.intoCycle
    const { daylight } = this.rules
    return t < daylight ? (t / daylight) * DAY_FRACTION : DAY_FRACTION + ((t - daylight) / NIGHT_LENGTH) * (1 - DAY_FRACTION)
  }

  set phase(value: number) {
    this.elapsed = this.elapsedAt(this.day, value)
  }

  /** `elapsed` del día `day` a la fase `phase`. Dentro de la Noche Eterna, el de su campana. */
  elapsedAt(day: number, phase: number): number {
    const p = euclideanModulo(phase, 1)
    const { daylight, eternalDay, bell } = this.rules
    const within = p < DAY_FRACTION ? (p / DAY_FRACTION) * daylight : daylight + ((p - DAY_FRACTION) / (1 - DAY_FRACTION)) * NIGHT_LENGTH
    const elapsed = (day - 1) * this.cycle + within - this.startOffset
    return elapsed < this.eternalAt ? elapsed : this.eternalAt + (day - eternalDay) * bell
  }

  /** `elapsed` del siguiente amanecer o, en la Noche Eterna, de la siguiente campana. */
  get nextMorning() {
    if (this.eternal) return this.eternalAt + (this.bells + 1) * this.rules.bell
    return (Math.floor((this.elapsed + this.startOffset) / this.cycle) + 1) * this.cycle - this.startOffset
  }
}

/** De noche el sol está bajo el horizonte. */
export const isNight = (phase: number) => euclideanModulo(phase, 1) >= DAY_FRACTION
