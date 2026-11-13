import { saveSettings } from '../../game/settings'
import { DIFFICULTIES, DIFFICULTY_DEFS, type Difficulty } from '../../sim/match'
import { createSettingsPanel } from '../settings'
import { allFailed, loadFraction } from '../../game/loadTracker'
import { controlGroups } from './controls'
import { countdownNumber } from './countdown'
import { pickTip } from './tips'
import type { MenuScreens, ScreenView } from './MenuScreens'

export const TAGLINE = 'Sobrevive a la noche en la isla'

/** Lo que se lee bajo cada dificultad. */
export const DIFFICULTY_TEXT: Record<Difficulty, string> = {
  easy: 'Un paseo por la playa… casi.',
  normal: 'La isla no perdona, pero avisa.',
  hard: 'Cada noche huele a colmillos.',
  ultra: 'Ni las bayas están de tu lado.',
}

export const livesText = (lives: number) => (lives === 1 ? '1 vida' : `${lives} vidas`)

export const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  parent?.appendChild(node)
  return node
}

/** Un botón del menú: `kind` es la variante (`primary`, `small`, `ghost`, `danger`; vacío, el de madera). */
export function button(parent: HTMLElement, text: string, kind: string, onClick: () => void) {
  const b = make('button', kind ? `btn ${kind}` : 'btn', parent)
  b.type = 'button'
  b.textContent = text
  b.addEventListener('click', onClick)
  return b
}

/** El tablón (o la tarjeta) de una pantalla. */
export const panel = () => make('div', '')

/** El logo y, si se quiere, el lema. */
export function logo(parent: HTMLElement, tagline = true) {
  const box = make('div', 'menu-logo', parent)
  make('h1', '', box).textContent = 'muck-web'
  if (tagline) make('p', '', box).textContent = TAGLINE
  return box
}

const BACK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"></path></svg>'

/** "Volver": cierra la sub-pantalla o vuelve al inicio, como Esc. */
export function backButton(parent: HTMLElement, menu: MenuScreens) {
  const b = make('button', 'menu-back', parent)
  b.type = 'button'
  b.innerHTML = `${BACK_ICON}Volver`
  b.addEventListener('click', () => menu.back())
  return b
}

/** Cabecera de una sub-pantalla: "Volver" y el título. */
export function header(parent: HTMLElement, menu: MenuScreens, title: string) {
  const head = make('div', 'menu-head', parent)
  backButton(head, menu)
  make('h1', 'menu-title', head).textContent = title
  return head
}

/** Controles y Ajustes, uno al lado del otro (en la pausa). */
export function subScreenButtons(parent: HTMLElement, menu: MenuScreens, kind = 'ghost') {
  const row = make('div', 'menu-row', parent)
  button(row, 'Controles', kind, () => menu.push('controls')).dataset.opens = 'controls'
  button(row, 'Ajustes', kind, () => menu.push('settings')).dataset.opens = 'settings'
  return row
}

/** Un campo con su etiqueta encima. */
export function field(parent: HTMLElement, label: string, input: HTMLInputElement) {
  const row = make('label', 'menu-field', parent)
  make('span', '', row).textContent = label
  row.appendChild(input)
  return row
}

/**
 * Las tarjetas de dificultad: un grupo de radio (flechas para cambiar, como cualquier grupo de opciones). `onPick`
 * llega al elegir otra.
 */
export function difficultyCards(parent: HTMLElement, value: Difficulty, onPick: (difficulty: Difficulty) => void) {
  const list = make('div', 'difficulty-list', parent)
  list.setAttribute('role', 'radiogroup')
  list.setAttribute('aria-label', 'Dificultad')
  const cards = DIFFICULTIES.map((difficulty) => {
    const card = make('button', 'difficulty', list)
    card.type = 'button'
    card.setAttribute('role', 'radio')
    card.dataset.difficulty = difficulty
    const name = make('span', 'name', card)
    name.textContent = DIFFICULTY_DEFS[difficulty].name
    make('small', '', name).textContent = livesText(DIFFICULTY_DEFS[difficulty].lives)
    make('span', 'desc', card).textContent = DIFFICULTY_TEXT[difficulty]
    card.addEventListener('click', () => pick(difficulty))
    return card
  })
  const pick = (difficulty: Difficulty, focus = false) => {
    value = difficulty
    cards.forEach((card, i) => {
      const on = DIFFICULTIES[i] === difficulty
      card.setAttribute('aria-checked', String(on))
      card.tabIndex = on ? 0 : -1
      if (on && focus) card.focus()
    })
    onPick(difficulty)
  }
  list.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const i = DIFFICULTIES.indexOf(value)
    pick(DIFFICULTIES[(i + step + DIFFICULTIES.length) % DIFFICULTIES.length]!, true)
  })
  pick(value)
  // El foco entra por la elegida.
  cards[DIFFICULTIES.indexOf(value)]!.dataset.autofocus = ''
  return list
}

