import { INVENTORY_KEYS } from '../game/actions'
import { INVENTORY_SIZE, ITEM_NAMES, SLOT_COUNT, type Inventory, type ItemId } from '../sim/inventory'
import { ICONS } from './icons'

/** Teclas que cierran la pantalla y vuelven a jugar: las que la abren (Tab y E) y la del crafteo (C). */
const CLOSE_KEYS: ReadonlySet<string> = new Set([...INVENTORY_KEYS, 'KeyC'])
/** Con la pantalla abierta no hacen nada: no deben pulsar lo que tenga el foco ni llegar al juego. */
const BLOCKED_KEYS: ReadonlySet<string> = new Set(['Space', 'Enter', 'NumpadEnter'])

const PICK_HINT = 'Clic en una casilla y en otra para intercambiarlas'

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent: HTMLElement) => {
  const node = document.createElement(tag)
  node.className = className
  parent.appendChild(node)
  return node
}

interface SlotView {
  root: HTMLElement
  icon: HTMLElement
  count: HTMLElement
  /** Lo que muestra ahora (para no rehacer el SVG si no cambia). */
  item: ItemId | null | undefined
}

/**
 * Pantalla de inventario (Tab o E): la mochila (2 × 9) encima de la hotbar (1 × 9). Un clic elige una casilla y otro
 * en otra las intercambia (`onmove`, que en el juego es la acción `move`). Abierta tiene su propio teclado: Tab, E y
 * C cierran (`onclose`, que recaptura el ratón dentro del propio evento, que cuenta como gesto del usuario) y Esc
 * pausa (`onescape`: no cuenta como gesto y no puede recapturarlo).
 */
export class InventoryScreen {
  onmove: ((from: number, to: number) => void) | null = null
  onclose: (() => void) | null = null
  onescape: (() => void) | null = null
  private root: HTMLElement
  private slots: SlotView[] = []
  private label: HTMLElement
  private inventory: Inventory | null = null
  /** La casilla elegida con el primer clic, a la espera del segundo. */
  private picked: number | null = null

  constructor(parent: HTMLElement) {
    this.root = el('div', 'inventory', parent)
    this.root.hidden = true
    const panel = el('div', 'inventory-panel', this.root)
    el('h2', 'title', panel).textContent = 'Inventario'
    const backpack = el('div', 'inventory-grid', panel)
    const hotbar = el('div', 'inventory-grid hotbar-row', panel)
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      const root = el('div', 'slot', i < SLOT_COUNT ? hotbar : backpack)
      if (i < SLOT_COUNT) el('span', 'key', root).textContent = String(i + 1)
      root.addEventListener('click', () => this.click(i))
      this.slots.push({ root, icon: el('div', 'icon', root), count: el('span', 'count', root), item: undefined })
    }
    this.label = el('p', 'label', panel)
    el('p', 'hint', panel).textContent = 'Tab, E o C: volver al juego · Esc: pausa'
    // Con el ratón suelto el clic derecho abriría el menú del navegador.
    this.root.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  get open(): boolean {
    return !this.root.hidden
  }

  setOpen(open: boolean) {
    if (open === this.open) return
    this.root.hidden = !open
    this.picked = null
    if (open) window.addEventListener('keydown', this.onKey)
    else window.removeEventListener('keydown', this.onKey)
    this.render()
  }

  setInventory(inventory: Inventory) {
    this.inventory = inventory
    if (this.open) this.render()
  }

  private onKey = (e: KeyboardEvent) => {
    if (CLOSE_KEYS.has(e.code)) {
      // Tab movería el foco. Mantener la tecla no cierra y abre: la autorrepetición no cuenta.
      e.preventDefault()
      if (!e.repeat) this.onclose?.()
    } else if (e.code === 'Escape') {
      if (!e.repeat) this.onescape?.()
    } else if (BLOCKED_KEYS.has(e.code)) {
      e.preventDefault()
    }
  }

  private click(i: number) {
    const from = this.picked
    this.picked = from === null ? i : null
    // Dos vacías no cambian nada: no se manda.
    if (from !== null && from !== i && this.inventory && this.inventory.slots[from] !== this.inventory.slots[i]) this.onmove?.(from, i)
    this.render()
  }

  private render() {
    const inventory = this.inventory
    if (!inventory) return
    this.slots.forEach((slot, i) => {
      const item = inventory.slots[i] ?? null
      if (item !== slot.item) {
        slot.item = item
        slot.root.classList.toggle('filled', !!item)
        slot.root.title = item ? ITEM_NAMES[item] : ''
        slot.icon.innerHTML = item ? ICONS[item] : ''
      }
      slot.count.textContent = item ? String(inventory.count(item)) : ''
      slot.root.classList.toggle('selected', i === inventory.selected)
      slot.root.classList.toggle('picked', i === this.picked)
    })
    const picked = this.picked === null ? undefined : inventory.slots[this.picked]
    this.label.textContent =
      picked === undefined ? PICK_HINT : `${picked ? ITEM_NAMES[picked] : 'Casilla vacía'}: clic en otra casilla para intercambiarlas`
  }
}
