import { describe, expect, it } from 'vitest'
import { connectionStatus, normalizeCode, roomFromUrl } from './lobby'

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

describe('connectionStatus', () => {
  const idle = { busy: false, closed: null, reconnecting: null, waiting: '', error: '' }
  it('nada que decir, conectando, o el error de la sala', () => {
    expect(connectionStatus(idle)).toEqual({ text: '', error: false })
    expect(connectionStatus({ ...idle, busy: true, error: 'x' })).toEqual({ text: 'Conectando…', error: false })
    expect(connectionStatus({ ...idle, error: 'No hay ninguna sala con ese código.' })).toEqual({ text: 'No hay ninguna sala con ese código.', error: true })
  })

  it('una conexión cerrada pesa más que reconectar o esperar', () => {
    expect(connectionStatus({ ...idle, closed: 'Sin conexión', reconnecting: 'Reconectando…', waiting: 'w' })).toEqual({ text: 'Sin conexión', error: true })
    expect(connectionStatus({ ...idle, reconnecting: 'Reconectando…', waiting: 'w' })).toEqual({ text: 'Reconectando…', error: false })
    expect(connectionStatus({ ...idle, waiting: 'Hay una versión nueva', error: 'e' })).toEqual({ text: 'Hay una versión nueva', error: false })
  })
})
