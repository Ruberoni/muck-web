import { missingMove, MOVE_REPEAT, type Action, type ActionData, type Move, type PlayerCommands } from '../sim/commands'
import { NO_EMIT, type SimEvent, type SimEventData } from '../sim/events'
import type { Combat } from '../sim/interaction'
import type { InventoryState } from '../sim/inventory'
import type { Player, Vec3 } from '../sim/player'
import { predictPlayer, type PredictWorld } from '../sim/playerTick'
import type { PlayerSlot } from '../sim/Simulation'
import type { PlayerState, SnapYou, You } from './protocol'

/** Un error de posición menor que este se suaviza al dibujar; uno mayor, salta. */
export const SMOOTH_MAX = 0.3
/** La corrección suavizada casi desaparece en este tiempo (tres constantes de tiempo). */
const SMOOTH_MS = 100

/** Lo que la predicción compara con el `you` del servidor (sin `inventoryFull`, que solo sabe el servidor). */
interface Predicted {
  player: Player
  inventory: InventoryState
  combat: Combat
  alive: boolean
  appliedSeq: number
}

/** Un tick predicho: su `Move` y el estado al acabarlo. `filled`: un tick saltado, que el servidor rellena solo. */
export interface PredictedTick {
  move: Move
  filled: boolean
  state: Predicted
}

const copyPlayer = (p: Player): Player => ({ ...p, pos: { ...p.pos }, prev: { ...p.prev }, vel: { ...p.vel } })

/**
 * Predicción del jugador local en red y reconciliación con el servidor (§7 del plan).
 *
 * - `step` aplica cada tick su `Move` y sus acciones con `predictPlayer` (lo mismo que hace el servidor con él,
 *   sin el mundo) y guarda ambos. Las acciones se numeran a continuación de `you.appliedSeq` del `welcome`.
 * - `reconcile(tick, you)`: copia `you` (el estado del servidor al final de `tick`) salvo `yaw`, `pitch` y `prev`,
 *   y re-simula los ticks guardados posteriores con el `yaw`/`pitch` de cada `Move`. Las acciones aún no aplicadas
 *   se re-aplican en su tick, o en `tick + 1` si su tick ya pasó (llegaron tarde), como hará el servidor.
 *   Al acabar, la orientación vuelve a la del último `Move`: la decide el ratón.
 * - Un error pequeño (< SMOOTH_MAX) queda en `offset`, que se suma al dibujar y se desvanece en ~100 ms.
 */
export class Predictor {
  /** Ticks predichos que el servidor aún no ha confirmado, en orden. */
  readonly history: PredictedTick[] = []
  /** Acciones que el servidor aún no ha aplicado, por `seq`. */
  readonly pending: Action[] = []
  /** Último tick predicho. */
  tick = 0
  /** Corrección pendiente de dibujar: se suma a la posición predicha. */
  readonly offset: Vec3 = { x: 0, y: 0, z: 0 }
  /** Reconciliaciones y cuántas encontraron una predicción distinta del servidor (para pruebas y depuración). */
  readonly stats = { reconciled: 0, corrections: 0, maxError: 0 }
  private nextSeq = 1
  /** El último `Move` del jugador y cuántas veces se ha repetido, para rellenar ticks saltados como el servidor. */
  private last: Move | null = null
  private repeated = MOVE_REPEAT

  constructor(
    readonly slot: PlayerSlot,
    private world: Omit<PredictWorld, 'emit'>,
  ) {}

  /** Empieza desde el `you` del `welcome` (orientación incluida): `tick` es el del servidor. */
  start(tick: number, you: You) {
    this.history.length = 0
    this.pending.length = 0
    this.tick = tick
    this.nextSeq = you.appliedSeq + 1
    this.load(you)
    Object.assign(this.slot.player, { yaw: you.player.yaw, pitch: you.player.pitch, prev: { ...you.player.pos } })
    this.last = { tick, buttons: 0, yaw: you.player.yaw, pitch: you.player.pitch }
    this.repeated = MOVE_REPEAT
    this.offset.x = this.offset.y = this.offset.z = 0
  }

  /**
   * Predice `tick` con lo que hace el jugador y devuelve lo que ha hecho (para presentarlo al momento).
   * Si hay ticks saltados desde el último (el reloj iba muy atrasado), los rellena como el servidor.
   */
  step(tick: number, move: Omit<Move, 'tick'>, actions: readonly ActionData[]): SimEvent[] {
    while (this.tick + 1 < tick) {
      const next = this.tick + 1
      this.run(missingMove(this.last!, this.repeated, next), true, NO_EMIT)
      this.repeated = Math.min(MOVE_REPEAT, this.repeated + 1)
    }
    for (const action of actions) this.pending.push({ ...action, seq: this.nextSeq++, tick })
    const events: SimEvent[] = []
    const full: Move = { ...move, tick }
    this.run(full, false, (e: SimEventData) => events.push({ ...e, tick }))
    this.last = full
    this.repeated = 0
    return events
  }

  /** Acciones que el servidor no ha recibido aún (`seq` mayor que `ackSeq`). */
  unsent(ackSeq: number): Action[] {
    return this.pending.filter((a) => a.seq > ackSeq)
  }

