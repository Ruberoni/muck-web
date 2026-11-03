export type ItemId =
  | 'wood'
  | 'stone'
  | 'berry'
  | 'wood_axe'
  | 'wood_pickaxe'
  | 'stone_axe'
  | 'stone_pickaxe'
  | 'raw_meat'
  | 'campfire'
  | 'workbench'
  | 'birch_wood'
  | 'iron_ore'
  | 'iron_bar'
  | 'iron_axe'
  | 'iron_pickaxe'
  | 'furnace'
  | 'anvil'
  | 'dark_wood'
  | 'mithril_ore'
  | 'mithril_bar'
  | 'mithril_axe'
  | 'mithril_pickaxe'
  | 'cooked_meat'
  | 'berry_infusion'
  | 'healing_herb'
  | 'wood_sword'
  | 'stone_sword'
  | 'iron_sword'
  | 'mithril_sword'
  | 'meteor_fragment'
  | 'meteor_sword'
  | 'distiller'
  | 'oil'
  | 'boss_trophy'
  | 'plane_engine'
  | 'coin'
  | 'coal'

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
  birch_wood: 'Madera de abedul',
  iron_ore: 'Mineral de hierro',
  iron_bar: 'Lingote de hierro',
  iron_axe: 'Hacha de hierro',
  iron_pickaxe: 'Pico de hierro',
  furnace: 'Horno',
  anvil: 'Yunque',
  dark_wood: 'Madera oscura',
  mithril_ore: 'Mineral de mithril',
  mithril_bar: 'Lingote de mithril',
  mithril_axe: 'Hacha de mithril',
  mithril_pickaxe: 'Pico de mithril',
  cooked_meat: 'Carne asada',
  berry_infusion: 'Infusión de bayas',
  healing_herb: 'Hierba curativa',
  wood_sword: 'Espada de madera',
  stone_sword: 'Espada de piedra',
  iron_sword: 'Espada de hierro',
  mithril_sword: 'Espada de mithril',
  meteor_fragment: 'Fragmento de meteorito',
  meteor_sword: 'Espada de meteorito',
  distiller: 'Destilador',
  oil: 'Aceite',
  boss_trophy: 'Trofeo de jefe',
  coin: 'Moneda',
  coal: 'Carbón',
  plane_engine: 'Motor del avión',
}

/** Lo que hace falta para escapar: no se puede perder, ni al irse quien lo lleva ni al caer al agua. */
export const KEY_ITEMS: readonly ItemId[] = ['meteor_fragment', 'boss_trophy', 'plane_engine']

/** Segundos que dura cada objeto en el suelo antes de desaparecer; null: no desaparece nunca. */
const MATERIAL = 300
const FOOD = 180
const GEAR = 600
export const GROUND_TIME: Record<ItemId, number | null> = {
  wood: MATERIAL,
  stone: MATERIAL,
  berry: FOOD,
  wood_axe: GEAR,
  wood_pickaxe: GEAR,
  stone_axe: GEAR,
  stone_pickaxe: GEAR,
  raw_meat: FOOD,
  campfire: GEAR,
  workbench: GEAR,
  birch_wood: MATERIAL,
  iron_ore: MATERIAL,
  iron_bar: MATERIAL,
  iron_axe: GEAR,
  iron_pickaxe: GEAR,
  furnace: GEAR,
  anvil: GEAR,
  dark_wood: MATERIAL,
  mithril_ore: MATERIAL,
  mithril_bar: MATERIAL,
  mithril_axe: GEAR,
  mithril_pickaxe: GEAR,
  cooked_meat: FOOD,
  berry_infusion: FOOD,
  healing_herb: FOOD,
  wood_sword: GEAR,
  stone_sword: GEAR,
  iron_sword: GEAR,
  mithril_sword: GEAR,
  meteor_fragment: null,
  meteor_sword: GEAR,
  distiller: GEAR,
  oil: MATERIAL,
  boss_trophy: null,
  plane_engine: null,
  coin: null,
  coal: MATERIAL,
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
