import * as THREE from 'three'
import { heightAt, WATER_LEVEL } from '../world/terrain'
import { resolveCircle, type Collider, type SpatialGrid } from './collision'
import { GRAVITY, PICKUP_DELAY, PICKUP_MAGNET, PICKUP_MAGNET_SPEED, PICKUP_RADIUS, STEP } from './constants'
import { itemModel } from './handheld'
import type { Inventory, ItemId } from './inventory'

// Los modelos de la mano son pequeños: en el suelo se ven algo más grandes.
const MODEL_SCALE = 2.2
const RADIUS = 0.2
const HOVER = 0.08
const BOB = 0.06
const SPIN_RATE = 1.5
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
  pos: Vec3
  prev: Vec3
  vel: Vec3
  grounded: boolean
  /** Segundos desde que cayó, en tiempo de simulación. */
  age: number
  /** Giro inicial, para que no giren todas a la vez. */
  spin: number
  object: THREE.Group
}

/** Encima del agua flotan: se pueden recoger vadeando. */
const groundAt = (x: number, z: number) => Math.max(heightAt(x, z), WATER_LEVEL)

/** Objetos en el suelo: caen al soltarse, se deslizan hacia el jugador si caben y se recogen al pasar por encima. */
export class Pickups {
  readonly list: Pickup[] = []
  readonly group = new THREE.Group()
  private models = new Map<ItemId, THREE.Group>()
  private nextId = 0

  /** `grids`: obstáculos de los que se apartan al caer (props, fogatas…). */
  constructor(
    private grids: SpatialGrid<Collider>[] = [],
    private rng: () => number = Math.random,
  ) {}

  /** Suelta `amount` piezas de `item` desde (x, y, z), repartidas alrededor. */
  drop(item: ItemId, amount: number, x: number, y: number, z: number) {
    const offset = this.rng() * Math.PI * 2
    for (let i = 0; i < amount; i++) {
      const angle = offset + ((i + this.rng() * 0.5) / amount) * Math.PI * 2
      const speed = POP_SPEED + this.rng() * POP_SPEED_RANDOM
      const object = this.model(item).clone()
      const pickup: Pickup = {
        id: this.nextId++,
        item,
        pos: { x, y, z },
        prev: { x, y, z },
        vel: { x: Math.cos(angle) * speed, y: POP_UP, z: Math.sin(angle) * speed },
        grounded: false,
        age: 0,
        spin: this.rng() * Math.PI * 2,
        object,
      }
      this.list.push(pickup)
      this.group.add(object)
      this.placeOne(pickup, 1)
    }
  }

  /**
   * Paso fijo: caída, imán y recogida. Devuelve cuántas piezas se recogieron y si el jugador
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
        if (inventory.add(p.item, 1)) {
          this.remove(i)
          collected++
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

  private remove(index: number) {
    const [p] = this.list.splice(index, 1)
    this.group.remove(p.object)
  }

  /** Reinicio de partida: sin nada en el suelo. */
  clear() {
    this.list.length = 0
    this.group.clear()
    this.nextId = 0
  }

  /** Coloca los modelos entre el paso anterior y el actual (alpha = 1: posición simulada). */
  place(alpha: number) {
    for (const p of this.list) this.placeOne(p, alpha)
  }

  private placeOne(p: Pickup, alpha: number) {
    const lerp = (a: number, b: number) => a + (b - a) * alpha
    const t = p.age - STEP * (1 - alpha)
    // En el suelo flota un poco y sube y baja; girando se ve qué es desde cualquier lado.
    const bob = p.grounded ? HOVER + BOB * (1 + Math.sin(t * 3 + p.spin)) : 0
    p.object.position.set(lerp(p.prev.x, p.pos.x), lerp(p.prev.y, p.pos.y) + bob, lerp(p.prev.z, p.pos.z))
    p.object.rotation.y = p.spin + t * SPIN_RATE
  }

  /** Un modelo por objeto; cada pieza es un clon que comparte geometría y material. */
  private model(item: ItemId) {
    let model = this.models.get(item)
    if (!model) {
      model = itemModel(item)
      model.scale.setScalar(MODEL_SCALE)
      model.traverse((o) => (o.castShadow = true))
      this.models.set(item, model)
    }
    return model
  }
}
