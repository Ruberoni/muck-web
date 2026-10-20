export interface Collider {
  x: number
  z: number
  radius: number
  alive: boolean
}

const OFFSET = 2048
const cellKey = (ix: number, iz: number) => (ix + OFFSET) * 4096 + (iz + OFFSET)

/** Rejilla uniforme en XZ. Cada collider se inserta en todas las celdas que toca su círculo. */
export class SpatialGrid<T extends Collider> {
  private cells = new Map<number, T[]>()
  private result = new Set<T>()
  maxRadius = 0

  constructor(readonly cellSize = 8) {}

  insert(item: T) {
    this.maxRadius = Math.max(this.maxRadius, item.radius)
    this.forEachCell(item.x, item.z, item.radius, (key) => {
      let cell = this.cells.get(key)
      if (!cell) this.cells.set(key, (cell = []))
      cell.push(item)
    })
  }

  clear() {
    this.cells.clear()
    this.maxRadius = 0
  }

  /** Colliders cuyas celdas tocan el círculo (x, z, r). El Set devuelto se reutiliza entre llamadas. */
  query(x: number, z: number, r: number): Set<T> {
    this.result.clear()
    this.forEachCell(x, z, r, (key) => {
      const cell = this.cells.get(key)
      if (cell) for (const item of cell) this.result.add(item)
    })
    return this.result
  }

  private forEachCell(x: number, z: number, r: number, fn: (key: number) => void) {
    const s = this.cellSize
    const x0 = Math.floor((x - r) / s)
    const x1 = Math.floor((x + r) / s)
    const z0 = Math.floor((z - r) / s)
    const z1 = Math.floor((z + r) / s)
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) fn(cellKey(ix, iz))
  }
}

const PASSES = 3

/** Empuja el círculo (pos, radius) fuera de los colliders vivos cercanos. Devuelve si hubo contacto. */
export function resolveCircle(pos: { x: number; z: number }, radius: number, grid: SpatialGrid<Collider>): boolean {
  let touched = false
  for (let pass = 0; pass < PASSES; pass++) {
    let moved = false
    for (const c of grid.query(pos.x, pos.z, radius + grid.maxRadius)) {
      if (!c.alive) continue
      const dx = pos.x - c.x
      const dz = pos.z - c.z
      const minDist = radius + c.radius
      const d2 = dx * dx + dz * dz
      if (d2 >= minDist * minDist) continue
      const d = Math.sqrt(d2)
      if (d < 1e-6) {
        pos.x = c.x + minDist
      } else {
        pos.x = c.x + (dx / d) * minDist
        pos.z = c.z + (dz / d) * minDist
      }
      moved = touched = true
    }
    if (!moved) break
  }
  return touched
}
