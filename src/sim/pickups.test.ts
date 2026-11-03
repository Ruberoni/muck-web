import { describe, expect, it } from 'vitest'
import { mulberry32 } from './random'
import { heightAt, ROCK_LEVEL, SAND_LEVEL } from './world/terrain'
import { DROP_PICKUP_DELAY, PICKUP_DELAY, PICKUP_MAGNET, PICKUP_RADIUS, STEP } from './constants'
import { GROUND_TIME, Inventory, KEY_ITEMS, type ItemId } from './inventory'
import { Pickups, timeLeft } from './pickups'
import type { SimEventData } from './events'

/** Primer punto de hierba en espiral desde el centro. */
function grassSpot() {
  for (let i = 0; i < 4000; i++) {
    const angle = i * 0.5
    const r = angle * 0.4
    const x = Math.cos(angle) * r
    const z = Math.sin(angle) * r
    const h = heightAt(x, z)
    if (h > SAND_LEVEL + 0.3 && h < ROCK_LEVEL) return { x, z }
  }
  throw new Error('sin hierba')
}

const spot = grassSpot()

/** `size`: casillas del inventario (pocas para llenarlo con los objetos que hay). */
function setup(size?: number) {
  const pickups = new Pickups([], mulberry32(1))
  const inventory = new Inventory(size)
  const run = (seconds: number, player: { x: number; y: number; z: number }) => {
    let collected = 0
    let full = false
    for (let i = 0; i < Math.round(seconds / STEP); i++) {
      const [r] = pickups.step(STEP, [{ id: 0, pos: player, inventory }])
      collected += r.collected
      full = r.full
    }
    return { collected, full }
  }
  /** Muy lejos: nada se recoge ni se desliza. */
  const away = { x: spot.x + 100, y: 0, z: spot.z }
  const at = (x: number, z: number) => ({ x, y: heightAt(x, z), z })
  /** Suelta y deja que caigan. */
  const dropAndLand = (item: ItemId, amount: number) => {
    pickups.drop(item, amount, spot.x, heightAt(spot.x, spot.z) + 1, spot.z)
    run(1, away)
  }
  return { pickups, inventory, run, away, at, dropAndLand }
}

