export type ItemId = 'wood' | 'stone' | 'berry'

export const ITEM_NAMES: Record<ItemId, string> = { wood: 'Madera', stone: 'Piedra', berry: 'Bayas' }
export const SLOT_COUNT = 6

export class Inventory {
  private counts = new Map<ItemId, number>()
  /** Casillas de la hotbar, en orden de primera recogida. */
  readonly slots: ItemId[] = []
  private listeners: (() => void)[] = []

  add(item: ItemId, amount: number) {
    if (amount <= 0) return
    if (!this.counts.has(item) && this.slots.length < SLOT_COUNT) this.slots.push(item)
    this.counts.set(item, this.count(item) + amount)
    this.notify()
  }

  /** Quita `amount` si los hay; al llegar a 0 libera su casilla. */
  remove(item: ItemId, amount: number): boolean {
    const left = this.count(item) - amount
    if (amount <= 0 || left < 0) return false
    if (left === 0) {
      this.counts.delete(item)
      const slot = this.slots.indexOf(item)
      if (slot !== -1) this.slots.splice(slot, 1)
    } else {
      this.counts.set(item, left)
    }
    this.notify()
    return true
  }

  clear() {
    this.counts.clear()
    this.slots.length = 0
    this.notify()
  }

  count(item: ItemId): number {
    return this.counts.get(item) ?? 0
  }

  onChange(listener: () => void) {
    this.listeners.push(listener)
  }

  private notify() {
    for (const listener of this.listeners) listener()
  }

  toJSON(): Partial<Record<ItemId, number>> {
    return Object.fromEntries(this.counts)
  }
}
