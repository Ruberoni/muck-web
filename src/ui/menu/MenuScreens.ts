import type { Game } from '../../game/Game'
import type { MatchEnd } from '../../sim/match'
import { backFrom, escapeAction, screenFor, type Choice, type Screen, type SubScreen } from './screens'

/** Una pantalla montada: su raíz y cómo repintarla sin rehacerla (la sala cambia mientras se mira). */
export interface ScreenView {
  root: HTMLElement
  /** Repinta lo que cambia; nunca mueve el foco. */
  update?(): void
  /** Al quitarla (p. ej. cortar la escucha de una tecla). */
  dispose?(): void
  /** Ancho del tablón: normal, `wide` (ajustes) o `full` (controles). */
  size?: 'wide' | 'full'
}

export type ScreenBuilder = (menu: MenuScreens) => ScreenView

/** Lo que solo existe con el lobby (la bandera multijugador): salir de la sala y el código de la invitación. */
export interface LobbyHooks {
  inviteCode(): string | null
  leave(): void
  /** Antes de empezar en solitario: olvidar la sala de la URL y las esperas por versión. */
  beforeSolo(): void
  /** Se ha vuelto al inicio desde unirse o la invitación: lo que estuviera conectando ya no cuenta. */
  cancel(): void
  /** La línea de estado de la conexión (en la pausa en red). */
  status(): { text: string; error: boolean }
}

/** Las que son una tarjeta centrada sobre la partida; el resto, el tablón a la izquierda sobre la isla. */
const CARDS: readonly Screen[] = ['pause', 'dead', 'results', 'countdown']

const RETRY_TEXT = 'No se pudo capturar el ratón. Prueba otra vez.'
const NOTICE_MS = 4000

/**
 * El menú en el DOM: la pantalla que dice `screenFor` y, encima, la pila de sub-pantallas (controles, ajustes…).
 * Solo mueve el foco al cambiar de pantalla, nunca al repintar. Esc vuelve atrás en una sub-pantalla o desde lo
 * elegido en el inicio; en la pausa lo lleva `Game` (reanudar), preguntando antes a `escapeResumes()`.
 */
export class MenuScreens {
  readonly root: HTMLElement
  /** La vista previa del personaje, a la derecha del tablón (la pone el lobby). */
  readonly preview: HTMLElement
  private notice: HTMLElement
  private noticeTimer: ReturnType<typeof setTimeout> | null = null
  private builders = new Map<Screen | SubScreen, ScreenBuilder>()
  private stack: SubScreen[] = []
  private base: Screen | null = null
  private shown: { key: Screen | SubScreen; view: ScreenView } | null = null
  /** El Esc que se acaba de usar para volver atrás: su keyup no debe reanudar. */
  private escapeUsed = false
  /** La sub-pantalla que se acaba de cerrar: el foco vuelve al botón que la abrió. */
  private returnTo: SubScreen | null = null

  choice: Choice | null = null
  /** `ready`: la partida de la sala ha empezado y falta entrar. Se borra al cambiar de estado. */
  overlay: 'ready' | null = null
  /** La pantalla final y sus líneas (la primera es el título). */
  results: { end: MatchEnd; lines: readonly string[] } | null = null
  lobby: LobbyHooks | null = null
  /** Ya se ha votado rendirse en esta partida de la sala. */
  voted = false

