import { BUILD_DEFS, copyBuild, deliver, newBuild, type BuildState } from './builds'
import type { MatchRules } from './match'
import { heightAt, MAX_SLOPE, slopeAt, WATER_LEVEL } from './world/terrain'
import { SpatialGrid, type Collider } from './collision'
import { LOCAL_PLAYER, NO_EMIT, type Emit, type PlayerId } from './events'
import type { Inventory, ItemId } from './inventory'
import { MAX_JOBS, PLACE_DISTANCE } from './constants'
import type { Recipe, RecipeId } from './crafting'
import type { Vec3 } from './player'

const MIN_GROUND = WATER_LEVEL + 0.2

/** Lo que se puede colocar en el mundo. Todas sirven de estación: las recetas dicen cuál hay que tener cerca. */
export type StructureKind = 'campfire' | 'workbench' | 'furnace' | 'anvil' | 'lighthouse'

export interface StructureDef {
  /** El objeto que se gasta al colocarla. */
  item: ItemId
  radius: number
  /** Las que no son redondas se colocan de frente a quien las pone; las demás, cada una con su giro. */
  facesPlacer: boolean
}

export const STRUCTURE_DEFS: Record<StructureKind, StructureDef> = {
  campfire: { item: 'campfire', radius: 0.6, facesPlacer: false },
  workbench: { item: 'workbench', radius: 0.7, facesPlacer: true },
  furnace: { item: 'furnace', radius: 0.8, facesPlacer: true },
  anvil: { item: 'anvil', radius: 0.5, facesPlacer: true },
  lighthouse: { item: 'lighthouse', radius: 1.8, facesPlacer: false },
}

export const STRUCTURE_KINDS = Object.keys(STRUCTURE_DEFS) as StructureKind[]

/** Qué estructura coloca cada objeto colocable: con uno de estos en la mano, el clic coloca en vez de golpear. */
export const PLACEABLE_DEFS: Partial<Record<ItemId, { kind: StructureKind; radius: number }>> = Object.fromEntries(
  STRUCTURE_KINDS.map((kind) => [STRUCTURE_DEFS[kind].item, { kind, radius: STRUCTURE_DEFS[kind].radius }]),
)

/** La estructura que coloca `item`, o null si no es colocable. */
export const placeableOf = (item: ItemId | null) => (item !== null && Object.hasOwn(PLACEABLE_DEFS, item) && PLACEABLE_DEFS[item]) || null

/** Un trabajo en la cola de una estación. */
export interface StationJob {
  recipe: RecipeId
  /** Segundos que tarda en total y los que le quedan: solo avanza el primero de la cola. */
  time: number
  left: number
}

export interface Structure extends Collider {
  id: number
  kind: StructureKind
  y: number
  /** Giro del modelo: cada estructura distinta, sin depender de cuántas haya. */
  rotY: number
  jobs: StationJob[]
  /** Lo que se construye entre todos (BUILD_DEFS). */
  build?: BuildState
}

export interface StructureSpot {
  x: number
  y: number
  z: number
  valid: boolean
}

/** Las estructuras como datos, para guardar y restaurar la partida. */
export interface StructuresState {
  list: Structure[]
  nextId: number
}

const overlaps = (grid: SpatialGrid<Collider>, x: number, z: number, radius: number) => {
  for (const c of grid.query(x, z, radius + grid.maxRadius)) {
    if (c.alive && Math.hypot(c.x - x, c.z - z) < c.radius + radius) return true
  }
  return false
}

const buildOf = (kind: StructureKind) => (BUILD_DEFS[kind] ? { build: newBuild() } : {})

const copyStructure = (s: Structure): Structure => ({ ...s, jobs: s.jobs.map((job) => ({ ...job })), ...(s.build ? { build: copyBuild(s.build) } : {}) })

/** Hueco entre el jugador y lo que coloca, si es grande. */
const PLACE_GAP = 1.2

/** Dónde caería una estructura de radio `radius` colocada desde `pos` mirando a `yaw`, y si se puede poner ahí. */
export function structureSpot(
  pos: { x: number; z: number },
  yaw: number,
  radius: number,
  blockers: SpatialGrid<Collider>[],
  out: StructureSpot = { x: 0, y: 0, z: 0, valid: false },
): StructureSpot {
  // forward = (-sin(yaw), -cos(yaw))
  const distance = Math.max(PLACE_DISTANCE, radius + PLACE_GAP)
  out.x = pos.x - Math.sin(yaw) * distance
  out.z = pos.z - Math.cos(yaw) * distance
  out.y = heightAt(out.x, out.z)
  out.valid =
    out.y > MIN_GROUND &&
    slopeAt(out.x, out.z) <= MAX_SLOPE &&
    blockers.every((grid) => !overlaps(grid, out.x, out.z, radius))
  return out
}

