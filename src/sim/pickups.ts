import { heightAt, WATER_LEVEL } from './world/terrain'
import { LOCAL_PLAYER, NO_EMIT, type Emit } from './events'
import { resolveCircle, type Collider, type SpatialGrid } from './collision'
import { GRAVITY, PICKUP_DELAY, PICKUP_MAGNET, PICKUP_MAGNET_SPEED, PICKUP_RADIUS } from './constants'
import type { Inventory, ItemId } from './inventory'

const RADIUS = 0.2
// Al caer saltan hacia fuera y hacia arriba.
const POP_SPEED = 1.2
const POP_SPEED_RANDOM = 1.2
const POP_UP = 3.5
/** Con los pies más arriba o más abajo que esto no se recoge (p. ej. saltando por encima). */
const REACH_Y = 1.6

type Vec3 = { x: number; y: number; z: number }

export interface Pickup {
  id: number
  item: ItemId
  /** Unidades que da al recogerlo: 1 en lo que sueltan props y enemigos. */
  amount: number
  pos: Vec3
  prev: Vec3
  vel: Vec3
  grounded: boolean
  /** Segundos desde que cayó, en tiempo de simulación. */
  age: number
  /** Giro inicial del modelo, para que no giren todas a la vez. */
  spin: number
}

/** Encima del agua flotan: se pueden recoger vadeando. */
const groundAt = (x: number, z: number) => Math.max(heightAt(x, z), WATER_LEVEL)

/**
 * Objetos en el suelo: caen al soltarse, se deslizan hacia el jugador si caben y se recogen al pasar por encima.
 * Los dibuja PickupView.
 */
export class Pickups {
  readonly list: Pickup[] = []
  private nextId = 0

  /** `grids`: obstáculos de los que se apartan al caer (props, fogatas…). */
  constructor(
    private grids: SpatialGrid<Collider>[] = [],
    private rng: () => number = Math.random,
    private emit: Emit = NO_EMIT,
  ) {}

  /** Suelta `amount` piezas de una unidad de `item` desde (x, y, z), repartidas alrededor. */
  drop(item: ItemId, amount: number, x: number, y: number, z: number) {
    const offset = this.rng() * Math.PI * 2
    for (let i = 0; i < amount; i++) {
      const angle = offset + ((i + this.rng() * 0.5) / amount) * Math.PI * 2
      this.spawn(item, 1, x, y, z, angle, POP_SPEED + this.rng() * POP_SPEED_RANDOM)
    }
  }

  /** Suelta un único montón con `amount` unidades de `item` desde (x, y, z). */
  dropPile(item: ItemId, amount: number, x: number, y: number, z: number) {
    this.spawn(item, amount, x, y, z, this.rng() * Math.PI * 2, POP_SPEED)
  }

  private spawn(item: ItemId, amount: number, x: number, y: number, z: number, angle: number, speed: number) {
    const pickup: Pickup = {
      id: this.nextId++,
      item,
      amount,
      pos: { x, y, z },
      prev: { x, y, z },
      vel: { x: Math.cos(angle) * speed, y: POP_UP, z: Math.sin(angle) * speed },
      grounded: false,
      age: 0,
      spin: this.rng() * Math.PI * 2,
    }
    this.list.push(pickup)
    this.emit({ type: 'pickupSpawn', id: pickup.id, item, amount })
  }

  /**
   * Paso fijo: caída, imán y recogida. Devuelve cuántas unidades se recogieron y si el jugador
   * está encima de alguna que no cabe en la hotbar (se queda en el suelo).
   */
  step(dt: number, player: Vec3, inventory: Pick<Inventory, 'add' | 'canAdd'>): { collected: number; full: boolean } {
    let collected = 0
    let full = false
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i]
      p.prev.x = p.pos.x
      p.prev.y = p.pos.y
      p.prev.z = p.pos.z
      p.age += dt
      if (!p.grounded) {
        this.fall(p, dt)
        continue
      }
      if (p.age < PICKUP_DELAY - 1e-9 || Math.abs(player.y - p.pos.y) > REACH_Y) continue
      const dx = player.x - p.pos.x
      const dz = player.z - p.pos.z
      const d = Math.hypot(dx, dz)
      if (d > PICKUP_MAGNET) continue
      if (d <= PICKUP_RADIUS) {
        if (inventory.add(p.item, p.amount)) {
          this.list.splice(i, 1)
          collected += p.amount
          this.emit({ type: 'pickupCollected', id: p.id, by: LOCAL_PLAYER })
        } else full = true
        continue
      }
      if (!inventory.canAdd(p.item)) continue
      const move = Math.min(PICKUP_MAGNET_SPEED * dt, d)
      p.pos.x += (dx / d) * move
      p.pos.z += (dz / d) * move
      p.pos.y = groundAt(p.pos.x, p.pos.z)
    }
    return { collected, full }
  }

  private fall(p: Pickup, dt: number) {
    p.vel.y -= GRAVITY * dt
    p.pos.x += p.vel.x * dt
    p.pos.y += p.vel.y * dt
    p.pos.z += p.vel.z * dt
    for (const grid of this.grids) resolveCircle(p.pos, RADIUS, grid)
    const ground = groundAt(p.pos.x, p.pos.z)
    if (p.pos.y > ground) return
    p.pos.y = ground
    p.vel.x = p.vel.y = p.vel.z = 0
    p.grounded = true
  }

  /** Reinicio de partida: sin nada en el suelo. */
  clear() {
    this.list.length = 0
    this.nextId = 0
  }
}
