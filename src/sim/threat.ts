import { DIFFICULTY_DEFS, type Difficulty } from './match'

/** Lo que aprenden los mobs con cada campana a oscuras. */
export type MobTrait = 'fast' | 'strong' | 'aggressive'

export const TRAIT_NAMES: Record<MobTrait, string> = { fast: 'Rápidos', strong: 'Fuertes', aggressive: 'Agresivos' }
const TRAITS = Object.keys(TRAIT_NAMES) as MobTrait[]

/** Lo que multiplica cada cosa de los mobs comunes. Los jefes y los guardianes no suben. */
export interface MobScaling {
  hp: number
  damage: number
  speed: number
  /** Segundos entre sus ataques. */
  attackInterval: number
  /** Segundos entre apariciones. */
  spawnInterval: number
}

export const NO_SCALING: Readonly<MobScaling> = { hp: 1, damage: 1, speed: 1, attackInterval: 1, spawnInterval: 1 }

/** Velocidad máxima: correr (10) siempre deja atrás a un mob. */
export const MOB_MAX_SPEED = 9

/** Un 5 % más de vida por noche, hasta la última antes de la Noche Eterna. */
const HP_PER_NIGHT = 0.05
const LAST_NORMAL_NIGHT = 5
const ETERNAL_JUMP = { hp: 1.5, damage: 1.3, speed: 1.15 }
const TOTEM_JUMP = { hp: 1.5, damage: 1.3, speed: 1.1 }
const FAST_SPEED = 1.08
const STRONG_HP = 1.15
const STRONG_DAMAGE = 1.1
const AGGRESSIVE_RATE = 0.9

/** Por dónde va la amenaza: los dos saltos y los rasgos de cada campana a oscuras. */
export interface ThreatState {
  /** Campanas a oscuras. */
  level: number
  traits: Record<MobTrait, number>
  /** El rasgo que tocará en la siguiente campana a oscuras: se anuncia antes. */
  next: MobTrait
  eternal: boolean
  totem: boolean
  /** Noches normales que quedaron iluminadas: cada una resta lo que habría subido la vida. */
  litNights: number
}

const fresh = (): ThreatState => ({ level: 0, traits: { fast: 0, strong: 0, aggressive: 0 }, next: 'strong', eternal: false, totem: false, litNights: 0 })

/**
 * Cuánto han subido los mobs. La cantidad tiene tope, así que lo que sube después es esto: un poco cada noche, un salto
 * al caer la Noche Eterna, otro al activar el tótem, en cualquier orden, y un rasgo con cada campana a oscuras.
 */
export class Threat {
  state = fresh()

  /** Cae la Noche Eterna: primer salto. */
  fall(rng: () => number) {
    this.state.eternal = true
    this.state.next = TRAITS[Math.floor(rng() * TRAITS.length)]
  }

  /** Amanece tras una noche normal iluminada: esa noche no cuenta. */
  lightNight() {
    this.state.litNights++
  }

  /** Se activa el tótem: segundo salto. */
  awaken() {
    this.state.totem = true
  }

  /** Campana a oscuras: suben un nivel con el rasgo anunciado. Devuelve ese rasgo. */
  rise(rng: () => number): MobTrait {
    const trait = this.state.next
    this.state.level++
    this.state.traits[trait]++
    this.state.next = TRAITS[Math.floor(rng() * TRAITS.length)]
    return trait
  }

  /** Escribe en `out` lo que vale ahora, la noche `day`. La dificultad multiplica lo que añaden los saltos. */
  apply(day: number, difficulty: Difficulty, out: MobScaling) {
    const { traits, eternal, totem, litNights } = this.state
    const jumps = DIFFICULTY_DEFS[difficulty].jumps
    const jump = (active: boolean, factor: number) => (active ? 1 + (factor - 1) * jumps : 1)
    const both = (key: keyof typeof ETERNAL_JUMP) => jump(eternal, ETERNAL_JUMP[key]) * jump(totem, TOTEM_JUMP[key])
    const nights = Math.max(0, Math.min(day, LAST_NORMAL_NIGHT) - 1 - litNights)
    out.hp = (1 + HP_PER_NIGHT * nights) * both('hp') * STRONG_HP ** traits.strong
    out.damage = both('damage') * STRONG_DAMAGE ** traits.strong
    out.speed = both('speed') * FAST_SPEED ** traits.fast
    out.attackInterval = out.spawnInterval = AGGRESSIVE_RATE ** traits.aggressive
  }

  reset() {
    this.state = fresh()
  }

  save(): ThreatState {
    return { ...this.state, traits: { ...this.state.traits } }
  }

  load(state: ThreatState) {
    this.state = { ...state, traits: { ...state.traits } }
  }
}