/** Las líneas de la pantalla final (sin el título, que va aparte). */
function resultLines(parent: HTMLElement, lines: readonly string[]) {
  const box = make('div', 'menu-results', parent)
  for (const line of lines) make('p', '', box).textContent = line
  return box
}

let soloDifficulty: Difficulty = 'normal'

/** Las pantallas que no dependen de la red: también sin la bandera multijugador. */
export function installCoreScreens(menu: MenuScreens) {
  const { game } = menu

  // Inicio sin lobby: jugar solo, controles y ajustes.
  menu.register('home', (menu) => {
    const root = panel()
    logo(root)
    const actions = make('div', 'menu-stack', root)
    button(actions, 'Jugar solo', 'primary', () => menu.go('solo-difficulty'))
    return { root }
  })

  menu.register('solo-difficulty', (menu) => {
    const root = panel()
    backButton(root, menu)
    make('h1', 'menu-title', root).textContent = 'Jugar solo'
    difficultyCards(root, soloDifficulty, (d) => (soloDifficulty = d))
    const start = button(make('div', 'menu-foot menu-stack', root), 'Empezar', 'primary', () => {
      menu.lobby?.beforeSolo()
      // Ya no se está eligiendo: si no se puede capturar el ratón se queda en el inicio, con el aviso.
      menu.choice = null
      void game.playSolo(soloDifficulty)
    })
    start.dataset.primary = ''
    return { root }
  })

  menu.register('pause', (menu) => {
    const root = panel()
    make('h1', 'menu-title', root).textContent = 'Pausa'
    const online = make('p', 'menu-text', root)
    online.textContent = 'En una sala la partida sigue mientras tanto'
    const actions = make('div', 'menu-stack', root)
    button(actions, 'Continuar', 'primary', () => void game.play())
    subScreenButtons(actions, menu, 'small')
    const surrender = button(actions, 'Rendirse', 'danger', () => {
      menu.voted = game.net !== null
      game.surrender()
      menu.refresh()
    })
    const leave = button(actions, 'Salir de la sala', 'ghost', () => menu.lobby?.leave())
    const status = make('p', 'menu-status', root)
    status.setAttribute('role', 'status')
    const update = () => {
      const net = game.net
      const match = net?.client.match ?? null
      online.hidden = !net
      const line = net && menu.lobby ? menu.lobby.status() : { text: '', error: false }
      status.textContent = line.text
      status.classList.toggle('error', line.error)
      status.hidden = !line.text
      leave.hidden = !net || !menu.lobby
      // En una sala solo se vota mientras se juega.
      surrender.hidden = !!net && match?.phase !== 'playing'
      surrender.disabled = !!net && menu.voted
      const votes = `(${match?.votes ?? 0}/${match?.players.length ?? 0})`
      surrender.textContent = !net ? 'Rendirse' : menu.voted ? `Has votado rendirse ${votes}` : `Votar rendirse ${votes}`
    }
    return { root, update }
  })

  // La partida de la sala ha empezado: 3, 2, 1 para todos (también el anfitrión) y luego "¡Entrar!", el clic que
  // deja capturar el ratón.
  menu.register('countdown', () => {
    const root = panel()
    make('p', 'menu-text', root).textContent = 'La partida empieza'
    const number = make('div', 'countdown-number', root)
    number.setAttribute('aria-hidden', 'true')
    const enter = button(root, '¡Entrar!', 'primary big', () => void game.play())
    enter.hidden = true
    const started = performance.now()
    let shown: number | null | undefined
    const tick = () => {
      const left = countdownNumber(performance.now() - started)
      if (left === shown) return
      shown = left
      if (left === null) {
        number.hidden = true
        enter.hidden = false
        enter.focus({ preventScroll: true })
        window.clearInterval(timer)
        return
      }
      number.textContent = String(left)
      // Vuelve a lanzar la animación del número (sin ella con el movimiento reducido: ver menu.css).
      number.classList.remove('pop')
      void number.offsetWidth
      number.classList.add('pop')
      game.sound.play('uiTick')
    }
    const timer = window.setInterval(tick, 100)
    tick()
    return { root, dispose: () => window.clearInterval(timer) }
  })

  // Al abrir el juego, mientras llegan los modelos: el logo, la barra y un consejo.
  menu.register('loading', (menu) => {
    const root = panel()
    logo(root, false)
    const bar = make('div', 'load-bar', root)
    bar.setAttribute('role', 'progressbar')
    bar.setAttribute('aria-label', 'Cargando')
    bar.setAttribute('aria-valuemin', '0')
    bar.setAttribute('aria-valuemax', '100')
    const fill = make('div', 'load-fill', bar)
    const tip = make('p', 'load-tip', root)
    tip.textContent = pickTip()
    const failed = make('div', 'menu-stack', root)
    make('p', 'menu-status error', failed).textContent = 'No se pudieron cargar los modelos'
    button(failed, 'Recargar', 'primary', () => location.reload())
    button(failed, 'Seguir sin ellos', 'ghost', () => menu.endLoading())
    const update = () => {
      const progress = game.loads.state
      const percent = Math.round(loadFraction(progress) * 100)
      fill.style.width = `${percent}%`
      bar.setAttribute('aria-valuenow', String(percent))
      const lost = allFailed(progress)
      failed.hidden = !lost
      bar.hidden = lost
      tip.hidden = lost
      if (lost && !root.contains(document.activeElement)) failed.querySelector('button')?.focus({ preventScroll: true })
    }
    return { root, update }
  })

  // Fin en solitario: "Jugar otra vez" reinicia la isla con la misma dificultad.
  const endButtons = (parent: HTMLElement) => {
    const actions = make('div', 'menu-stack', parent)
    button(actions, 'Jugar otra vez', 'primary', () => {
      game.restart()
      void game.play()
    })
    button(actions, 'Menú principal', '', () => {
      game.restart()
      menu.go(null)
    })
  }

  menu.register('dead', (menu) => {
    const root = panel()
    const [title, ...lines] = menu.results?.lines ?? ['Has muerto']
    make('h1', 'menu-title danger', root).textContent = title === 'Fin de la partida' ? 'Has muerto' : title!
    resultLines(root, lines)
    endButtons(root)
    return { root }
  })

  menu.register('results', (menu) => {
    const root = panel()
    const [title, ...lines] = menu.results?.lines ?? ['Fin de la partida']
    // Escapar en el avión es ganar: el título, dorado.
    make('h1', menu.results?.end === 'escaped' ? 'menu-title win' : 'menu-title', root).textContent = title!
    resultLines(root, lines)
    if (game.net) {
      button(root, 'Volver a la sala', 'primary', () => menu.setResults(null))
    } else {
      endButtons(root)
    }
    return { root }
  })

  menu.register('controls', (menu) => {
    const root = panel()
    header(root, menu, 'Controles')
    const grid = make('div', 'controls-grid', root)
    for (const group of controlGroups(game.settings.bindings)) {
      const box = make('section', 'menu-section', grid)
      make('h2', '', box).textContent = group.title
      for (const row of group.rows) {
        const line = make('div', 'control', box)
        make('kbd', 'kbd', line).textContent = row.key
        make('span', '', line).textContent = row.text
      }
    }
    return { root, size: 'full' }
  })

  menu.register('settings', (menu) => {
    const root = panel()
    header(root, menu, 'Ajustes')
    const { dispose } = createSettingsPanel(
      root,
      game.settings,
      () => game.applySettings(),
      (settings, key) => {
        saveSettings(settings)
        if (key === 'volume') game.sound.play('pickup')
        if (key === 'bindings') game.applyBindings()
      },
    )
    // Se puede cerrar con un deslizador a medio arrastrar (empieza la partida de la sala, se muere…): su valor ya está
    // aplicado pero el `change` que lo guarda no llegará. Se guarda sin más, sin el sonido de prueba del volumen.
    const close = () => {
      saveSettings(game.settings)
      dispose()
    }
    return { root, dispose: close, size: 'wide' } satisfies ScreenView
  })
}
