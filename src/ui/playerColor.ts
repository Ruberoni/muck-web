import type { PlayerId } from '../sim/events'

const SATURATION = 55
const LIGHTNESS = 55

/** Tono (0..1) de cada jugador: ángulo áureo en el círculo de tonos, el mismo en todos los clientes. */
export const playerHue = (id: PlayerId) => (id * 0.618034) % 1

/** El color de un jugador en CSS (lista, nombres, minimapa); su avatar usa el mismo en sRGB. */
export const playerCss = (id: PlayerId) => `hsl(${Math.round(playerHue(id) * 3600) / 10}, ${SATURATION}%, ${LIGHTNESS}%)`

export const PLAYER_SATURATION = SATURATION / 100
export const PLAYER_LIGHTNESS = LIGHTNESS / 100
