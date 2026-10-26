import { CloseCode, MAX_PLAYERS, PROTOCOL_VERSION, type Reject } from './protocol'

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
      // Con el servidor más viejo, recargar no sirve: el cliente ya es el nuevo.
      return reject.v !== undefined && reject.v < PROTOCOL_VERSION
        ? 'El servidor aún no se ha actualizado a esta versión del juego. Prueba dentro de un rato.'
        : 'Tu versión del juego no es la del servidor: recarga la página.'
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

/** La recarga que ya se hizo por una versión nueva del servidor (`v`) y cuándo (`at`, ms de `Date.now()`). */
export interface ReloadMark {
  v: number
  at: number
}

/** Si el cliente recargado sigue siendo viejo (Pages aún no sirve el nuevo), se vuelve a recargar cada tanto (ms)… */
export const RELOAD_EVERY_MS = 30_000
/** …durante como mucho esto (ms) desde la primera recarga por esa versión. */
export const RELOAD_FOR_MS = 5 * 60_000
/** Con el servidor más viejo que el cliente (Pages se despliega antes que el Worker), se reintenta cada tanto (ms)… */
export const OLD_SERVER_RETRY_MS = 5000
/** …durante como mucho esto (ms). */
export const OLD_SERVER_FOR_MS = 2 * 60_000

export const NEW_VERSION = 'Hay una versión nueva, recargando…'
export const SERVER_UPDATING = 'El servidor se está actualizando…'

/**
 * Qué hacer cuando la sala rechaza al cliente por versión (`serverV` es la del `reject`):
 * - `reload`: el servidor es más nuevo; recargar ya para bajar el cliente nuevo.
 * - `reload-later`: ya se recargó por esa versión hace menos de RELOAD_FOR_MS y Pages sigue sirviendo el cliente
 *   viejo (volver a conectar con el mismo JS daría el mismo rechazo): recargar otra vez dentro de RELOAD_EVERY_MS.
 * - `retry`: el servidor es más viejo (aún no se ha desplegado el Worker); volver a intentarlo dentro de
 *   OLD_SERVER_RETRY_MS, si no hace más de OLD_SERVER_FOR_MS que se espera (`waitingSince`, o null si es el primero).
 * - `lost`: no hay nada que esperar; "recarga la página".
 */
export type VersionAction = 'reload' | 'reload-later' | 'retry' | 'lost'

export function versionAction(clientV: number, serverV: number | undefined, reloadedFor: ReloadMark | null, waitingSince: number | null, now: number): VersionAction {
  if (serverV === undefined || serverV === clientV) return 'lost'
  if (serverV < clientV) return waitingSince === null || now - waitingSince < OLD_SERVER_FOR_MS ? 'retry' : 'lost'
  // Una marca del futuro (se cambió el reloj) no vale.
  if (reloadedFor?.v !== serverV || now < reloadedFor.at) return 'reload'
  return now - reloadedFor.at < RELOAD_FOR_MS ? 'reload-later' : 'lost'
}

/**
 * La marca que hay que guardar al recargar por la versión `serverV`: la que ya había si es de esa versión (el plazo
 * de RELOAD_FOR_MS cuenta desde la primera recarga; si se renovara, se recargaría cada 30 s para siempre) y, si no,
 * una nueva. Una marca del futuro (se cambió el reloj) no vale.
 */
export function nextMark(mark: ReloadMark | null, serverV: number, now: number): ReloadMark {
  return mark?.v === serverV && mark.at <= now ? mark : { v: serverV, at: now }
}

/**
 * Si tras este cierre (o este fallo al volver a entrar) se reintenta: sí tras un corte (1006, 1001, 1011, un
 * redespliegue del servidor o la pestaña olvidada, 1000); no si la sala lo ha rechazado, si es otra versión (eso
 * lo decide `versionAction`), si se ha abierto en otra pestaña, si la sala está llena o borrada, si se ha agotado
 * la cuota o por un mensaje no válido.
 */
export function shouldReconnect(reject: Reject | null, code: number | null): boolean {
  if (reject) return false
  switch (code) {
    case CloseCode.Version:
    case CloseCode.OtherTab:
    case CloseCode.RoomDeleted:
    case CloseCode.RoomFull:
    case CloseCode.Quota:
    case CloseCode.Invalid:
      return false
    default:
      return true
  }
}

/** Reintentos durante como mucho este tiempo (ms): un redespliegue del servidor tarda unos segundos. */
export const RECONNECT_FOR_MS = 60_000

/** Espera antes del intento `attempt` (0, 1, …): 0,5 s, 1 s, 2 s, 4 s y después cada 5 s. */
export const reconnectDelay = (attempt: number) => Math.min(5000, 500 * 2 ** attempt)
