import { describe, expect, it } from 'vitest'
import { LIT_SHARE, MOTOR_TIME, PLANE_HP } from '../sim/constants'
import { clockOf } from '../sim/match'
import type { Structure } from '../sim/structures'
import { DayClock, NIGHT_LENGTH } from '../sim/world/daycycle'
import { boardingBanner, clockTexts, lightText, planeText, threatText } from './clockText'

describe('la noche iluminada en el HUD', () => {
  it('también se ve en las noches normales', () => {
    const fire = { oil: 3, burning: false, left: 0, lit: (NIGHT_LENGTH * LIT_SHARE) / 2 }
    expect(lightText([{ fire } as Structure], new DayClock())).toBe('Faro: 50 % · Aceite 3/10')
  })
})

describe('el reloj en el HUD', () => {
  const clock = new DayClock()
  clock.configure(clockOf(3))

  it('de día: el día y la cuenta atrás hasta la Noche Eterna', () => {
    clock.elapsed = clock.eternalAt - 125
    expect(clockTexts(clock)).toEqual({ title: 'Día 6', countdown: 'Noche Eterna en 2:05' })
  })

  it('en la Noche Eterna: la noche y la campana', () => {
    clock.elapsed = clock.eternalAt + clockOf(3).bell * 3 + 30
    expect(clockTexts(clock)).toEqual({ title: 'Noche Eterna · Noche 9', countdown: 'Campana en 4:30' })
  })

  it('en la Noche Eterna, también el nivel de los mobs y lo que viene', () => {
    expect(threatText({ eternal: true, level: 3, next: 'fast', traits: { fast: 1, strong: 2, aggressive: 0 }, totem: false, litNights: 0 })).toBe('Mobs nivel 3 · Próximo: Rápidos')
    expect(threatText({ eternal: false, level: 0, next: 'fast', traits: { fast: 0, strong: 0, aggressive: 0 }, totem: false, litNights: 0 })).toBeNull()
  })

  it('sin reglas, solo el día', () => {
    expect(clockTexts(new DayClock())).toEqual({ title: 'Día 1', countdown: '' })
  })
})

describe('el avión en el HUD', () => {
  const plane = (p: Partial<NonNullable<Structure['plane']>>) =>
    [{ plane: { hp: PLANE_HP, running: true, heat: MOTOR_TIME, until: null, wait: null, aboard: 0, expected: 0, ...p } } as Structure]

  it('apagado no dice nada', () => {
    expect(planeText(plane({ running: false }))).toBeNull()
  })

  it('calentando: el motor y la vida', () => {
    expect(planeText(plane({ heat: 30.5, hp: PLANE_HP * 0.8 }))).toBe(`Motor: 30/${MOTOR_TIME} s · Avión 80 %`)
  })

  it('con alguien a bordo: lo que falta para despegar y cuántos han subido', () => {
    expect(planeText(plane({ until: 999, wait: 41.2, aboard: 2, expected: 3, hp: PLANE_HP * 0.8 }))).toBe('Despega en 0:42 · 2/3 a bordo · Avión 80 %')
  })

  it('con la cuenta a 0, mientras llega el final de la partida: despegando', () => {
    expect(planeText(plane({ until: 999, wait: 0, aboard: 1, expected: 2 }))).toBe('Despegando… · Avión 100 %')
  })

  it('los 60 s justos, aunque la resta de pasos deje decimales de más', () => {
    expect(planeText(plane({ until: 999, wait: 3600 * (1 / 60), aboard: 1, expected: 2 }))).toContain('Despega en 1:00')
  })
})

describe('el aviso de que alguien sube al avión', () => {
  it('lejos: hacia dónde está', () => {
    expect(boardingBanner(0, -100, 5, true)).toBe('¡El avión despega en 60 s! Está al norte')
  })

  it('a bordo: que se espera a los demás', () => {
    expect(boardingBanner(3, 4, 5, true)).toBe('¡El avión despega en 60 s! Esperando a los demás')
  })

  it('muerto al lado del avión: no va a bordo, así que hacia dónde está', () => {
    expect(boardingBanner(0, -3, 5, false)).toBe('¡El avión despega en 60 s! Está al norte')
  })
})
