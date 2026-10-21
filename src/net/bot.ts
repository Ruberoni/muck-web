import { Btn } from '../sim/commands'
import type { NetClient } from './client'
import type { MoveInput } from './session'

/**
 * Lo que hace un bot en cada tick: anda en círculos amplios, salta de vez en cuando y golpea lo que tenga
 * delante (así se ven su mano y sus golpes desde otro cliente). Sin azar: cada bot desfasado por su id.
 */
export function botMove(tick: number, id: number): MoveInput {
  const t = tick + id * 97
  return {
    buttons: Btn.Fwd | (t % 180 === 0 ? Btn.Jump : 0) | (t % 240 < 30 ? Btn.Attack : 0),
    yaw: t / 160,
    pitch: -0.1,
  }
}

/** Un frame de un cliente sin pantalla: predice los ticks que tocan con `script`, envía y pone el espejo al día. */
export function driveClient(client: NetClient, script: (tick: number) => MoveInput) {
  const ticks = client.advance()
  for (let i = 0; i < ticks; i++) client.step(script(client.predictor!.tick + 1))
  client.flush()
  client.render()
}
