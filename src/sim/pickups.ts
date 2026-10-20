import { heightAt, WATER_LEVEL } from './world/terrain'
import { NO_EMIT, type Emit, type PlayerId } from './events'
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
  /** Hacia quién se desliza con el imán: lo sigue mientras pueda cogerlo, aunque otro se acerque más. */
  claimedBy: PlayerId | null
}

/** Un jugador que puede recoger: está en el mundo y vivo. */
export interface Collector {
  id: PlayerId
  pos: Vec3
  inventory: Pick<Inventory, 'add' | 'canAdd'>
}

/** Lo que pasa a un jugador en un paso: unidades recogidas y si está encima de algo que no le cabe. */
export interface CollectResult {
  collected: number
  full: boolean
}

/** Los objetos del suelo como datos, para guardar y restaurar la partida. */
export interface PickupsState {
  list: Pickup[]
  nextId: number
}

const copyPickup = (p: Pickup): Pickup => ({ ...p, pos: { ...p.pos }, prev: { ...p.prev }, vel: { ...p.vel } })

/** Encima del agua flotan: se pueden recoger vadeando. */
const groundAt = (x: number, z: number) => Math.max(heightAt(x, z), WATER_LEVEL)

/**
 * Objetos en el suelo: caen al soltarse, se deslizan hacia un jugador si le caben y se recogen al pasar por encima.
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
      claimedBy: null,
    }
    this.list.push(pickup)
    this.emit({ type: 'pickupSpawn', id: pickup.id, item, amount })
  }

  /**
   * Paso fijo: caída, imán y recogida. `collectors` van ordenados por id. Cada objeto lo recoge el más cercano
   * que lo tenga encima y le quepa; si no, se desliza hacia el más cercano dentro del imán al que le quepa
   * (empate: el de menor id) y le sigue hasta que deje de caberle o se aleje. Devuelve, para cada jugador
   * (en el mismo orden), cuántas unidades recogió y si está encima de alguna que no le cabe (se queda en el suelo).
   */
  step(dt: number, collectors: readonly Collector[]): CollectResult[] {
    const results = collectors.map((): CollectResult => ({ collected: 0, full: false }))
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
      if (p.age < PICKUP_DELAY - 1e-9) continue
      // Quién lo tiene a su alcance, del más cercano al más lejano.
      const near: { index: number; d: number }[] = []
      collectors.forEach((c, index) => {
        if (Math.abs(c.pos.y - p.pos.y) > REACH_Y) return
        const d = Math.hypot(c.pos.x - p.pos.x, c.pos.z - p.pos.z)
        if (d <= PICKUP_MAGNET) near.push({ index, d })
      })
      if (!near.length) {
        p.claimedBy = null
        continue
      }
      near.sort((a, b) => a.d - b.d || a.index - b.index)
      const onTop = near.filter(({ d }) => d <= PICKUP_RADIUS)
      const taker = onTop.find(({ index }) => collectors[index].inventory.add(p.item, p.amount))
      if (taker) {
        const c = collectors[taker.index]
        this.list.splice(i, 1)
        results[taker.index].collected += p.amount
        this.emit({ type: 'pickupCollected', id: p.id, by: c.id })
        continue
      }
      // A quien lo tiene encima sin que le quepa se le avisa; si a otro le cabe, se va hacia él.
      for (const { index } of onTop) results[index].full = true
      const fits = near.filter(({ index }) => collectors[index].inventory.canAdd(p.item))
      const claim = fits.find(({ index }) => collectors[index].id === p.claimedBy) ?? fits[0]
      if (!claim) {
        p.claimedBy = null
        continue
      }
      const c = collectors[claim.index]
      p.claimedBy = c.id
      const move = Math.min(PICKUP_MAGNET_SPEED * dt, claim.d)
      p.pos.x += ((c.pos.x - p.pos.x) / claim.d) * move
      p.pos.z += ((c.pos.z - p.pos.z) / claim.d) * move
      p.pos.y = groundAt(p.pos.x, p.pos.z)
    }
    return results
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

  save(): PickupsState {
    return { list: this.list.map(copyPickup), nextId: this.nextId }
  }

  load(state: PickupsState) {
    this.list.length = 0
    this.list.push(...state.list.map(copyPickup))
    this.nextId = state.nextId
  }
}
