import { PROP_DEFS } from '../game/constants'
import { ITEM_NAMES, SLOT_COUNT, type Inventory, type ItemId } from '../game/inventory'
import type { PropData } from '../world/props'

const ICONS: Record<ItemId, string> = {
  wood: `<svg viewBox="0 0 32 32"><rect x="4" y="9" width="24" height="14" rx="3" fill="#8a5a32"/><ellipse cx="26" cy="16" rx="4" ry="7" fill="#d9a86a"/><ellipse cx="26" cy="16" rx="2" ry="3.5" fill="#b07b45"/></svg>`,
  stone: `<svg viewBox="0 0 32 32"><polygon points="6,22 10,10 20,6 27,14 25,24 14,27" fill="#9a978a"/><polygon points="10,10 20,6 18,15" fill="#b8b5a8"/><polygon points="18,15 27,14 25,24" fill="#7c796e"/></svg>`,
}

export type OverlayKind = 'menu' | 'paused' | 'retry' | null

const OVERLAY_TEXT: Record<Exclude<OverlayKind, null>, string> = {
  menu: 'Haz clic para jugar',
  paused: 'Pausa — haz clic para continuar',
  retry: 'No se pudo capturar el ratón. Haz clic de nuevo',
}

const CONTROLS = `
  <ul class="controls">
    <li><kbd>WASD</kbd> moverse</li>
    <li><kbd>Ratón</kbd> mirar</li>
    <li><kbd>Espacio</kbd> saltar</li>
    <li><kbd>Shift</kbd> correr</li>
    <li><kbd>Clic</kbd> golpear (mantener para repetir)</li>
    <li><kbd>Esc</kbd> pausa</li>
  </ul>`

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent: HTMLElement) => {
  const node = document.createElement(tag)
  node.className = className
  parent.appendChild(node)
  return node
}

/** HUD en DOM. Solo toca el DOM cuando cambia un valor visible. */
export class Hud {
  private healthFill: HTMLElement
  private staminaBar: HTMLElement
  private staminaFill: HTMLElement
  private prompt: HTMLElement
  private slots: { root: HTMLElement; icon: HTMLElement; count: HTMLElement }[] = []
  private overlay: HTMLElement
  private overlayTitle: HTMLElement
  private last = { health: -1, stamina: -1, exhausted: false, prompt: '' }

  constructor(container: HTMLElement, onOverlayClick: () => void) {
    const root = el('div', 'hud', container)
    el('div', 'crosshair', root)
    this.prompt = el('div', 'prompt', root)

    const bars = el('div', 'bars', root)
    this.healthFill = el('div', 'fill', el('div', 'bar health', bars))
    this.staminaBar = el('div', 'bar stamina', bars)
    this.staminaFill = el('div', 'fill', this.staminaBar)

    const hotbar = el('div', 'hotbar', root)
    for (let i = 0; i < SLOT_COUNT; i++) {
      const slot = el('div', 'slot', hotbar)
      this.slots.push({ root: slot, icon: el('div', 'icon', slot), count: el('span', 'count', slot) })
    }

    this.overlay = el('div', 'overlay', container)
    const panel = el('div', 'panel', this.overlay)
    el('h1', 'title', panel).textContent = 'muck-web'
    this.overlayTitle = el('p', 'action', panel)
    panel.insertAdjacentHTML('beforeend', CONTROLS)
    if (!matchMedia('(any-pointer: fine)').matches) {
      el('p', 'warning', panel).textContent = 'Necesitas teclado y ratón para jugar.'
    }
    this.overlay.addEventListener('click', onOverlayClick)
    this.showOverlay('menu')
  }

  showOverlay(kind: OverlayKind) {
    this.overlay.hidden = kind === null
    if (kind) this.overlayTitle.textContent = OVERLAY_TEXT[kind]
  }

  setHealth(value: number, max: number) {
    const v = Math.round(value)
    if (v === this.last.health) return
    this.last.health = v
    this.healthFill.style.transform = `scaleX(${v / max})`
  }

  setStamina(value: number, max: number, exhausted: boolean) {
    const v = Math.round(value)
    if (v !== this.last.stamina) {
      this.last.stamina = v
      this.staminaFill.style.transform = `scaleX(${v / max})`
    }
    if (exhausted !== this.last.exhausted) {
      this.last.exhausted = exhausted
      this.staminaBar.classList.toggle('exhausted', exhausted)
    }
  }

  setTarget(prop: PropData | null) {
    let text = ''
    if (prop) {
      const def = PROP_DEFS[prop.kind]
      text = `${def.name} ${'▮'.repeat(prop.hp)}${'▯'.repeat(prop.maxHp - prop.hp)} — clic para ${def.verb}`
    }
    if (text === this.last.prompt) return
    this.last.prompt = text
    this.prompt.textContent = text
    this.prompt.hidden = !text
  }

  setInventory(inventory: Inventory) {
    this.slots.forEach((slot, i) => {
      const item = inventory.slots[i]
      slot.root.classList.toggle('filled', !!item)
      slot.root.title = item ? ITEM_NAMES[item] : ''
      slot.icon.innerHTML = item ? ICONS[item] : ''
      slot.count.textContent = item ? String(inventory.count(item)) : ''
    })
  }
}
