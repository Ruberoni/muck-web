import { CloseCode, MAX_PLAYERS, type Reject } from './protocol'

/** El servidor no responde: puede ser la red o la cuota gratuita de Cloudflare (que no deja ni ver `/status`). */
export const SERVER_DOWN = 'El servidor no responde. Puede que se haya agotado su cuota gratuita de hoy: prueba más tarde o juega solo.'
export const QUOTA = 'Se ha agotado la cuota gratuita del servidor por hoy. Prueba mañana o juega solo.'
const NO_CONNECTION = 'Sin conexión con el servidor.'

/**
 * Por qué no se pudo entrar o por qué se cortó, para el jugador: con el `reject` de la sala si lo hubo y, si no,
 * con el código de cierre. null si no hay nada que decir más allá de "sin conexión" (1006 y compañía: entonces
 * conviene preguntar a `/status`, ver `probeServer`).
 */
export function closeMessage(reject: Reject | null, code: number | null, room = ''): string | null {
  switch (reject?.reason) {
    case 'version':
      return 'Tu versión del juego no es la del servidor: recarga la página.'
    case 'full':
      return `La sala está llena (${MAX_PLAYERS} jugadores).`
    case 'not-found':
      return room ? `No existe la sala ${room}.` : 'No existe esa sala.'
    case 'exists':
      return 'Ya existe una sala con ese código.'
    case 'invalid':
      return 'El servidor ha rechazado la conexión.'
  }
  switch (code) {
    case CloseCode.Version:
      return 'Tu versión del juego no es la del servidor: recarga la página.'
    case CloseCode.OtherTab:
      return 'La partida se ha abierto en otra pestaña.'
    case CloseCode.RoomDeleted:
      return 'La sala se ha borrado.'
    case CloseCode.RoomFull:
      return `La sala está llena (${MAX_PLAYERS} jugadores).`
    case CloseCode.Quota:
      return QUOTA
    case CloseCode.Invalid:
      return 'El servidor ha cerrado la conexión por un mensaje no válido.'
    default:
      return null
  }
}

/** `https://…/status` del Worker a partir de su `wss://…`. */
export function statusUrl(serverUrl: string): string {
  return `${serverUrl.replace(/^ws/, 'http').replace(/\/+$/, '')}/status`
}

/**
 * Si el Worker contesta. El navegador no ve por qué falló un WebSocket (1006), así que se pregunta a `/status`:
 * si responde, el problema era la sala o la red de ese momento; si no (cuota agotada, caído, sin red), no.
 */
export async function probeServer(serverUrl: string, fetchFn: typeof fetch = fetch): Promise<boolean> {
  if (!serverUrl) return false
  try {
    const response = await fetchFn(statusUrl(serverUrl), { cache: 'no-store' })
    return response.ok
  } catch {
    return false
  }
}

/** El mensaje final de un fallo de conexión: el del cierre o, si no dice nada, según conteste `/status`. */
export async function explainClose(reject: Reject | null, code: number | null, room: string, serverUrl: string, fetchFn?: typeof fetch): Promise<string> {
  const known = closeMessage(reject, code, room)
  if (known) return known
  if (code === CloseCode.Normal) return NO_CONNECTION
  return (await probeServer(serverUrl, fetchFn)) ? NO_CONNECTION : SERVER_DOWN
}
