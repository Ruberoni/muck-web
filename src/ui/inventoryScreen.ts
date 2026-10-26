import { INVENTORY_KEYS, RECIPES_KEY, type InventoryFocus } from '../game/actions'
import type { CraftWorld, Recipe, RecipeId } from '../sim/crafting'
import { INVENTORY_SIZE, ITEM_NAMES, SLOT_COUNT, type Inventory, type ItemId } from '../sim/inventory'
import type { Vec3 } from '../sim/player'
import { ICONS } from './icons'
import { CRAFT_MANY, RECIPE_GROUPS, recipeStatus } from './recipes'

/** Teclas que cierran la pantalla y vuelven a jugar: las que la abren (Tab, E y C). */
const CLOSE_KEYS: ReadonlySet<string> = new Set([...INVENTORY_KEYS, RECIPES_KEY])
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

interface RecipeView {
  recipe: Recipe
  root: HTMLElement
  /** Un span por ingrediente, en rojo si falta. */
  cost: HTMLElement[]
  reason: HTMLElement
  /** Lo que muestra ahora, como texto (para no tocar el DOM si no cambia). */
  key: string
}

/**
 * Pantalla de inventario (Tab o E; C la abre con las recetas a la vista). A la izquierda, la mochila (2 × 9) encima
 * de la hotbar (1 × 9): un clic elige una casilla y otro en otra las intercambia (`onmove`, que en el juego es la
 * acción `move`). A la derecha, todas las recetas por estación, con lo que falta en rojo y el motivo si no se puede:
 * un clic fabrica una y Mayúsculas + clic, hasta CRAFT_MANY (`oncraft`; el juego solo manda las que su predicción da
 * por buenas). Las filas no son enfocables, para que Espacio o Enter no repitan una receta. Abierta tiene su propio
 * teclado: Tab, E y C cierran (`onclose`, que recaptura el ratón dentro del propio evento, que cuenta como gesto del
 * usuario) y Esc pausa (`onescape`: no cuenta como gesto y no puede recapturarlo).
 */
export class InventoryScreen {
  onmove: ((from: number, to: number) => void) | null = null
  oncraft: ((recipe: RecipeId, times: number) => void) | null = null
  onclose: (() => void) | null = null
  onescape: (() => void) | null = null
  private root: HTMLElement
  private slots: SlotView[] = []
  private recipes: RecipeView[] = []
  private recipesColumn: HTMLElement
  private label: HTMLElement
  private inventory: Inventory | null = null
  /** La casilla elegida con el primer clic, a la espera del segundo. */
  private picked: number | null = null

  constructor(parent: HTMLElement) {
    this.root = el('div', 'inventory', parent)
    this.root.hidden = true
    const panel = el('div', 'inventory-panel', this.root)
    const slotsColumn = el('div', 'inventory-slots', panel)
    el('h2', 'title', slotsColumn).textContent = 'Inventario'
    const backpack = el('div', 'inventory-grid', slotsColumn)
    const hotbar = el('div', 'inventory-grid hotbar-row', slotsColumn)
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      const root = el('div', 'slot', i < SLOT_COUNT ? hotbar : backpack)
      if (i < SLOT_COUNT) el('span', 'key', root).textContent = String(i + 1)
      root.addEventListener('click', () => this.click(i))
      this.slots.push({ root, icon: el('div', 'icon', root), count: el('span', 'count', root), item: undefined })
    }
    this.label = el('p', 'label', slotsColumn)

    this.recipesColumn = el('div', 'inventory-recipes', panel)
    el('h2', 'title', this.recipesColumn).textContent = 'Crafteo'
    const list = el('div', 'recipe-list', this.recipesColumn)
    for (const group of RECIPE_GROUPS) {
      el('h3', 'recipe-group', list).textContent = group.title
      for (const recipe of group.recipes) {
        const root = el('div', 'recipe', list)
        root.title = ITEM_NAMES[recipe.result]
        el('div', 'icon', root).innerHTML = ICONS[recipe.result]
        el('span', 'name', root).textContent = ITEM_NAMES[recipe.result]
        const costLine = el('span', 'cost', root)
        const cost = recipe.cost.map(({ item, amount }, i) => {
          if (i > 0) costLine.append(' + ')
          const part = el('span', '', costLine)
          part.textContent = `${amount} ${ITEM_NAMES[item].toLowerCase()}`
          return part
        })
        const reason = el('span', 'reason', root)
        root.addEventListener('click', (e) => this.oncraft?.(recipe.id, e.shiftKey ? CRAFT_MANY : 1))
        this.recipes.push({ recipe, root, cost, reason, key: '' })
      }
    }
    el('p', 'hint', this.recipesColumn).textContent = `Clic: fabricar · Mayúsculas + clic: hasta ${CRAFT_MANY}`

    el('p', 'hint inventory-keys', panel).textContent = 'Tab, E o C: volver al juego · Esc: pausa'
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

  /** Con la pantalla abierta, lleva a la vista las casillas o las recetas (en pantallas estrechas van apiladas). */
  focus(focus: InventoryFocus) {
    const panel = this.recipesColumn.parentElement
    if (!panel) return
    if (focus === 'recipes') this.recipesColumn.scrollIntoView({ block: 'nearest' })
    else panel.scrollTop = 0
  }

  /**
   * Recalcula qué recetas se pueden fabricar. Se llama cada frame con la pantalla abierta: depende del inventario,
   * pero también de dónde está el jugador y de las estaciones que tenga cerca (`world`, el del filtro de envío).
   */
  updateRecipes(world: CraftWorld, pos: Vec3) {
    const inventory = this.inventory
    if (!inventory || !this.open) return
    for (const view of this.recipes) {
      const status = recipeStatus(inventory, view.recipe, world, pos)
      const key = `${status.reason}|${status.cost.map((c) => c.have >= c.amount).join()}`
      if (key === view.key) continue
      view.key = key
      view.root.classList.toggle('available', status.available)
      status.cost.forEach((c, i) => view.cost[i].classList.toggle('missing', c.have < c.amount))
      view.reason.textContent = status.reason ?? ''
      view.reason.hidden = !status.reason
    }
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
