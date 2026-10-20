import type { ItemId } from '../game/inventory'

/** Identificador de jugador. Con un jugador siempre es LOCAL_PLAYER. */
export type PlayerId = number
export const LOCAL_PLAYER: PlayerId = 0

/** Lo que tiene delante un jugador al golpear. */
export type TargetRef = { kind: 'prop' | 'enemy'; id: number }

/**
 * Lo que pasa en un paso de la simulación. HUD, sonido, mano y vistas se suscriben a esto en vez de
 * que la simulación los llame. `by` es quien lo provocó. Un golpe que rompe o mata emite
 * propDestroyed/enemyDied en vez de propHit/enemyHit.
 */
export type SimEventData =
  | { type: 'propHit'; id: number; hp: number; by: PlayerId }
  | { type: 'propDestroyed'; id: number; by: PlayerId }
  | { type: 'berryTaken'; id: number; hp: number; by: PlayerId }
  | { type: 'berryGrew'; id: number; hp: number }
  | { type: 'pickupSpawn'; id: number; item: ItemId; amount: number }
  | { type: 'pickupCollected'; id: number; by: PlayerId }
  | { type: 'campfirePlaced'; id: number; x: number; y: number; z: number; rotY: number; by: PlayerId }
  | { type: 'enemySpawn'; id: number; x: number; z: number }
  | { type: 'enemyHit'; id: number; hp: number; kx: number; kz: number; by: PlayerId }
  | { type: 'enemyAttack'; id: number; target: PlayerId }
  | { type: 'enemyDied'; id: number; by: PlayerId }
  | { type: 'enemiesDespawn' }
  | { type: 'playerSwing'; id: PlayerId; item: ItemId | null; target: TargetRef | null }
  | { type: 'playerAte'; id: PlayerId }
  | { type: 'playerCrafted'; id: PlayerId; recipe: number }
  | { type: 'playerPlaced'; id: PlayerId }
  | { type: 'playerHurt'; id: PlayerId; dmg: number }
  | { type: 'playerDied'; id: PlayerId }

export type SimEvent = SimEventData & { tick: number }

/** Lo que reciben los módulos de la simulación para emitir eventos. */
export type Emit = (event: SimEventData) => void

export const NO_EMIT: Emit = () => {}

/** Eventos del paso en curso, sellados con su tick. */
export class EventLog {
  tick = 0
  private list: SimEvent[] = []

  readonly emit: Emit = (event) => void this.list.push({ ...event, tick: this.tick })

  /** Devuelve los eventos acumulados y vacía el registro. */
  drain(): SimEvent[] {
    const list = this.list
    this.list = []
    return list
  }
}
