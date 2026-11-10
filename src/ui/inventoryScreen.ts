import { type InventoryFocus } from '../game/actions'
import { binds, bindingLabel, DEFAULT_BINDINGS, type Bindings } from '../game/bindings'
import type { CraftWorld, Recipe, RecipeId } from '../sim/crafting'
import { INVENTORY_SIZE, ITEM_NAMES, SLOT_COUNT, type Inventory, type ItemId } from '../sim/inventory'
import type { Vec3 } from '../sim/player'
import { ICONS } from './icons'
import { CRAFT_MANY, RECIPE_GROUPS, recipeStatus, STATION_NAMES } from './recipes'
import type { ActionData } from '../sim/commands'
import { slotFor, STATION_DEFS, STATION_SLOTS, stationStall, type StationSlot } from '../sim/stations'
import type { Structure } from '../sim/structures'
import { EQUIP_SLOTS, equipSlotOf, type EquipSlot } from '../sim/equipment'
import { buyProblem, OFFERS, priceOf, PURCHASES, sellProblem } from '../sim/merchant'

const EQUIP_SLOT_NAMES: Record<EquipSlot, string> = { chest: 'Pecho', shield: 'Escudo' }
const PURCHASE_ITEMS = Object.keys(PURCHASES) as ItemId[]

const STATION_SLOT_NAMES: Record<StationSlot, string> = { input: 'Entrada', fuel: 'Combustible', output: 'Salida' }
const STATION_HINT = 'Clic en una casilla: meter la pila · Clic derecho: meter una · Arrastrar a una ranura · Clic en una ranura: sacarla'

/** Con la pantalla abierta no hacen nada: no deben pulsar lo que tenga el foco ni llegar al juego. */
const BLOCKED_KEYS: ReadonlySet<string> = new Set(['Space', 'Enter', 'NumpadEnter'])

/** La ayuda de la pantalla, nombrando la tecla que se haya asignado para tirar. */
function pickHint(b: Bindings) {
  const drop = bindingLabel(b.drop)
  return `Clic en una casilla y en otra, o arrastrar: intercambiarlas · 1–9 con el ratón encima: a esa casilla de la hotbar · ${drop}: tirar uno · Ctrl + ${drop}: todos · Mayúsculas + clic en un peto o un escudo, o arrastrarlo a su hueco: ponérselo`
}

/** La casilla de la hotbar que nombra una tecla (1–9), o null si no es una de ellas. */
export function hotbarSlotOf(code: string): number | null {
  const match = /^Digit([1-9])$/.exec(code)
  return match && Number(match[1]) <= SLOT_COUNT ? Number(match[1]) - 1 : null
}

/** Si intercambiar dos casillas cambia algo: no si es la misma, ni si las dos tienen lo mismo (dos vacías). */
export const changesSlots = (slots: readonly (ItemId | null)[], from: number, to: number) => from !== to && (slots[from] ?? null) !== (slots[to] ?? null)

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
 * acción `move`), y lo mismo arrastrando una sobre otra; con el ratón encima de una, 1–9 la intercambia con esa casilla de
 * la hotbar, como en Minecraft. Q tira uno de la casilla bajo el ratón y Ctrl + Q la pila (`ondrop`, la acción `drop`). A la derecha, todas las recetas por estación, con lo que falta en rojo y el motivo si no se puede:
 * un clic fabrica una y Mayúsculas + clic, hasta CRAFT_MANY (`oncraft`; el juego solo manda las que su predicción da
 * por buenas). Las filas no son enfocables, para que Espacio o Enter no repitan una receta. Abierta tiene su propio
 * teclado: Tab, E y C cierran (`onclose`, que recaptura el ratón dentro del propio evento, que cuenta como gesto del
 * usuario) y Esc pausa (`onescape`: no cuenta como gesto y no puede recapturarlo).
 */
