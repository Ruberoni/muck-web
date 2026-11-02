import { resolveCircle, SpatialGrid, type Collider } from './collision'
import {
  METEOR_BLAST,
  METEOR_DAMAGE,
  METEOR_FROM_DAY,
  METEOR_PHASE_MAX,
  METEOR_PHASE_MIN,
  METEOR_RADIUS,
  METEOR_SPAWN_MAX,
  METEOR_SPAWN_MIN,
  METEOR_WARNING,
  STEP,
} from './constants'
import { NO_EMIT, type Emit, type PlayerId } from './events'
import { biomeAt } from './world/biomes'
import { isNight } from './world/daycycle'
import { heightAt, MAX_SLOPE, slopeAt } from './world/terrain'

const SPOT_ATTEMPTS = 24

/** Un meteorito: mientras cae, solo se anuncia; en el suelo, su roca es un obstáculo más. */
export interface Meteor extends Collider {
  y: number
  /** Tick en que cae. */
  landTick: number
  landed: boolean
  /** Día en que se enfrió: desaparece al amanecer siguiente. null: sigue caliente. */
  coolDay: number | null
  /** El enemigo que lo guarda (en el cliente, null): mientras viva sigue caliente. */
  guardian: number | null
}

/** Quien guarda un meteorito: lo pone Simulation, que es quien tiene a los enemigos. */
export interface MeteorGuardian {
  /** Lo crea junto a (x, z), con `players` jugadores en el mundo. Devuelve su id. */
  spawn(x: number, z: number, players: number): number
  alive(id: number): boolean
}

const NO_GUARDIAN: MeteorGuardian = { spawn: () => 0, alive: () => false }

/** Un jugador que puede pillar debajo: en el mundo y vivo (`alive` falso: no le da, como con los enemigos). */
export interface WorldEventTarget {
  id: PlayerId
  pos: { x: number; z: number }
  alive: boolean
}

export interface WorldEventDamage {
  playerId: PlayerId
  damage: number
}

/** Los eventos del mundo como datos, para guardar y restaurar la partida. */
export interface WorldEventsState {
  meteor: Meteor | null
  /** Último día al que se le eligió hora. */
  day: number
  /** Fase a la que caerá el meteorito de hoy. null: hoy ya no cae ninguno. */
  fallPhase: number | null
}

/** Hierba y poco inclinado: ni en la playa ni en la montaña. */
function isGrass(x: number, z: number) {
  const biome = biomeAt(x, z)
  return (biome === 'meadow' || biome === 'forest') && slopeAt(x, z) <= MAX_SLOPE
}

/**
 * Lo que pasa en la isla sin que nadie lo provoque: de momento, meteoritos. Hay uno como mucho: el de cada día no cae
 * mientras siga el anterior. La simulación los decide; en red el cliente tiene su propia copia, que sigue sus eventos.
 * Los dibuja MeteorView.
 */
export class WorldEvents {
  /** La roca del meteorito: una rejilla más de obstáculos para jugadores, enemigos y lo que vuela. */
  readonly grid = new SpatialGrid<Collider>()
  meteor: Meteor | null = null
  private day = 0
  private fallPhase: number | null = null

  /** `grids`: lo que no quiere debajo (props, estructuras…). */
  constructor(
    private grids: SpatialGrid<Collider>[] = [],
    private rng: () => number = Math.random,
    private emit: Emit = NO_EMIT,
    private guardians: MeteorGuardian = NO_GUARDIAN,
  ) {}