describe('objetos en el suelo', () => {
  it('saltan, caen al suelo cerca de donde se soltaron y se reparten', () => {
    const { pickups, dropAndLand } = setup()
    dropAndLand('wood', 4)
    expect(pickups.list).toHaveLength(4)
    for (const p of pickups.list) {
      expect(p.grounded).toBe(true)
      expect(p.pos.y).toBeCloseTo(heightAt(p.pos.x, p.pos.z))
      const d = Math.hypot(p.pos.x - spot.x, p.pos.z - spot.z)
      expect(d).toBeGreaterThan(0.3)
      expect(d).toBeLessThan(3)
    }
    // Ninguna cae encima de otra.
    const [a, b] = pickups.list
    expect(Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z)).toBeGreaterThan(0.3)
  })

  it('no se recogen nada más soltarse aunque el jugador esté encima', () => {
    const { pickups, inventory, run, at } = setup()
    pickups.drop('stone', 1, spot.x, heightAt(spot.x, spot.z), spot.z)
    // Cae enseguida (sale a ras de suelo) pero aún no se puede recoger.
    const p = pickups.list[0]
    run(PICKUP_DELAY - 0.1, at(p.pos.x, p.pos.z))
    expect(inventory.count('stone')).toBe(0)
    run(0.2, at(p.pos.x, p.pos.z))
    expect(inventory.count('stone')).toBe(1)
    expect(pickups.list).toHaveLength(0)
  })

  it('se recogen al pasar por encima, uno a uno, y entran en el inventario', () => {
    const { pickups, inventory, run, at, dropAndLand } = setup()
    dropAndLand('wood', 4)
    let collected = 0
    for (const { pos } of [...pickups.list]) collected += run(STEP, at(pos.x, pos.z)).collected
    expect(collected).toBe(4)
    expect(inventory.count('wood')).toBe(4)
    expect(inventory.slots[0]).toBe('wood')
  })

  it('lejos se quedan quietos; cerca se deslizan hacia el jugador', () => {
    const { pickups, inventory, run, at, dropAndLand } = setup()
    dropAndLand('stone', 1)
    const p = pickups.list[0]
    const start = { ...p.pos }
    const far = at(p.pos.x + PICKUP_MAGNET + 0.3, p.pos.z)
    run(1, far)
    expect(p.pos.x).toBe(start.x)
    expect(inventory.count('stone')).toBe(0)

    const near = at(p.pos.x + (PICKUP_MAGNET + PICKUP_RADIUS) / 2, p.pos.z)
    run(STEP, near)
    expect(p.pos.x).toBeGreaterThan(start.x)
    run(0.5, near)
    expect(inventory.count('stone')).toBe(1)
  })

  it('con el inventario lleno un objeto nuevo se queda en el suelo, no se desliza y avisa', () => {
    // Las 27 casillas no se llenan con los objetos que hay: un inventario de una casilla, ocupada.
    const { pickups, inventory, at, dropAndLand } = setup(1)
    inventory.add('stone', 1)
    dropAndLand('wood', 1)
    const [p] = pickups.list
    const start = { ...p.pos }
    const near = at(p.pos.x + (PICKUP_MAGNET + PICKUP_RADIUS) / 2, p.pos.z)
    for (let i = 0; i < 30; i++) pickups.step(STEP, [{ id: 0, pos: near, inventory }])
    expect(p.pos).toEqual(start)
    expect(pickups.step(STEP, [{ id: 0, pos: at(p.pos.x, p.pos.z), inventory }])[0]).toEqual({ collected: 0, full: true })
    expect(pickups.list).toHaveLength(1)

    inventory.remove('stone', 1)
    expect(pickups.step(STEP, [{ id: 0, pos: at(p.pos.x, p.pos.z), inventory }])[0]).toEqual({ collected: 1, full: false })
    expect(inventory.count('wood')).toBe(1)
  })

  it('el que ya está en el inventario se recoge aunque no queden casillas libres', () => {
    const { pickups, inventory, run, at, dropAndLand } = setup(2)
    const fill: ItemId[] = ['wood', 'stone']
    fill.forEach((item) => inventory.add(item, 1))
    expect(inventory.slots.includes(null)).toBe(false)
    dropAndLand('wood', 1)
    const [p] = pickups.list
    run(STEP, at(p.pos.x, p.pos.z))
    expect(inventory.count('wood')).toBe(2)
  })

  it('saltando muy por encima no se recogen', () => {
    const { pickups, inventory, run, at, dropAndLand } = setup()
    dropAndLand('stone', 1)
    const [p] = pickups.list
    const above = at(p.pos.x, p.pos.z)
    above.y += 3
    run(0.5, above)
    expect(inventory.count('stone')).toBe(0)
  })

  it('clear los quita todos', () => {
    const { pickups, dropAndLand } = setup()
    dropAndLand('wood', 4)
    pickups.clear()
    expect(pickups.list).toHaveLength(0)
  })

  it('un montón cae entero y da todas sus unidades de una vez', () => {
    const { pickups, inventory, run, at } = setup()
    pickups.dropPile('stone', 5, spot.x, heightAt(spot.x, spot.z) + 1, spot.z)
    expect(pickups.list).toHaveLength(1)
    expect(pickups.list[0].amount).toBe(5)
    run(1, { x: spot.x + 100, y: 0, z: spot.z })
    const [p] = pickups.list
    expect(p.grounded).toBe(true)
    expect(run(STEP, at(p.pos.x, p.pos.z)).collected).toBe(5)
    expect(inventory.count('stone')).toBe(5)
    expect(pickups.list).toHaveLength(0)
  })

  it('lo que sueltan props y enemigos va en piezas de una unidad', () => {
    const { pickups, dropAndLand } = setup()
    dropAndLand('wood', 3)
    expect(pickups.list.map((p) => p.amount)).toEqual([1, 1, 1])
  })

  it('cada pieza tiene un id propio que no se reutiliza al recoger otras', () => {
    const { pickups, run, at, dropAndLand } = setup()
    dropAndLand('wood', 3)
    expect(pickups.list.map((p) => p.id)).toEqual([0, 1, 2])
    const [first] = pickups.list
    run(STEP, at(first.pos.x, first.pos.z))
    expect(pickups.list.map((p) => p.id)).not.toContain(0)
    dropAndLand('stone', 1)
    expect(pickups.list.at(-1)!.id).toBe(3)
    pickups.clear()
    dropAndLand('stone', 1)
    expect(pickups.list[0].id).toBe(0)
  })

  it('con la misma semilla caen en el mismo sitio', () => {
    const positions = () => {
      const { pickups, dropAndLand } = setup()
      dropAndLand('wood', 4)
      return pickups.list.map((p) => p.pos)
    }
    expect(positions()).toEqual(positions())
  })

  it('lo que tira un jugador sale hacia donde mira, más lejos que el imán', () => {
    const { pickups, run, away } = setup()
    const y = heightAt(spot.x, spot.z) + 1.2
    // yaw 0 mira a -z; yaw π/2, a -x.
    pickups.toss('wood', 3, spot.x, y, spot.z, 0, 0)
    pickups.toss('stone', 1, spot.x, y, spot.z, Math.PI / 2, 0)
    run(1, away)
    const [wood, stone] = pickups.list
    expect(wood).toMatchObject({ item: 'wood', amount: 3, droppedBy: 0, grounded: true })
    // Hacia delante, con un desvío pequeño.
    expect(spot.z - wood.pos.z).toBeGreaterThan(PICKUP_MAGNET)
    expect(Math.abs(wood.pos.x - spot.x)).toBeLessThan((spot.z - wood.pos.z) * 0.3)
    expect(spot.x - stone.pos.x).toBeGreaterThan(PICKUP_MAGNET)
    expect(Math.abs(stone.pos.z - spot.z)).toBeLessThan((spot.x - stone.pos.x) * 0.3)
  })

  it('quien lo tira no lo recoge ni lo atrae hasta DROP_PICKUP_DELAY; los demás, sí', () => {
    const { pickups, inventory, at } = setup()
    const other = new Inventory()
    const y = heightAt(spot.x, spot.z) + 1.2
    pickups.toss('wood', 2, spot.x, y, spot.z, 0, 0)
    const steps = (seconds: number, who: { id: number; inventory: Inventory }) => {
      for (let i = 0; i < Math.round(seconds / STEP); i++) {
        const p = pickups.list[0]
        // Siempre encima, aunque se mueva.
        pickups.step(STEP, p ? [{ ...who, pos: at(p.pos.x, p.pos.z) }] : [])
      }
    }
    steps(DROP_PICKUP_DELAY - 0.1, { id: 0, inventory })
    expect(inventory.count('wood')).toBe(0)
    expect(pickups.list).toHaveLength(1)
    steps(0.2, { id: 0, inventory })
    expect(inventory.count('wood')).toBe(2)

    pickups.toss('stone', 1, spot.x, y, spot.z, 0, 0)
    steps(PICKUP_DELAY + 0.6, { id: 1, inventory: other })
    expect(other.count('stone')).toBe(1)
  })
})

