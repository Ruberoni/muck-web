import { heightAt, MAX_SLOPE, slopeAt, WATER_LEVEL } from './world/terrain'
import { SpatialGrid, type Collider } from './collision'
import { LOCAL_PLAYER, NO_EMIT, type Emit, type PlayerId } from './events'
import type { ItemId } from './inventory'
import { PLACE_DISTANCE } from './constants'
import type { StationKind } from './crafting'
import type { Vec3 } from './player'

const MIN_GROUND = WATER_LEVEL + 0.2

/** Lo que se puede colocar en el mundo. El horno y el yunque entran con su PR. */
export type StructureKind = 'campfire' | 'workbench'

export interface StructureDef {
  /** El objeto que se gasta al colocarla. */
  item: ItemId
  radius: number
}

export const STRUCTURE_DEFS: Record<StructureKind, StructureDef> = {
  campfire: { item: 'campfire', radius: 0.6 },
  workbench: { item: 'workbench', radius: 0.7 },
}

export const STRUCTURE_KINDS = Object.keys(STRUCTURE_DEFS) as StructureKind[]

/** Qué estructura coloca cada objeto colocable: con uno de estos en la mano, el clic coloca en vez de golpear. */
export const PLACEABLE_DEFS: Partial<Record<ItemId, { kind: StructureKind; radius: number }>> = Object.fromEntries(
  STRUCTURE_KINDS.map((kind) => [STRUCTURE_DEFS[kind].item, { kind, radius: STRUCTURE_DEFS[kind].radius }]),
)

/** La estructura que coloca `item`, o null si no es colocable. */
export const placeableOf = (item: ItemId | null) => (item !== null && Object.hasOwn(PLACEABLE_DEFS, item) && PLACEABLE_DEFS[item]) || null

export interface Structure extends Collider {
  id: number
  kind: StructureKind
  y: number
  /** Giro del modelo: cada estructura distinta, sin depender de cuántas haya. */
  rotY: number
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

/**
 * Dónde caería una estructura de radio `radius` colocada desde `pos` mirando a `yaw`, y si se puede poner ahí.
 * La distancia es fija (PLACE_DISTANCE): con radios de más de 1 m habría que alejarla.
 */
export function structureSpot(
  pos: { x: number; z: number },
  yaw: number,
  radius: number,
  blockers: SpatialGrid<Collider>[],
  out: StructureSpot = { x: 0, y: 0, z: 0, valid: false },
): StructureSpot {
  // forward = (-sin(yaw), -cos(yaw))
  out.x = pos.x - Math.sin(yaw) * PLACE_DISTANCE
  out.z = pos.z - Math.cos(yaw) * PLACE_DISTANCE
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
export function stationNear(structures: readonly Structure[], kind: StationKind, pos: Vec3, range: number): boolean {
  return structures.some((s) => s.kind === kind && Math.hypot(s.x - pos.x, s.z - pos.z) - s.radius <= range)
}

/** Estructuras colocadas (fogatas y estaciones) y su rejilla de colisión. Las dibuja StructureView. */
export class Structures {
  readonly list: Structure[] = []
  readonly grid = new SpatialGrid<Structure>()
  private nextId = 0

  constructor(private emit: Emit = NO_EMIT) {}

  /** Coloca una estructura `kind` de `by` si el sitio es válido; devuelve la estructura o null. */
  place(spot: StructureSpot, kind: StructureKind, by: PlayerId = LOCAL_PLAYER): Structure | null {
    if (!spot.valid) return null
    const id = this.nextId++
    const structure: Structure = { id, kind, x: spot.x, y: spot.y, z: spot.z, rotY: id * 1.3, radius: STRUCTURE_DEFS[kind].radius, alive: true }
    this.insert(structure)
    this.emit({ type: 'structurePlaced', id, kind, x: structure.x, y: structure.y, z: structure.z, rotY: structure.rotY, by })
    return structure
  }

  /** Añade una estructura ya colocada en otra parte (el espejo del cliente, con lo que dice `structurePlaced`). */
  add(structure: Omit<Structure, 'radius' | 'alive'>) {
    if (this.list.some((s) => s.id === structure.id)) return
    this.insert({ ...structure, radius: STRUCTURE_DEFS[structure.kind].radius, alive: true })
    this.nextId = Math.max(this.nextId, structure.id + 1)
  }

  /** Reinicio de partida: sin estructuras. */
  clear() {
    this.list.length = 0
    this.grid.clear()
    this.nextId = 0
  }

  save(): StructuresState {
    return { list: this.list.map((s) => ({ ...s })), nextId: this.nextId }
  }

  load(state: StructuresState) {
    this.clear()
    for (const s of state.list) this.insert({ ...s })
    this.nextId = state.nextId
  }

  private insert(structure: Structure) {
    this.list.push(structure)
    this.grid.insert(structure)
  }
}
