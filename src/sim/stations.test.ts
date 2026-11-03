import { describe, expect, it } from 'vitest'
import { FUEL_SECONDS, newStation, putInto, slotFor, STATION_STACK, stepStation, takeFrom, type StationState } from './stations'

const run = (station: StationState, seconds: number, kind: 'furnace' | 'campfire' | 'distiller' = 'furnace', factor = 1) => {
  let changes = 0
  for (let t = 0; t < seconds - 1e-9; t += 0.5) if (stepStation(kind, station, 0.5, factor)) changes++
  return changes
}

describe('estaciones con ranuras', () => {
  it('cada cosa va a su ranura: lo que procesa a la entrada y lo que arde al combustible', () => {
    expect(slotFor('furnace', 'iron_ore')).toBe('input')
    expect(slotFor('furnace', 'wood')).toBe('fuel')
    expect(slotFor('furnace', 'coal')).toBe('fuel')
    expect(slotFor('furnace', 'raw_meat')).toBeNull()
    expect(slotFor('campfire', 'raw_meat')).toBe('input')
    expect(slotFor('campfire', 'wood')).toBeNull()
    expect(slotFor('workbench', 'wood')).toBeNull()
  })

  it('el horno funde con combustible, y sin él se para', () => {
    const s = newStation()
    putInto('furnace', s, 'input', 'iron_ore', 3)
    run(s, 20)
    expect(s.output).toBeNull()
    putInto('furnace', s, 'fuel', 'wood', 1)
    run(s, 15)
    expect(s.output).toEqual({ item: 'iron_bar', amount: 1 })
    expect(s.fuel).toBeNull()
    run(s, 30)
    expect(s.output!.amount).toBe(1)
    expect(s.input!.amount).toBe(2)
  })

  it('el carbón arde cuatro veces más que la madera', () => {
    expect(FUEL_SECONDS.coal).toBe(FUEL_SECONDS.wood! * 4)
    const s = newStation()
    putInto('furnace', s, 'input', 'iron_ore', 10)
    putInto('furnace', s, 'fuel', 'coal', 1)
    run(s, 60)
    expect(s.output!.amount).toBe(4)
  })

  it('la fogata cocina sin combustible, y las bayas van de cuatro en cuatro', () => {
    const s = newStation()
    putInto('campfire', s, 'input', 'berry', 9)
    run(s, 30, 'campfire')
    expect(s.output).toEqual({ item: 'berry_infusion', amount: 2 })
    expect(s.input).toEqual({ item: 'berry', amount: 1 })
    run(s, 30, 'campfire')
    expect(s.output!.amount).toBe(2)
  })

  it('con la salida llena o con otra cosa no sigue', () => {
    const s = newStation()
    s.output = { item: 'iron_bar', amount: STATION_STACK }
    putInto('furnace', s, 'input', 'iron_ore', 2)
    putInto('furnace', s, 'fuel', 'coal', 2)
    run(s, 30)
    expect(s.input!.amount).toBe(2)
    expect(s.fuel!.amount).toBe(2)
    s.output = { item: 'mithril_bar', amount: 1 }
    run(s, 30)
    expect(s.input!.amount).toBe(2)
  })

  it('no se mete lo que no va, ni en una ranura con otra cosa, ni pasado el tope', () => {
    const s = newStation()
    expect(putInto('furnace', s, 'output', 'iron_bar', 1)).toBe(0)
    expect(putInto('furnace', s, 'input', 'wood', 1)).toBe(0)
    expect(putInto('furnace', s, 'input', 'iron_ore', 5)).toBe(5)
    expect(putInto('furnace', s, 'input', 'mithril_ore', 1)).toBe(0)
    expect(putInto('furnace', s, 'input', 'iron_ore', 500)).toBe(STATION_STACK - 5)
  })

  it('sacar la entrada a medias empieza de cero, y sacar la salida la vacía', () => {
    const s = newStation()
    putInto('furnace', s, 'input', 'iron_ore', 2)
    putInto('furnace', s, 'fuel', 'wood', 5)
    run(s, 10)
    expect(s.progress).toBeGreaterThan(0)
    expect(takeFrom(s, 'input')).toEqual({ item: 'iron_ore', amount: 2 })
    expect(s.progress).toBe(0)
    putInto('furnace', s, 'input', 'iron_ore', 1)
    run(s, 15)
    expect(takeFrom(s, 'output')).toEqual({ item: 'iron_bar', amount: 1 })
    expect(s.output).toBeNull()
  })

  it('la dificultad alarga lo que tarda', () => {
    const s = newStation()
    putInto('campfire', s, 'input', 'raw_meat', 1)
    run(s, 10, 'campfire', 2)
    expect(s.output).toBeNull()
    run(s, 10, 'campfire', 2)
    expect(s.output).toEqual({ item: 'cooked_meat', amount: 1 })
  })
})
