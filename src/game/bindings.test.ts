import { describe, expect, it } from 'vitest'
import { anyOf, BINDABLE_ACTIONS, binds, bindingLabel, closesInventory, codesOf, DEFAULT_BINDINGS, keyLabel, rebind, sanitizeBindings } from './bindings'

/** Todos los códigos usados, con la acción que los tiene. */
const used = (bindings: Record<string, string>) => BINDABLE_ACTIONS.flatMap((action) => codesOf(bindings[action]).map((code) => [action, code] as const))

describe('teclas reasignables', () => {
  it('las de por defecto no repiten ninguna tecla', () => {
    const codes = used(DEFAULT_BINDINGS).map(([, code]) => code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('correr sigue valiendo con cualquiera de los dos Mayús', () => {
    expect(codesOf(DEFAULT_BINDINGS.sprint)).toEqual(['ShiftLeft', 'ShiftRight'])
    expect(anyOf(new Set(['ShiftRight']), DEFAULT_BINDINGS.sprint)).toBe(true)
    expect(anyOf(new Set(['ShiftLeft']), DEFAULT_BINDINGS.sprint)).toBe(true)
    expect(anyOf(new Set(['KeyW']), DEFAULT_BINDINGS.sprint)).toBe(false)
  })

  it('una acción sin tecla no se activa nunca', () => {
    expect(anyOf(new Set(['Space', 'KeyW']), '')).toBe(false)
    expect(binds('', 'KeyW')).toBe(false)
    expect(bindingLabel('')).toBe('—')
  })

  it('reasignar le quita la tecla a la acción que la tuviera', () => {
    const next = rebind({ ...DEFAULT_BINDINGS }, 'eat', 'KeyE')
    expect(next.eat).toBe('KeyE')
    expect(next.use).toBe('')
    // Y no toca las demás.
    expect(next.jump).toBe(DEFAULT_BINDINGS.jump)
  })

  it('reasignar una de las varias teclas de una acción deja las otras intactas', () => {
    const next = rebind({ ...DEFAULT_BINDINGS }, 'jump', 'ShiftRight')
    expect(next.jump).toBe('ShiftRight')
    expect(codesOf(next.sprint)).toEqual(['ShiftLeft'])
  })

  it('sanear descarta lo que no es cadena y no repite teclas', () => {
    expect(sanitizeBindings(null)).toEqual(DEFAULT_BINDINGS)
    expect(sanitizeBindings({ jump: 42 }).jump).toBe(DEFAULT_BINDINGS.jump)
    // Dos acciones con la misma tecla: se la queda la que va antes en BINDABLE_ACTIONS.
    const dup = sanitizeBindings({ ...DEFAULT_BINDINGS, eat: 'KeyW' })
    expect(dup.forward).toBe('KeyW')
    expect(dup.eat).toBe('')
    expect(used(dup).map(([, code]) => code)).toEqual(expect.arrayContaining(['KeyW']))
    expect(new Set(used(dup).map(([, code]) => code)).size).toBe(used(dup).length)
  })

  it('una acción sin asignar sigue sin asignar tras sanear', () => {
    expect(sanitizeBindings({ ...DEFAULT_BINDINGS, sprint: '' }).sprint).toBe('')
  })

  it('la pantalla de inventario la cierran las mismas teclas que la abren', () => {
    // Tab, E y C, como antes del refactor: la E cuenta porque sin nada que usar cerca abre la pantalla.
    for (const code of ['Tab', 'KeyE', 'KeyC']) expect(closesInventory(DEFAULT_BINDINGS, code)).toBe(true)
    for (const code of ['KeyQ', 'Escape', 'KeyW']) expect(closesInventory(DEFAULT_BINDINGS, code)).toBe(false)
    // Y siguen a la tecla que se asigne, no a una fija.
    const rebound = rebind({ ...DEFAULT_BINDINGS }, 'use', 'KeyG')
    expect(closesInventory(rebound, 'KeyG')).toBe(true)
    expect(closesInventory(rebound, 'KeyE')).toBe(false)
  })

  it('los nombres que se leen en pantalla', () => {
    expect(keyLabel('KeyE')).toBe('E')
    expect(keyLabel('Digit3')).toBe('3')
    expect(keyLabel('Space')).toBe('Espacio')
    expect(keyLabel('ShiftLeft')).toBe('Mayús izq.')
    expect(keyLabel('Mouse0')).toBe('Clic izq.')
    expect(keyLabel('Mouse2')).toBe('Clic der.')
    expect(keyLabel('ArrowUp')).toBe('↑')
    expect(keyLabel('Numpad7')).toBe('Num 7')
    expect(keyLabel('F5')).toBe('F5')
    expect(bindingLabel(DEFAULT_BINDINGS.sprint)).toBe('Mayús izq. / Mayús der.')
    expect(bindingLabel(DEFAULT_BINDINGS.use)).toBe('E')
  })
})
