import type { Game } from '../../game/Game'
import type { MatchEnd } from '../../sim/match'
import { allFailed, pendingOf } from '../../game/loadTracker'
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
const CARDS: readonly Screen[] = ['pause', 'dead', 'results', 'countdown', 'loading']

const RETRY_TEXT = 'No se pudo capturar el ratón. Prueba otra vez.'
const NOTICE_MS = 4000

/**
 * El menú en el DOM: la pantalla que dice `screenFor` y, encima, la pila de sub-pantallas (controles, ajustes…).
 * Solo mueve el foco al cambiar de pantalla, nunca al repintar. Esc vuelve atrás en una sub-pantalla o desde lo
 * elegido en el inicio; en la pausa lo lleva `Game` (reanudar), preguntando antes a `escapeResumes()`.
 */
export class MenuScreens {
  readonly root: HTMLElement
  private notice: HTMLElement
  /** Los nombres sobre los personajes de la sala, detrás del tablón. */
  private tagLayer: HTMLElement
  private tags = new Map<number, HTMLElement>()
  private noticeTimer: ReturnType<typeof setTimeout> | null = null
  private builders = new Map<Screen | SubScreen, ScreenBuilder>()
  private stack: SubScreen[] = []
  private base: Screen | null = null
  private shown: { key: Screen | SubScreen; view: ScreenView } | null = null
  /** El Esc que se acaba de usar para volver atrás: su keyup no debe reanudar. */
  private escapeUsed = false
  /** La sub-pantalla que se acaba de cerrar: el foco vuelve al botón que la abrió. */
  private returnTo: SubScreen | null = null
  /** La pantalla de carga del principio ya no se enseña (ha terminado o se ha pasado el tiempo). */
  private loadingOver = false
  /** Se ha elegido seguir sin los modelos: aunque todo haya fallado, no vuelve. */
  private loadingSkipped = false

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
    this.notice = document.createElement('div')
    this.notice.className = 'menu-notice'
    this.notice.setAttribute('role', 'status')
    this.notice.hidden = true
    this.tagLayer = document.createElement('div')
    this.tagLayer.className = 'stage-tags'
    this.tagLayer.setAttribute('aria-hidden', 'true')
    this.root.append(this.tagLayer, this.notice)
    container.appendChild(this.root)
    // El toc de cada botón del menú (respeta el volumen: va por el mismo master que los efectos). El clic también
    // despierta el audio, así la cuenta atrás ya suena.
    this.root.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement | null)?.closest('button')
      if (!target || target.disabled) return
      game.sound.unlock()
      game.sound.play('uiClick')
      // En captura: antes que el botón, que puede desactivarse o quitarse de la pantalla al pulsarlo.
    }, true)
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
      loading: this.loading,
    })
    if (base !== this.base) {
      this.base = base
      this.stack.length = 0
    }
    const key = this.top ?? base
    if (key !== (this.shown?.key ?? null)) this.rebuild()
    else this.shown?.view.update?.()
  }

  /**
   * Si aún toca la pantalla de carga: hasta que no quede nada pendiente (o pase el tiempo). Si todo ha fallado se
   * enseña (con "Recargar"), también si falla después del tiempo, hasta que se elija seguir sin los modelos.
   */
  private get loading(): boolean {
    if (this.loadingSkipped) return false
    const progress = this.game.loads.state
    if (allFailed(progress)) return true
    if (this.loadingOver) return false
    if (pendingOf(progress) > 0) return true
    this.loadingOver = true
    return false
  }

  /** Deja de esperar a los modelos: `skip`, se ha elegido seguir sin ellos; si no, se ha pasado el tiempo. */
  endLoading(skip = true) {
    if (skip) this.loadingSkipped = true
    this.loadingOver = true
    this.refresh()
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

  /** Los nombres de la fila de la sala, en píxeles CSS (vacío: ninguno). Solo toca lo que cambia. */
  setStageTags(tags: readonly { id: number; name: string; left: number; top: number }[]) {
    if (!tags.length && !this.tags.size) return
    const seen = new Set<number>()
    for (const tag of tags) {
      seen.add(tag.id)
      let node = this.tags.get(tag.id)
      if (!node) {
        node = document.createElement('div')
        node.className = 'stage-tag'
        this.tagLayer.appendChild(node)
        this.tags.set(tag.id, node)
      }
      if (node.textContent !== tag.name) node.textContent = tag.name
      const transform = `translate(${tag.left.toFixed(1)}px, ${tag.top.toFixed(1)}px) translate(-50%, -100%)`
      if (node.style.transform !== transform) node.style.transform = transform
    }
    for (const [id, node] of this.tags) {
      if (seen.has(id)) continue
      node.remove()
      this.tags.delete(id)
    }
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
    this.root.insertBefore(view.root, this.notice)
    this.shown = { key, view }
    view.update?.()
    const opener = this.returnTo && view.root.querySelector<HTMLElement>(`[data-opens="${this.returnTo}"]`)
    const first = opener || view.root.querySelector<HTMLElement>('[data-autofocus]') || view.root.querySelector<HTMLElement>('button:not(:disabled), input, select')
    first?.focus({ preventScroll: true })
  }
}
