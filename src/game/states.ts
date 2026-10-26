/**
 * `spectating`: muerto en una sala, mirando a los demás hasta reaparecer (con un jugador, morir es `dead`).
 * `inventory`: con la pantalla de inventario abierta (el ratón suelto y el jugador quieto, pero en partida).
 */
export type GameState = 'menu' | 'playing' | 'paused' | 'dead' | 'spectating' | 'inventory'

/**
 * En partida: en red no se suspende (se predice y se envía) y, con un jugador, la simulación avanza. Fuera
 * (menú, pausa, muerto con un jugador) la red se suspende y el jugador pasa a ausente.
 */
export const inGame = (state: GameState): state is 'playing' | 'spectating' | 'inventory' =>
  state === 'playing' || state === 'spectating' || state === 'inventory'

/** Con el ratón capturado: vivo jugando o, en una sala, muerto mirando a los demás. */
export const holdsMouse = (state: GameState) => state === 'playing' || state === 'spectating'

/**
 * Estados en los que cuentan las pulsaciones de teclado de `Input`: también muerto en una sala, donde Tab cambia a
 * quién se mira y Enter abre el chat. El clic y la rueda solo cuentan en `playing`. Con el inventario abierto las
 * teclas las lleva la pantalla.
 */
export const acceptsKeys = (state: GameState) => state === 'playing' || state === 'spectating'

/** La mira: ni el espectador ni la pantalla de inventario apuntan a nada. */
export const showsCrosshair = (state: GameState) => state !== 'spectating' && state !== 'inventory'

/**
 * A qué estado se pasa al capturar o soltar el ratón; null si no cambia. Capturarlo es empezar, reanudar o cerrar
 * el inventario, salvo muerto con un jugador: si se muere justo al cerrarlo, la captura pendiente no debe volver a
 * jugar (el clic en el overlay reinicia y pasa por el menú). Perderlo (Esc, cambiar de ventana) pausa si se jugaba
 * con él; al abrir el inventario se suelta a propósito, y con el estado ya en `inventory` no cambia nada (tampoco
 * en `dead`, que lo suelta igual).
 */
export function afterLockChange(state: GameState, locked: boolean): GameState | null {
  if (locked) return state === 'dead' ? null : 'playing'
  return holdsMouse(state) ? 'paused' : null
}
