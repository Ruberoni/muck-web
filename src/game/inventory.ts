export type ItemId = 'wood' | 'stone'

export const ITEM_NAMES: Record<ItemId, string> = { wood: 'Madera', stone: 'Piedra' }
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
    for (const listener of this.listeners) listener()
  }

  count(item: ItemId): number {
    return this.counts.get(item) ?? 0
  }

  onChange(listener: () => void) {
    this.listeners.push(listener)
  }

  toJSON(): Partial<Record<ItemId, number>> {
    return Object.fromEntries(this.counts)
  }
}
