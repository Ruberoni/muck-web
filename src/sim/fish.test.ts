import { describe, expect, it } from 'vitest'
import { FLOAT_DEPTH, STEP } from './constants'
import { FISH_BITE, FISH_BITE_INTERVAL, FISH_DELAY, Fishes } from './fish'
import { pickIsland } from './islands'
import { Simulation } from './Simulation'
import { heightAt, WATER_LEVEL } from './world/terrain'
import type { SimEventData } from './events'

describe('el pez', () => {
  const swim = (fishes: Fishes, seconds: number, inSea = true, alive = true) => {
    const bites: number[] = []
    for (let t = 0; t < seconds - 1e-9; t += STEP) for (const b of fishes.step(STEP, [{ id: 0, alive, inSea }])) bites.push(b.damage)
    return bites
  }

  it('aparece tras FISH_DELAY segundos seguidos en el mar y muerde FISH_BITE cada FISH_BITE_INTERVAL', () => {
    const events: SimEventData[] = []
    const fishes = new Fishes((e) => events.push(e))
    swim(fishes, FISH_DELAY - 0.5)
    expect(fishes.list).toEqual([])
    swim(fishes, 0.6)
    expect(events).toEqual([{ type: 'fishAppeared', id: 0 }])
    expect(swim(fishes, FISH_BITE_INTERVAL * 3 + 0.1)).toEqual([FISH_BITE, FISH_BITE, FISH_BITE])
    expect(events.filter((e) => e.type === 'fishBite')).toHaveLength(3)
  })

  it('salir del mar (o morir) lo espanta, y la cuenta vuelve a empezar', () => {
    const events: SimEventData[] = []
    const fishes = new Fishes((e) => events.push(e))
    swim(fishes, FISH_DELAY + 1)
    swim(fishes, STEP, false)
    expect(fishes.list).toEqual([])
    expect(events.at(-1)).toEqual({ type: 'fishLeft', id: 0 })
    swim(fishes, FISH_DELAY - 1)
    expect(fishes.list).toEqual([])
    swim(fishes, 2)
    swim(fishes, STEP, true, false)
    expect(fishes.list).toEqual([])
    // Quien se va del mundo se lo lleva.
    swim(fishes, FISH_DELAY + 1)
    fishes.step(STEP, [])
    expect(fishes.list).toEqual([])
  })

  it('en la partida: muerde a quien nada lejos de la orilla, la armadura lo reduce, el escudo no, y no es un enemigo', () => {
    const sim = new Simulation(1)
    const slot = sim.addPlayer(0)
    expect(heightAt(0, 94)).toBeLessThan(WATER_LEVEL - FLOAT_DEPTH)
    slot.inventory.add('iron_chestplate', 1)
    slot.inventory.add('crystal_shield', 1)
    slot.inventory.equip(0)
    slot.inventory.equip(0)
    sim.teleport(0, 0, 94, 0, 0)
    const events: SimEventData[] = []
    for (let i = 0; i < Math.round((FISH_DELAY + FISH_BITE_INTERVAL + 0.2) / STEP); i++) {
      slot.player.health = 100
      events.push(...sim.step(new Map()))
    }
    expect(slot.player.floating).toBe(true)
    expect(events.map((e) => e.type)).toContain('fishAppeared')
    const bite = events.find((e) => e.type === 'playerHurt')!
    expect(bite).toMatchObject({ dmg: expect.closeTo(FISH_BITE * 0.8, 6) })
    expect(bite).not.toHaveProperty('blocked')
    expect(sim.enemies.list).toEqual([])
    // Se guarda con la partida.
    const copy = Simulation.fromJSON(JSON.parse(JSON.stringify(sim.toJSON())))
    expect(copy.fishes.list).toEqual(sim.fishes.list)
    // A la orilla, se va.
    sim.teleport(0, sim.spawnCenter.x, sim.spawnCenter.z, 0, 0)
    expect(sim.step(new Map()).map((e) => e.type)).toContain('fishLeft')
    expect(sim.fishes.list).toEqual([])
  })

  it('en los lagos no hay peces, aunque cubran', () => {
    const island = pickIsland(11)
    const sim = new Simulation(1, undefined, island)
    const slot = sim.addPlayer(0)
    const lake = island.lakes[0]
    sim.teleport(0, lake.x, lake.z, 0, 0)
    for (let i = 0; i < Math.round((FISH_DELAY + 3) / STEP); i++) {
      slot.player.hunger = 100
      sim.step(new Map())
    }
    expect(slot.player.floating).toBe(true)
    expect(sim.fishes.list).toEqual([])
  })
})
