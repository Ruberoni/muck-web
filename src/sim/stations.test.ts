import { describe, expect, it } from 'vitest'
import { burnLeft, followStation, fuelSeconds, isLit, newStation, putInto, slotFor, stationStall, STATION_DEFS, STATION_STACK, stepStation, takeFrom, type StationState } from './stations'

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
    expect(slotFor('campfire', 'wood')).toBe('fuel')
    expect(slotFor('campfire', 'birch_wood')).toBe('fuel')
    expect(slotFor('campfire', 'dark_wood')).toBe('fuel')
    expect(slotFor('campfire', 'coal')).toBeNull()
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
    expect(fuelSeconds('furnace', 'coal')).toBe(fuelSeconds('furnace', 'wood')! * 4)
    const s = newStation()
    putInto('furnace', s, 'input', 'iron_ore', 10)
    putInto('furnace', s, 'fuel', 'coal', 1)
    run(s, 60)
    expect(s.output!.amount).toBe(4)
  })

  it('la fogata cocina con leña, y las bayas van de cuatro en cuatro', () => {
    const s = newStation()
    putInto('campfire', s, 'fuel', 'wood', 2)
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
    putInto('campfire', s, 'fuel', 'wood', 1)
    putInto('campfire', s, 'input', 'raw_meat', 1)
    run(s, 10, 'campfire', 2)
    expect(s.output).toBeNull()
    run(s, 10, 'campfire', 2)
    expect(s.output).toEqual({ item: 'cooked_meat', amount: 1 })
  })

  it('la fogata avisa al empezar y al pararse, para que la barra del cliente siga a la de verdad', () => {
    const s = newStation()
    putInto('campfire', s, 'fuel', 'wood', 1)
    putInto('campfire', s, 'input', 'raw_meat', 1)
    expect(stepStation('campfire', s, 0.5, 1)).toBe(true)
    expect(s.time).toBe(10)
    expect(stepStation('campfire', s, 0.5, 1)).toBe(false)
    // Al acabar la única carne cambia la salida, y el paso siguiente ya no tiene nada que hacer: no avisa otra vez.
    expect(run(s, 10, 'campfire')).toBe(1)
    expect(s.time).toBe(0)
    // Sin sitio en la salida se para y lo dice.
    putInto('campfire', s, 'input', 'berry', 4)
    expect(stepStation('campfire', s, 0.5, 1)).toBe(false)
    expect(stationStall('campfire', s)).toMatch(/Saca carne asada/)
  })

  it('la copia del cliente avanza la unidad y lo que arde, y espera sin nada ardiendo', () => {
    const s = newStation()
    putInto('furnace', s, 'input', 'iron_ore', 1)
    putInto('furnace', s, 'fuel', 'wood', 1)
    stepStation('furnace', s, 0.5, 1)
    const copy = { ...s }
    followStation('furnace', copy, 5)
    expect(copy.progress).toBeCloseTo(5.5)
    expect(copy.burn).toBeCloseTo(9.5)
    copy.burn = 0
    followStation('furnace', copy, 5)
    expect(copy.progress).toBeCloseTo(5.5)
    const fire = newStation()
    followStation('campfire', fire, 5)
    expect(fire.progress).toBe(0)
  })

  it('la copia del cliente de la fogata gasta leña sin cocinar nada, y se apaga', () => {
    const s = newStation()
    putInto('campfire', s, 'fuel', 'wood', 1)
    stepStation('campfire', s, 0.5, 1)
    const copy = { ...s }
    followStation('campfire', copy, 50)
    expect(copy.burn).toBeCloseTo(9.5)
    expect(isLit(copy)).toBe(true)
    followStation('campfire', copy, 20)
    expect(copy.burn).toBe(0)
    expect(isLit(copy)).toBe(false)
  })

  it('dice por qué no trabaja', () => {
    const s = newStation()
    expect(stationStall('campfire', s)).toBeNull()
    putInto('campfire', s, 'input', 'berry', 3)
    expect(stationStall('campfire', s)).toMatch(/Faltan 1/)
    putInto('campfire', s, 'input', 'berry', 1)
    putInto('campfire', s, 'fuel', 'wood', 1)
    expect(stationStall('campfire', s)).toBeNull()
    const f = newStation()
    putInto('furnace', f, 'input', 'iron_ore', 1)
    expect(stationStall('furnace', f)).toBe('Sin combustible: madera, madera seca o carbón')
    expect(stationStall('campfire', newStation())).toBeNull()
    const c = newStation()
    putInto('campfire', c, 'input', 'raw_meat', 1)
    expect(stationStall('campfire', c)).toBe('Apagada: échale madera')
  })
})

