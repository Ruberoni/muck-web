import type { ActionData, Move } from '../sim/commands'
import type { SimEvent } from '../sim/events'
import { Simulation } from '../sim/Simulation'

/** Lo que el cliente manda en cada tick; la sesión le pone el número de tick. */
export type MoveInput = Omit<Move, 'tick'>

/**
 * Por donde el cliente (Game) mueve la partida: le pasa sus comandos de cada tick y recibe los eventos.
 * El estado que dibuja lo lee de `sim`. Con un jugador es LocalSession; en red será NetSession (PR 12).
 */
export interface Session {
  readonly sim: Simulation
  step(move: MoveInput, actions: readonly ActionData[]): SimEvent[]
  reset(): void
}

/** Semilla nueva para cada partida: la isla es fija, pero enemigos y objetos que caen varían. */
const randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0]

/** Un jugador, sin servidor: la simulación corre en el mismo hilo y cada comando se aplica al momento. */
export class LocalSession implements Session {
  readonly sim: Simulation

  constructor(seed = randomSeed()) {
    this.sim = new Simulation(seed)
  }

  step(move: MoveInput, actions: readonly ActionData[]): SimEvent[] {
    const tick = this.sim.tick + 1
    // Las acciones se numeran a continuación de la última aplicada, como hará el cliente en red.
    let seq = this.sim.slot.appliedSeq
    return this.sim.step(
      { ...move, tick },
      actions.map((action) => ({ ...action, seq: ++seq, tick })),
    )
  }

  reset() {
    this.sim.reset()
  }
}
