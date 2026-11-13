import type { Game } from '../game/Game'
import { inGame } from '../game/states'
import { DIFFICULTIES, DIFFICULTY_DEFS, type Difficulty } from '../sim/match'
import { failureMessage, NetError, NetSession } from '../net/netSession'
import { cleanName, isRoomCode, MAX_NAME, ROOM_ALPHABET, ROOM_CODE_LENGTH } from '../net/protocol'
import { onVersionReject, reloadFor } from '../net/reload'
import { LocalSession } from '../net/session'
import { loadCharacter } from '../view/characters'
import { backButton, button, field, logo, make, panel, subScreenButtons } from './menu/views'
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

/** El texto de la línea de estado de la conexión (vacío: nada que decir). */
export function connectionStatus(s: {
  busy: boolean
  closed: string | null
  reconnecting: string | null
  waiting: string
  error: string
}): { text: string; error: boolean } {
  if (s.busy) return { text: 'Conectando…', error: false }
  if (s.closed !== null) return { text: s.closed, error: true }
  if (s.reconnecting !== null) return { text: s.reconnecting, error: false }
  if (s.waiting) return { text: s.waiting, error: false }
  return { text: s.error, error: !!s.error }
}

/**
 * El lobby (§8 del plan del multijugador), repartido en las pantallas del menú: el inicio con el nombre (guardado
 * como `muck-web:name`), "Jugar solo", "Crear partida" y "Unirse"; unirse con un código; la invitación de un enlace
 * con `?room=`; y la sala de espera (código, copiar el enlace, quién está y, para el anfitrión, la dificultad y
 * empezar). Aquí queda la lógica (la red, las esperas por versión); las pantallas solo la pintan.
 */
