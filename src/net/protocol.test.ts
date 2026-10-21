import { describe, expect, it } from 'vitest'
import { MAX_PITCH } from '../sim/constants'
import { RECIPES } from '../sim/crafting'
import { SLOT_COUNT } from '../sim/inventory'
import { cleanName, isRoomCode, MAX_ACTIONS, MAX_MESSAGE, MAX_MOVES, parseClientMessage, PROTOCOL_VERSION } from './protocol'

const hello = { type: 'hello', v: PROTOCOL_VERSION, t: 12.5, intent: 'join', room: 'K7QX2', name: ' Ana ', tab: 'a1' }
const move = { tick: 10, buttons: 65, yaw: 1, pitch: -0.2 }
const cmds = (extra: object = {}) => ({ type: 'cmds', t: 1, moves: [move], actions: [], ...extra })
const parse = (msg: unknown) => parseClientMessage(JSON.stringify(msg))
const valid = (msg: unknown) => parse(msg).ok

describe('protocolo', () => {
  it('códigos de sala', () => {
    expect(isRoomCode('K7QX2')).toBe(true)
    for (const code of ['K7QX', 'K7QX22', 'k7qx2', 'K0QX2', 'KIQX2', 'KLQX2', 5]) expect(isRoomCode(code), String(code)).toBe(false)
  })

  it('nombres: hasta 16 caracteres, sin caracteres de control', () => {
    expect(cleanName('  Ana  ')).toBe('Ana')
    expect(cleanName('x'.repeat(16))).toBe('x'.repeat(16))
    expect(cleanName('x'.repeat(17))).toBeNull()
    expect(cleanName('a\nb')).toBeNull()
    expect(cleanName('a\u0085b')).toBeNull()
    expect(cleanName(3)).toBeNull()
  })

  it('hello válido, con los campos limpios y sin los desconocidos', () => {
    expect(parse({ ...hello, extra: 1 })).toEqual({ ok: true, msg: { ...hello, name: 'Ana' } })
    expect(parse({ ...hello, token: 'tok_1-x' })).toEqual({ ok: true, msg: { ...hello, name: 'Ana', token: 'tok_1-x' } })
  })

  it('un hello de otra versión se distingue de uno inválido, aunque cambie su forma', () => {
    expect(parse({ type: 'hello', v: PROTOCOL_VERSION + 1, otra: 'forma' })).toEqual({ ok: false, version: PROTOCOL_VERSION + 1 })
    expect(parse({ ...hello, v: 'uno' })).toEqual({ ok: false })
  })

  it('hello inválido', () => {
    const bad = [
      { t: Infinity },
      { intent: 'spy' },
      { room: 'nope!' },
      { name: 'a'.repeat(30) },
      { tab: '' },
      { tab: 'x'.repeat(65) },
      { token: 'con espacio' },
      { token: 5 },
    ]
    for (const extra of bad) expect(valid({ ...hello, ...extra }), JSON.stringify(extra)).toBe(false)
  })

  it('cmds válido', () => {
    const actions = [
      { seq: 1, tick: 10, kind: 'select', slot: SLOT_COUNT - 1 },
      { seq: 2, tick: 10, kind: 'craft', recipe: RECIPES.length - 1 },
      { seq: 3, tick: 11, kind: 'swing' },
      { seq: 4, tick: 11, kind: 'eat' },
      { seq: 5, tick: 12, kind: 'place', junk: true },
    ]
    const moves = [
      { ...move, n: 4, aim: { kind: 'prop', id: 3 } },
      { ...move, tick: 14, aim: null, pitch: MAX_PITCH },
    ]
    const result = parse(cmds({ moves, actions }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.msg).toEqual({ type: 'cmds', t: 1, moves, actions: actions.map(({ ...a }) => (delete (a as { junk?: boolean }).junk, a)) })
    expect(valid({ type: 'resync' })).toBe(true)
  })

  it('cmds inválido: tipos, rangos y tamaños', () => {
    const badMoves = [
      { pitch: MAX_PITCH + 0.01 },
      { yaw: null },
      { tick: -1 },
      { tick: 1.5 },
      { buttons: 128 },
      { n: 0 },
      { n: 1000 },
      { aim: { kind: 'tree', id: 1 } },
      { aim: { kind: 'prop', id: -1 } },
    ]
    for (const extra of badMoves) expect(valid(cmds({ moves: [{ ...move, ...extra }] })), JSON.stringify(extra)).toBe(false)
    const badActions = [
      { seq: 0, tick: 1, kind: 'eat' },
      { seq: 1, tick: 1, kind: 'select', slot: SLOT_COUNT },
      { seq: 1, tick: 1, kind: 'craft', recipe: RECIPES.length },
      { seq: 1, tick: 1, kind: 'fly' },
      { seq: 1, kind: 'eat' },
    ]
    for (const action of badActions) expect(valid(cmds({ actions: [action] })), JSON.stringify(action)).toBe(false)
    expect(valid(cmds({ moves: Array(MAX_MOVES + 1).fill(move) }))).toBe(false)
    expect(valid(cmds({ actions: Array.from({ length: MAX_ACTIONS + 1 }, (_, i) => ({ seq: i + 1, tick: 1, kind: 'eat' })) }))).toBe(false)
    expect(valid(cmds({ moves: 'x' }))).toBe(false)
    expect(valid({ type: 'dev', op: 'give' })).toBe(false)
    expect(parseClientMessage('{"type":"resync"' + ' '.repeat(MAX_MESSAGE) + '}').ok).toBe(false)
    expect(parseClientMessage('[1]').ok).toBe(false)
    expect(parseClientMessage('null').ok).toBe(false)
  })

  it('trucos de desarrollo: solo los conocidos y con sus campos', () => {
    const dev = (extra: object) => parse({ type: 'dev', ...extra })
    expect(dev({ op: 'give', item: 'wood', amount: 3, extra: 1 })).toEqual({ ok: true, msg: { type: 'dev', op: 'give', item: 'wood', amount: 3 } })
    expect(dev({ op: 'teleport', x: 1, z: 2, yaw: 3, pitch: 0.1 }).ok).toBe(true)
    expect(dev({ op: 'setVitals', hunger: 10 })).toEqual({ ok: true, msg: { type: 'dev', op: 'setVitals', hunger: 10 } })
    expect(dev({ op: 'spawnEnemy', x: 1, z: 2 }).ok).toBe(true)
    expect(dev({ op: 'placeCampfire', x: 1, z: 2, yaw: 0 }).ok).toBe(true)
    expect(dev({ op: 'setPhase', phase: 0.5 }).ok).toBe(true)
    const bad = [
      { op: 'give', item: 'diamante', amount: 1 },
      { op: 'give', item: 'wood', amount: 0 },
      { op: 'give', item: 'wood', amount: 1.5 },
      { op: 'teleport', x: 1, z: Infinity, yaw: 0, pitch: 0 },
      { op: 'teleport', x: 1, z: 2, yaw: 0, pitch: MAX_PITCH + 0.1 },
      { op: 'setVitals', health: -1 },
      { op: 'setVitals', hunger: 'mucha' },
      { op: 'spawnEnemy', x: 1 },
      { op: 'setPhase' },
      { op: 'fly' },
    ]
    for (const extra of bad) expect(dev(extra).ok, JSON.stringify(extra)).toBe(false)
  })
})
