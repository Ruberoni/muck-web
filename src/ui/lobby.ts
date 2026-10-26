import type { Game } from '../game/Game'
import { failureMessage, NetError, NetSession } from '../net/netSession'
import { cleanName, isRoomCode, MAX_NAME, ROOM_ALPHABET, ROOM_CODE_LENGTH } from '../net/protocol'
import { onVersionReject, reloadFor } from '../net/reload'
import { LocalSession } from '../net/session'
import { NEW_VERSION, OLD_SERVER_RETRY_MS, SERVER_UPDATING } from '../net/status'

const NAME_KEY = 'muck-web:name'
const DEFAULT_NAME = 'Jugador'
const COPIED_MS = 2000

function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
}

function saveName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name)
  } catch {
    // Sin almacenamiento: se pedirá otra vez la próxima vez.
  }
}

/** Lo que se escribe en el campo del código, en mayúsculas y solo con letras válidas. */
export function normalizeCode(text: string): string {
  return [...text.toUpperCase()].filter((ch) => ROOM_ALPHABET.includes(ch)).join('').slice(0, ROOM_CODE_LENGTH)
}

/** El código de la sala de la URL (`?room=`), si es válido. */
export function roomFromUrl(search = location.search): string | null {
  const code = normalizeCode(new URLSearchParams(search).get('room') ?? '')
  return isRoomCode(code) ? code : null
}

function setRoomInUrl(code: string | null) {
  const url = new URL(location.href)
  if (code) url.searchParams.set('room', code)
  else url.searchParams.delete('room')
  history.replaceState(null, '', url)
}

const button = (parent: HTMLElement, text: string, className = '') => {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = className
  b.textContent = text
  parent.appendChild(b)
  return b
}

const div = (parent: HTMLElement, className: string) => {
  const d = document.createElement('div')
  d.className = className
  parent.appendChild(d)
  return d
}

/**
 * El lobby, dentro del panel del menú y la pausa (§8 del plan). Fuera de una sala: nombre (guardado como
 * `muck-web:name`), "Jugar solo", "Crear partida" y "Unirse" con un código; con `?room=` en la URL, el botón
 * principal es "Unirse a K7QX2". Dentro de una sala: su código, copiar el enlace y salir. Los clics no llegan al
 * overlay (que solo reanuda) y las teclas no llegan al juego.
 */