export function installLobby(game: Game) {
  const { menu } = game
  let busy = false
  let error = ''
  /** Esperando por versión (recarga o reintento pendiente): el aviso y cómo cancelarlo si se elige otra cosa. */
  let waiting = ''
  let cancelWait: (() => void) | null = null
  /** Desde cuándo (Date.now()) el servidor es más viejo que el cliente en los intentos de entrar. */
  let oldServerSince: number | null = null
  let nameValue = loadName()
  let roomDifficulty: Difficulty = 'normal'
  /** Cuántos intentos de entrar se han empezado: uno que termina después de abandonarlo (volver al inicio) no cuenta. */
  let attempts = 0
  const name = () => cleanName(nameValue) || DEFAULT_NAME
  // La vista previa del personaje (hasta el PR 2 del menú, con su propio lienzo), a la derecha del tablón.
  const skin = skinField(menu.preview, loadCharacter)

  const status = () => {
    const net = game.net
    return connectionStatus({
      busy,
      closed: net?.closed ? (net.closeReason ?? 'Sin conexión con el servidor.') : null,
      reconnecting: net?.status === 'reconnecting' ? (net.waitReason ?? 'Se ha cortado la conexión. Reconectando…') : null,
      waiting,
      error,
    })
  }

  /** La línea de estado de una pantalla, que se repinta con ella. */
  const statusLine = (parent: HTMLElement) => {
    const line = make('p', 'menu-status', parent)
    line.setAttribute('role', 'status')
    return () => {
      const { text, error } = status()
      line.textContent = text
      line.classList.toggle('error', error)
      line.hidden = !text
    }
  }

  const nameField = (parent: HTMLElement) => {
    const input = make('input', 'menu-input', undefined)
    input.maxLength = MAX_NAME
    input.placeholder = DEFAULT_NAME
    input.value = nameValue
    input.autocomplete = 'off'
    input.addEventListener('input', () => {
      nameValue = input.value
      saveName(input.value.trim())
    })
    field(parent, 'Tu nombre', input)
    return input
  }

  /** Mientras se conecta no se puede pedir otra cosa. */
  const lockWhileBusy = (...buttons: HTMLButtonElement[]) => () => {
    for (const b of buttons) b.disabled = busy
  }

  menu.register('home', (menu) => {
    const root = panel()
    logo(root)
    nameField(root)
    const actions = make('div', 'menu-stack', root)
    const solo = button(actions, 'Jugar solo', 'primary', () => menu.go('solo-difficulty'))
    const create = button(actions, 'Crear partida', '', () => void enter(() => NetSession.create(name(), skin.value()), ''))
    const join = button(actions, 'Unirse', '', () => {
      error = ''
      menu.go('join')
    })
    solo.dataset.autofocus = ''
    const paint = statusLine(root)
    subScreenButtons(make('div', 'menu-foot', root), menu)
    const lock = lockWhileBusy(solo, create, join)
    return { root, update: () => (paint(), lock()) }
  })

  menu.register('join', (menu) => {
    const root = panel()
    backButton(root, menu)
    make('h1', 'menu-title', root).textContent = 'Unirse a una sala'
    const code = make('input', 'menu-input code', undefined)
    code.maxLength = ROOM_CODE_LENGTH
    code.autocapitalize = 'characters'
    code.autocomplete = 'off'
    code.spellcheck = false
    code.dataset.autofocus = ''
    field(root, 'Código', code)
    const paint = statusLine(root)
    const join = button(make('div', 'menu-foot menu-stack', root), 'Unirse', 'primary', () => {
      if (isRoomCode(code.value)) void enter(() => NetSession.open('join', code.value, name(), skin.value()), code.value)
    })
    const update = () => {
      paint()
      join.disabled = busy || !isRoomCode(code.value)
    }
    code.addEventListener('input', () => {
      code.value = normalizeCode(code.value)
      error = ''
      update()
    })
    code.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !join.disabled) join.click()
    })
    return { root, update }
  })

  menu.register('invite', (menu) => {
    const root = panel()
    logo(root, false)
    const box = make('div', 'room-code', root)
    make('span', '', box).textContent = 'Te han invitado a la sala'
    const code = make('code', '', box)
    nameField(root)
    const accept = button(root, 'Unirse a la sala', 'primary', () => {
      const room = roomFromUrl()
      if (room) void enter(() => NetSession.open('join', room, name(), skin.value()), room)
    })
    accept.dataset.autofocus = ''
    const paint = statusLine(root)
    const home = make('button', 'menu-link menu-foot', root)
    home.type = 'button'
    home.textContent = 'Ir al menú principal'
    home.addEventListener('click', () => {
      cancel()
      setRoomInUrl(null)
      menu.refresh()
    })
    const update = () => {
      code.textContent = roomFromUrl() ?? ''
      paint()
      accept.disabled = busy
    }
    return { root, update }
  })

  // La sala de espera. Se repinta cada medio segundo y con cada `match`: sin rehacerla, para no robar el foco.
  menu.register('room', (menu) => {
    const root = panel()
    const box = make('div', 'room-code', root)
    make('span', '', box).textContent = 'Sala'
    const code = make('code', '', box)
    const copy = button(root, 'Copiar enlace', 'small', () => void copyLink())
    const linkField = make('input', 'menu-input room-link', root)
    linkField.readOnly = true
    linkField.hidden = true
    linkField.setAttribute('aria-label', 'Enlace de la sala')
    const players = make('ul', 'room-players', root)
    const difficulty = make('select', 'menu-select', undefined)
    for (const d of DIFFICULTIES) difficulty.add(new Option(DIFFICULTY_DEFS[d].name, d, false, d === roomDifficulty))
    difficulty.addEventListener('change', () => (roomDifficulty = difficulty.value as Difficulty))
    const difficultyRow = make('label', 'menu-field', root)
    make('span', '', difficultyRow).textContent = 'Dificultad'
    difficultyRow.appendChild(difficulty)
    const foot = make('div', 'menu-foot menu-stack', root)
    const start = button(foot, 'Empezar partida', 'primary', () => {
      game.net?.client.start(roomDifficulty)
      // El clic es el gesto que permite capturar el ratón: a los demás les toca el suyo.
      void game.play()
    })
    const back = button(foot, 'Volver a la partida', 'primary', () => void game.play())
    const waitingHost = make('p', 'menu-text', foot)
    waitingHost.textContent = 'Esperando al anfitrión'
    const paint = statusLine(foot)
    button(foot, 'Salir de la sala', 'ghost', leave)
    let copiedTimer: ReturnType<typeof setTimeout> | null = null
    let playerKey = ''

    async function copyLink() {
      const link = location.href
      try {
        await navigator.clipboard.writeText(link)
      } catch {
        // Sin portapapeles (p. ej. sin HTTPS): el enlace, seleccionado, para copiarlo a mano.
        linkField.value = link
        linkField.hidden = false
        linkField.focus()
        linkField.select()
        return
      }
      copy.textContent = '¡Copiado!'
      if (copiedTimer) clearTimeout(copiedTimer)
      copiedTimer = setTimeout(() => (copy.textContent = 'Copiar enlace'), COPIED_MS)
    }

    const update = () => {
      const net = game.net
      if (!net) return
      const match = net.client.match
      code.textContent = net.room
      const lobby = match?.phase === 'lobby'
      const isHost = !!match && match.host === net.me
      if (lobby) menu.voted = false
      const key = match ? match.players.map((p) => `${p.id}:${p.name}`).join('|') + `#${match.host}` : ''
      if (key !== playerKey) {
        playerKey = key
        players.replaceChildren(
          ...(match?.players ?? []).map(({ id, name: who }) => {
            const li = make('li', id === match!.host ? 'host' : '')
            li.textContent = id === match!.host ? `${who} (anfitrión)` : who
            return li
          }),
        )
      }
      players.hidden = !lobby
      difficultyRow.hidden = start.hidden = !lobby || !isHost
      waitingHost.hidden = !lobby || isHost
      back.hidden = match?.phase !== 'playing'
      paint()
    }
    return {
      root,
      update,
      dispose: () => {
        if (copiedTimer) clearTimeout(copiedTimer)
      },
    }
  })

  /** Repinta la pantalla del menú que se vea (o cambia a la que toque). */
  function update() {
    menu.refresh()
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

  /** Deja lo que se estuviera intentando (conectar, esperar por versión) y el error que hubiera. */
  function cancel() {
    attempts++
    stopWaiting()
    busy = false
    error = ''
  }

  async function attempt(open: () => Promise<NetSession>, room: string) {
    const id = ++attempts
    busy = true
    error = ''
    update()
    try {
      const session = await open()
      if (id !== attempts) {
        session.close()
        return
      }
      oldServerSince = null
      game.setSession(session)
      setRoomInUrl(session.room)
      session.client.onmatch = update
      busy = false
      menu.choice = null
      update()
      // En la sala de espera se está en el menú hasta que empiece la partida.
      if (session.client.match?.phase === 'playing') await game.play()
    } catch (e) {
      if (id !== attempts) return
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

  function leave() {
    stopWaiting()
    game.setSession(new LocalSession())
    setRoomInUrl(null)
    error = ''
    menu.choice = null
    game.setState('menu')
  }

  menu.lobby = {
    inviteCode: () => roomFromUrl(),
    leave,
    cancel,
    status,
    beforeSolo: () => {
      stopWaiting()
      error = ''
      setRoomInUrl(null)
    },
  }
  game.onchange = update
  // El estado de la conexión cambia sin avisar a Game: se mira de vez en cuando mientras se ve el menú (fuera de
  // partida: jugando, de espectador o con el inventario abierto no se ve).
  setInterval(() => {
    if (!inGame(game.state)) update()
  }, 500)
  update()
}
