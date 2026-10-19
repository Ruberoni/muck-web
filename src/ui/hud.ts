import { ENEMY_DEF, PROP_DEFS } from '../game/constants'
import { canCraft, RECIPES } from '../game/crafting'
import { ITEM_NAMES, SLOT_COUNT, type Inventory, type ItemId } from '../game/inventory'
import type { Target } from '../game/interaction'

const HANDLE = `<polygon points="7,28 10,29.5 22,8 19,6.5" fill="#8a5a32"/>`
const axe = (head: string, edge: string) =>
  `<svg viewBox="0 0 32 32">${HANDLE}<polygon points="16,7 22,3 29,9 27,15 21,11" fill="${head}"/><polygon points="22,3 29,9 27,15" fill="${edge}"/></svg>`
const pickaxe = (head: string, edge: string) =>
  `<svg viewBox="0 0 32 32">${HANDLE}<polygon points="5,12 11,6 20,3 29,5 30,9 21,7 12,9" fill="${head}"/><polygon points="5,12 11,6 12,9" fill="${edge}"/><polygon points="29,5 30,9 25,7.5" fill="${edge}"/></svg>`

const ICONS: Record<ItemId, string> = {
  wood: `<svg viewBox="0 0 32 32"><rect x="4" y="9" width="24" height="14" rx="3" fill="#8a5a32"/><ellipse cx="26" cy="16" rx="4" ry="7" fill="#d9a86a"/><ellipse cx="26" cy="16" rx="2" ry="3.5" fill="#b07b45"/></svg>`,
  stone: `<svg viewBox="0 0 32 32"><polygon points="6,22 10,10 20,6 27,14 25,24 14,27" fill="#9a978a"/><polygon points="10,10 20,6 18,15" fill="#b8b5a8"/><polygon points="18,15 27,14 25,24" fill="#7c796e"/></svg>`,
  berry: `<svg viewBox="0 0 32 32"><path d="M16 9 Q18 4 23 4 Q21 8 16 9" fill="#3d7d35"/><circle cx="11" cy="19" r="6" fill="#c2304a"/><circle cx="21" cy="20" r="6" fill="#a8243d"/><circle cx="16" cy="12" r="5.5" fill="#d63d58"/><circle cx="14.5" cy="10.5" r="1.5" fill="#f2a0ad"/></svg>`,
  wood_axe: axe('#d9a86a', '#b07b45'),
  wood_pickaxe: pickaxe('#d9a86a', '#b07b45'),
  stone_axe: axe('#b8b5a8', '#7c796e'),
  stone_pickaxe: pickaxe('#b8b5a8', '#7c796e'),
  raw_meat: `<svg viewBox="0 0 32 32"><rect x="20" y="17" width="9" height="4" rx="2" transform="rotate(35 24 19)" fill="#efe6d2"/><path d="M5 15 Q6 6 15 6 Q24 7 23 15 Q22 24 13 25 Q4 24 5 15" fill="#d9566a"/><path d="M9 14 Q11 9 16 10" stroke="#f2a0ad" stroke-width="2" fill="none"/><circle cx="14" cy="17" r="2.5" fill="#f4e2c8"/></svg>`,
}

export type OverlayKind = 'menu' | 'paused' | 'retry' | 'dead' | null

const OVERLAY_TEXT: Record<Exclude<OverlayKind, null>, string> = {
  menu: 'Haz clic para jugar',
  paused: 'Pausa — haz clic para continuar',
  retry: 'No se pudo capturar el ratón. Haz clic de nuevo',
  dead: 'Has muerto — haz clic para empezar de nuevo',
}

