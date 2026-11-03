import { STATION_RANGE } from './constants'
import type { Inventory, ItemId } from './inventory'
import { clockOf, workFactor, type MatchRules } from './match'
import type { Vec3 } from './player'
import type { Structure, StructureKind } from './structures'
import { DayClock } from './world/daycycle'

/** Los costes van para 3 jugadores; con otros, ver `playerScale`. */
const REFERENCE_PLAYERS = 3

/** Segundos hasta la Noche Eterna con `players` jugadores. */
function untilEternal(players: number) {
  const clock = new DayClock()
  clock.configure(clockOf(players))
  return clock.eternalAt
}

const SCALES = new Map<number, number>()

/**
 * Por cuánto se multiplica lo compartido con `players` jugadores: por el tiempo de trabajo que juntan hasta la Noche
 * Eterna (jugadores × ese tiempo, que baja con más jugadores) respecto al de 3. Así cada uno pone la misma parte de su
 * tiempo, sea cual sea el grupo: con uno, algo menos de la mitad; con cinco, casi una vez y media.
 */
export function playerScale(players: number): number {
  let scale = SCALES.get(players)
  if (scale === undefined) SCALES.set(players, (scale = (players * untilEternal(players)) / (REFERENCE_PLAYERS * untilEternal(REFERENCE_PLAYERS))))
  return scale
}

export interface BuildCost {
  item: ItemId
  amount: number
  /**
   * `each`: tantos por jugador; `one`: tal cual. Sin él escala con los jugadores (`playerScale`) y con la dificultad, que
   * así también alarga la caminata: lo que no sale de recolectar, no.
   */
  fixed?: 'each' | 'one'
}

export interface BuildPhase {
  name: string
  cost: BuildCost[]
}

export interface BuildDef {
  name: string
  phases: BuildPhase[]
}

/**
 * Lo que se construye entre todos, llevando materiales hasta el sitio. Con 3 jugadores en normal, el faro y el tótem
 * cuestan cada uno algo menos de la mitad del tiempo hasta la Noche Eterna, como las armas de cada uno: no da para todo
 * (el presupuesto, en balance.test.ts).
 */
export const BUILD_DEFS: Partial<Record<StructureKind, BuildDef>> = {
  lighthouse: {
    name: 'Faro',
    phases: [
      { name: 'Cimiento', cost: [{ item: 'stone', amount: 240 }] },
      { name: 'Torre', cost: [{ item: 'wood', amount: 220 }, { item: 'iron_bar', amount: 45 }] },
      // La lente, de cristal de las cimas.
      { name: 'Lámpara', cost: [{ item: 'iron_bar', amount: 45 }, { item: 'mithril_bar', amount: 22 }, { item: 'crystal', amount: 12 }] },
    ],
  },
  // Meteoritos y jefes de noche forman parte del objetivo.
  totem: {
    name: 'Tótem',
    phases: [
      { name: 'Base', cost: [{ item: 'stone', amount: 200 }, { item: 'dark_wood', amount: 150 }] },
      { name: 'Cuerpo', cost: [{ item: 'iron_bar', amount: 100 }] },
      { name: 'Corazón', cost: [{ item: 'meteor_fragment', amount: 3, fixed: 'each' }, { item: 'boss_trophy', amount: 1, fixed: 'one' }] },
    ],
  },
  plane: {
    name: 'Avión',
    phases: [
      { name: 'Fuselaje', cost: [{ item: 'wood', amount: 200 }, { item: 'iron_bar', amount: 50 }] },
      // De momento hay un solo jefe de luz: faltan las otras cuatro piezas.
      { name: 'Motor', cost: [{ item: 'plane_engine', amount: 1, fixed: 'one' }] },
    ],
  },
}

/** Por dónde va una construcción. */
export interface BuildState {
  phase: number
  delivered: Partial<Record<ItemId, number>>
  /** De 0 a 1, para las barras. */
  progress: number
}

export const newBuild = (): BuildState => ({ phase: 0, delivered: {}, progress: 0 })

export const copyBuild = (build: BuildState): BuildState => ({ ...build, delivered: { ...build.delivered } })

/** Si no está en construcción (o ya está acabada). */
export const isBuilt = ({ kind, build }: Pick<Structure, 'kind' | 'build'>) => !build || build.phase >= BUILD_DEFS[kind]!.phases.length

/** Lo que pide la fase `phase` en esta partida. */
export function phaseCost(kind: StructureKind, phase: number, rules: MatchRules): { item: ItemId; amount: number }[] {
  const scale = playerScale(rules.players) * workFactor(rules)
  return BUILD_DEFS[kind]!.phases[phase].cost.map(({ item, amount, fixed }) => ({
    item,
    amount: fixed === 'one' ? amount : fixed === 'each' ? amount * rules.players : Math.ceil(amount * scale),
  }))
}

const total = (cost: readonly { amount: number }[]) => cost.reduce((sum, c) => sum + c.amount, 0)

/**
 * Entrega de `inventory` lo que falte de la fase actual. Si con eso se completa, pasa a la siguiente. Devuelve si ha
 * cambiado algo y el nombre de la fase que ha acabado, si ha acabado alguna.
 */
export function deliver(structure: Structure, inventory: Inventory, rules: MatchRules): { changed: boolean; finished: string | null } {
  const { kind, build } = structure
  if (!build || isBuilt(structure)) return { changed: false, finished: null }
  const cost = phaseCost(kind, build.phase, rules)
  let changed = false
  for (const { item, amount } of cost) {
    const have = build.delivered[item] ?? 0
    const take = Math.min(amount - have, inventory.count(item))
    if (take <= 0) continue
    inventory.remove(item, take)
    build.delivered[item] = have + take
    changed = true
  }
  const done = cost.every(({ item, amount }) => (build.delivered[item] ?? 0) >= amount)
  const finished = done ? BUILD_DEFS[kind]!.phases[build.phase].name : null
  if (done) {
    build.phase++
    build.delivered = {}
  }
  const phases = BUILD_DEFS[kind]!.phases.map((_, i) => total(phaseCost(kind, i, rules)))
  const before = phases.slice(0, build.phase).reduce((a, b) => a + b, 0)
  build.progress = (before + total(Object.values(build.delivered).map((amount) => ({ amount: amount ?? 0 })))) / total(phases.map((amount) => ({ amount })))
  return { changed, finished }
}

/** Lo más cercano con lo que se puede hacer algo con la tecla de uso; null si no hay nada al alcance. */
export function usableNear(structures: readonly Structure[], pos: Vec3): Structure | null {
  let best: Structure | null = null
  let bestDistance = Infinity
  for (const s of structures) {
    if (!BUILD_DEFS[s.kind] && s.kind !== 'grave') continue
    const distance = Math.hypot(s.x - pos.x, s.z - pos.z) - s.radius
    if (distance > STATION_RANGE || distance >= bestDistance) continue
    best = s
    bestDistance = distance
  }
  return best
}
