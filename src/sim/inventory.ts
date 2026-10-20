export type ItemId = 'wood' | 'stone' | 'berry' | 'wood_axe' | 'wood_pickaxe' | 'stone_axe' | 'stone_pickaxe' | 'raw_meat' | 'campfire'

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
}
// Una tecla numérica por casilla (1–9).
export const SLOT_COUNT = 9

export class Inventory {
  private counts = new Map<ItemId, number>()
  /** Casillas de la hotbar: un objeto nuevo ocupa la primera libre y la deja libre al llegar a 0. */
  readonly slots: (ItemId | null)[] = Array(SLOT_COUNT).fill(null)
  selected = 0
  private listeners: (() => void)[] = []

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

  select(index: number) {
    if (index < 0 || index >= SLOT_COUNT || index === this.selected) return
    this.selected = index
    this.emit()
  }

  /** Mueve la selección `steps` casillas, dando la vuelta al pasar de un extremo. */
  cycle(steps: number) {
    this.select((((this.selected + steps) % SLOT_COUNT) + SLOT_COUNT) % SLOT_COUNT)
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

  private emit() {
    for (const listener of this.listeners) listener()
  }
}
