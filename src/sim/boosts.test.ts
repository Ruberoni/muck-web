import { describe, expect, it } from 'vitest'
import {
  BOOST_DEFS,
  BOOST_IDS,
  BOOST_PAYMENTS,
  BOOST_PRICE,
  BOOST_PRICE_RISE,
  boostCost,
  boostedDamage,
  boostFactor,
  boostProblem,
  buyBoost,
  isBoostId,
  isBoostPayment,
  levelOf,
  maxHealthOf,
  type BoostId,
  type BoostLevels,
  type BoostPayment,
} from './boosts'
import { HEALTH_MAX, HEALTH_REGEN_PER_SEC, HUNGER_DRAIN_PER_SEC, HUNGER_MAX, STAMINA_MAX, STAMINA_REGEN_PER_SEC, STEP } from './constants'
import { Inventory } from './inventory'
import { attackDamage } from './tiers'
import { createPlayer, NO_INPUT, stepPlayer } from './player'
import { NO_HEALING, stepSurvival, type Vitals } from './survival'
import { Simulation } from './Simulation'

const vitals = (health: number, hunger: number, boosts?: BoostLevels): Vitals => ({ health, hunger, boosts, ...NO_HEALING })
const run = (v: Vitals, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / STEP); i++) stepSurvival(v, STEP)
}

