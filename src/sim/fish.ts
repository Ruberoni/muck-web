import { NO_EMIT, type Emit, type PlayerId } from './events'

/** Segundos seguidos en el agua del mar hasta que aparece el pez. */
export const FISH_DELAY = 12
/** Lo que quita cada mordisco donde ya no se hace pie, y cada cuánto muerde. */
export const FISH_BITE = 35
/** Lo que quita en lo poco hondo, donde aún se hace pie: la orilla también es peligrosa, pero menos. */
export const FISH_BITE_SHALLOW = 15
export const FISH_BITE_INTERVAL = 1.5

/** Un pez detrás de un jugador: muerde mientras siga en el mar. No se puede matar ni apuntar. */
export interface Fish {
  target: PlayerId
  /** Segundos que faltan para el siguiente mordisco. */
  biteIn: number
}

/** Los peces y cuánto lleva cada jugador nadando en el mar, para guardar y restaurar la partida. */
export interface FishState {
  list: Fish[]
  swimming: [PlayerId, number][]
}

/** Quien puede atraer un pez: si está vivo (y sin el escudo de reaparecer), si está en el agua del mar y si nada. */
export interface Swimmer {
  id: PlayerId
  alive: boolean
  inSea: boolean
  /** Donde ya no se hace pie: muerde más. */
  deep?: boolean
}

/**
 * Los peces del mar: quien se queda en el agua fuera de la isla (no en un lago), vadeando o nadando, más de FISH_DELAY
 * segundos atrae uno, que muerde cada FISH_BITE_INTERVAL hasta que sale del agua: FISH_BITE donde se nada y
 * FISH_BITE_SHALLOW donde aún se hace pie. Aparecer y morder se avisan
 * (`fishAppeared`, `fishBite`, `fishLeft`); el daño pasa por la armadura, pero no hay escudo que lo pare.
 */
export class Fishes {
  readonly list: Fish[] = []
  private swimming = new Map<PlayerId, number>()

  constructor(private emit: Emit = NO_EMIT) {}

  /** Paso fijo. `swimmers`: los que están en el mundo. Devuelve los mordiscos de este paso. */
  step(dt: number, swimmers: readonly Swimmer[]): { playerId: PlayerId; damage: number }[] {
    const bites: { playerId: PlayerId; damage: number }[] = []
    for (const { id, alive, inSea, deep = true } of swimmers) {
      if (!alive || !inSea) {
        this.swimming.delete(id)
        this.leave(id)
        continue
      }
      const time = (this.swimming.get(id) ?? 0) + dt
      this.swimming.set(id, time)
      const fish = this.list.find((f) => f.target === id)
      if (!fish) {
        if (time < FISH_DELAY - 1e-9) continue
        this.list.push({ target: id, biteIn: FISH_BITE_INTERVAL })
        this.emit({ type: 'fishAppeared', id })
        continue
      }
      fish.biteIn -= dt
      if (fish.biteIn > 1e-9) continue
      fish.biteIn += FISH_BITE_INTERVAL
      bites.push({ playerId: id, damage: deep ? FISH_BITE : FISH_BITE_SHALLOW })
      this.emit({ type: 'fishBite', id })
    }
    // Quien ya no está en el mundo (se ha ido) se lleva su pez.
    for (const fish of [...this.list]) if (!swimmers.some((s) => s.id === fish.target)) this.leave(fish.target)
    for (const id of [...this.swimming.keys()]) if (!swimmers.some((s) => s.id === id)) this.swimming.delete(id)
    return bites
  }

  private leave(id: PlayerId) {
    const index = this.list.findIndex((f) => f.target === id)
    if (index < 0) return
    this.list.splice(index, 1)
    this.emit({ type: 'fishLeft', id })
  }

  /** El espejo del cliente, con los avisos del servidor. */
  appeared(id: PlayerId) {
    if (!this.list.some((f) => f.target === id)) this.list.push({ target: id, biteIn: FISH_BITE_INTERVAL })
  }

  left(id: PlayerId) {
    const index = this.list.findIndex((f) => f.target === id)
    if (index >= 0) this.list.splice(index, 1)
  }

  /** Partida nueva: sin peces ni nadie nadando. */
  reset() {
    this.list.length = 0
    this.swimming.clear()
  }

  save(): FishState {
    return { list: this.list.map((f) => ({ ...f })), swimming: [...this.swimming] }
  }

  load(state: FishState) {
    this.list.length = 0
    this.list.push(...state.list.map((f) => ({ ...f })))
    this.swimming = new Map(state.swimming)
  }
}
