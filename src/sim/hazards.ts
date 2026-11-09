import { STEP } from './constants'
import { NO_EMIT, type Emit, type PlayerId } from './events'

/** Cómo se ve un peligro: lo elige el ataque que lo crea (la vista lo pinta de su color). */
export type HazardLook = 'stomp' | 'rock' | 'fire' | 'light' | 'crystal'

/**
 * Un peligro en el suelo, con centro fijo y por ticks, como los proyectiles: así el cliente lo dibuja en su tick
 * predicho igual que lo decide el servidor, y se esquiva lo que se ve.
 *
 * - Zona: se marca desde `startTick` y daña a quien esté dentro en `hitTick`; con `pulse`, cada `pulse` ticks hasta
 *   `endTick` (el suelo ardiendo).
 * - Onda (`ring`): un anillo que sale del centro en `hitTick` a `ring.speed` m/s hasta `radius`; daña una vez a quien
 *   esté en el suelo cuando el anillo pasa por él, así que se esquiva saltando.
 */
export interface Hazard {
  id: number
  look: HazardLook
  x: number
  z: number
  radius: number
  startTick: number
  hitTick: number
  endTick: number
  damage: number
  pulse?: number
  ring?: { speed: number; width: number }
  /** A quién ha dado ya una onda. */
  hit: PlayerId[]
}

/** Un jugador al que le puede dar: en el mundo, vivo y si pisa el suelo (en el aire, la onda le pasa por debajo). */
export interface HazardTarget {
  id: PlayerId
  pos: { x: number; z: number }
  alive: boolean
  grounded: boolean
}

export interface HazardDamage {
  playerId: PlayerId
  damage: number
}

export interface HazardsState {
  list: Hazard[]
  nextId: number
}

const copyHazard = (h: Hazard): Hazard => ({ ...h, ring: h.ring && { ...h.ring }, hit: [...h.hit] })

/** El radio de una onda en `tick` (0 antes de salir). */
export const ringRadius = (h: Pick<Hazard, 'hitTick' | 'ring'>, tick: number) => (h.ring ? Math.max(0, (tick - h.hitTick) * STEP * h.ring.speed) : 0)

/** Segundos a ticks, redondeando. */
export const ticks = (seconds: number) => Math.round(seconds / STEP)

/** Los peligros de la partida: los crean los ataques de los jefes y los resuelve solo la simulación. */
export class Hazards {
  readonly list: Hazard[] = []
  private nextId = 0

  constructor(private emit: Emit = NO_EMIT) {}

  /** Uno nuevo: se avisa con todo lo que hace falta para dibujarlo (`hazardAdded`). */
  add(data: Omit<Hazard, 'id' | 'hit' | 'endTick'> & { endTick?: number }): Hazard {
    const endTick = data.endTick ?? (data.ring ? data.hitTick + Math.ceil((data.radius + data.ring.width) / data.ring.speed / STEP) : data.hitTick)
    const hazard: Hazard = { ...data, endTick, id: this.nextId++, hit: [] }
    this.list.push(hazard)
    this.emit({ type: 'hazardAdded', hazard: copyHazard(hazard) })
    return hazard
  }

  /** Paso fijo al tick `tick`. Devuelve el daño a cada jugador en este paso. */
  step(tick: number, players: readonly HazardTarget[]): HazardDamage[] {
    const damage: HazardDamage[] = []
    for (const h of [...this.list]) {
      if (tick < h.hitTick) continue
      for (const p of players) {
        if (!p.alive) continue
        const d = Math.hypot(p.pos.x - h.x, p.pos.z - h.z)
        if (h.ring) {
          const r = ringRadius(h, tick)
          if (!p.grounded || h.hit.includes(p.id) || d > r || d < r - h.ring.width || d > h.radius + h.ring.width) continue
          h.hit.push(p.id)
          damage.push({ playerId: p.id, damage: h.damage })
        } else if (d <= h.radius && (h.pulse ? (tick - h.hitTick) % h.pulse === 0 : tick === h.hitTick)) {
          damage.push({ playerId: p.id, damage: h.damage })
        }
      }
      if (tick >= h.endTick) this.list.splice(this.list.indexOf(h), 1)
    }
    return damage
  }

  /** La copia del cliente: lo añade su evento y se quita solo cuando ya no se ve. */
  mirror(hazard: Hazard) {
    if (!this.list.some((h) => h.id === hazard.id)) this.list.push(copyHazard(hazard))
  }

  /** La copia del cliente, al tick `tick`: quita lo que ya ha acabado. */
  follow(tick: number) {
    for (const h of [...this.list]) if (tick > h.endTick + ticks(0.5)) this.list.splice(this.list.indexOf(h), 1)
  }

  clear() {
    this.list.length = 0
    this.nextId = 0
  }

  save(): HazardsState {
    return { list: this.list.map(copyHazard), nextId: this.nextId }
  }

  load(state: HazardsState) {
    this.list.length = 0
    this.list.push(...state.list.map(copyHazard))
    this.nextId = state.nextId
  }
}
