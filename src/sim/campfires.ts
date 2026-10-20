import { heightAt, MAX_SLOPE, slopeAt, WATER_LEVEL } from './world/terrain'
import { SpatialGrid, type Collider } from './collision'
import { LOCAL_PLAYER, NO_EMIT, type Emit, type PlayerId } from './events'
import { CAMPFIRE_PLACE_DISTANCE, CAMPFIRE_RADIUS } from './constants'

const MIN_GROUND = WATER_LEVEL + 0.2

export interface Campfire extends Collider {
  id: number
  y: number
  /** Giro del modelo: cada fogata distinta, sin depender de cuántas haya. */
  rotY: number
}

export interface CampfireSpot {
  x: number
  y: number
  z: number
  valid: boolean
}

/** Las fogatas como datos, para guardar y restaurar la partida. */
export interface CampfiresState {
  list: Campfire[]
  nextId: number
}

const overlaps = (grid: SpatialGrid<Collider>, x: number, z: number, radius: number) => {
  for (const c of grid.query(x, z, radius + grid.maxRadius)) {
    if (c.alive && Math.hypot(c.x - x, c.z - z) < c.radius + radius) return true
  }
  return false
}

/** Dónde caería una fogata colocada desde `pos` mirando a `yaw`, y si se puede poner ahí. */
export function campfireSpot(
  pos: { x: number; z: number },
  yaw: number,
  blockers: SpatialGrid<Collider>[],
  out: CampfireSpot = { x: 0, y: 0, z: 0, valid: false },
): CampfireSpot {
  // forward = (-sin(yaw), -cos(yaw))
  out.x = pos.x - Math.sin(yaw) * CAMPFIRE_PLACE_DISTANCE
  out.z = pos.z - Math.cos(yaw) * CAMPFIRE_PLACE_DISTANCE
  out.y = heightAt(out.x, out.z)
  out.valid =
    out.y > MIN_GROUND &&
    slopeAt(out.x, out.z) <= MAX_SLOPE &&
    blockers.every((grid) => !overlaps(grid, out.x, out.z, CAMPFIRE_RADIUS))
  return out
}

/** Fogatas colocadas y su rejilla de colisión. Las dibuja CampfireView. */
export class Campfires {
  readonly list: Campfire[] = []
  readonly grid = new SpatialGrid<Campfire>()
  private nextId = 0

  constructor(private emit: Emit = NO_EMIT) {}

  /** Coloca una fogata de `by` si el sitio es válido; devuelve la fogata o null. */
  place(spot: CampfireSpot, by: PlayerId = LOCAL_PLAYER): Campfire | null {
    if (!spot.valid) return null
    const id = this.nextId++
    const fire: Campfire = { id, x: spot.x, y: spot.y, z: spot.z, rotY: id * 1.3, radius: CAMPFIRE_RADIUS, alive: true }
    this.list.push(fire)
    this.grid.insert(fire)
    this.emit({ type: 'campfirePlaced', id, x: fire.x, y: fire.y, z: fire.z, rotY: fire.rotY, by })
    return fire
  }

  /** Reinicio de partida: sin fogatas. */
  clear() {
    this.list.length = 0
    this.grid.clear()
    this.nextId = 0
  }

  save(): CampfiresState {
    return { list: this.list.map((fire) => ({ ...fire })), nextId: this.nextId }
  }

  load(state: CampfiresState) {
    this.clear()
    for (const fire of state.list) {
      const copy = { ...fire }
      this.list.push(copy)
      this.grid.insert(copy)
    }
    this.nextId = state.nextId
  }
}
