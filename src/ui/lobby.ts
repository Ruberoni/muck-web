import type { Game } from '../game/Game'
import { inGame } from '../game/states'
import { DIFFICULTIES, DIFFICULTY_DEFS, type Difficulty } from '../sim/match'
import { failureMessage, NetError, NetSession } from '../net/netSession'
import { cleanName, isRoomCode, MAX_NAME, ROOM_ALPHABET, ROOM_CODE_LENGTH } from '../net/protocol'
import { onVersionReject, reloadFor } from '../net/reload'
import { LocalSession } from '../net/session'
import { loadCharacter } from '../view/characters'
import { skinField } from './skinPicker'
import { NEW_VERSION, OLD_SERVER_FOR_MS, OLD_SERVER_RETRY_MS, SERVER_UPDATING, shouldReconnect } from '../net/status'

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

/** Un desplegable de dificultad con su etiqueta. */
function difficultyField(parent: HTMLElement) {
  const row = document.createElement('label')
  row.className = 'field'
  row.append('Dificultad')
  const select = document.createElement('select')
  for (const difficulty of DIFFICULTIES) select.add(new Option(DIFFICULTY_DEFS[difficulty].name, difficulty, false, difficulty === 'normal'))
  row.appendChild(select)
  parent.appendChild(row)
  return { row, select, value: () => select.value as Difficulty }
}

/**
 * El lobby, dentro del panel del menú y la pausa (§8 del plan). Fuera de una sala: nombre (guardado como
 * `muck-web:name`), "Jugar solo", "Crear partida" y "Unirse" con un código; con `?room=` en la URL, el botón
 * principal es "Unirse a K7QX2". Dentro de una sala: su código, copiar el enlace, salir y, en la sala de espera, quién
 * está y, para el anfitrión, la dificultad y empezar. En partida, en la pausa: rendirse. Los clics no llegan al overlay
 * (que solo reanuda) y las teclas no llegan al juego.
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
  const skin = skinField(offline, loadCharacter)

  const soloDifficulty = difficultyField(offline)
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
  const waitingRoom = div(online, 'lobby-room')
  const playerList = document.createElement('ul')
  playerList.className = 'players'
  waitingRoom.appendChild(playerList)
  const roomDifficulty = difficultyField(waitingRoom)
  const startButton = button(waitingRoom, 'Empezar partida', 'primary')
  const waitingHost = div(waitingRoom, 'waiting')
  waitingHost.textContent = 'Esperando a que el anfitrión empiece la partida…'
  const onlineButtons = div(online, 'buttons')
  const copy = button(onlineButtons, 'Copiar enlace')
  const leave = button(onlineButtons, 'Salir de la sala')

  // --- En partida ---
  const inMatch = div(root, 'buttons')
  const surrender = button(inMatch, 'Rendirse')
  /** Ya se ha votado en esta partida. */
  let voted = false

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
    const match = net?.client.match ?? null
    const paused = game.state === 'paused'
    // Solo en el menú se elige cómo jugar; en la pausa de un jugador, rendirse y los ajustes.
    root.hidden = !inRoom && game.state !== 'menu' && !paused
    offline.hidden = inRoom || game.state !== 'menu'
    online.hidden = !inRoom
    const lobby = match?.phase === 'lobby'
    waitingRoom.hidden = !lobby
    if (lobby) {
      voted = false
      const isHost = match.host === net!.me
      playerList.replaceChildren(
        ...match.players.map(({ id, name: who }) => Object.assign(document.createElement('li'), { textContent: id === match.host ? `${who} (anfitrión)` : who })),
      )
      roomDifficulty.row.hidden = startButton.hidden = !isHost
      waitingHost.hidden = isHost
    }
    inMatch.hidden = !paused || (inRoom && match?.phase !== 'playing')
    surrender.disabled = voted
    surrender.textContent = !inRoom ? 'Rendirse' : voted ? `Has votado rendirse (${match?.votes ?? 0}/${match?.players.length ?? 0})` : `Votar rendirse (${match?.votes ?? 0}/${match?.players.length ?? 0})`
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
      session.client.onmatch = update
      busy = false
      update()
      // En la sala de espera se está en el menú hasta que empiece la partida.
      if (session.client.match?.phase === 'playing') await game.play()
    } catch (e) {
      busy = false
      if (!waitForVersion(e, open, room)) error = await failureMessage(e, room)
      update()
    }
  }

  /**
   * La sala es de otra versión: recarga la página (servidor más nuevo; al volver, "Unirse a…" espera el clic) o lo
   * reintenta cada poco (más viejo: Pages se despliega antes que el Worker). Mientras se espera al servidor viejo,
   * un corte pasajero (el Worker redesplegándose) también se reintenta. false si no hay nada que esperar.
   */
  function waitForVersion(error: unknown, open: () => Promise<NetSession>, room: string): boolean {
    const reject = error instanceof NetError ? error.reject : null
    if (reject?.reason !== 'version') {
      const code = error instanceof NetError ? error.code : null
      if (oldServerSince === null || !shouldReconnect(reject, code) || Date.now() - oldServerSince >= OLD_SERVER_FOR_MS) return false
      retryLater(open, room)
      return true
    }
    const action = onVersionReject(reject.v, oldServerSince)
    if (action === 'lost') {
      oldServerSince = null
      return false
    }
    if (action === 'retry') {
      oldServerSince ??= Date.now()
      retryLater(open, room)
      return true
    }
    waiting = NEW_VERSION
    cancelWait = reloadFor(reject.v!, action === 'reload-later')
    return true
  }

  function retryLater(open: () => Promise<NetSession>, room: string) {
    waiting = SERVER_UPDATING
    const timer = setTimeout(() => {
      cancelWait = null
      waiting = ''
      void attempt(open, room)
    }, OLD_SERVER_RETRY_MS)
    cancelWait = () => clearTimeout(timer)
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
    void game.playSolo(soloDifficulty.value())
  })
  startButton.addEventListener('click', () => {
    game.net?.client.start(roomDifficulty.value())
    // El clic es el gesto que permite capturar el ratón: a los demás les toca el suyo.
    void game.play()
  })
  surrender.addEventListener('click', () => {
    voted = game.net !== null
    game.surrender()
    update()
  })
  create.addEventListener('click', () => void enter(() => NetSession.create(name(), skin.value()), ''))
  joinUrl.addEventListener('click', () => {
    const code = urlRoom()
    if (code) void enter(() => NetSession.open('join', code, name(), skin.value()), code)
  })
  join.addEventListener('click', () => {
    const code = codeInput.value
    if (isRoomCode(code)) void enter(() => NetSession.open('join', code, name(), skin.value()), code)
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
  // El estado de la conexión cambia sin avisar a Game: se mira de vez en cuando mientras se ve el panel (fuera de
  // partida: jugando, de espectador o con el inventario abierto no se ve).
  setInterval(() => {
    if (!inGame(game.state)) update()
  }, 500)
  if (game.state === 'menu') game.hud.showOverlay('menu')
  update()
}
