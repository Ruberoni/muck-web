import { describe, expect, it } from 'vitest'
import { RECIPES } from '../sim/crafting'
import { SLOT_COUNT, type ItemId } from '../sim/inventory'
import { acceptsKeys, stepActions, type KeyStep } from './actions'
import { CLICK, RIGHT_CLICK } from './input'

const slots = (items: Partial<Record<number, ItemId>> = {}) => Array.from({ length: SLOT_COUNT }, (_, i) => items[i] ?? null)

const step = (presses: string[], k: Partial<KeyStep> = {}) =>
  stepActions([], { presses: new Set(presses), wheel: 0, crafting: false, selected: 0, slots: slots(), clickSwings: true, ...k })

describe('teclas a acciones', () => {
  it('los números eligen casilla', () => {
    expect(step(['Digit3', 'Digit9']).actions).toEqual([
      { kind: 'select', slot: 2 },
      { kind: 'select', slot: 8 },
    ])
  })

  it('con el crafteo abierto los números fabrican, pero solo recetas que existen', () => {
    const digits = Array.from({ length: SLOT_COUNT }, (_, i) => `Digit${i + 1}`)
    const { actions, crafting } = step(digits, { crafting: true })
    expect(crafting).toBe(true)
    expect(actions).toEqual(RECIPES.map((_, i) => ({ kind: 'craft', recipe: i })))
    // Condición previa de la prueba: con tantas recetas como casillas no quedarían teclas de más que filtrar.
    expect(RECIPES.length).toBeLessThan(SLOT_COUNT)
  })

  it('C abre o cierra el crafteo y vale ya para los números del mismo paso', () => {
    expect(step(['KeyC', 'Digit1'])).toEqual({ actions: [{ kind: 'craft', recipe: 0 }], crafting: true })
    expect(step(['KeyC', 'Digit1'], { crafting: true })).toEqual({ actions: [{ kind: 'select', slot: 0 }], crafting: false })
  })

  it('la rueda mueve la casilla, salvo con el crafteo abierto', () => {
    expect(step([], { wheel: 1, selected: 8 }).actions).toEqual([{ kind: 'select', slot: 0 }])
    expect(step([], { wheel: -1, crafting: true }).actions).toEqual([])
  })

  it('el clic coloca la fogata si queda en la mano tras elegir casilla; si no, golpea', () => {
    const fire = slots({ 2: 'campfire' })
    expect(step([CLICK], { slots: fire, selected: 2 }).actions).toEqual([{ kind: 'place' }])
    expect(step([CLICK, 'Digit3'], { slots: fire }).actions).toEqual([{ kind: 'select', slot: 2 }, { kind: 'place' }])
    expect(step([CLICK], { slots: fire }).actions).toEqual([{ kind: 'swing' }])
    expect(step([CLICK], { clickSwings: false }).actions).toEqual([])
  })

  it('una casilla elegida desde debug cuenta para el clic del mismo paso', () => {
    const { actions } = stepActions([{ kind: 'select', slot: 4 }], {
      presses: new Set([CLICK]),
      wheel: 0,
      crafting: false,
      selected: 0,
      slots: slots({ 4: 'campfire' }),
      clickSwings: true,
    })
    expect(actions).toEqual([{ kind: 'select', slot: 4 }, { kind: 'place' }])
  })

  it('F o el clic derecho comen', () => {
    expect(step(['KeyF']).actions).toEqual([{ kind: 'eat' }])
    expect(step([RIGHT_CLICK]).actions).toEqual([{ kind: 'eat' }])
  })

  it('el teclado cuenta jugando y de espectador (Tab y chat), no en menús ni pausa', () => {
    expect(acceptsKeys('playing')).toBe(true)
    expect(acceptsKeys('spectating')).toBe(true)
    for (const state of ['menu', 'paused', 'dead'] as const) expect(acceptsKeys(state)).toBe(false)
  })
})
