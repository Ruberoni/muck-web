import { describe, expect, it } from 'vitest'
import { MAX_PITCH } from '../sim/constants'
import { RECIPES } from '../sim/crafting'
import { SLOT_COUNT } from '../sim/inventory'
import {
  cleanChat,
  cleanName,
  enemyTuple,
  isRoomCode,
  MAX_ACTIONS,
  MAX_CHAT,
  MAX_MESSAGE,
  MAX_MOVES,
  MAX_RTT,
  parseClientMessage,
  pickupTuple,
  playerTuple,
  PROTOCOL_VERSION,
  ServerDecoder,
  type EnemySnap,
  type PickupSnap,
  type PlayerSnap,
  type SnapWire,
} from './protocol'

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
    const withRtt = parse(cmds({ rtt: 85 }))
    expect(withRtt.ok && withRtt.msg).toMatchObject({ type: 'cmds', rtt: 85 })
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
    for (const rtt of [-1, 1.5, 'x', MAX_RTT + 1]) expect(valid(cmds({ rtt })), String(rtt)).toBe(false)
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

  it('chat: de 1 a MAX_CHAT caracteres, sin caracteres de control', () => {
    expect(cleanChat('  hola  ')).toBe('hola')
    expect(cleanChat('x'.repeat(MAX_CHAT))).toHaveLength(MAX_CHAT)
    for (const text of ['', '   ', 'x'.repeat(MAX_CHAT + 1), 'a\nb', 7, null]) expect(cleanChat(text), String(text)).toBeNull()
    expect(parse({ type: 'say', text: ' ¡hola! ', extra: 1 })).toEqual({ ok: true, msg: { type: 'say', text: '¡hola!' } })
    expect(valid({ type: 'say' })).toBe(false)
  })
})

describe('snap en el cable', () => {
  const player: PlayerSnap = { id: 2, pos: { x: 1.25, y: 5.5, z: -3 }, yaw: 1.5, pitch: -0.2, item: 'wood', health: 80, alive: true, connection: 'absent', ping: 87 }
  const enemy: EnemySnap = { id: 9, pos: { x: -10.5, z: 4.25 }, yaw: 3.1, hp: 4 }
  const pickup: PickupSnap = { id: 4, pos: { x: 1, y: 2, z: 3 }, grounded: true }
  const inventory = { slots: ['wood', null, null, null, null, null, null, null, null], counts: { wood: 3 }, selected: 0 } as const
  const you = (withInventory: boolean): SnapWire['you'] => ({
    player: { pos: { x: 1, y: 2, z: 3 }, vel: { x: 0, y: 0, z: 0 }, grounded: true, inWater: false, floating: false, stamina: 100, exhausted: false, sprintLocked: false, regenDelay: 0, health: 100, hunger: 90 },
    ...(withInventory ? { inventory: { ...inventory, slots: [...inventory.slots], counts: { ...inventory.counts } } } : {}),
    combat: { cooldown: 0, pendingSwing: false },
    hotbarFull: false,
    alive: true,
    respawnAt: null,
    appliedSeq: 3,
  })
  const wire = (withInventory: boolean): SnapWire => ({
    type: 'snap',
    tick: 30,
    t: 1,
    held: 2,
    ackTick: 31,
    ackSeq: 3,
    slack: 4,
    you: you(withInventory),
    players: [playerTuple(player)],
    enemies: [enemyTuple(enemy)],
    movingPickups: [pickupTuple(pickup)],
  })

  it('las tuplas se leen como los objetos de los que salen', () => {
    const decoder = new ServerDecoder()
    const snap = decoder.decode(JSON.stringify(wire(true)))
    expect(snap).toMatchObject({ type: 'snap', tick: 30, players: [player], enemies: [enemy], movingPickups: [pickup] })
    expect(decoder.decode(JSON.stringify({ ...wire(true), players: [playerTuple({ ...player, alive: false, connection: 'present' })] }))).toMatchObject({
      players: [{ alive: false, connection: 'present' }],
    })
  })

  it('un snap sin inventario lleva el último que llegó (en un welcome, un state o un snap)', () => {
    const decoder = new ServerDecoder()
    expect(() => decoder.decode(JSON.stringify(wire(false)))).toThrow()
    decoder.decode(JSON.stringify(wire(true)))
    const snap = decoder.decode(JSON.stringify(wire(false)))
    expect(snap.type === 'snap' && snap.you.inventory).toEqual(inventory)
    const empty = { slots: Array(9).fill(null), counts: {}, selected: 2 }
    decoder.decode(JSON.stringify({ type: 'state', tick: 40, worldStartTick: 0, state: {}, you: { ...you(false), inventory: empty } }))
    const after = decoder.decode(JSON.stringify(wire(false)))
    expect(after.type === 'snap' && after.you.inventory).toEqual(empty)
  })
})
