import type { RecipeId } from './crafting'
import type { TargetRef } from './events'
import type { PlayerInput } from './player'

/** Botones de un `Move`, como bits. `Attack` es el clic mantenido. */
export const Btn = { Fwd: 1, Back: 2, Left: 4, Right: 8, Sprint: 16, Jump: 32, Attack: 64 } as const

/** Lo que el jugador mantiene durante un tick: botones y orientación (absoluta). */
export interface Move {
  tick: number
  buttons: number
  yaw: number
  pitch: number
  /**
   * Lo que el cliente tiene delante según aim.ts (null: nada). Sin él (un jugador) la simulación calcula
   * el objetivo desde la posición y la mirada tras moverse; con él solo comprueba que sea creíble (validateAim).
   */
  aim?: TargetRef | null
}

/**
 * Flancos de un solo uso: se aplican una vez, en su tick y en orden de `seq`.
 * `swing` es un golpe pedido (un clic, aunque sea más corto que un tick): si el cooldown no ha acabado,
 * queda pendiente hasta que acabe. `place` coloca lo que se tiene en la mano (la fogata). `move` intercambia dos
 * casillas del inventario (hotbar o mochila).
 */
export type ActionData =
  | { kind: 'swing' }
  | { kind: 'select'; slot: number }
  | { kind: 'craft'; recipe: RecipeId }
  | { kind: 'move'; from: number; to: number }
  | { kind: 'eat' }
  | { kind: 'place' }

export type Action = ActionData & { seq: number; tick: number }

/** Lo que manda un jugador para un tick: su `Move` y las acciones de ese tick. */
export interface PlayerCommands {
  move: Move
  actions: readonly Action[]
}

/** Botones de un `Move` a partir de las teclas y el clic mantenido. */
export function inputButtons(input: PlayerInput, attack: boolean): number {
  return (
    (input.forward ? Btn.Fwd : 0) |
    (input.back ? Btn.Back : 0) |
    (input.left ? Btn.Left : 0) |
    (input.right ? Btn.Right : 0) |
    (input.sprint ? Btn.Sprint : 0) |
    (input.jump ? Btn.Jump : 0) |
    (attack ? Btn.Attack : 0)
  )
}

/** Teclas de movimiento de un `Move`. */
export function buttonsInput(buttons: number): PlayerInput {
  return {
    forward: (buttons & Btn.Fwd) !== 0,
    back: (buttons & Btn.Back) !== 0,
    left: (buttons & Btn.Left) !== 0,
    right: (buttons & Btn.Right) !== 0,
    sprint: (buttons & Btn.Sprint) !== 0,
    jump: (buttons & Btn.Jump) !== 0,
  }
}

/** Si falta el `Move` de un tick se repite el último, sin Attack ni Jump, como mucho tantos ticks. */
export const MOVE_REPEAT = 6
/** Sin Attack ni Jump: un golpe o un salto que el cliente no ha predicho no se pueden deshacer. */
const REPEAT_MASK = ~(Btn.Attack | Btn.Jump)

/**
 * El `Move` de un tick que no ha llegado, cuando el anterior ya se ha repetido `repeated` veces: el último sin
 * Attack ni Jump durante MOVE_REPEAT ticks y luego uno neutro con la misma mirada. La sala lo usa con los que
 * faltan y la predicción con los ticks que el cliente se salta, así los dos simulan lo mismo.
 */
export function missingMove(last: Move, repeated: number, tick: number): Move {
  return { ...last, tick, buttons: repeated < MOVE_REPEAT ? last.buttons & REPEAT_MASK : 0 }
}
