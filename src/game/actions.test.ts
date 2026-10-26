import { describe, expect, it } from 'vitest'
import { INVENTORY_SIZE, SLOT_COUNT, type ItemId } from '../sim/inventory'
import { stepActions, type KeyStep } from './actions'
import { CLICK, RIGHT_CLICK } from './input'

const slots = (items: Partial<Record<number, ItemId>> = {}) => Array.from({ length: SLOT_COUNT }, (_, i) => items[i] ?? null)

const step = (presses: string[], k: Partial<KeyStep> = {}) =>
  stepActions([], { presses: new Set(presses), wheel: 0, selected: 0, slots: slots(), clickSwings: true, ...k })

describe('teclas a acciones', () => {
  it('los números eligen casilla', () => {
    expect(step(['Digit3', 'Digit9']).actions).toEqual([
      { kind: 'select', slot: 2 },
      { kind: 'select', slot: 8 },
    ])
  })

  it('la rueda mueve la casilla', () => {
    expect(step([], { wheel: 1, selected: 8 }).actions).toEqual([{ kind: 'select', slot: 0 }])
    expect(step([], { wheel: -2, selected: 1 }).actions).toEqual([{ kind: 'select', slot: 8 }])
  })

  it('los números ya no fabrican: C pide la pantalla de inventario en las recetas', () => {
    expect(step(['KeyC', 'Digit1'])).toEqual({ actions: [{ kind: 'select', slot: 0 }], inventory: 'recipes' })
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
      selected: 0,
      slots: slots({ 4: 'campfire' }),
      clickSwings: true,
    })
    expect(actions).toEqual([{ kind: 'select', slot: 4 }, { kind: 'place' }])
  })

  it('una casilla movida desde debug cuenta para el clic del mismo paso', () => {
    const k = { presses: new Set([CLICK]), wheel: 0, selected: 0, clickSwings: true }
    const toHand = { kind: 'move', from: 20, to: 0 } as const
    const out = { kind: 'move', from: 0, to: 20 } as const
    const inBackpack = Array.from({ length: INVENTORY_SIZE }, (_, i) => (i === 20 ? 'campfire' : null))
    expect(stepActions([toHand], { ...k, slots: inBackpack }).actions).toEqual([toHand, { kind: 'place' }])
    const inHand = Array.from({ length: INVENTORY_SIZE }, (_, i) => (i === 0 ? 'campfire' : null))
    expect(stepActions([out], { ...k, slots: inHand }).actions).toEqual([out, { kind: 'swing' }])
  })

  it('F o el clic derecho comen', () => {
    expect(step(['KeyF']).actions).toEqual([{ kind: 'eat' }])
    expect(step([RIGHT_CLICK]).actions).toEqual([{ kind: 'eat' }])
  })

  it('Tab o E piden la pantalla de inventario en las casillas', () => {
    expect(step(['Tab'])).toEqual({ actions: [], inventory: 'slots' })
    expect(step(['KeyE'])).toEqual({ actions: [], inventory: 'slots' })
    expect(step(['KeyQ']).inventory).toBe(null)
  })
})
