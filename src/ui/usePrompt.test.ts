import { describe, expect, it } from 'vitest'
import { BUILD_DEFS } from '../sim/builds'
import { MOTOR_TIME, PLANE_HP } from '../sim/constants'
import { DEFAULT_RULES } from '../sim/match'
import type { Structure } from '../sim/structures'
import { newStation, putInto, type StationState } from '../sim/stations'
import { clockTime, stationProcessText, stationPrompt, usePrompt } from './usePrompt'

const lighthouse = (fire: Structure['fire']) =>
  ({ kind: 'lighthouse', fire, build: { phase: BUILD_DEFS.lighthouse!.phases.length, delivered: {}, progress: 1 } }) as Structure

describe('el aviso del faro', () => {
  it('sin aceite no ofrece encenderlo', () => {
    const text = usePrompt(lighthouse({ oil: 0, burning: false, left: 0, lit: 0 }), DEFAULT_RULES, false, 'E')
    expect(text).toContain('Sin aceite')
    expect(text).not.toContain('encenderlo')
  })

  it('con aceite se puede encender, y encendido, apagar', () => {
    expect(usePrompt(lighthouse({ oil: 2, burning: false, left: 0, lit: 0 }), DEFAULT_RULES, false, 'E')).toContain('encenderlo')
    expect(usePrompt(lighthouse({ oil: 0, burning: true, left: 10, lit: 0 }), DEFAULT_RULES, false, 'E')).toContain('apagarlo')
  })

  it('apagado a medias, lo que queda de la unidad aún lo enciende', () => {
    expect(usePrompt(lighthouse({ oil: 0, burning: false, left: 10, lit: 0 }), DEFAULT_RULES, false, 'E')).toContain('encenderlo')
  })

  it('la tecla del aviso es la que se haya asignado, no siempre E', () => {
    const oil = { oil: 2, burning: false, left: 0, lit: 0 } as const
    expect(usePrompt(lighthouse(oil), DEFAULT_RULES, false, 'Espacio')).toContain('Espacio para cargar aceite')
    expect(usePrompt(lighthouse(oil), DEFAULT_RULES, false, 'E')).not.toContain('Espacio')
  })
})

describe('el aviso de las estaciones de procesar', () => {
  const campfire = (fill: (s: StationState) => void = () => {}) => {
    const station = newStation()
    fill(station)
    return { kind: 'campfire', station } as Structure
  }

  it('la fogata apagada pide leña con la tecla asignada', () => {
    expect(stationPrompt(campfire(), 'E')).toBe('Fogata · Apagada — E para echarle leña')
    expect(stationPrompt(campfire(), 'Espacio')).toBe('Fogata · Apagada — Espacio para echarle leña')
  })

  it('encendida dice cuánto fuego le queda, contando la leña de la ranura', () => {
    expect(stationPrompt(campfire((s) => (s.burn = 90)), 'E')).toBe('Fogata · Encendida 1:30 — E para cocinar')
    expect(stationPrompt(campfire((s) => putInto('campfire', s, 'fuel', 'wood', 99)), 'E')).toBe('Fogata · Encendida 1:39:00 — E para cocinar')
    expect(stationPrompt(campfire((s) => ((s.burn = 29.2), putInto('campfire', s, 'fuel', 'dark_wood', 1))), 'E')).toBe('Fogata · Encendida 2:30 — E para cocinar')
  })

  it('el horno y el destilador dicen qué hacen', () => {
    expect(stationPrompt({ kind: 'furnace', station: newStation() } as Structure, 'E')).toBe('Horno — E para fundir')
    expect(stationPrompt({ kind: 'distiller', station: newStation() } as Structure, 'E')).toBe('Destilador — E para destilar')
  })

  it('la pantalla de la estación dice lo que procesa con los tiempos de la partida, y la fogata lo que arde cada madera', () => {
    expect(stationProcessText('campfire', DEFAULT_RULES)).toBe(
      '1 carne cruda → carne asada (10 s) · 4 bayas → infusión de bayas (15 s) · Arde: madera 1 min, madera seca 1,5 min, madera de abedul 1,5 min, madera oscura 2 min',
    )
    expect(stationProcessText('furnace', { ...DEFAULT_RULES, difficulty: 'hard' })).not.toContain('Arde')
  })

  it('el reloj pasa a horas desde la hora y redondea hacia arriba', () => {
    expect(clockTime(0)).toBe('0:00')
    expect(clockTime(59.1)).toBe('1:00')
    expect(clockTime(3600)).toBe('1:00:00')
  })
})

describe('el aviso del avión', () => {
  const plane = (p: Partial<NonNullable<Structure['plane']>>) =>
    ({
      kind: 'plane',
      build: { phase: BUILD_DEFS.plane!.phases.length, delivered: {}, progress: 1 },
      plane: { hp: PLANE_HP, running: true, heat: MOTOR_TIME, until: null, wait: null, aboard: 0, expected: 0, ...p },
    }) as Structure
  const prompt = (p: Partial<NonNullable<Structure['plane']>>) => usePrompt(plane(p), DEFAULT_RULES, true, 'E')

  it('calentando', () => {
    expect(prompt({ heat: 10 })).toContain('Calentando el motor')
  })

  it('caliente y sin nadie a bordo: espera a que subáis (o a que subas, en solitario)', () => {
    expect(prompt({ expected: 3 })).toContain('Listo · Esperando a que subáis')
    expect(prompt({ expected: 1 })).toContain('Listo · Esperando a que subas')
  })

  it('con alguien a bordo: la cuenta atrás y cuántos han subido', () => {
    expect(prompt({ until: 999, wait: 41.2, aboard: 2, expected: 3 })).toContain('Despega en 42 s · 2/3 a bordo')
  })
})