describe('tiempo en el suelo', () => {
  it('cada objeto dice cuánto dura, y lo imprescindible y las monedas no caducan', () => {
    expect(GROUND_TIME.wood).toBeGreaterThan(0)
    expect(GROUND_TIME.raw_meat).toBeLessThan(GROUND_TIME.wood!)
    expect(GROUND_TIME.iron_axe).toBeGreaterThan(GROUND_TIME.wood!)
    for (const item of [...KEY_ITEMS, 'coin'] as const) expect(GROUND_TIME[item]).toBeNull()
  })

  it('al pasar su tiempo desaparece, y lo avisa', () => {
    const events: SimEventData[] = []
    const pickups = new Pickups([], mulberry32(1), (e) => events.push(e))
    pickups.drop('raw_meat', 1, spot.x, heightAt(spot.x, spot.z) + 1, spot.z)
    const far = [{ id: 0, pos: { x: spot.x + 100, y: 0, z: spot.z }, inventory: new Inventory() }]
    for (let i = 0; i < Math.round((GROUND_TIME.raw_meat! - 1) / STEP); i++) pickups.step(STEP, far)
    expect(pickups.list).toHaveLength(1)
    for (let i = 0; i < Math.round(2 / STEP); i++) pickups.step(STEP, far)
    expect(pickups.list).toHaveLength(0)
    expect(events.map((e) => e.type)).toContain('pickupExpired')
  })

  it('lo que suelta un jugador al morir y las monedas no desaparecen nunca', () => {
    const pickups = new Pickups([], mulberry32(1))
    const y = heightAt(spot.x, spot.z) + 1
    pickups.dropPile('wood', 30, spot.x, y, spot.z, true)
    pickups.drop('coin', 2, spot.x, y, spot.z)
    pickups.drop('wood', 1, spot.x, y, spot.z)
    const far = [{ id: 0, pos: { x: spot.x + 100, y: 0, z: spot.z }, inventory: new Inventory() }]
    for (let i = 0; i < Math.round((GROUND_TIME.wood! + 5) / STEP); i++) pickups.step(STEP, far)
    expect(pickups.list.map((p) => p.item).sort()).toEqual(['coin', 'coin', 'wood'])
    expect(pickups.list.find((p) => p.item === 'wood')!.keep).toBe(true)
  })

  it('el tiempo que queda sirve para avisar antes de que desaparezca', () => {
    expect(timeLeft({ item: 'wood', age: 100, keep: false })).toBe(GROUND_TIME.wood! - 100)
    expect(timeLeft({ item: 'wood', age: 100, keep: true })).toBeNull()
    expect(timeLeft({ item: 'coin', age: 100, keep: false })).toBeNull()
  })
})
