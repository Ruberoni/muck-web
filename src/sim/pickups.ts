import { WATER_LEVEL } from './world/terrain'
import { DEFAULT_ISLAND, type Island } from './world/island'
import { NO_EMIT, type Emit, type PlayerId } from './events'
import { resolveCircle, type Collider, type SpatialGrid } from './collision'
import { DROP_PICKUP_DELAY, GRAVITY, PICKUP_DELAY, PICKUP_MAGNET, PICKUP_MAGNET_SPEED, PICKUP_RADIUS } from './constants'
import { GROUND_TIME, KEY_ITEMS, type Inventory, type ItemId } from './inventory'

const RADIUS = 0.2
// Al caer saltan hacia fuera y hacia arriba.
const POP_SPEED = 1.2
const POP_SPEED_RANDOM = 1.2
const POP_UP = 3.5
// Lo que tira un jugador sale hacia delante, más lejos que el imán (PICKUP_MAGNET).
const TOSS_SPEED = 5.5
const TOSS_UP = 3.5
/** Desvío máximo (rad) a cada lado: lo que se tira seguido no cae justo en el mismo sitio. */
const TOSS_SPREAD = 0.25
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
  /** Quién lo tiró (null: lo soltó un prop o un enemigo): no lo puede recoger hasta DROP_PICKUP_DELAY. */
  droppedBy: PlayerId | null
  /** No desaparece aunque su objeto caduque: lo que soltó un jugador al morir. */
  keep: boolean
}

/** Segundos que le quedan en el suelo; null: no desaparece. */
export const timeLeft = (p: Pick<Pickup, 'item' | 'age' | 'keep'>): number | null => {
  const limit = GROUND_TIME[p.item]
  return limit === null || p.keep ? null : limit - p.age
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
const SHORE_STEP = 2
const SHORE_RANGE = 300
const SHORE_ANGLES = 16
const groundAt = (island: Island, x: number, z: number) => Math.max(island.heightAt(x, z), WATER_LEVEL)

/** La tierra más cercana a (x, z), buscando en anillos. */
function shoreNear(island: Island, x: number, z: number): { x: number; z: number } {
  for (let r = SHORE_STEP; r < SHORE_RANGE; r += SHORE_STEP) {
    for (let i = 0; i < SHORE_ANGLES; i++) {
      const angle = (i / SHORE_ANGLES) * Math.PI * 2
      const spot = { x: x + Math.cos(angle) * r, z: z + Math.sin(angle) * r }
      if (island.heightAt(spot.x, spot.z) > WATER_LEVEL + 0.2) return spot
    }
  }
  return { x: 0, z: 0 }
}

/**
 * Objetos en el suelo: caen al soltarse, se deslizan hacia un jugador si le caben y se recogen al pasar por encima.
 * Los dibuja PickupView.
 */
export class Pickups {
  readonly list: Pickup[] = []
  private nextId = 0

  /** `grids`: obstáculos de los que se apartan al caer (props, estructuras…). `island`: el suelo donde caen. */
  constructor(
    private grids: SpatialGrid<Collider>[] = [],
    private rng: () => number = Math.random,
    private emit: Emit = NO_EMIT,
    private island: Island = DEFAULT_ISLAND,
  ) {}

  /** Suelta `amount` piezas de una unidad de `item` desde (x, y, z), repartidas alrededor. */
  drop(item: ItemId, amount: number, x: number, y: number, z: number) {
    const offset = this.rng() * Math.PI * 2
    for (let i = 0; i < amount; i++) {
      const angle = offset + ((i + this.rng() * 0.5) / amount) * Math.PI * 2
      this.spawn(item, 1, x, y, z, angle, POP_SPEED + this.rng() * POP_SPEED_RANDOM)
    }
  }

  /** Suelta un único montón con `amount` unidades de `item` desde (x, y, z). Con `keep` no caduca nunca. */
  dropPile(item: ItemId, amount: number, x: number, y: number, z: number, keep = false) {
    this.spawn(item, amount, x, y, z, this.rng() * Math.PI * 2, POP_SPEED, POP_UP, null, keep)
  }

  /** El jugador `by` tira un montón de `amount` unidades desde (x, y, z) hacia donde mira (`yaw`). */
  toss(item: ItemId, amount: number, x: number, y: number, z: number, yaw: number, by: PlayerId) {
    // forward = (-sin(yaw), -cos(yaw)), que es el ángulo atan2(-cos, -sin) en el plano XZ.
    const angle = Math.atan2(-Math.cos(yaw), -Math.sin(yaw)) + (this.rng() * 2 - 1) * TOSS_SPREAD
    this.spawn(item, amount, x, y, z, angle, TOSS_SPEED, TOSS_UP, by)
  }

  private spawn(item: ItemId, amount: number, x: number, y: number, z: number, angle: number, speed: number, up = POP_UP, by: PlayerId | null = null, keep = false) {
    const pickup: Pickup = {
      id: this.nextId++,
      item,
      amount,
      pos: { x, y, z },
      prev: { x, y, z },
      vel: { x: Math.cos(angle) * speed, y: up, z: Math.sin(angle) * speed },
      grounded: false,
      age: 0,
      spin: this.rng() * Math.PI * 2,
      claimedBy: null,
      droppedBy: by,
      keep,
    }
    this.list.push(pickup)
    this.emit({ type: 'pickupSpawn', id: pickup.id, item, amount, ...(keep ? { keep } : {}) })
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
      const left = timeLeft(p)
      if (left !== null && left <= 1e-9) {
        this.list.splice(i, 1)
        this.emit({ type: 'pickupExpired', id: p.id })
        continue
      }
      if (!p.grounded) {
        this.fall(p, dt)
        continue
      }
      if (p.age < PICKUP_DELAY - 1e-9) continue
      // Quien lo acaba de tirar no cuenta: ni lo recoge ni lo atrae.
      const tossing = p.droppedBy !== null && p.age < DROP_PICKUP_DELAY - 1e-9
      // Quién lo tiene a su alcance, del más cercano al más lejano.
      const near: { index: number; d: number }[] = []
      collectors.forEach((c, index) => {
        if (tossing && c.id === p.droppedBy) return
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
      p.pos.y = groundAt(this.island, p.pos.x, p.pos.z)
    }
    return results
  }

  private fall(p: Pickup, dt: number) {
    p.vel.y -= GRAVITY * dt
    p.pos.x += p.vel.x * dt
    p.pos.y += p.vel.y * dt
    p.pos.z += p.vel.z * dt
    for (const grid of this.grids) resolveCircle(p.pos, RADIUS, grid)
    const ground = groundAt(this.island, p.pos.x, p.pos.z)
    if (p.pos.y > ground) return
    p.pos.y = ground
    p.vel.x = p.vel.y = p.vel.z = 0
    p.grounded = true
    // Lo imprescindible no se pierde en el agua: aparece en la orilla.
    if (this.island.heightAt(p.pos.x, p.pos.z) < WATER_LEVEL && KEY_ITEMS.includes(p.item)) {
      Object.assign(p.pos, shoreNear(this.island, p.pos.x, p.pos.z))
      p.pos.y = groundAt(this.island, p.pos.x, p.pos.z)
    }
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
