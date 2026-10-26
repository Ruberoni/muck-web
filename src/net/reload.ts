import { PROTOCOL_VERSION } from './protocol'
import { RELOAD_EVERY_MS, versionAction, type ReloadMark, type VersionAction } from './status'

/** En `sessionStorage` (por pestaña): a qué versión del servidor se recargó y cuándo, para no recargar en bucle. */
const MARK_KEY = 'muck-web:reloadedFor'
/** En la URL tras una recarga por versión: así la petición no sale de la caché del navegador. */
const VERSION_PARAM = 'v'

function loadMark(): ReloadMark | null {
  try {
    const mark = JSON.parse(sessionStorage.getItem(MARK_KEY) ?? 'null') as Partial<ReloadMark> | null
    return typeof mark?.v === 'number' && typeof mark.at === 'number' ? { v: mark.v, at: mark.at } : null
  } catch {
    return null
  }
}

/** Qué hacer ante un rechazo por versión, según la marca de la última recarga de esta pestaña. */
export function onVersionReject(serverV: number | undefined, waitingSince: number | null): VersionAction {
  return versionAction(PROTOCOL_VERSION, serverV, loadMark(), waitingSince, Date.now())
}

/**
 * Recarga la página para bajar el cliente de la versión `serverV`, ya o (`later`) dentro de RELOAD_EVERY_MS,
 * manteniendo `?room=`. La marca guarda la hora de la primera recarga por esa versión: el plazo cuenta desde ahí.
 * Devuelve cómo cancelar la recarga pendiente.
 */
export function reloadFor(serverV: number, later = false): () => void {
  const reload = () => {
    try {
      const mark = loadMark()
      if (mark?.v !== serverV || mark.at > Date.now()) sessionStorage.setItem(MARK_KEY, JSON.stringify({ v: serverV, at: Date.now() } satisfies ReloadMark))
    } catch {
      // Sin almacenamiento no hay protección contra el bucle, pero tras recargar hace falta un clic para volver a entrar.
    }
    const url = new URL(location.href)
    url.searchParams.set(VERSION_PARAM, String(serverV))
    location.replace(url)
  }
  if (!later) {
    reload()
    return () => {}
  }
  const timer = setTimeout(reload, RELOAD_EVERY_MS)
  return () => clearTimeout(timer)
}

/** Ya se ha entrado con esta versión: fuera la marca y el `?v` de la URL (para que "Copiar enlace" no lo arrastre). */
export function versionAccepted() {
  try {
    sessionStorage.removeItem(MARK_KEY)
  } catch {
    // Sin almacenamiento no había marca.
  }
  const url = new URL(location.href)
  if (!url.searchParams.has(VERSION_PARAM)) return
  url.searchParams.delete(VERSION_PARAM)
  history.replaceState(history.state, '', url)
}