export class InventoryScreen {
  onmove: ((from: number, to: number) => void) | null = null
  ondrop: ((slot: number, all: boolean) => void) | null = null
  oncraft: ((recipe: RecipeId, times: number) => void) | null = null
  onclose: (() => void) | null = null
  onescape: (() => void) | null = null
  onstation: ((action: Extract<ActionData, { kind: 'station' }>) => void) | null = null
  onequip: ((action: Extract<ActionData, { kind: 'equip' | 'unequip' }>) => void) | null = null
  onshop: ((action: Extract<ActionData, { kind: 'shop' }>) => void) | null = null
  /** Teclas asignadas: de aquí salen las que cierran la pantalla, la que tira y la que nombra la ayuda. */
  private bindings: Bindings = { ...DEFAULT_BINDINGS }
  private root: HTMLElement
  private slots: SlotView[] = []
  private recipes: RecipeView[] = []
  private recipesColumn: HTMLElement
  private label: HTMLElement
  private inventory: Inventory | null = null
  /** La casilla elegida con el primer clic, a la espera del segundo. */
  private picked: number | null = null
  /** La casilla bajo el ratón: la que tira Q y la que mueven los números. */
  private hovered: number | null = null
  /** La casilla que se está arrastrando. */
  private dragged: number | null = null
  /** La estación abierta: sus ranuras sustituyen a las recetas. */
  private station: Structure | null = null
  private stationColumn: HTMLElement
  private stationTitle: HTMLElement
  private stationSlots = new Map<StationSlot, SlotView>()
  private stationBars: { progress: HTMLElement; burn: HTMLElement; fuelRow: HTMLElement }
  /** Por qué no trabaja la estación abierta. */
  private stationStall: HTMLElement
  /** Lo que se lleva puesto: un clic lo quita. */
  private equipSlots = new Map<EquipSlot, SlotView>()
  /** El puesto del mercader abierto: su tienda sustituye a las recetas. */
  private shop: Structure | null = null
  private shopColumn!: HTMLElement
  private shopCoins!: HTMLElement
  private shopList!: HTMLElement
  private shopTabs!: { buy: HTMLElement; sell: HTMLElement }
  private shopMode: 'buy' | 'sell' = 'buy'
  /** Lo que enseña ahora la tienda, como texto (para no rehacerla si no cambia). */
  private shopKey = ''

