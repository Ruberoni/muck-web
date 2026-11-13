import { describe, expect, it } from 'vitest'
import { escapeAction, screenFor, type ScreenInput } from './screens'

const base: ScreenInput = {
  state: 'menu',
  overlay: null,
  inRoom: false,
  results: null,
  hasLobby: true,
  inviteCode: null,
  choice: null,
  loading: false,
}
const at = (input: Partial<ScreenInput>) => screenFor({ ...base, ...input })

describe('screenFor', () => {
  it('en partida no hay menú', () => {
    expect(at({ state: 'playing' })).toBeNull()
    expect(at({ state: 'spectating', inRoom: true })).toBeNull()
    expect(at({ state: 'inventory' })).toBeNull()
    // `retry` no cambia de pantalla.
    expect(at({ state: 'playing', overlay: 'retry' })).toBeNull()
  })

  it('en el menú: inicio, invitación o lo elegido', () => {
    expect(at({})).toBe('home')
    expect(at({ inviteCode: 'K7QX2' })).toBe('invite')
    expect(at({ choice: 'join' })).toBe('join')
    expect(at({ choice: 'solo-difficulty' })).toBe('solo-difficulty')
    expect(at({ choice: 'solo-difficulty', inviteCode: 'K7QX2' })).toBe('solo-difficulty')
    // Con el ratón sin capturar al empezar sigue en la misma pantalla.
    expect(at({ choice: 'solo-difficulty', overlay: 'retry' })).toBe('solo-difficulty')
  })

  it('sin la bandera multijugador no hay ni salas ni invitaciones', () => {
    expect(at({ hasLobby: false, inviteCode: 'K7QX2' })).toBe('home')
    expect(at({ hasLobby: false, choice: 'join' })).toBe('home')
    expect(at({ hasLobby: false, choice: 'solo-difficulty' })).toBe('solo-difficulty')
  })

  it('en una sala: la sala, con los resultados encima hasta cerrarlos', () => {
    expect(at({ inRoom: true })).toBe('room')
    expect(at({ inRoom: true, inviteCode: 'K7QX2' })).toBe('room')
    expect(at({ inRoom: true, results: 'lost' })).toBe('results')
    expect(at({ inRoom: true, results: 'escaped' })).toBe('results')
  })

  it('pausa y la partida de la sala que ha empezado', () => {
    expect(at({ state: 'paused' })).toBe('pause')
    expect(at({ state: 'paused', overlay: 'retry' })).toBe('pause')
    expect(at({ state: 'paused', inRoom: true, overlay: 'ready' })).toBe('countdown')
  })

  it('fin en solitario: morir es la tarjeta roja; escapar o rendirse, los resultados', () => {
    expect(at({ state: 'dead' })).toBe('dead')
    expect(at({ state: 'dead', results: 'lost' })).toBe('dead')
    expect(at({ state: 'dead', results: 'escaped' })).toBe('results')
    expect(at({ state: 'dead', results: 'surrendered' })).toBe('results')
  })

  it('cargando, en el menú antes que nada; nunca tapa una partida', () => {
    expect(at({ loading: true })).toBe('loading')
    expect(at({ loading: true, inviteCode: 'K7QX2' })).toBe('loading')
    expect(at({ loading: true, inRoom: true })).toBe('loading')
    expect(at({ loading: true, state: 'paused' })).toBe('pause')
    expect(at({ loading: true, state: 'playing' })).toBeNull()
  })
})

describe('escapeAction', () => {
  it('una sub-pantalla vuelve atrás, también sobre la pausa', () => {
    expect(escapeAction('home', 1)).toBe('back')
    expect(escapeAction('pause', 1)).toBe('back')
    expect(escapeAction('room', 1)).toBe('back')
  })

  it('lo elegido en el inicio vuelve a él; la pausa reanuda; el resto, nada', () => {
    expect(escapeAction('join', 0)).toBe('back')
    expect(escapeAction('solo-difficulty', 0)).toBe('back')
    expect(escapeAction('pause', 0)).toBe('resume')
    for (const screen of ['home', 'invite', 'room', 'countdown', 'dead', 'results', 'loading', null] as const) {
      expect(escapeAction(screen, 0)).toBe('none')
    }
  })
})