const CONTROLS = `
  <ul class="controls">
    <li><kbd>WASD</kbd> moverse</li>
    <li><kbd>Ratón</kbd> mirar</li>
    <li><kbd>Espacio</kbd> saltar</li>
    <li><kbd>Shift</kbd> correr</li>
    <li><kbd>Clic</kbd> golpear (mantener para repetir)</li>
    <li><kbd>F</kbd> comer bayas</li>
    <li><kbd>1–9</kbd> elegir casilla</li>
    <li><kbd>C</kbd> crafteo (con él abierto, 1–4 fabrica)</li>
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
  private hungerBar: HTMLElement
  private hungerFill: HTMLElement
  private staminaBar: HTMLElement
  private staminaFill: HTMLElement
  private prompt: HTMLElement
  private day: HTMLElement
  private slots: { root: HTMLElement; icon: HTMLElement; count: HTMLElement }[] = []
  private held: HTMLElement
  private crafting: HTMLElement
  private recipes: HTMLElement[] = []
  private hurt: HTMLElement
  private overlay: HTMLElement
  private overlayTitle: HTMLElement
  private last = { health: -1, hunger: -1, stamina: -1, exhausted: false, prompt: '', day: 0 }

  constructor(container: HTMLElement, onOverlayClick: () => void) {
    const root = el('div', 'hud', container)
    this.hurt = el('div', 'hurt', root)
    el('div', 'crosshair', root)
    this.prompt = el('div', 'prompt', root)
    this.day = el('div', 'day', root)

    const bars = el('div', 'bars', root)
    this.healthFill = el('div', 'fill', el('div', 'bar health', bars))
    this.hungerBar = el('div', 'bar hunger', bars)
    this.hungerFill = el('div', 'fill', this.hungerBar)
    this.staminaBar = el('div', 'bar stamina', bars)
    this.staminaFill = el('div', 'fill', this.staminaBar)

    const dock = el('div', 'dock', root)
    this.held = el('div', 'held', dock)
    const hotbar = el('div', 'hotbar', dock)
    for (let i = 0; i < SLOT_COUNT; i++) {
      const slot = el('div', 'slot', hotbar)
      el('span', 'key', slot).textContent = String(i + 1)
      this.slots.push({ root: slot, icon: el('div', 'icon', slot), count: el('span', 'count', slot) })
    }

    this.crafting = el('div', 'crafting', root)
    el('h2', 'title', this.crafting).textContent = 'Crafteo'
    RECIPES.forEach((recipe, i) => {
      const row = el('div', 'recipe', this.crafting)
      el('kbd', '', row).textContent = String(i + 1)
      el('div', 'icon', row).innerHTML = ICONS[recipe.result]
      el('span', 'name', row).textContent = ITEM_NAMES[recipe.result]
      el('span', 'cost', row).textContent = recipe.cost.map(({ item, amount }) => `${amount} ${ITEM_NAMES[item].toLowerCase()}`).join(' + ')
      this.recipes.push(row)
    })
    el('p', 'hint', this.crafting).textContent = 'C para cerrar'
    this.crafting.hidden = true

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
    this.overlay.classList.toggle('dead', kind === 'dead')
    if (kind) this.overlayTitle.textContent = OVERLAY_TEXT[kind]
  }

  setHealth(value: number, max: number) {
    const v = Math.ceil(value)
    if (v === this.last.health) return
    this.last.health = v
    this.healthFill.style.transform = `scaleX(${v / max})`
  }

  setHunger(value: number, max: number) {
    // ceil, como la vida: la barra no se vacía hasta que el hambre llega de verdad a 0.
    const v = Math.ceil(value)
    if (v === this.last.hunger) return
    this.last.hunger = v
    this.hungerFill.style.transform = `scaleX(${v / max})`
    this.hungerBar.classList.toggle('starving', v === 0)
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

  setTarget(target: Target | null) {
    let text = ''
    if (target) {
      const def = target.kind === 'enemy' ? ENEMY_DEF : PROP_DEFS[target.kind]
      const hp = target.maxHp > 1 ? ` ${'▮'.repeat(target.hp)}${'▯'.repeat(target.maxHp - target.hp)}` : ''
      text = `${def.name}${hp} — clic para ${def.verb}`
    }
    if (text === this.last.prompt) return
    this.last.prompt = text
    this.prompt.textContent = text
    this.prompt.hidden = !text
  }

  /** Destello rojo en los bordes al recibir daño. */
  flashHurt() {
    this.hurt.classList.remove('active')
    // Forzar reflow para que la animación vuelva a empezar aunque siga activa.
    void this.hurt.offsetWidth
    this.hurt.classList.add('active')
  }

  setCrafting(open: boolean) {
    this.crafting.hidden = !open
  }

  setInventory(inventory: Inventory) {
    this.slots.forEach((slot, i) => {
      const item = inventory.slots[i]
      slot.root.classList.toggle('filled', !!item)
      slot.root.classList.toggle('selected', i === inventory.selected)
      slot.root.title = item ? ITEM_NAMES[item] : ''
      slot.icon.innerHTML = item ? ICONS[item] : ''
      slot.count.textContent = item ? String(inventory.count(item)) : ''
    })
    const held = inventory.selectedItem
    this.held.textContent = held ? ITEM_NAMES[held] : ''
    RECIPES.forEach((recipe, i) => this.recipes[i].classList.toggle('available', canCraft(inventory, recipe)))
  }
  setDay(day: number) {
    if (day === this.last.day) return
    this.last.day = day
    this.day.textContent = `Día ${day}`
  }
}
