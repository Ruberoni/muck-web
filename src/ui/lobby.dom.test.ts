// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Game } from '../game/Game'
import type { MatchInfo } from '../net/protocol'
import { DEFAULT_RULES } from '../sim/match'
import { installLobby } from './lobby'
import { MenuScreens } from './menu/MenuScreens'
import { installCoreScreens } from './menu/views'
import { LoadTracker } from '../game/loadTracker'
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
function room(me = 1, loads = new LoadTracker()) {
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
    loads,
    sound: { unlock: vi.fn(), play: vi.fn() },
  } as unknown as Game & { menu: MenuScreens; state: string; sound: { unlock: ReturnType<typeof vi.fn>; play: ReturnType<typeof vi.fn> } }
  game.hud.net.setVisible(true)
  ;(game as { menu: MenuScreens }).menu = new MenuScreens(document.body, game)
  installCoreScreens(game.menu)
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

const buttonNamed = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === text)!

describe('empezar, cuenta atrás y carga', () => {
  it('"Empezar partida" manda el inicio sin capturar el ratón (el anfitrión también pasa por la cuenta atrás)', () => {
    const { game, client } = room()
    buttonNamed('Empezar partida').click()
    expect(client.start).toHaveBeenCalledTimes(1)
    expect(game.play).not.toHaveBeenCalled()
    // Suena el clic del botón.
    expect(game.sound.play).toHaveBeenCalledWith('uiClick')
  })

  it('3, 2, 1 con su tic y luego "¡Entrar!", que pide el ratón', () => {
    vi.useFakeTimers()
    const { game, menu } = room()
    game.state = 'paused'
    menu.overlay = 'ready'
    menu.refresh()
    expect(menu.screen).toBe('countdown')
    const number = document.querySelector<HTMLElement>('.countdown-number')!
    const enter = buttonNamed('¡Entrar!')
    expect(number.textContent).toBe('3')
    expect(enter.hidden).toBe(true)
    vi.advanceTimersByTime(1100)
    expect(number.textContent).toBe('2')
    vi.advanceTimersByTime(2000)
    expect(number.hidden).toBe(true)
    expect(enter.hidden).toBe(false)
    expect(document.activeElement).toBe(enter)
    expect(game.sound.play.mock.calls.filter(([name]) => name === 'uiTick')).toHaveLength(3)
    enter.click()
    expect(game.play).toHaveBeenCalledTimes(1)
  })

  it('la carga tapa el menú hasta que llega todo; si todo falla, "Recargar" o seguir', async () => {
    const loads = new LoadTracker()
    let finish!: () => void
    loads.track(new Promise<void>((resolve) => (finish = resolve)))
    const { menu } = room(1, loads)
    loads.onChange = () => menu.refresh()
    expect(menu.screen).toBe('loading')
    expect(document.querySelector('.load-tip')!.textContent).not.toBe('')
    finish()
    await Promise.resolve()
    await Promise.resolve()
    expect(menu.screen).toBe('room')

    const failing = new LoadTracker()
    failing.track(Promise.reject(new Error('sin red'))).catch(() => {})
    const second = room(1, failing)
    await Promise.resolve()
    await Promise.resolve()
    second.menu.refresh()
    expect(second.menu.screen).toBe('loading')
    // Pasado el tiempo sigue ahí: sin modelos se ofrece recargar.
    second.menu.endLoading(false)
    expect(second.menu.screen).toBe('loading')
    expect(buttonNamed('Recargar').closest('[hidden]')).toBeNull()
    buttonNamed('Seguir sin ellos').click()
    expect(second.menu.screen).toBe('room')
  })
})
