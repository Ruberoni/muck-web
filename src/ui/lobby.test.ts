import { describe, expect, it } from 'vitest'
import { normalizeCode, roomFromUrl } from './lobby'

describe('lobby', () => {
  it('el código se escribe en mayúsculas y sin letras que no existen', () => {
    expect(normalizeCode('k7 qx2')).toBe('K7QX2')
    // 0, O, 1, I y L no están en el alfabeto de las salas.
    expect(normalizeCode('o0i1lab')).toBe('AB')
    expect(normalizeCode('abcdefgh')).toBe('ABCDE')
  })

  it('la sala de la URL, solo si es un código válido', () => {
    expect(roomFromUrl('?room=k7qx2')).toBe('K7QX2')
    expect(roomFromUrl('?foo=1&room=K7QX2')).toBe('K7QX2')
    expect(roomFromUrl('?room=K7Q')).toBeNull()
    expect(roomFromUrl('')).toBeNull()
  })
})
