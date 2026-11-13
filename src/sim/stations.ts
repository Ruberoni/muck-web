import { ITEM_NAMES, type ItemId } from './inventory'
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
  /** Segundos que le quedan a lo que está ardiendo, y lo que dura en total esa unidad (para escalar su barra). */
  burn: number
  burnTotal: number
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

/** Segundos que arde una unidad de cada combustible que acepta una estación. */
export type FuelTable = Partial<Record<ItemId, number>>

export interface StationDef {
  processes: readonly Process[]
  /** Lo que acepta como combustible y cuánto arde cada cosa (null: no lo necesita). */
  fuel: FuelTable | null
  /** Si arde siempre que tenga combustible, procese o no (la fogata); si no, solo gasta mientras procesa. */
  alwaysBurns?: boolean
}

/** Horno y destilador: la madera da para fundir un lingote de hierro, la seca para dos y el carbón para cuatro. */
const FORGE_FUEL: FuelTable = { wood: 15, dry_wood: 30, coal: 60 }

/** Fogata: un minuto por madera, más cuanto mayor su nivel. El carbón no vale. */
const CAMPFIRE_FUEL: FuelTable = { wood: 60, dry_wood: 90, birch_wood: 90, dark_wood: 120 }

/** Las estaciones que procesan; la mesa de trabajo y el yunque fabrican al momento con sus recetas. */
export const STATION_DEFS: Partial<Record<StructureKind, StationDef>> = {
  furnace: {
    fuel: FORGE_FUEL,
    processes: [
      { input: 'iron_ore', amount: 1, output: 'iron_bar', time: 15 },
      { input: 'mithril_ore', amount: 1, output: 'mithril_bar', time: 25 },
    ],
  },
  // Con carne cruda: el aceite del faro compite con la comida.
  distiller: { fuel: FORGE_FUEL, processes: [{ input: 'raw_meat', amount: 1, output: 'oil', time: 60 }] },
  campfire: {
    fuel: CAMPFIRE_FUEL,
    alwaysBurns: true,
    processes: [
      { input: 'raw_meat', amount: 1, output: 'cooked_meat', time: 10 },
      { input: 'berry', amount: 4, output: 'berry_infusion', time: 15 },
    ],
  },
}

/** Segundos que arde una unidad de `item` en `kind` (undefined si no le vale de combustible). */
export const fuelSeconds = (kind: StructureKind, item: ItemId): number | undefined => STATION_DEFS[kind]?.fuel?.[item]

/**
 * Si arde. Con leña en la ranura cuenta como encendida aunque `burn` acabe de llegar a 0: la unidad siguiente se coge
 * al principio del paso siguiente, y así ni el servidor pasa un tick apagado ni la copia del cliente parpadea.
 */
export const isLit = (s: StationState): boolean => s.burn > 1e-9 || s.fuel !== null

/** Segundos que le quedan de fuego: lo que arde más lo que durará el combustible de la ranura. */
export function burnLeft(kind: StructureKind, s: StationState): number {
  return s.burn + (s.fuel ? (fuelSeconds(kind, s.fuel.item) ?? 0) * s.fuel.amount : 0)
}

/** Lo que cabe en cada ranura. */
export const STATION_STACK = 99

export const newStation = (): StationState => ({ input: null, fuel: null, output: null, burn: 0, burnTotal: 0, progress: 0, time: 0 })

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
  if (def.fuel?.[item] !== undefined) return 'fuel'
  return null
}

/** Si `item` vale para la ranura `slot` de `kind`: a la salida no se mete nada. */
export function accepts(kind: StructureKind, slot: StationSlot, item: ItemId): boolean {
  if (slot === 'input') return processOf(kind, item) !== null
  if (slot === 'fuel') return fuelSeconds(kind, item) !== undefined
  return false
}

/**
 * La copia del cliente de una estación entre dos avisos (`stationChanged`): avanza la unidad en curso y gasta lo que
 * arde, como `stepStation`, pero sin decidir nada. Sin nada ardiendo espera: o el servidor ya ha cogido más
 * combustible (y llegará el aviso) o se ha quedado sin él. La fogata gasta aunque no procese nada: si no, la copia
 * nunca se apagaría.
 */