  constructor(
    container: HTMLElement,
    readonly game: Game,
  ) {
    this.root = document.createElement('div')
    this.root.className = 'menu'
    this.preview = document.createElement('div')
    this.preview.className = 'menu-preview'
    this.notice = document.createElement('div')
    this.notice.className = 'menu-notice'
    this.notice.setAttribute('role', 'status')
    this.notice.hidden = true
    this.root.append(this.preview, this.notice)
    container.appendChild(this.root)
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape' || e.repeat) return
      // Un keyup perdido (se cambió de ventana con Esc pulsado) no deja la marca puesta para la siguiente pausa.
      this.escapeUsed = false
      if (this.root.hidden) return
      const action = escapeAction(this.base, this.stack.length)
      if (action !== 'back') return
      this.escapeUsed = true
      this.back()
    })
  }

  /** Quién pinta cada pantalla. El lobby sustituye el inicio y añade las suyas. */
  register(screen: Screen | SubScreen, builder: ScreenBuilder) {
    this.builders.set(screen, builder)
    if (this.shown?.key === screen) this.rebuild()
  }

  get screen(): Screen | null {
    return this.base
  }

  /** La sub-pantalla de arriba, si hay alguna. */
  get top(): SubScreen | null {
    return this.stack.at(-1) ?? null
  }

  /** Vuelve a mirar qué pantalla toca: si es otra, la monta (y le da el foco); si es la misma, la repinta. */
  refresh() {
    const { game } = this
    const base = screenFor({
      state: game.state,
      overlay: this.overlay,
      inRoom: game.net !== null,
      results: this.results?.end ?? null,
      hasLobby: this.lobby !== null,
      inviteCode: this.lobby?.inviteCode() ?? null,
      choice: this.choice,
      loading: false,
    })
    if (base !== this.base) {
      this.base = base
      this.stack.length = 0
    }
    const key = this.top ?? base
    if (key !== (this.shown?.key ?? null)) this.rebuild()
    else this.shown?.view.update?.()
  }

  /** Abre una sub-pantalla encima. */
  push(screen: SubScreen) {
    this.stack.push(screen)
    this.rebuild()
  }

  /** Cierra la sub-pantalla de arriba o, sin ninguna, vuelve al inicio desde lo elegido en él. */
  back() {
    if (this.stack.length) this.returnTo = this.stack.pop()!
    else if (backFrom(this.base)) {
      this.choice = null
      this.lobby?.cancel()
    }
    this.refresh()
    this.returnTo = null
  }

  /** Va a lo elegido en el inicio (null: al inicio). */
  go(choice: Choice | null) {
    if (choice === null && this.choice !== null) this.lobby?.cancel()
    this.choice = choice
    this.refresh()
  }

  /** La pantalla final (null la quita). */
  setResults(results: { end: MatchEnd; lines: readonly string[] } | null) {
    this.results = results
    this.refresh()
  }

  /** No se pudo capturar el ratón: el botón principal de la pantalla en curso vuelve a pedirlo. */
  showRetry() {
    this.refresh()
    this.notice.textContent = RETRY_TEXT
    this.notice.hidden = false
    if (this.noticeTimer) clearTimeout(this.noticeTimer)
    this.noticeTimer = setTimeout(() => (this.notice.hidden = true), NOTICE_MS)
  }

  /**
   * Si el keyup de Esc puede reanudar: solo en la pausa sin sub-pantallas (en la cuenta atrás, que también es
   * `paused`, no), y no si su keydown ya se usó para volver atrás. Consume la marca de ese keydown.
   */
  escapeResumes(): boolean {
    const used = this.escapeUsed
    this.escapeUsed = false
    return !used && escapeAction(this.base, this.stack.length) === 'resume'
  }

  private rebuild() {
    const key = this.top ?? this.base
    const hadFocus = this.root.contains(document.activeElement)
    this.shown?.view.root.remove()
    this.shown?.view.dispose?.()
    this.shown = null
    this.root.hidden = key === null
    if (key === null) {
      this.notice.hidden = true
      if (hadFocus) (document.activeElement as HTMLElement | null)?.blur()
      return
    }
    const builder = this.builders.get(key)
    if (!builder) {
      this.root.hidden = true
      return
    }
    const view = builder(this)
    const card = this.base !== null && CARDS.includes(this.base)
    this.root.classList.toggle('card', card)
    this.root.classList.toggle('danger', this.base === 'dead' && !this.top)
    this.root.classList.toggle('online', this.game.net !== null)
    view.root.classList.add('menu-panel')
    if (view.size) view.root.classList.add(view.size)
    this.preview.hidden = card || this.top !== null
    this.root.insertBefore(view.root, this.notice)
    this.shown = { key, view }
    view.update?.()
    const opener = this.returnTo && view.root.querySelector<HTMLElement>(`[data-opens="${this.returnTo}"]`)
    const first = opener || view.root.querySelector<HTMLElement>('[data-autofocus]') || view.root.querySelector<HTMLElement>('button:not(:disabled), input, select')
    first?.focus({ preventScroll: true })
  }
}