/**
 * Si hay una estación `kind` al alcance desde `pos`: a `range` o menos en horizontal, del centro del jugador al
 * borde de la estación. La usan la simulación (con STATION_RANGE) y el cliente (con algo menos, para no fabricar en
 * el borde y acabar en una corrección).
 */
export function stationNear(structures: readonly Structure[], kind: StructureKind, pos: Vec3, range: number): boolean {
  return structures.some((s) => s.kind === kind && Math.hypot(s.x - pos.x, s.z - pos.z) - s.radius <= range)
}

/** La estación más cercana de ese tipo al alcance, con hueco en su cola; null si no hay. */
export function stationWithRoom(structures: readonly Structure[], kind: StructureKind, pos: Vec3, range: number): Structure | null {
  let best: Structure | null = null
  let bestDistance = Infinity
  for (const s of structures) {
    const distance = Math.hypot(s.x - pos.x, s.z - pos.z) - s.radius
    if (s.kind !== kind || distance > range || s.jobs.length >= MAX_JOBS || distance >= bestDistance) continue
    best = s
    bestDistance = distance
  }
  return best
}

/** Estructuras colocadas (fogatas y estaciones) y su rejilla de colisión. Las dibuja StructureView. */
export class Structures {
  readonly list: Structure[] = []
  readonly grid = new SpatialGrid<Structure>()
  private nextId = 0

  constructor(private emit: Emit = NO_EMIT) {}

  /**
   * Coloca una estructura `kind` de `by` si el sitio es válido; devuelve la estructura o null. `yaw` es hacia donde
   * mira quien la coloca: las estaciones quedan de frente a él (como su vista previa).
   */
  place(spot: StructureSpot, kind: StructureKind, by: PlayerId = LOCAL_PLAYER, yaw = 0): Structure | null {
    if (!spot.valid) return null
    const id = this.nextId++
    const { radius, facesPlacer } = STRUCTURE_DEFS[kind]
    const rotY = facesPlacer ? yaw : id * 1.3
    const structure: Structure = { id, kind, x: spot.x, y: spot.y, z: spot.z, rotY, radius, alive: true, jobs: [], ...buildOf(kind) }
    this.insert(structure)
    this.emit({ type: 'structurePlaced', id, kind, x: structure.x, y: structure.y, z: structure.z, rotY: structure.rotY, by })
    return structure
  }

  /** Añade una estructura ya colocada en otra parte (el espejo del cliente, con lo que dice `structurePlaced`). */
  add(structure: Omit<Structure, 'radius' | 'alive' | 'jobs'>) {
    if (this.list.some((s) => s.id === structure.id)) return
    this.insert({ ...structure, radius: STRUCTURE_DEFS[structure.kind].radius, alive: true, jobs: [], ...buildOf(structure.kind) })
    this.nextId = Math.max(this.nextId, structure.id + 1)
  }

  /** Pone un trabajo en la cola de una estación; `time`: lo que tarda en esta partida. */
  enqueue(structure: Structure, recipe: Recipe, time: number) {
    structure.jobs.push({ recipe: recipe.id, time, left: time })
    this.emit({ type: 'stationQueued', id: structure.id, recipe: recipe.id, time })
  }

  /** Entrega a una construcción lo que falte de `inventory`. */
  deliver(structure: Structure, inventory: Inventory, rules: MatchRules) {
    const { changed, finished } = deliver(structure, inventory, rules)
    if (changed) this.emit({ type: 'buildProgress', id: structure.id, build: copyBuild(structure.build!), finished })
  }

  /** Paso fijo: cada estación trabaja en lo primero de su cola. `done`: ha terminado esa receta. */
  step(dt: number, done: (structure: Structure, recipe: RecipeId) => void) {
    for (const s of this.list) {
      const job = s.jobs[0]
      if (!job) continue
      job.left -= dt
      if (job.left > 1e-9) continue
      s.jobs.shift()
      this.emit({ type: 'stationDone', id: s.id })
      done(s, job.recipe)
    }
  }

  /** La copia del cliente: avanza la barra; quitar el trabajo lo dice su `stationDone`. */
  follow(dt: number) {
    for (const s of this.list) if (s.jobs[0]) s.jobs[0].left = Math.max(0, s.jobs[0].left - dt)
  }

  byId(id: number) {
    return this.list.find((s) => s.id === id)
  }

  /** Reinicio de partida: sin estructuras. */
  clear() {
    this.list.length = 0
    this.grid.clear()
    this.nextId = 0
  }

  save(): StructuresState {
    return { list: this.list.map(copyStructure), nextId: this.nextId }
  }

  load(state: StructuresState) {
    this.clear()
    for (const s of state.list) this.insert(copyStructure(s))
    this.nextId = state.nextId
  }

  private insert(structure: Structure) {
    this.list.push(structure)
    this.grid.insert(structure)
  }
}
