import type { PlayerId } from '../sim/events'
import { playerCss } from './playerColor'

/** Los nombres se ven hasta esta distancia (m). */
export const NAME_DISTANCE = 40
/** Lo que dura un aviso en pantalla (ms); la animación de salida va en el CSS. */
const NOTICE_MS = 5000
/** Avisos a la vez: si llegan más, se van los más viejos. */
const MAX_NOTICES = 4

export type ConnectionLight = 'connecting' | 'online' | 'lost'

/** Una fila de la lista de jugadores. */
export interface PlayerRow {
  id: PlayerId
  name: string
  health: number
  maxHealth: number
  /** ms; 0 si aún no se sabe. */
  ping: number
  absent: boolean
  alive: boolean
  me: boolean
}

/** Otro jugador visto desde la cámara, para su nombre. */
export interface TagCandidate {
  id: PlayerId
  name: string
  x: number
  y: number
  z: number
}

/** Un nombre en pantalla, en píxeles CSS. */
export interface NameTag {
  id: PlayerId
  name: string
  left: number
  top: number
}

/**
 * Los nombres que se ven: a menos de NAME_DISTANCE de la cámara, delante de ella y dentro de la pantalla.
 * `project` lleva un punto del mundo a coordenadas normalizadas (−1..1; `z` > 1 o < −1 queda fuera, como
 * `Vector3.project` de three). No mira si algo lo tapa.
 */
export function pickNameTags(
  candidates: readonly TagCandidate[],
  camera: { x: number; y: number; z: number },
  project: (x: number, y: number, z: number) => { x: number; y: number; z: number },
  width: number,
  height: number,
): NameTag[] {
  const tags: NameTag[] = []
  for (const c of candidates) {
    if (Math.hypot(c.x - camera.x, c.y - camera.y, c.z - camera.z) > NAME_DISTANCE) continue
    const p = project(c.x, c.y, c.z)
    if (p.z < -1 || p.z > 1 || Math.abs(p.x) > 1.05 || Math.abs(p.y) > 1.05) continue
    tags.push({ id: c.id, name: c.name, left: ((p.x + 1) / 2) * width, top: ((1 - p.y) / 2) * height })
  }
  return tags
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent: HTMLElement) => {
  const node = document.createElement(tag)
  node.className = className
  parent.appendChild(node)
  return node
}

/**
 * La parte del HUD que solo sale en red: indicador de conexión, lista de jugadores (vida, ping, ausente),
 * avisos ("X se ha unido") y nombres sobre los demás. Todo texto que viene de otros va con `textContent`.
 */
export class MultiplayerHud {
  private root: HTMLElement
  private status: HTMLElement
  private statusText: HTMLElement
  private list: HTMLElement
  private notices: HTMLElement
  private names: HTMLElement
  private banner: HTMLElement
  private bannerTitle: HTMLElement
  private bannerDetail: HTMLElement
  private rows = new Map<PlayerId, { root: HTMLElement; key: string }>()
  private tags = new Map<PlayerId, HTMLElement>()
  private lastStatus = ''

  constructor(parent: HTMLElement) {
    // Los nombres van debajo de todo lo demás del HUD.
    this.names = el('div', 'names', parent)
    parent.prepend(this.names)
    this.root = el('div', 'net', parent)
    this.status = el('div', 'net-status', this.root)
    el('span', 'light', this.status)
    this.statusText = el('span', 'text', this.status)
    this.list = el('ul', 'players', this.root)
    this.notices = el('div', 'notices', parent)
    this.banner = el('div', 'banner', parent)
    this.bannerTitle = el('div', 'title', this.banner)
    this.bannerDetail = el('div', 'detail', this.banner)
    this.setVisible(false)
  }

  /** Fuera de una sala no se ve nada (y se olvida lo que había). */
  setVisible(visible: boolean) {
    this.root.hidden = !visible
    this.names.hidden = !visible
    if (visible) return
    this.setPlayers([])
    this.setNames([])
    this.notices.replaceChildren()
    this.setBanner(null)
    this.lastStatus = ''
  }

  /** Cartel en el centro de la pantalla ("Has muerto", "Game over"); null lo quita. El detalle puede llevar nombres ajenos. */
  setBanner(banner: { title: string; detail: string } | null) {
    this.banner.hidden = !banner
    if (!banner) return
    if (this.bannerTitle.textContent !== banner.title) this.bannerTitle.textContent = banner.title
    if (this.bannerDetail.textContent !== banner.detail) this.bannerDetail.textContent = banner.detail
  }

  setStatus(light: ConnectionLight, text: string) {
    const key = `${light}|${text}`
    if (key === this.lastStatus) return
    this.lastStatus = key
    this.status.className = `net-status ${light}`
    this.statusText.textContent = text
  }

  /** La lista entera, en el orden dado. Solo rehace las filas que cambian. */
  setPlayers(players: readonly PlayerRow[]) {
    const seen = new Set<PlayerId>()
    for (const p of players) {
      seen.add(p.id)
      const health = Math.max(0, Math.min(1, p.health / p.maxHealth))
      const tag = !p.alive ? 'muerto' : p.absent ? 'ausente' : ''
      const ping = p.ping > 0 ? `${Math.round(p.ping)} ms` : ''
      const key = `${p.name}|${Math.round(health * 50)}|${ping}|${tag}|${p.me}`
      let row = this.rows.get(p.id)
      if (!row) {
        row = { root: document.createElement('li'), key: '' }
        this.rows.set(p.id, row)
      }
      // Mantiene el orden aunque la fila ya existiera.
      this.list.appendChild(row.root)
      if (row.key === key) continue
      row.key = key
      const li = row.root
      li.className = `player${p.me ? ' me' : ''}${tag ? ' away' : ''}`
      li.replaceChildren()
      const swatch = el('span', 'swatch', li)
      swatch.style.background = playerCss(p.id)
      el('span', 'name', li).textContent = p.me ? `${p.name} (tú)` : p.name
      el('span', 'fill', el('span', 'life', li)).style.transform = `scaleX(${health})`
      el('span', 'ping', li).textContent = ping
      // Siempre, aunque vacía: así las columnas de todas las filas cuadran.
      el('span', tag ? 'tag' : 'tag empty', li).textContent = tag
    }
    for (const [id, row] of this.rows) {
      if (seen.has(id)) continue
      row.root.remove()
      this.rows.delete(id)
    }
  }

  /** Un aviso que se va solo. */
  notice(text: string) {
    while (this.notices.childElementCount >= MAX_NOTICES) this.notices.firstElementChild!.remove()
    const node = el('div', 'notice', this.notices)
    node.textContent = text
    setTimeout(() => node.remove(), NOTICE_MS)
  }

  setNames(tags: readonly NameTag[]) {
    const seen = new Set<PlayerId>()
    for (const tag of tags) {
      seen.add(tag.id)
      let node = this.tags.get(tag.id)
      if (!node) {
        node = el('div', 'name-tag', this.names)
        node.style.color = playerCss(tag.id)
        this.tags.set(tag.id, node)
      }
      if (node.textContent !== tag.name) node.textContent = tag.name
      node.style.transform = `translate(${tag.left.toFixed(1)}px, ${tag.top.toFixed(1)}px) translate(-50%, -100%)`
    }
    for (const [id, node] of this.tags) {
      if (seen.has(id)) continue
      node.remove()
      this.tags.delete(id)
    }
  }
}