  /**
   * Paso fijo al tick `tick`. `players`: los que están en el mundo. Devuelve el daño a cada jugador en este paso.
   * En la Noche Eterna `eternal`: ya no hay día, y el de cada noche cae con su campana. Sin esto no habría fragmentos
   * para el tótem si no se consiguieron antes, y la partida no se podría ganar.
   */
  step(tick: number, players: readonly WorldEventTarget[], phase: number, day: number, eternal = false): WorldEventDamage[] {
    if (this.meteor && this.meteor.coolDay !== null && day > this.meteor.coolDay) this.clearMeteor()
    if (day !== this.day) {
      this.day = day
      this.fallPhase = day >= METEOR_FROM_DAY ? METEOR_PHASE_MIN + this.rng() * (METEOR_PHASE_MAX - METEOR_PHASE_MIN) : null
    }
    const { meteor } = this
    if (meteor) {
      if (!meteor.landed) return tick >= meteor.landTick ? this.land(meteor, players) : []
      if (meteor.coolDay === null && meteor.guardian !== null && !this.guardians.alive(meteor.guardian)) {
        this.setCooled(day)
        this.emit({ type: 'meteorCooled', day })
      }
      return []
    }
    if (this.fallPhase !== null && phase >= this.fallPhase && (eternal || !isNight(phase))) {
      const spot = this.findSpot(players)
      if (spot) this.fall(tick, spot.x, spot.z)
    }
    return []
  }

  /** Un sitio de hierba libre a METEOR_SPAWN_MIN–MAX metros de un jugador vivo al azar; null si no hay vivos o no se encuentra. */
  findSpot(players: readonly WorldEventTarget[]): { x: number; z: number } | null {
    const living = players.filter((p) => p.alive)
    if (!living.length) return null
    const around = living[Math.floor(this.rng() * living.length)]
    for (let i = 0; i < SPOT_ATTEMPTS; i++) {
      const angle = this.rng() * Math.PI * 2
      const r = METEOR_SPAWN_MIN + this.rng() * (METEOR_SPAWN_MAX - METEOR_SPAWN_MIN)
      const pos = { x: around.pos.x + Math.cos(angle) * r, z: around.pos.z + Math.sin(angle) * r }
      if (!isGrass(pos.x, pos.z)) continue
      const { x, z } = pos
      if (!this.grids.some((grid) => resolveCircle(pos, METEOR_BLAST, grid))) return { x, z }
    }
    return null
  }

  /** Anuncia un meteorito en (x, z), que cae dentro de METEOR_WARNING segundos. Si queda otro, ese desaparece. */
  fall(tick: number, x: number, z: number) {
    if (this.meteor) this.clearMeteor()
    this.fallPhase = null
    const y = heightAt(x, z)
    const landTick = tick + Math.round(METEOR_WARNING / STEP)
    this.add({ x, y, z, landTick })
    this.emit({ type: 'meteorIncoming', x, y, z, landTick })
  }

  /** Lo pone en la lista: en la simulación lo hace `fall`; en el cliente, su evento. */
  add({ x, y, z, landTick }: Pick<Meteor, 'x' | 'y' | 'z' | 'landTick'>) {
    this.meteor = { x, y, z, radius: METEOR_RADIUS, alive: true, landTick, landed: false, coolDay: null, guardian: null }
  }

  /** La roca ya está en el suelo y se choca con ella. */
  settle() {
    if (!this.meteor) return
    this.meteor.landed = true
    this.grid.insert(this.meteor)
  }

  /** Se enfría en el día `day`. */
  setCooled(day: number) {
    if (this.meteor) this.meteor.coolDay = day
  }

  remove() {
    this.meteor = null
    this.grid.clear()
  }

  private land(meteor: Meteor, players: readonly WorldEventTarget[]): WorldEventDamage[] {
    this.settle()
    const { x, y, z } = meteor
    this.emit({ type: 'meteorLanded', x, y, z })
    meteor.guardian = this.guardians.spawn(x, z, players.length)
    return players
      .filter((p) => p.alive && Math.hypot(p.pos.x - x, p.pos.z - z) < METEOR_BLAST)
      .map((p) => ({ playerId: p.id, damage: METEOR_DAMAGE }))
  }

  private clearMeteor() {
    this.remove()
    this.emit({ type: 'meteorGone' })
  }

  /** Reinicio de partida: sin meteorito y el día sin elegir. */
  reset() {
    this.remove()
    this.day = 0
    this.fallPhase = null
  }

  save(): WorldEventsState {
    return { meteor: this.meteor && { ...this.meteor }, day: this.day, fallPhase: this.fallPhase }
  }

  load(state: WorldEventsState) {
    this.remove()
    this.meteor = state.meteor && { ...state.meteor }
    if (this.meteor?.landed) this.grid.insert(this.meteor)
    this.day = state.day
    this.fallPhase = state.fallPhase
  }
}
