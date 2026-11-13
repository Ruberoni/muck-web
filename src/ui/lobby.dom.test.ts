// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Game } from '../game/Game'
import type { MatchInfo } from '../net/protocol'
import { DEFAULT_RULES } from '../sim/match'
import { installLobby } from './lobby'
import { MenuScreens } from './menu/MenuScreens'
import { MultiplayerHud } from './multiplayerHud'

const lobbyMatch = (over: Partial<MatchInfo> = {}): MatchInfo => ({
  phase: 'lobby',
  host: 1,
  rules: DEFAULT_RULES,
  difficulty: 'normal',
  players: [
    { id: 1, name: 'Ana' },
    { id: 2, name: 'Tomás' },
  ],
  votes: 0,
  result: null,
  ...over,
})

/** Lo justo de `Game` para montar la sala: un estado, una sesión de red de mentira y el HUD de red. */
function room(me = 1) {
  document.body.replaceChildren()
  const hudRoot = document.createElement('div')
  document.body.append(hudRoot)
  const client = { match: lobbyMatch(), start: vi.fn(), setDifficulty: vi.fn(), skins: new Map(), onmatch: null as (() => void) | null }
  const game = {
    state: 'menu',
    net: { room: 'K7QXP', me, client, closed: false, status: 'online', closeReason: null, waitReason: null },
    hud: { net: new MultiplayerHud(hudRoot) },
    onchange: null,
    play: vi.fn(),
  } as unknown as Game & { menu: MenuScreens }
  game.hud.net.setVisible(true)
  ;(game as { menu: MenuScreens }).menu = new MenuScreens(document.body, game)
  installLobby(game)
  return { game, client, menu: game.menu, hudRoot }
}

afterEach(() => vi.useRealTimers())

describe('la sala de espera', () => {
  it('pinta cinco puestos, la corona y, para el anfitrión, empezar', () => {
    const { menu } = room()
    expect(menu.screen).toBe('room')
    const seats = [...document.querySelectorAll('.room-players li')].map((li) => li.textContent)
    expect(seats).toEqual(['Anaanfitrión · tú', 'Tomás', 'Hueco libre', 'Hueco libre', 'Hueco libre'])
    expect(document.querySelector('.room-players .host .crown svg')).not.toBeNull()
    expect(document.querySelector<HTMLButtonElement>('.btn.primary')!.hidden).toBe(false)
  })

  it('los repintados (cada medio segundo, cada `match`) no roban el foco, ni al chat ni a un botón', () => {
    const { menu, client } = room()
    const input = document.querySelector<HTMLInputElement>('.room-chat .chat-input')!
    input.focus()
    input.value = 'hola'
    client.match = lobbyMatch({ players: [...client.match.players, { id: 3, name: 'Lía' }], difficulty: 'hard' })
    menu.refresh()
    menu.refresh()
    expect(document.activeElement).toBe(input)
    expect(input.value).toBe('hola')
    const change = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Cambiar')!
    change.focus()
    client.match = lobbyMatch({ host: 1, players: [{ id: 1, name: 'Ana' }] })
    menu.refresh()
    expect(document.activeElement).toBe(change)
    expect(document.querySelector('.room-difficulty strong')!.textContent).toBe('Normal')
  })

  it('si cambia el anfitrión, la corona y "Empezar partida" pasan al nuevo', () => {
    const { menu, client } = room(2)
    const start = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Empezar partida')!
    expect(start.hidden).toBe(true)
    expect(document.querySelector<HTMLElement>('.room-waiting')!.hidden).toBe(false)
    client.match = lobbyMatch({ host: 2, players: [{ id: 2, name: 'Tomás' }] })
    menu.refresh()
    expect(start.hidden).toBe(false)
    expect(document.querySelector('.room-players .host')!.textContent).toContain('Tomás')
  })

  it('Enter abre el chat solo con el foco en nada; el campo no se cierra al salir de él', () => {
    room()
    const input = document.querySelector<HTMLInputElement>('.room-chat .chat-input')!
    ;(document.activeElement as HTMLElement | null)?.blur()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(document.activeElement).toBe(input)
    input.blur()
    expect(input.hidden).toBe(false)
    const copy = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Copiar enlace')!
    copy.focus()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(document.activeElement).toBe(copy)
  })

  it('al abrir "Cambiar" el chat vuelve al HUD cerrado, sin perder el borrador, y vuelve a la sala después', () => {
    const { menu, hudRoot } = room()
    const input = document.querySelector<HTMLInputElement>('.room-chat .chat-input')!
    input.value = 'un momento'
    menu.push('difficulty-room')
    expect(hudRoot.contains(input)).toBe(true)
    expect(input.hidden).toBe(true)
    menu.back()
    expect(document.querySelector('.room-chat')!.contains(input)).toBe(true)
    expect(input.hidden).toBe(false)
    expect(input.value).toBe('un momento')
  })

  it('"Guardar" manda la dificultad elegida', () => {
    const { menu, client } = room()
    menu.push('difficulty-room')
    document.querySelector<HTMLButtonElement>('[data-difficulty="ultra"]')!.click()
    ;[...document.querySelectorAll('button')].find((b) => b.textContent === 'Guardar')!.click()
    expect(client.setDifficulty).toHaveBeenCalledWith('ultra')
    expect(menu.top).toBe(null)
  })
})
