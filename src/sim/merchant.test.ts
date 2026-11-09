import { describe, expect, it } from 'vitest'
import { Inventory } from './inventory'
import { newShop, OFFERS, offerOf, priceOf, PURCHASES, trade } from './merchant'
import { Simulation } from './Simulation'
import { Threat } from './threat'
import { mulberry32 } from './random'

describe('el mercader', () => {
  it('vende si hay monedas, y lo que más ayuda sube de precio con cada compra', () => {
    const shop = newShop()
    const inventory = new Inventory()
    inventory.add('coin', 100)
    const incense = offerOf('calm_incense')!
    expect(priceOf(incense, shop)).toBe(25)
    expect(trade(shop, inventory, { op: 'buy', item: 'calm_incense' })).toBe(true)
    expect(inventory.count('calm_incense')).toBe(1)
    expect(inventory.count('coin')).toBe(75)
    expect(priceOf(incense, shop)).toBe(38)
    // Las pociones no suben.
    const potion = offerOf('healing_potion')!
    trade(shop, inventory, { op: 'buy', item: 'healing_potion' })
    expect(priceOf(potion, shop)).toBe(potion.price)
  })

  it('sin monedas suficientes no vende, y el amuleto solo si hace algo', () => {
    const shop = newShop()
    const inventory = new Inventory()
    inventory.add('coin', 5)
    expect(trade(shop, inventory, { op: 'buy', item: 'healing_potion' })).toBe(false)
    inventory.add('coin', 100)
    expect(trade(shop, inventory, { op: 'buy', item: 'forget_amulet' }, false)).toBe(false)
    expect(trade(shop, inventory, { op: 'buy', item: 'forget_amulet' }, true)).toBe(true)
  })

  it('compra en lotes, y lo que no puede perderse no', () => {
    const shop = newShop()
    const inventory = new Inventory()
    inventory.add('stone', 25)
    expect(trade(shop, inventory, { op: 'sell', item: 'stone' })).toBe(true)
    expect(trade(shop, inventory, { op: 'sell', item: 'stone' })).toBe(true)
    expect(trade(shop, inventory, { op: 'sell', item: 'stone' })).toBe(false)
    expect(inventory.count('stone')).toBe(5)
    expect(inventory.count('coin')).toBe(2)
    inventory.add('plane_engine', 1)
    expect(trade(shop, inventory, { op: 'sell', item: 'plane_engine' })).toBe(false)
  })

  it('comprar y vender nunca da ganancia: nada de lo que vende se le puede vender', () => {
    for (const offer of OFFERS) expect(PURCHASES[offer.item]).toBeUndefined()
  })

  it('el amuleto deshace el último rasgo, y sin rasgos no hace nada', () => {
    const threat = new Threat()
    const rng = mulberry32(1)
    expect(threat.canForget).toBe(false)
    expect(threat.forget()).toBeNull()
    threat.fall(rng)
    const first = threat.rise(rng)
    const second = threat.rise(rng)
    expect(threat.forget()).toBe(second)
    expect(threat.state.level).toBe(1)
    expect(threat.forget()).toBe(first)
    expect(threat.canForget).toBe(false)
  })

  it('en la partida: el puesto ya está en la isla y el incienso deshace a los mobs comunes sin botín', () => {
    const sim = new Simulation(1)
    const slot = sim.addPlayer(0)
    sim.startMatch({ players: 1, difficulty: 'normal' })
    const merchant = sim.structures.list.find((s) => s.kind === 'merchant')
    expect(merchant?.shop).toBeDefined()
    sim.enemies.spawnAt(merchant!.x + 10, merchant!.z, 'goblin')
    slot.inventory.add('calm_incense', 1)
    slot.inventory.select(slot.inventory.slots.indexOf('calm_incense'))
    const events = sim.step(new Map([[0, { move: { tick: sim.tick + 1, buttons: 0, yaw: 0, pitch: 0 }, actions: [{ kind: 'eat', seq: 1, tick: sim.tick + 1 }] }]]))
    expect(events.map((e) => e.type)).toContain('mobsCalmed')
    expect(sim.enemies.list).toHaveLength(0)
    expect(sim.pickups.list.filter((p) => p.item === 'raw_meat')).toHaveLength(0)
  })
})