  constructor(parent: HTMLElement) {
    this.root = el('div', 'inventory', parent)
    this.root.hidden = true
    const panel = el('div', 'inventory-panel', this.root)
    const slotsColumn = el('div', 'inventory-slots', panel)
    el('h2', 'title', slotsColumn).textContent = 'Inventario'
    const equipment = el('div', 'inventory-equipment', slotsColumn)
    for (const which of EQUIP_SLOTS) {
      const root = el('div', 'slot equip-slot', equipment)
      el('span', 'equip-slot-name', root).textContent = EQUIP_SLOT_NAMES[which]
      root.addEventListener('click', () => {
        if (!this.inventory?.equipped[which]) return
        this.picked = null
        this.onequip?.({ kind: 'unequip', which })
      })
      root.addEventListener('dragover', (e) => {
        if (this.dragged !== null && equipSlotOf(this.inventory?.slots[this.dragged]) === which) e.preventDefault()
      })
      root.addEventListener('drop', (e) => {
        e.preventDefault()
        const from = this.dragged
        this.dragged = null
        if (from !== null && equipSlotOf(this.inventory?.slots[from]) === which) this.onequip?.({ kind: 'equip', slot: from })
      })
      this.equipSlots.set(which, { root, icon: el('div', 'icon', root), count: el('span', 'count', root), item: undefined })
    }
    const backpack = el('div', 'inventory-grid', slotsColumn)
    const hotbar = el('div', 'inventory-grid hotbar-row', slotsColumn)
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      const root = el('div', 'slot', i < SLOT_COUNT ? hotbar : backpack)
      if (i < SLOT_COUNT) el('span', 'key', root).textContent = String(i + 1)
      root.addEventListener('click', (e) => {
        // Con una estación abierta, un clic en lo que procesa o quema lo mete (sin casilla elegida a medias).
        if (this.station && (e.shiftKey || this.picked === null) && this.toStation(i, true)) return
        if (!(e.shiftKey && this.equip(i))) this.click(i)
      })
      root.addEventListener('contextmenu', () => this.station && this.toStation(i, false))
      root.addEventListener('mouseenter', () => (this.hovered = i))
      root.addEventListener('mouseleave', () => {
        if (this.hovered === i) this.hovered = null
      })
      root.addEventListener('dragstart', (e) => {
        if (!this.inventory?.slots[i]) return e.preventDefault()
        this.dragged = i
        this.picked = null
        e.dataTransfer?.setData('text/plain', String(i))
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
        root.classList.add('dragging')
      })
      // Sin esto el navegador no deja soltar encima.
      root.addEventListener('dragover', (e) => {
        if (this.dragged !== null) e.preventDefault()
      })
      root.addEventListener('drop', (e) => {
        e.preventDefault()
        const from = this.dragged
        this.dragged = null
        if (from !== null) this.move(from, i)
      })
      root.addEventListener('dragend', () => {
        this.dragged = null
        root.classList.remove('dragging')
        this.render()
      })
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

    this.stationColumn = el('div', 'inventory-station', panel)
    this.stationColumn.hidden = true
    this.stationTitle = el('h2', 'title', this.stationColumn)
    const machine = el('div', 'station-machine', this.stationColumn)
    const progressTrack = el('div', 'station-bar', machine)
    const fuelRow = el('div', 'station-fuel', this.stationColumn)
    const burnTrack = el('div', 'station-bar burn', fuelRow)
    for (const slot of STATION_SLOTS) {
      const parent = slot === 'fuel' ? fuelRow : machine
      const root = document.createElement('div')
      root.className = 'slot station-slot'
      parent.insertBefore(root, slot === 'output' ? null : slot === 'fuel' ? burnTrack : progressTrack)
      el('span', 'station-slot-name', root).textContent = STATION_SLOT_NAMES[slot]
      root.addEventListener('click', () => this.station && this.onstation?.({ kind: 'station', id: this.station.id, slot, from: null, all: true }))
      root.addEventListener('dragover', (e) => {
        if (this.dragged !== null) e.preventDefault()
      })
      root.addEventListener('drop', (e) => {
        e.preventDefault()
        const from = this.dragged
        this.dragged = null
        if (from !== null && this.station && this.inventory?.slots[from]) this.onstation?.({ kind: 'station', id: this.station.id, slot, from, all: true })
      })
      this.stationSlots.set(slot, { root, icon: el('div', 'icon', root), count: el('span', 'count', root), item: undefined })
    }
    this.stationBars = { progress: el('div', 'fill', progressTrack), burn: el('div', 'fill', burnTrack), fuelRow }
    this.stationStall = el('p', 'station-stall', this.stationColumn)
    el('p', 'hint', this.stationColumn).textContent = STATION_HINT

    this.buildShop(panel)

    el('p', 'hint inventory-keys', panel).textContent = 'Tab, E o C: volver al juego · Esc: pausa · W A S D: andar'
    // Con el ratón suelto el clic derecho abriría el menú del navegador.
    this.root.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  get open(): boolean {
    return !this.root.hidden
  }

  /** Cambia las teclas (desde los ajustes) y repinta la ayuda si la pantalla está abierta. */
  setBindings(bindings: Bindings) {
    this.bindings = bindings
    if (this.open) this.render()
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

  /**
   * La estación abierta (o null): con una de procesar se ven sus ranuras en vez de las recetas. Se llama cada frame con
   * la pantalla abierta, con la estación tal como está ahora.
   */
  setStation(station: Structure | null, canForget = false) {
    this.setShop(station?.shop ? station : null, canForget)
    const showing = station?.station ? station : null
    if (showing?.id !== this.station?.id) this.dragged = null
    this.station = showing
    this.stationColumn.hidden = !showing
    this.recipesColumn.hidden = !!showing || !!this.shop
    if (!showing?.station) return
    this.stationTitle.textContent = STATION_NAMES[showing.kind]
    const { station: state } = showing
    for (const [slot, view] of this.stationSlots) {
      const stack = state[slot]
      const item = stack?.item ?? null
      if (item !== view.item) {
        view.item = item
        view.root.classList.toggle('filled', !!item)
        view.root.title = item ? ITEM_NAMES[item] : STATION_SLOT_NAMES[slot]
        view.icon.innerHTML = item ? ICONS[item] : ''
      }
      view.count.textContent = stack ? String(stack.amount) : ''
    }
    this.stationBars.fuelRow.hidden = !STATION_DEFS[showing.kind]?.fuel
    const stall = stationStall(showing.kind, state)
    this.stationStall.textContent = stall ?? ''
    this.stationStall.hidden = !stall
    this.stationBars.progress.style.width = `${state.time > 0 ? Math.min(100, (state.progress / state.time) * 100) : 0}%`
    this.stationBars.burn.style.width = `${Math.min(100, (state.burn / 60) * 100)}%`
  }

  private buildShop(panel: HTMLElement) {
    this.shopColumn = el('div', 'inventory-shop', panel)
    this.shopColumn.hidden = true
    el('h2', 'title', this.shopColumn).textContent = 'Mercader'
    this.shopCoins = el('p', 'shop-coins', this.shopColumn)
    const tabs = el('div', 'shop-tabs', this.shopColumn)
    const tab = (mode: 'buy' | 'sell', text: string) => {
      const button = el('button', 'shop-tab', tabs)
      button.type = 'button'
      button.textContent = text
      button.tabIndex = -1
      button.addEventListener('click', () => {
        this.shopMode = mode
        this.shopKey = ''
      })
      return button
    }
    this.shopTabs = { buy: tab('buy', 'Comprar'), sell: tab('sell', 'Vender') }
    this.shopList = el('div', 'recipe-list shop-list', this.shopColumn)
    el('p', 'hint', this.shopColumn).textContent = 'Clic: comprar o vender uno'
  }

  /** El puesto abierto (o null): se llama cada frame con la pantalla abierta. `canForget`: si el amuleto haría algo. */
  private setShop(shop: Structure | null, canForget: boolean) {
    this.shop = shop
    this.shopColumn.hidden = !shop
    const inventory = this.inventory
    if (!shop?.shop || !inventory) return
    const state = shop.shop
    const coins = inventory.count('coin')
    const key = `${this.shopMode}|${coins}|${canForget}|${JSON.stringify(state.bought)}|${inventory.slots.join()}|${PURCHASE_ITEMS.map((i) => inventory.count(i)).join()}`
    if (key === this.shopKey) return
    this.shopKey = key
    this.shopCoins.textContent = `Monedas: ${coins}`
    this.shopTabs.buy.classList.toggle('active', this.shopMode === 'buy')
    this.shopTabs.sell.classList.toggle('active', this.shopMode === 'sell')
    const rows: HTMLElement[] = []
    const row = (item: ItemId, cost: string, problem: string | null, onclick: () => void) => {
      const root = document.createElement('div')
      root.className = 'recipe'
      root.classList.toggle('available', !problem)
      root.title = ITEM_NAMES[item]
      el('div', 'icon', root).innerHTML = ICONS[item]
      el('span', 'name', root).textContent = ITEM_NAMES[item]
      el('span', 'cost', root).textContent = cost
      const reason = el('span', 'reason', root)
      reason.textContent = problem ?? ''
      reason.hidden = !problem
      root.addEventListener('click', () => {
        if (!problem) onclick()
      })
      rows.push(root)
    }
    if (this.shopMode === 'buy') {
      for (const offer of OFFERS) {
        const available = offer.item !== 'forget_amulet' || canForget
        const price = priceOf(offer, state)
        row(offer.item, `${price} monedas${offer.rise ? ' · sube con cada compra' : ''}`, buyProblem(offer, state, inventory, available), () =>
          this.onshop?.({ kind: 'shop', id: shop.id, op: 'buy', item: offer.item }),
        )
      }
    } else {
      for (const item of PURCHASE_ITEMS) {
        const deal = PURCHASES[item]!
        row(item, `${deal.amount} por ${deal.coins} ${deal.coins === 1 ? 'moneda' : 'monedas'} · tienes ${inventory.count(item)}`, sellProblem(item, inventory), () =>
          this.onshop?.({ kind: 'shop', id: shop.id, op: 'sell', item }),
        )
      }
    }
    this.shopList.replaceChildren(...rows)
  }

  /** Se pone lo de la casilla `i` si es un peto o un escudo; devuelve si lo era. */
  private equip(i: number): boolean {
    if (!equipSlotOf(this.inventory?.slots[i])) return false
    this.picked = null
    this.onequip?.({ kind: 'equip', slot: i })
    this.render()
    return true
  }

  /**
   * Mete en la estación abierta lo de la casilla `i`, en la ranura que le toca (la pila con `all`, si no una). Devuelve
   * si la estación lo acepta.
   */
  private toStation(i: number, all: boolean): boolean {
    const item = this.inventory?.slots[i]
    const target = item && this.station ? slotFor(this.station.kind, item) : null
    if (!target || !this.station) return false
    this.picked = null
    this.onstation?.({ kind: 'station', id: this.station.id, slot: target, from: i, all })
    this.render()
    return true
  }

  setInventory(inventory: Inventory) {
    this.inventory = inventory
    if (this.open) this.render()
  }

  private onKey = (e: KeyboardEvent) => {
    const b = this.bindings
    // Cierran la pantalla las teclas que la abren. Tab movería el foco. Mantener la tecla no cierra y abre: la
    // autorrepetición no cuenta.
    if (binds(b.inventory, e.code) || binds(b.recipes, e.code)) {
      e.preventDefault()
      if (!e.repeat) this.onclose?.()
    } else if (e.code === 'Escape') {
      if (!e.repeat) this.onescape?.()
    } else if (hotbarSlotOf(e.code) !== null) {
      e.preventDefault()
      const from = this.hovered
      if (e.repeat || from === null) return
      this.picked = null
      this.move(from, hotbarSlotOf(e.code)!)
    } else if (binds(b.drop, e.code)) {
      const slot = this.hovered
      if (e.repeat || slot === null || !this.inventory?.slots[slot]) return
      e.preventDefault()
      // Lo que se iba a intercambiar puede dejar de estar: se empieza de nuevo.
      this.picked = null
      this.ondrop?.(slot, e.ctrlKey)
      this.render()
    } else if (BLOCKED_KEYS.has(e.code) || binds(b.jump, e.code)) {
      e.preventDefault()
    }
  }

  private click(i: number) {
    const from = this.picked
    this.picked = from === null ? i : null
    if (from !== null) this.move(from, i)
    else this.render()
  }

  /** Intercambia dos casillas si cambia algo: lo que no cambia no se manda. */
  private move(from: number, to: number) {
    if (this.inventory && changesSlots(this.inventory.slots, from, to)) this.onmove?.(from, to)
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
        slot.root.draggable = !!item
      }
      slot.count.textContent = item ? String(inventory.count(item)) : ''
      slot.root.classList.toggle('selected', i === inventory.selected)
      slot.root.classList.toggle('picked', i === this.picked)
    })
    for (const [which, view] of this.equipSlots) {
      const item = inventory.equipped[which]
      if (item === view.item) continue
      view.item = item
      view.root.classList.toggle('filled', !!item)
      view.root.title = item ? `${ITEM_NAMES[item]} · clic: quitárselo` : EQUIP_SLOT_NAMES[which]
      view.icon.innerHTML = item ? ICONS[item] : ''
    }
    const picked = this.picked === null ? undefined : inventory.slots[this.picked]
    this.label.textContent =
      picked === undefined ? (this.station ? STATION_HINT : pickHint(this.bindings)) : `${picked ? ITEM_NAMES[picked] : 'Casilla vacía'}: clic en otra casilla para intercambiarlas`
  }
}
