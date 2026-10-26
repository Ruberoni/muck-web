import { describe, expect, it } from 'vitest'
import { acceptsKeys, afterLockChange, holdsMouse, inGame, showsCrosshair, type GameState } from './states'

const ALL: GameState[] = ['menu', 'playing', 'paused', 'dead', 'spectating', 'inventory']
const which = (f: (s: GameState) => boolean) => ALL.filter(f)

describe('estados de Game', () => {
  it('en partida (red despierta, simulación en marcha) también con el inventario abierto', () => {
    expect(which(inGame)).toEqual(['playing', 'spectating', 'inventory'])
  })

  it('el ratón capturado solo jugando y de espectador', () => {
    expect(which(holdsMouse)).toEqual(['playing', 'spectating'])
  })

  it('el teclado cuenta jugando y de espectador (Tab y chat), no en menús, pausa ni inventario', () => {
    expect(which(acceptsKeys)).toEqual(['playing', 'spectating'])
  })

  it('la mira se oculta de espectador y con el inventario abierto', () => {
    expect(which(showsCrosshair)).toEqual(['menu', 'playing', 'paused', 'dead'])
  })

  it('capturar el ratón pasa a jugar (empezar, reanudar o cerrar el inventario), salvo muerto con un jugador', () => {
    for (const state of ALL) expect(afterLockChange(state, true)).toBe(state === 'dead' ? null : 'playing')
  })

  it('perderlo pausa si se jugaba con él; al abrir el inventario o al morir con un jugador no cambia nada', () => {
    expect(afterLockChange('playing', false)).toBe('paused')
    expect(afterLockChange('spectating', false)).toBe('paused')
    for (const state of ['inventory', 'dead', 'menu', 'paused'] as const) expect(afterLockChange(state, false)).toBeNull()
  })
})