export function installLobby(game: Game) {
  const root = document.createElement('div')
  root.className = 'lobby'
  for (const type of ['click', 'mousedown', 'pointerdown'] as const) root.addEventListener(type, (e) => e.stopPropagation())
  root.addEventListener('keydown', (e) => e.stopPropagation())
  const { panel } = game.hud
  // Bajo el texto del menú, antes de los controles.
  panel.querySelector('.action')!.after(root)

  // --- Fuera de una sala ---
  const offline = div(root, 'lobby-offline')
  const nameRow = document.createElement('label')
  nameRow.className = 'field'
  nameRow.append('Tu nombre')
  const nameInput = document.createElement('input')
  nameInput.maxLength = MAX_NAME
  nameInput.placeholder = DEFAULT_NAME
  nameInput.value = loadName()
  nameInput.autocomplete = 'off'
  nameRow.appendChild(nameInput)
  offline.appendChild(nameRow)

  const actions = div(offline, 'buttons')
  const joinUrl = button(actions, '', 'primary')
  const solo = button(actions, 'Jugar solo')
  const create = button(actions, 'Crear partida')

  const joinRow = div(offline, 'join')
  const codeInput = document.createElement('input')
  codeInput.placeholder = 'Código'
  codeInput.maxLength = ROOM_CODE_LENGTH
  codeInput.autocapitalize = 'characters'
  codeInput.spellcheck = false
  joinRow.appendChild(codeInput)
  const join = button(joinRow, 'Unirse')

  // --- Dentro de una sala ---
  const online = div(root, 'lobby-room')
  const roomLine = div(online, 'room')
  roomLine.append('Sala ')
  const roomCode = document.createElement('code')
  roomLine.appendChild(roomCode)
  const onlineButtons = div(online, 'buttons')
  const copy = button(onlineButtons, 'Copiar enlace')
  const leave = button(onlineButtons, 'Salir de la sala')

  const status = document.createElement('p')
  status.className = 'status'
  status.setAttribute('role', 'status')
  root.appendChild(status)

  let busy = false
  let error = ''
  /** Esperando por versión (recarga o reintento pendiente): el aviso y cómo cancelarlo si se elige otra cosa. */
  let waiting = ''
  let cancelWait: (() => void) | null = null
  /** Desde cuándo (Date.now()) el servidor es más viejo que el cliente en los intentos de entrar. */
  let oldServerSince: number | null = null
  let copiedTimer: ReturnType<typeof setTimeout> | null = null
  const urlRoom = () => roomFromUrl()
  const name = () => cleanName(nameInput.value) || DEFAULT_NAME

  function update() {
    const net = game.net
    const inRoom = net !== null
    // Solo en el menú se elige cómo jugar; en la pausa de un jugador solo están los ajustes.
    root.hidden = !inRoom && game.state !== 'menu'
    offline.hidden = inRoom
    online.hidden = !inRoom
    const fromUrl = urlRoom()
    joinUrl.hidden = !fromUrl
    joinUrl.textContent = fromUrl ? `Unirse a ${fromUrl} como ${name()}` : ''
    for (const b of [joinUrl, solo, create, join, leave]) b.disabled = busy
    join.disabled = busy || !isRoomCode(codeInput.value)
    if (net) roomCode.textContent = net.room
    status.classList.toggle('error', !!error || !!net?.closed)
    status.textContent = busy
      ? 'Conectando…'
      : net?.closed
        ? (net.closeReason ?? 'Sin conexión con el servidor.')
        : net?.status === 'reconnecting'
          ? (net.waitReason ?? 'Se ha cortado la conexión. Reconectando…')
          : waiting || error
    status.hidden = !status.textContent
  }

  /** Otra elección del jugador: se olvida la espera por versión que hubiera. */
  function stopWaiting() {
    cancelWait?.()
    cancelWait = null
    waiting = ''
    oldServerSince = null
  }

  async function enter(open: () => Promise<NetSession>, room: string) {
    stopWaiting()
    await attempt(open, room)
  }

  async function attempt(open: () => Promise<NetSession>, room: string) {
    busy = true
    error = ''
    update()
    try {
      const session = await open()
      oldServerSince = null
      game.setSession(session)
      setRoomInUrl(session.room)
      busy = false
      update()
      await game.play()
    } catch (e) {
      busy = false
      if (!(e instanceof NetError && e.reject?.reason === 'version' && waitForVersion(e.reject.v, open, room))) error = await failureMessage(e, room)
      update()
    }
  }

  /**
   * La sala es de otra versión: recarga la página (servidor más nuevo; al volver, "Unirse a…" espera el clic) o lo
   * reintenta cada poco (más viejo: Pages se despliega antes que el Worker). false si no hay nada que esperar.
   */
  function waitForVersion(serverV: number | undefined, open: () => Promise<NetSession>, room: string): boolean {
    const action = onVersionReject(serverV, oldServerSince)
    if (action === 'lost') {
      oldServerSince = null
      return false
    }
    if (action === 'retry') {
      oldServerSince ??= Date.now()
      waiting = SERVER_UPDATING
      const timer = setTimeout(() => {
        cancelWait = null
        waiting = ''
        void attempt(open, room)
      }, OLD_SERVER_RETRY_MS)
      cancelWait = () => clearTimeout(timer)
      return true
    }
    waiting = NEW_VERSION
    cancelWait = reloadFor(serverV!, action === 'reload-later')
    return true
  }

  nameInput.addEventListener('input', () => {
    saveName(nameInput.value.trim())
    update()
  })
  codeInput.addEventListener('input', () => {
    codeInput.value = normalizeCode(codeInput.value)
    update()
  })
  codeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !join.disabled) join.click()
  })
  solo.addEventListener('click', () => {
    stopWaiting()
    error = ''
    setRoomInUrl(null)
    update()
    void game.play()
  })
  create.addEventListener('click', () => void enter(() => NetSession.create(name()), ''))
  joinUrl.addEventListener('click', () => {
    const code = urlRoom()
    if (code) void enter(() => NetSession.open('join', code, name()), code)
  })
  join.addEventListener('click', () => {
    const code = codeInput.value
    if (isRoomCode(code)) void enter(() => NetSession.open('join', code, name()), code)
  })
  copy.addEventListener('click', async () => {
    const link = location.href
    let copied = false
    try {
      await navigator.clipboard.writeText(link)
      copied = true
    } catch {
      // Sin portapapeles (p. ej. sin HTTPS): se enseña el enlace para copiarlo a mano.
    }
    copy.textContent = copied ? '¡Copiado!' : link
    if (copiedTimer) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => (copy.textContent = 'Copiar enlace'), copied ? COPIED_MS : COPIED_MS * 4)
  })
  leave.addEventListener('click', () => {
    stopWaiting()
    game.setSession(new LocalSession())
    setRoomInUrl(null)
    error = ''
    game.setState('menu')
  })

  game.menuClickStarts = false
  game.hud.menuText = 'Elige cómo jugar'
  game.onchange = update
  // El estado de la conexión cambia sin avisar a Game: se mira de vez en cuando mientras se ve el panel.
  setInterval(() => {
    if (game.state !== 'playing') update()
  }, 500)
  if (game.state === 'menu') game.hud.showOverlay('menu')
  update()
}
