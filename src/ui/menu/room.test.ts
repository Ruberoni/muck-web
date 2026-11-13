import { describe, expect, it } from 'vitest'
import { MAX_PLAYERS, type MatchInfo } from '../../net/protocol'
import { DEFAULT_RULES } from '../../sim/match'
import { roomModel, seatNote, seatsKey } from './room'

const match = (over: Partial<MatchInfo> = {}): MatchInfo => ({
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

describe('roomModel', () => {
  it('siempre cinco puestos: los que están, con la corona en el anfitrión, y huecos libres', () => {
    const model = roomModel(match(), 2)
    expect(model.seats).toHaveLength(MAX_PLAYERS)
    expect(model.seats.slice(0, 2)).toEqual([
      { id: 1, name: 'Ana', host: true, me: false },
      { id: 2, name: 'Tomás', host: false, me: true },
    ])
    expect(model.seats.slice(2)).toEqual([null, null, null])
    expect(model).toMatchObject({ count: 2, isHost: false, lobby: true, difficulty: 'normal' })
  })

  it('si cambia el anfitrión, la corona y empezar pasan al nuevo', () => {
    const before = roomModel(match(), 2)
    const after = roomModel(match({ host: 2, players: [{ id: 2, name: 'Tomás' }] }), 2)
    expect(before.isHost).toBe(false)
    expect(after.isHost).toBe(true)
    expect(after.seats[0]).toEqual({ id: 2, name: 'Tomás', host: true, me: true })
    expect(seatsKey(after)).not.toBe(seatsKey(before))
  })

  it('la lista solo se rehace si cambia quién está: no con la dificultad, los votos ni la fase', () => {
    const key = seatsKey(roomModel(match(), 1))
    expect(seatsKey(roomModel(match({ difficulty: 'hard', votes: 1, phase: 'playing' }), 1))).toBe(key)
    expect(seatsKey(roomModel(match({ players: [{ id: 1, name: 'Ana' }] }), 1))).not.toBe(key)
  })

  it('la dificultad elegida la ve todo el mundo', () => {
    expect(roomModel(match({ difficulty: 'ultra' }), 2).difficulty).toBe('ultra')
  })

  it('sin `match` todavía: todo huecos, sin anfitrión', () => {
    const model = roomModel(null, 0)
    expect(model.seats.every((s) => s === null)).toBe(true)
    expect(model).toMatchObject({ count: 0, isHost: false, lobby: false })
  })
})

describe('seatNote', () => {
  it('dice quién es el anfitrión y quién eres tú', () => {
    expect(seatNote({ id: 1, name: 'A', host: true, me: true })).toBe('anfitrión · tú')
    expect(seatNote({ id: 1, name: 'A', host: true, me: false })).toBe('anfitrión')
    expect(seatNote({ id: 1, name: 'A', host: false, me: true })).toBe('tú')
    expect(seatNote({ id: 1, name: 'A', host: false, me: false })).toBe('')
  })
})
