export type ItemId = 'wood' | 'stone' | 'berry' | 'wood_axe' | 'wood_pickaxe' | 'stone_axe' | 'stone_pickaxe' | 'raw_meat' | 'campfire' | 'workbench'

export const ITEM_NAMES: Record<ItemId, string> = {
  wood: 'Madera',
  stone: 'Piedra',
  berry: 'Bayas',
  wood_axe: 'Hacha de madera',
  wood_pickaxe: 'Pico de madera',
  stone_axe: 'Hacha de piedra',
  stone_pickaxe: 'Pico de piedra',
  raw_meat: 'Carne cruda',
  campfire: 'Fogata',
  workbench: 'Mesa de trabajo',
}
// Casillas de la hotbar: una tecla numérica por casilla (1–9).
export const SLOT_COUNT = 9
/** Casillas del inventario: 0–8 son la hotbar y 9–26 la mochila. */
export const INVENTORY_SIZE = 27

/** Casilla a `steps` de `selected`, dando la vuelta al pasar de un extremo. */
export const cycleSlot = (selected: number, steps: number) => (((selected + steps) % SLOT_COUNT) + SLOT_COUNT) % SLOT_COUNT

/** Todo el inventario como datos: casillas, recuentos y selección. */
export interface InventoryState {
  slots: (ItemId | null)[]
  counts: Partial<Record<ItemId, number>>
  selected: number
}

export class Inventory {
  private counts = new Map<ItemId, number>()
  /**
   * Casillas: un objeto nuevo ocupa la primera libre (la hotbar antes que la mochila) y la deja libre al llegar a 0.
   * Cada tipo es una sola pila sin límite.
   */
  readonly slots: (ItemId | null)[]
  /** Casilla de la hotbar elegida. */
  selected = 0
  private listeners: (() => void)[] = []

  /** `size` solo cambia en las pruebas, para llenarlo con pocos objetos. */
  constructor(size = INVENTORY_SIZE) {
    this.slots = Array(size).fill(null)
  }

  /** Cabe si ya ocupa una casilla o queda alguna libre. */
  canAdd(item: ItemId): boolean {
    return this.counts.has(item) || this.slots.includes(null)
  }

  /** Devuelve false (sin añadir nada) si la cantidad no es positiva o no queda casilla libre. */
  add(item: ItemId, amount: number): boolean {
    if (amount <= 0 || !this.canAdd(item)) return false
    if (!this.counts.has(item)) this.slots[this.slots.indexOf(null)] = item
    this.counts.set(item, this.count(item) + amount)
    this.emit()
    return true
  }

  /** Quita la cantidad entera o nada: devuelve false si no hay suficiente. */
  remove(item: ItemId, amount: number): boolean {
    if (amount <= 0 || !this.has(item, amount)) return false
    const left = this.count(item) - amount
    if (left > 0) {
      this.counts.set(item, left)
    } else {
      this.counts.delete(item)
      this.slots[this.slots.indexOf(item)] = null
    }
    this.emit()
    return true
  }

  clear() {
    this.counts.clear()
    this.slots.fill(null)
    this.selected = 0
    this.emit()
  }

  has(item: ItemId, amount = 1): boolean {
    return this.count(item) >= amount
  }

  count(item: ItemId): number {
    return this.counts.get(item) ?? 0
  }

  /** Intercambia dos casillas. Devuelve false (sin avisar) si alguna no existe o no cambia nada (la misma, o dos vacías). */
  move(from: number, to: number): boolean {
    const valid = (i: number) => Number.isInteger(i) && i >= 0 && i < this.slots.length
    if (!valid(from) || !valid(to) || this.slots[from] === this.slots[to]) return false
    const item = this.slots[from]
    this.slots[from] = this.slots[to]
    this.slots[to] = item
    this.emit()
    return true
  }

  select(index: number) {
    if (index < 0 || index >= Math.min(SLOT_COUNT, this.slots.length) || index === this.selected) return
    this.selected = index
    this.emit()
  }

  /** Mueve la selección `steps` casillas, dando la vuelta al pasar de un extremo. */
  cycle(steps: number) {
    this.select(cycleSlot(this.selected, steps))
  }

  /** Objeto de la casilla seleccionada; null si está vacía. */
  get selectedItem(): ItemId | null {
    return this.slots[this.selected]
  }

  onChange(listener: () => void) {
    this.listeners.push(listener)
  }

  toJSON(): Partial<Record<ItemId, number>> {
    return Object.fromEntries(this.counts)
  }

  save(): InventoryState {
    return { slots: [...this.slots], counts: this.toJSON(), selected: this.selected }
  }

  /** Solo avisa si el contenido cambia: el cliente en red copia el suyo del servidor 20 veces por segundo. */
  load(state: InventoryState) {
    const before = this.key()
    this.counts = new Map(Object.entries(state.counts) as [ItemId, number][])
    for (let i = 0; i < this.slots.length; i++) this.slots[i] = state.slots[i] ?? null
    this.selected = state.selected
    if (this.key() !== before) this.emit()
  }

  /** Casillas, recuentos y selección como texto, para comparar (sin depender del orden del Map). */
  private key(): string {
    return JSON.stringify([this.slots, this.slots.map((item) => (item ? this.count(item) : 0)), this.selected])
  }

  private emit() {
    for (const listener of this.listeners) listener()
  }
}
