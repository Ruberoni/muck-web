import type { ItemId } from './inventory'
import type { StructureKind } from './structures'

/** Las ranuras de una estación de procesar: lo que entra, con qué arde y lo que sale. */
export type StationSlot = 'input' | 'fuel' | 'output'

export const STATION_SLOTS: readonly StationSlot[] = ['input', 'fuel', 'output']

export interface Stack {
  item: ItemId
  amount: number
}

/** Lo que pasa dentro de una estación. Las ranuras son de la estación: cualquiera mete y saca. */
export interface StationState {
  input: Stack | null
  fuel: Stack | null
  output: Stack | null
  /** Segundos que le quedan a lo que está ardiendo. */
  burn: number
  /** Segundos de la unidad que está procesando, y lo que tarda en total (0: ninguna). */
  progress: number
  time: number
}

/** Lo que hace una estación con `amount` de `input`: una unidad de `output` en `time` segundos. */
export interface Process {
  input: ItemId
  amount: number
  output: ItemId
  time: number
}

export interface StationDef {
  processes: readonly Process[]
  /** Si necesita combustible: la fogata ya es fuego. */
  fuel: boolean
}

/** Las estaciones que procesan; la mesa de trabajo y el yunque fabrican al momento con sus recetas. */
export const STATION_DEFS: Partial<Record<StructureKind, StationDef>> = {
  furnace: {
    fuel: true,
    processes: [
      { input: 'iron_ore', amount: 1, output: 'iron_bar', time: 15 },
      { input: 'mithril_ore', amount: 1, output: 'mithril_bar', time: 25 },
    ],
  },
  // Con carne cruda: el aceite del faro compite con la comida.
  distiller: { fuel: true, processes: [{ input: 'raw_meat', amount: 1, output: 'oil', time: 60 }] },
  campfire: {
    fuel: false,
    processes: [
      { input: 'raw_meat', amount: 1, output: 'cooked_meat', time: 10 },
      { input: 'berry', amount: 4, output: 'berry_infusion', time: 15 },
    ],
  },
}

/** Segundos que arde una unidad de cada combustible: la madera da para fundir un lingote de hierro. */
export const FUEL_SECONDS: Partial<Record<ItemId, number>> = { wood: 15, coal: 60 }

/** Lo que cabe en cada ranura. */
export const STATION_STACK = 99

export const newStation = (): StationState => ({ input: null, fuel: null, output: null, burn: 0, progress: 0, time: 0 })

export const copyStation = (s: StationState): StationState => ({
  ...s,
  input: s.input && { ...s.input },
  fuel: s.fuel && { ...s.fuel },
  output: s.output && { ...s.output },
})

/** Lo que hace `kind` con `item`, si hace algo. */
export const processOf = (kind: StructureKind, item: ItemId | undefined) => (item && STATION_DEFS[kind]?.processes.find((p) => p.input === item)) || null

/** Dónde va `item` en una estación `kind` si se mete sin decir dónde: la entrada si lo procesa, si no el combustible. */
export function slotFor(kind: StructureKind, item: ItemId): StationSlot | null {
  const def = STATION_DEFS[kind]
  if (!def) return null
  if (processOf(kind, item)) return 'input'
  if (def.fuel && FUEL_SECONDS[item] !== undefined) return 'fuel'
  return null
}

/** Si `item` vale para la ranura `slot` de `kind`: a la salida no se mete nada. */
export function accepts(kind: StructureKind, slot: StationSlot, item: ItemId): boolean {
  if (slot === 'input') return processOf(kind, item) !== null
  if (slot === 'fuel') return STATION_DEFS[kind]?.fuel === true && FUEL_SECONDS[item] !== undefined
  return false
}

/** Mete hasta `amount` de `item` en `slot`; devuelve cuántas caben (0 si no vale o está ocupada con otra cosa). */
export function putInto(kind: StructureKind, s: StationState, slot: StationSlot, item: ItemId, amount: number): number {
  if (!accepts(kind, slot, item)) return 0
  const stack = s[slot]
  if (stack && stack.item !== item) return 0
  const take = Math.min(amount, STATION_STACK - (stack?.amount ?? 0))
  if (take <= 0) return 0
  if (stack) stack.amount += take
  else s[slot] = { item, amount: take }
  // Otra cosa en la entrada empieza de cero.
  if (slot === 'input' && !stack) s.progress = s.time = 0
  return take
}

/** Vacía `slot` y devuelve lo que había. */
export function takeFrom(s: StationState, slot: StationSlot): Stack | null {
  const stack = s[slot]
  s[slot] = null
  if (slot === 'input') s.progress = s.time = 0
  return stack
}

/**
 * Paso fijo de una estación. Procesa mientras haya entrada, sitio en la salida y, si lo necesita, algo ardiendo: al
 * acabarse lo que arde coge una unidad más del combustible. `factor`: lo que tarda el trabajo en esta partida. Devuelve
 * si han cambiado las ranuras (lo que hay que avisar); el progreso y lo que arde se siguen solos.
 */
export function stepStation(kind: StructureKind, s: StationState, dt: number, factor: number): boolean {
  const def = STATION_DEFS[kind]
  const process = processOf(kind, s.input?.item)
  const fits = process && (!s.output || (s.output.item === process.output && s.output.amount < STATION_STACK))
  if (!def || !process || !fits || s.input!.amount < process.amount) {
    s.progress = s.time = 0
    return false
  }
  let changed = false
  if (def.fuel && s.burn <= 1e-9) {
    if (!s.fuel) return false
    s.burn += FUEL_SECONDS[s.fuel.item]!
    if (--s.fuel.amount <= 0) s.fuel = null
    changed = true
  }
  if (def.fuel) s.burn = Math.max(0, s.burn - dt)
  s.time = process.time * factor
  s.progress += dt
  if (s.progress < s.time - 1e-9) return changed
  s.progress = 0
  s.input!.amount -= process.amount
  if (s.input!.amount <= 0) s.input = null
  if (s.output) s.output.amount++
  else s.output = { item: process.output, amount: 1 }
  return true
}