describe('las mejoras del mercader', () => {
  it('cada nivel suma 50 monedas al precio, y los materiales van al mismo cambio', () => {
    expect(BOOST_PRICE).toBe(100)
    expect(BOOST_PRICE_RISE).toBe(50)
    expect([0, 1, 2, 3].map((level) => boostCost({ damage: level }, 'damage', 'coin'))).toEqual([100, 150, 200, 250])
    // El mithril y el hierro valen lo que su precio del primer nivel diga, redondeado hacia arriba.
    expect(boostCost({}, 'damage', 'mithril_bar')).toBe(25)
    expect(boostCost({ damage: 1 }, 'damage', 'mithril_bar')).toBe(38)
    expect(boostCost({}, 'damage', 'iron_bar')).toBe(60)
    expect(boostCost({ damage: 1 }, 'damage', 'iron_bar')).toBe(90)
    // El precio es de cada mejora por separado.
    expect(boostCost({ damage: 2 }, 'health', 'coin')).toBe(100)
  })

  it('cada nivel multiplica el anterior, y el del hambre lo baja', () => {
    expect(boostFactor({}, 'damage')).toBe(1)
    expect(boostFactor(undefined, 'damage')).toBe(1)
    expect(boostFactor({ damage: 1 }, 'damage')).toBeCloseTo(1.5)
    expect(boostFactor({ damage: 2 }, 'damage')).toBeCloseTo(2.25)
    expect(boostFactor({ hunger: 1 }, 'hunger')).toBe(0.5)
    expect(boostFactor({ hunger: 2 }, 'hunger')).toBe(0.25)
    expect(boostFactor({ knockback: 1 }, 'knockback')).toBe(2)
    // Todas las mejoras existen, tienen nombre y un factor con sentido.
    for (const id of BOOST_IDS) {
      expect(BOOST_DEFS[id].name.length, id).toBeGreaterThan(0)
      expect(BOOST_DEFS[id].factor, id).toBeGreaterThan(0)
      expect(levelOf(undefined, id), id).toBe(0)
    }
  })

  it('la vida máxima sube con la vitalidad', () => {
    expect(maxHealthOf(undefined)).toBe(HEALTH_MAX)
    expect(maxHealthOf({})).toBe(HEALTH_MAX)
    expect(maxHealthOf({ health: 1 })).toBe(150)
    expect(maxHealthOf({ health: 2 })).toBe(225)
  })

  it('el daño sube redondeado, y lo que no se puede golpear sigue sin poder', () => {
    const base = attackDamage('mithril_sword', 'goblin')
    expect(boostedDamage(base, {})).toBe(base)
    expect(boostedDamage(base, { damage: 1 })).toBe(Math.round(base * 1.5))
    expect(boostedDamage(base, { damage: 2 })).toBe(Math.round(base * 2.25))
    // A mano (1 de daño) con media mejora: sigue siendo un golpe entero, no 0,5 ni 0.
    expect(boostedDamage(1, { damage: 1 })).toBe(2)
    expect(boostedDamage(0, { damage: 3 })).toBe(0)
  })

  it('cambia las tasas del jugador: hambre más lenta, más vida y más regeneración', () => {
    const plain = vitals(HEALTH_MAX, HUNGER_MAX)
    const boosted = vitals(HEALTH_MAX, HUNGER_MAX, { hunger: 1 })
    run(plain, 10)
    run(boosted, 10)
    expect(plain.hunger).toBeCloseTo(HUNGER_MAX - HUNGER_DRAIN_PER_SEC * 10, 6)
    expect(boosted.hunger).toBeCloseTo(HUNGER_MAX - (HUNGER_DRAIN_PER_SEC * 10) / 2, 6)

    // Regenera 1,5 por segundo y llega a su máximo (150), no al de siempre.
    const healing = vitals(50, HUNGER_MAX, { regen: 1, health: 1 })
    run(healing, 1)
    expect(healing.health).toBeCloseTo(50 + HEALTH_REGEN_PER_SEC * 1.5, 6)
    run(healing, 200)
    expect(healing.health).toBe(150)
  })

  it('la resistencia se recupera más deprisa con aguante', () => {
    const env = { heightAt: () => 0 }
    const plain = createPlayer(env, 0, 0)
    const boosted = createPlayer(env, 0, 0)
    boosted.boosts = { stamina: 1 }
    for (const player of [plain, boosted]) {
      player.stamina = 0
      for (let i = 0; i < Math.round(1 / STEP); i++) stepPlayer(player, NO_INPUT, env, STEP)
    }
    expect(plain.stamina).toBeCloseTo(STAMINA_REGEN_PER_SEC, 6)
    expect(boosted.stamina).toBeCloseTo(STAMINA_REGEN_PER_SEC * 1.5, 6)
    expect(boosted.stamina).toBeLessThan(STAMINA_MAX)
  })

  it('se pagan con monedas o con materiales, y sin ellas no se compra', () => {
    const player = { health: 100, boosts: {} as BoostLevels }
    const poor = new Inventory()
    expect(boostProblem(undefined, 'damage', 'coin', poor)).toBe('Faltan 100')
    expect(buyBoost(player, 'damage', 'coin', poor)).toBeNull()
    expect(player.boosts.damage).toBeUndefined()

    const rich = new Inventory()
    rich.add('coin', 100)
    expect(boostProblem(undefined, 'damage', 'coin', rich)).toBeNull()
    expect(buyBoost(player, 'damage', 'coin', rich)).toBe(1)
    expect(rich.count('coin')).toBe(0)
    expect(player.boosts.damage).toBe(1)

    // El segundo nivel, con lingotes: 38 de mithril.
    rich.add('mithril_bar', 38)
    expect(buyBoost(player, 'damage', 'mithril_bar', rich)).toBe(2)
    expect(rich.count('mithril_bar')).toBe(0)
    expect(player.boosts.damage).toBe(2)

    // Los niveles se cambian por un objeto nuevo: el que ya se tenía no cambia (la predicción lo copia).
    const before = player.boosts
    rich.add('coin', 200)
    buyBoost(player, 'damage', 'coin', rich)
    expect(before.damage).toBe(2)
    expect(player.boosts.damage).toBe(3)
    expect(player.boosts).not.toBe(before)
  })

  it('comprar vitalidad también cura lo que sube', () => {
    const player = { health: 40, boosts: {} as BoostLevels }
    const inventory = new Inventory()
    inventory.add('coin', 100)
    expect(buyBoost(player, 'health', 'coin', inventory)).toBe(1)
    expect(player.health).toBe(90)
    expect(maxHealthOf(player.boosts)).toBe(150)
  })

  it('en la partida: se compran junto al puesto, con monedas o con lingotes', () => {
    const sim = new Simulation(1)
    const slot = sim.addPlayer(0)
    sim.startMatch({ players: 1, difficulty: 'normal' })
    const merchant = sim.structures.list.find((s) => s.kind === 'merchant')!
    slot.player.pos.x = merchant.x + 3
    slot.player.pos.z = merchant.z
    slot.inventory.add('coin', 100)
    let seq = 0
    const buy = (boost: BoostId, pay: BoostPayment) =>
      sim.step(new Map([[0, { move: { tick: sim.tick + 1, buttons: 0, yaw: 0, pitch: 0 }, actions: [{ kind: 'shop', id: merchant.id, op: 'boost', boost, pay, seq: ++seq, tick: sim.tick + 1 }] }]]))

    const events = buy('damage', 'coin')
    expect(slot.player.boosts!.damage).toBe(1)
    expect(slot.inventory.count('coin')).toBe(0)
    expect(events).toContainEqual(expect.objectContaining({ type: 'playerTraded', op: 'boost', item: 'coin', boost: 'damage', id: 0 }))

    // Sin nada con que pagar no se compra, y no se emite nada.
    const broke = buy('damage', 'coin')
    expect(slot.player.boosts!.damage).toBe(1)
    expect(broke.some((e) => e.type === 'playerTraded')).toBe(false)

    // Con lingotes sí, al precio del segundo nivel.
    slot.inventory.add('mithril_bar', 38)
    buy('damage', 'mithril_bar')
    expect(slot.player.boosts!.damage).toBe(2)
    expect(slot.inventory.count('mithril_bar')).toBe(0)

    // Y lejos del puesto, nada.
    slot.inventory.add('coin', 500)
    slot.player.pos.x = merchant.x + 60
    buy('health', 'coin')
    expect(slot.player.boosts!.health).toBeUndefined()
    expect(slot.inventory.count('coin')).toBe(500)
  })

  it('el cable solo acepta mejoras y pagos que existen', () => {
    expect(isBoostId('damage')).toBe(true)
    expect(isBoostId('speed')).toBe(false)
    expect(isBoostId(3)).toBe(false)
    for (const pay of BOOST_PAYMENTS) expect(isBoostPayment(pay)).toBe(true)
    expect(isBoostPayment('wood')).toBe(false)
  })
})