export function followStation(kind: StructureKind, s: StationState, dt: number) {
  const def = STATION_DEFS[kind]
  if (!def) return
  if (def.alwaysBurns && s.time <= 0) {
    s.burn = Math.max(0, s.burn - dt)
    return
  }
  if (s.time <= 0) return
  if (def.fuel && s.burn <= 1e-9) return
  // A saltos grandes, la unidad solo avanza lo que quedaba ardiendo: luego espera, como el servidor.
  const worked = def.fuel ? Math.min(dt, s.burn) : dt
  if (def.fuel) s.burn = Math.max(0, s.burn - dt)
  s.progress = Math.min(s.time, s.progress + worked)
}

/**
 * Por qué no trabaja una estación que tiene algo en la entrada, para decirlo en su pantalla (null si trabaja o si no
 * tiene nada que hacer). Mira lo mismo que `stepStation`.
 */
export function stationStall(kind: StructureKind, s: StationState): string | null {
  const def = STATION_DEFS[kind]
  const process = processOf(kind, s.input?.item)
  if (!def || !s.input || !process) return null
  if (s.output && s.output.item !== process.output) return `Saca ${ITEM_NAMES[s.output.item].toLowerCase()} de la salida para seguir`
  if (s.output && s.output.amount >= STATION_STACK) return 'La salida está llena'
  if (s.input.amount < process.amount) return `Faltan ${process.amount - s.input.amount}: van de ${process.amount} en ${process.amount}`
  if (def.fuel && s.burn <= 1e-9 && !s.fuel) return def.alwaysBurns ? 'Apagada: échale madera' : `Sin combustible: ${fuelList(def.fuel)}`
  return null
}

/** Los combustibles de una tabla, en minúsculas: «madera, madera seca o carbón». */
export function fuelList(fuel: FuelTable): string {
  const names = (Object.keys(fuel) as ItemId[]).map((item) => ITEM_NAMES[item].toLowerCase())
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} o ${names[names.length - 1]}` : names.join('')
}

/** Coge una unidad más de la ranura de combustible si no queda nada ardiendo. Devuelve si la ha cogido. */
function refuel(kind: StructureKind, s: StationState): boolean {
  if (s.burn > 1e-9 || !s.fuel) return false
  const seconds = fuelSeconds(kind, s.fuel.item) ?? 0
  s.burn += seconds
  s.burnTotal = seconds
  if (--s.fuel.amount <= 0) s.fuel = null
  return true
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
 * acabarse lo que arde coge una unidad más del combustible. La fogata (`alwaysBurns`) arde y gasta aunque no procese.
 * `factor`: lo que tarda el trabajo en esta partida. Devuelve si han cambiado las ranuras (lo que hay que avisar); el
 * progreso y lo que arde se siguen solos.
 */
export function stepStation(kind: StructureKind, s: StationState, dt: number, factor: number): boolean {
  const def = STATION_DEFS[kind]
  if (!def) return false
  let changed = false
  // La fogata gasta antes de mirar si tiene trabajo: arde aunque no cocine nada. `lit`: si ardía en este paso.
  let lit = true
  if (def.alwaysBurns) {
    changed = refuel(kind, s)
    lit = s.burn > 1e-9
    s.burn = Math.max(0, s.burn - dt)
  }
  const process = processOf(kind, s.input?.item)
  const fits = process && (!s.output || (s.output.item === process.output && s.output.amount < STATION_STACK))
  if (!process || !fits || s.input!.amount < process.amount) {
    // Pararse se avisa: la copia del cliente avanza la barra mientras `time` no sea 0.
    const was = s.time > 0
    s.progress = s.time = 0
    return changed || was
  }
  // Apagada no cocina: lo que esté a medias se queda a medias, con su progreso.
  if (!lit) return changed
  if (def.fuel && !def.alwaysBurns) {
    if (refuel(kind, s)) changed = true
    else if (s.burn <= 1e-9) return changed
    s.burn = Math.max(0, s.burn - dt)
  }
  // Empezar una unidad también se avisa: si ya ardía, no habría otro aviso hasta acabarla.
  if (s.time <= 0) changed = true
  s.time = process.time * factor
  s.progress += dt
  if (s.progress < s.time - 1e-9) return changed
  s.progress = 0
  s.input!.amount -= process.amount
  // Sin más entrada no queda unidad en curso: así el paso siguiente no tiene que avisar de que se para.
  if (s.input!.amount <= 0) {
    s.input = null
    s.time = 0
  }
  if (s.output) s.output.amount++
  else s.output = { item: process.output, amount: 1 }
  return true
}
