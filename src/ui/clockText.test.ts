import { describe, expect, it } from 'vitest'
import { clockOf } from '../sim/match'
import { DayClock } from '../sim/world/daycycle'
import { clockTexts, threatText } from './clockText'

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
    expect(threatText({ eternal: true, level: 3, next: 'fast', traits: { fast: 1, strong: 2, aggressive: 0 }, totem: false })).toBe('Mobs nivel 3 · Próximo: Rápidos')
    expect(threatText({ eternal: false, level: 0, next: 'fast', traits: { fast: 0, strong: 0, aggressive: 0 }, totem: false })).toBeNull()
  })

  it('sin reglas, solo el día', () => {
    expect(clockTexts(new DayClock())).toEqual({ title: 'Día 1', countdown: '' })
  })
})