describe('la fogata necesita leña', () => {
  it('cada estación tiene su tabla: la fogata no acepta carbón y la madera le dura más según su nivel', () => {
    expect(STATION_DEFS.furnace!.fuel).toEqual({ wood: 15, dry_wood: 30, coal: 60 })
    expect(STATION_DEFS.distiller!.fuel).toEqual(STATION_DEFS.furnace!.fuel)
    expect(STATION_DEFS.campfire!.fuel).toEqual({ wood: 60, dry_wood: 90, birch_wood: 90, dark_wood: 120 })
    expect(putInto('campfire', newStation(), 'fuel', 'coal', 1)).toBe(0)
    expect(putInto('furnace', newStation(), 'fuel', 'birch_wood', 1)).toBe(0)
  })

  it('se coloca apagada', () => {
    expect(isLit(newStation())).toBe(false)
  })

  it('arde sola aunque no cocine nada, y se apaga al acabarse la leña', () => {
    const s = newStation()
    putInto('campfire', s, 'fuel', 'wood', 2)
    expect(stepStation('campfire', s, 0.5, 1)).toBe(true)
    expect(s.fuel).toEqual({ item: 'wood', amount: 1 })
    expect(s.burnTotal).toBe(60)
    run(s, 60, 'campfire')
    expect(s.fuel).toBeNull()
    expect(isLit(s)).toBe(true)
    run(s, 59.5, 'campfire')
    expect(s.burn).toBe(0)
    expect(isLit(s)).toBe(false)
  })

  it('coge la unidad siguiente sin pasar ningún paso apagada', () => {
    const s = newStation()
    putInto('campfire', s, 'fuel', 'dry_wood', 3)
    for (let t = 0; t < 270 - 1e-9; t += 0.5) {
      stepStation('campfire', s, 0.5, 1)
      if (t < 269) expect(isLit(s)).toBe(true)
    }
    expect(isLit(s)).toBe(false)
  })

  it('cada madera arde lo suyo, y burnTotal es lo de la que arde ahora', () => {
    for (const [item, seconds] of [['wood', 60], ['dry_wood', 90], ['birch_wood', 90], ['dark_wood', 120]] as const) {
      const s = newStation()
      putInto('campfire', s, 'fuel', item, 1)
      stepStation('campfire', s, 0.5, 1)
      expect(s.burnTotal).toBe(seconds)
      expect(s.burn).toBeCloseTo(seconds - 0.5)
    }
  })

  it('apagada no cocina: lo que esté a medias se queda a medias', () => {
    const s = newStation()
    putInto('campfire', s, 'input', 'raw_meat', 1)
    run(s, 30, 'campfire')
    expect(s.output).toBeNull()
    expect(s.progress).toBe(0)
    putInto('campfire', s, 'fuel', 'wood', 1)
    run(s, 55, 'campfire')
    expect(s.output).toEqual({ item: 'cooked_meat', amount: 1 })
    putInto('campfire', s, 'input', 'raw_meat', 1)
    // Le quedan 5 s de leña: la carne se queda a medias y espera a que le echen más.
    run(s, 20, 'campfire')
    expect(isLit(s)).toBe(false)
    expect(s.output!.amount).toBe(1)
    const half = s.progress
    expect(half).toBeGreaterThan(4)
    expect(half).toBeLessThan(10)
    run(s, 10, 'campfire')
    expect(s.progress).toBe(half)
    putInto('campfire', s, 'fuel', 'wood', 1)
    run(s, 10 - half + 0.5, 'campfire')
    expect(s.output!.amount).toBe(2)
  })

  it('lo que le queda de fuego cuenta la leña de la ranura', () => {
    const s = newStation()
    putInto('campfire', s, 'fuel', 'wood', 99)
    expect(burnLeft('campfire', s)).toBe(99 * 60)
    stepStation('campfire', s, 0.5, 1)
    expect(burnLeft('campfire', s)).toBeCloseTo(99 * 60 - 0.5)
  })
})
