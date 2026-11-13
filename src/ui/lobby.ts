import type { Game } from '../game/Game'
import { inGame } from '../game/states'
import { DIFFICULTY_DEFS, type Difficulty } from '../sim/match'
import { failureMessage, NetError, NetSession } from '../net/netSession'
import { cleanName, isRoomCode, MAX_NAME, MAX_PLAYERS, ROOM_ALPHABET, ROOM_CODE_LENGTH } from '../net/protocol'
import { onVersionReject, reloadFor } from '../net/reload'
import { LocalSession } from '../net/session'
import { loadSkin } from './skin'
import { backButton, button, difficultyCards, field, header, logo, make, panel, subScreenButtons } from './menu/views'
import { roomModel, seatNote, seatsKey, type Seat } from './menu/room'
import { NEW_VERSION, OLD_SERVER_FOR_MS, OLD_SERVER_RETRY_MS, SERVER_UPDATING, shouldReconnect } from '../net/status'

/** Tras pulsar "Empezar partida", lo que se espera a la fase nueva antes de dejar volver a probar. */
const START_RETRY_MS = 4000

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

const CROWN_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><path d="M3 18h18l-2-11-5 5-2-7-2 7-5-5z"></path></svg>'

/** Un puesto de la sala: la corona del anfitrión, el nombre (ajeno: con `textContent`) y quién es; o un hueco libre. */
function seatItem(seat: Seat | null): HTMLLIElement {
  if (!seat) {
    const li = make('li', 'empty')
    li.textContent = 'Hueco libre'
    return li
  }
  const li = make('li', seat.host ? 'host' : '')
  const crown = make('span', 'crown', li)
  if (seat.host) {
    crown.innerHTML = CROWN_ICON
    crown.title = 'Anfitrión'
  }
  make('span', 'who', li).textContent = seat.name
  const note = seatNote(seat)
  if (note) make('span', 'note', li).textContent = note
  return li
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
  /** Cuántos intentos de entrar se han empezado: uno que termina después de abandonarlo (volver al inicio) no cuenta. */
  let attempts = 0
  const name = () => cleanName(nameValue) || DEFAULT_NAME

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
    const create = button(actions, 'Crear partida', '', () => void enter(() => NetSession.create(name(), loadSkin()), ''))
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
      if (isRoomCode(code.value)) void enter(() => NetSession.open('join', code.value, name(), loadSkin()), code.value)
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
      if (room) void enter(() => NetSession.open('join', room, name(), loadSkin()), room)
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
    root.classList.add('room')
    make('h1', 'menu-title', root).textContent = 'Sala de espera'
    const box = make('div', 'room-code row', root)
    const label = make('div', 'room-code-text', box)
    make('span', '', label).textContent = 'Código de la sala'
    const code = make('code', '', label)
    const copy = button(box, 'Copiar enlace', 'small', () => void copyLink())
    const linkField = make('input', 'menu-input room-link', root)
    linkField.readOnly = true
    linkField.hidden = true
    linkField.setAttribute('aria-label', 'Enlace de la sala')
    const seatsBox = make('div', 'room-seats', root)
    const seatsTitle = make('span', 'room-seats-title', seatsBox)
    const seats = make('ul', 'room-players', seatsBox)
    const difficultyRow = make('div', 'room-difficulty', root)
    const difficultyText = make('span', '', difficultyRow)
    difficultyText.append('Dificultad: ')
    const difficultyStrong = make('strong', '', difficultyText)
    const change = button(difficultyRow, 'Cambiar', 'ghost tiny', () => menu.push('difficulty-room'))
    change.dataset.opens = 'difficulty-room'
    const foot = make('div', 'menu-foot menu-stack', root)
    // Sin capturar el ratón: como los demás, el anfitrión ve la cuenta atrás y entra con "¡Entrar!". Un doble clic
    // no manda dos `start`; si el servidor no contesta, se puede volver a probar al rato. Con `aria-disabled` y no
    // `disabled`, para que el botón no pierda el foco (en `body`, Enter abriría el chat).
    let startTimer: ReturnType<typeof setTimeout> | null = null
    const start = button(foot, 'Empezar partida', 'primary', () => {
      if (startTimer) return
      start.setAttribute('aria-disabled', 'true')
      startTimer = setTimeout(() => {
        startTimer = null
        start.removeAttribute('aria-disabled')
      }, START_RETRY_MS)
      game.net?.client.start()
    })
    const back = button(foot, 'Volver a la partida', 'primary', () => void game.play())
    const waitingHost = make('p', 'room-waiting', foot)
    waitingHost.textContent = 'Esperando al anfitrión'
    const paint = statusLine(foot)
    button(foot, 'Salir de la sala', 'ghost', leave)
    // El chat de la sala: el mismo del HUD, traído aquí (a la derecha o, en una ventana estrecha, dentro del tablón).
    const chat = make('div', 'room-chat', root)
    game.hud.net.dock(chat)
    // Enter abre el chat solo si el foco no está en nada (en un botón, Enter lo pulsa).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.repeat || (document.activeElement && document.activeElement !== document.body)) return
      e.preventDefault()
      game.hud.net.openChat()
    }
    window.addEventListener('keydown', onKey)
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
      const model = roomModel(net.client.match, net.me)
      code.textContent = net.room
      if (model.lobby) menu.voted = false
      const key = seatsKey(model)
      if (key !== playerKey) {
        playerKey = key
        seatsTitle.textContent = `Jugadores (${model.count} de ${MAX_PLAYERS})`
        seats.replaceChildren(...model.seats.map(seatItem))
      }
      const difficultyName = DIFFICULTY_DEFS[model.difficulty].name
      if (difficultyStrong.textContent !== difficultyName) difficultyStrong.textContent = difficultyName
      difficultyRow.hidden = !model.lobby
      change.hidden = !model.isHost
      start.hidden = !model.lobby || !model.isHost
      waitingHost.hidden = !model.lobby || model.isHost
      back.hidden = net.client.match?.phase !== 'playing'
      paint()
    }
    return {
      root,
      update,
      dispose: () => {
        if (copiedTimer) clearTimeout(copiedTimer)
        if (startTimer) clearTimeout(startTimer)
        window.removeEventListener('keydown', onKey)
        game.hud.net.dock(null)
      },
    }
  })

  // Cambiar la dificultad de la sala (solo el anfitrión): las mismas tarjetas que en solitario, y "Guardar".
  menu.register('difficulty-room', (menu) => {
    const root = panel()
    header(root, menu, 'Dificultad')
    let picked: Difficulty = game.net?.client.match?.difficulty ?? 'normal'
    difficultyCards(root, picked, (d) => (picked = d))
    button(make('div', 'menu-foot menu-stack', root), 'Guardar', 'primary', () => {
      game.net?.client.setDifficulty(picked)
      menu.back()
    })
    // Si deja de ser el anfitrión (o empieza la partida) ya no hay nada que guardar: de vuelta a la sala.
    const update = () => {
      const net = game.net
      const model = net ? roomModel(net.client.match, net.me) : null
      if (model && model.isHost && model.lobby) return
      queueMicrotask(() => {
        if (menu.top === 'difficulty-room') menu.back()
      })
    }
    return { root, update }
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