  /**
   * El estado del servidor al final de `tick`: corrige la predicción y re-simula lo que va por delante.
   * Devuelve el error de posición en `tick` respecto a lo predicho (0 si coincide o no hay con qué comparar).
   */
  reconcile(tick: number, you: SnapYou): number {
    const { player } = this.slot
    let error = 0
    const predicted = this.history.find((h) => h.move.tick === tick)
    if (predicted) {
      this.stats.reconciled++
      error = Math.hypot(predicted.state.player.pos.x - you.player.pos.x, predicted.state.player.pos.y - you.player.pos.y, predicted.state.player.pos.z - you.player.pos.z)
      if (!samePrediction(predicted.state, you)) this.stats.corrections++
      this.stats.maxError = Math.max(this.stats.maxError, error)
    }
    const before = { ...player.pos }
    const { yaw, pitch } = player
    while (this.history.length && this.history[0].move.tick <= tick) this.history.shift()
    while (this.pending.length && this.pending[0].seq <= you.appliedSeq) this.pending.shift()

    this.load(you)
    if (this.tick < tick) {
      // El servidor va por delante de lo predicho (en pausa, o justo al sincronizar): se adopta tal cual.
      this.tick = tick
      this.offset.x = this.offset.y = this.offset.z = 0
      return error
    }
    for (const entry of this.history) {
      predictPlayer(this.slot, this.commands(entry.move), { ...this.world, emit: NO_EMIT })
      entry.state = this.capture()
    }
    player.yaw = yaw
    player.pitch = pitch
    this.smooth(before)
    return error
  }

  /** Desvanece la corrección suavizada (`ms` desde la última llamada). */
  decay(ms: number) {
    const k = Math.exp((-3 * ms) / SMOOTH_MS)
    this.offset.x *= k
    this.offset.y *= k
    this.offset.z *= k
  }

  private run(move: Move, filled: boolean, emit: PredictWorld['emit']) {
    predictPlayer(this.slot, this.commands(move), { ...this.world, emit })
    this.tick = move.tick
    this.history.push({ move, filled, state: this.capture() })
  }

  /** Los comandos de un tick: su `Move` y, en orden de `seq`, las acciones de su tick o anteriores hasta la primera futura. */
  private commands(move: Move): PlayerCommands {
    const actions: Action[] = []
    for (const action of this.pending) {
      if (action.tick > move.tick) break
      actions.push(action)
    }
    return { move, actions }
  }

  /** Copia `you` en el jugador salvo la orientación y `prev` (un `snap` ni los trae). */
  private load(you: SnapYou) {
    const { player } = this.slot
    const { yaw, pitch, prev } = player
    Object.assign(player, you.player, { pos: { ...you.player.pos }, vel: { ...you.player.vel } }, { yaw, pitch, prev })
    this.slot.inventory.load(you.inventory)
    Object.assign(this.slot.combat, you.combat)
    this.slot.inventoryFull = you.inventoryFull
    this.slot.alive = you.alive
    this.slot.respawnAt = you.respawnAt
    this.slot.appliedSeq = you.appliedSeq
  }

  private capture(): Predicted {
    const { player, inventory, combat, alive, appliedSeq } = this.slot
    return { player: copyPlayer(player), inventory: inventory.save(), combat: { ...combat }, alive, appliedSeq }
  }

  /** El salto de la posición actual al reconciliar: pequeño, se dibuja desvaneciéndose; grande, se ve el salto. */
  private smooth(before: Vec3) {
    const { pos } = this.slot.player
    const ox = this.offset.x + before.x - pos.x
    const oy = this.offset.y + before.y - pos.y
    const oz = this.offset.z + before.z - pos.z
    const keep = Math.hypot(ox, oy, oz) < SMOOTH_MAX
    this.offset.x = keep ? ox : 0
    this.offset.y = keep ? oy : 0
    this.offset.z = keep ? oz : 0
  }
}

/** Lo predicho y lo del servidor coinciden (salvo la orientación, que decide el ratón, y `prev`, que solo sirve para dibujar). */
function samePrediction(a: Predicted, you: SnapYou): boolean {
  return (
    samePlayer(a.player, you.player) &&
    sameInventory(a.inventory, you.inventory) &&
    a.combat.cooldown === you.combat.cooldown &&
    a.combat.pendingSwing === you.combat.pendingSwing &&
    a.alive === you.alive &&
    a.appliedSeq === you.appliedSeq
  )
}

function samePlayer(a: Player, b: PlayerState): boolean {
  const same = (u: Vec3, v: Vec3) => u.x === v.x && u.y === v.y && u.z === v.z
  return (Object.keys(b) as (keyof Player)[]).every((key) => {
    if (key === 'prev' || key === 'yaw' || key === 'pitch') return true
    if (key === 'pos' || key === 'vel') return same(a[key], (b as Player)[key])
    return a[key] === (b as Player)[key]
  })
}

function sameInventory(a: InventoryState, b: InventoryState): boolean {
  if (a.selected !== b.selected) return false
  return a.slots.every((item, i) => item === (b.slots[i] ?? null) && (item === null || a.counts[item] === b.counts[item]))
}
