import { describe, expect, it, vi } from 'vitest'
import {
  CloseCode,
  MAX_CHAT,
  MAX_PLAYERS,
  MAX_SEATS,
  PROTOCOL_VERSION,
  ServerDecoder,
  type Hello,
  type MoveMsg,
  type ServerMessage,
  type Snap,
  type Welcome,
} from '../src/net/protocol'
import { LaggyTransport, ManualTime, type Lag } from '../src/net/transport'
import { Btn, type Action, type ActionData, type PlayerCommands } from '../src/sim/commands'
import { EYE_HEIGHT, PLACE_DISTANCE } from '../src/sim/constants'
import type { PlayerId, SimEvent } from '../src/sim/events'
import { STRUCTURE_DEFS, structureSpot } from '../src/sim/structures'
import { aimPose } from '../src/sim/interaction'
import { INVENTORY_SIZE } from '../src/sim/inventory'
import type { PropData } from '../src/sim/props'
import type { Simulation } from '../src/sim/Simulation'
import { DAY_FRACTION } from '../src/sim/world/daycycle'
import { heightAt } from '../src/sim/world/terrain'
import { ABSENT_MS, CHAT_MS, FORGOTTEN_MS, ISLAND_TTL_MS, LOOP_MS, MAX_AHEAD, MemoryStorage, MOVE_REPEAT, Room, SAVE_MS } from './room'

const CODE = 'K7QX2'

/** Una sala con reloj manual, almacenamiento en memoria y tokens y semillas previsibles. */
function setup(storage = new MemoryStorage(), dev = false) {
  const time = new ManualTime(1_000_000)
  let tokens = 0
  const room = new Room(CODE, { storage, clock: time, scheduler: time, random: { token: () => `tok${++tokens}`, seed: () => 7 }, dev })
  return { room, time, storage }
}

type Of<T extends ServerMessage['type']> = Extract<ServerMessage, { type: T }>

/** Un cliente falso: manda lo que se le dice y guarda lo que recibe, en crudo y ya leído. */
class Client {
  readonly transport: LaggyTransport
  readonly raw: string[] = []
  readonly msgs: ServerMessage[] = []
  closed: number | null = null
  id: PlayerId = -1
  token?: string
  /** Última `seq` usada: tras `welcome`, la de `you.appliedSeq`. */
  seq = 0
  private decoder = new ServerDecoder()

  constructor(
    readonly room: Room,
    readonly time: ManualTime,
    readonly tab = 'tab',
    lag?: Lag,
  ) {
    this.transport = new LaggyTransport(room, time, lag)
    this.transport.onmessage = (data) => {
      this.raw.push(data)
      const msg = this.decoder.decode(data)
      this.msgs.push(msg)
      if (msg.type === 'welcome') {
        this.id = msg.id
        this.token = msg.token
        this.seq = msg.you.appliedSeq
      }
    }
    this.transport.onclose = (code) => (this.closed = code)
  }

  hello(intent: Hello['intent'], extra: Partial<Hello> = {}) {
    this.send({ type: 'hello', v: PROTOCOL_VERSION, t: this.time.now(), intent, room: CODE, name: 'Ana', tab: this.tab, ...(this.token ? { token: this.token } : {}), ...extra })
  }

  send(msg: object) {
    this.transport.send(JSON.stringify(msg))
  }

  cmds(moves: MoveMsg[], actions: Action[] = []) {
    this.send({ type: 'cmds', t: this.time.now(), moves, actions })
  }

  /** Una acción nueva para `tick`, numerada a continuación de la anterior. */
  action(data: ActionData, tick: number): Action {
    return { ...data, seq: ++this.seq, tick }
  }

  of<T extends ServerMessage['type']>(type: T): Of<T>[] {
    return this.msgs.filter((m): m is Of<T> => m.type === type)
  }

  get welcome(): Welcome {
    return this.of('welcome')[0]
  }

  get snap(): Snap {
    return this.of('snap').at(-1)!
  }

  get events(): SimEvent[] {
    return this.of('ev').flatMap((m) => m.list)
  }
}

/** Crea la sala con `a` y une a los demás; deja pasar los mensajes. */
function join(first: Client, ...others: Client[]) {
  first.hello('create')
  first.time.advance(0)
  for (const c of others) c.hello('join')
  first.time.advance(0)
}

/** Durante `ms`, cada cliente manda en cada vuelta los `Move` de los próximos ticks (como un cliente por delante). */
function play(time: ManualTime, ms: number, clients: [Client, Omit<MoveMsg, 'tick'>?][]) {
  for (let t = 0; t < ms; t += LOOP_MS) {
    for (const [c, move = { buttons: 0, yaw: 0, pitch: 0 }] of clients) c.cmds([{ ...move, tick: c.room.sim!.tick + 1, n: 6 }])
    time.advance(LOOP_MS)
  }
}

/** Pone al jugador delante del prop mirándolo; devuelve su orientación. */
function aimAt(sim: Simulation, id: PlayerId, prop: PropData) {
  const isFree = (x: number, z: number) => sim.world.props.every((o) => o === prop || !o.alive || Math.hypot(o.x - x, o.z - z) > o.radius + 0.4)
  const pose = aimPose(prop, isFree)
  const pitch = Math.atan2(pose.aimY - heightAt(pose.x, pose.z) - EYE_HEIGHT, pose.horizontal)
  sim.teleport(id, pose.x, pose.z, pose.yaw, pitch)
  return { yaw: pose.yaw, pitch }
}

/** Los comandos que recibe la simulación en cada tick. */
function spySteps(sim: Simulation) {
  const spy = vi.spyOn(sim, 'step')
  return () => spy.mock.calls.map(([commands]) => commands as ReadonlyMap<PlayerId, PlayerCommands>)
}

describe('Room', () => {
  it('dos clientes ven caer el mismo árbol', () => {
    const { room, time } = setup()
    const a = new Client(room, time)
    const b = new Client(room, time, 'b')
    join(a, b)
    expect(a.welcome.id).toBe(0)
    expect(b.welcome.id).toBe(1)
    expect(b.welcome.placements).toHaveLength(room.placements.length)
    expect(a.of('join')).toEqual([{ type: 'join', id: 1, name: 'Ana' }])

    const sim = room.sim!
    const tree = sim.world.props.find((p) => p.kind === 'tree')!
    const look = aimAt(sim, a.id, tree)
    play(time, 2000, [[a, { buttons: Btn.Attack, ...look }], [b]])
    expect(tree.alive).toBe(false)
    for (const c of [a, b]) {
      expect(c.events.filter((e) => e.type === 'propDestroyed')).toEqual([expect.objectContaining({ id: tree.id, by: a.id })])
      expect(c.events.filter((e) => e.type === 'playerSwing' && e.id === a.id).length).toBeGreaterThanOrEqual(3)
    }
    // B ve a A delante del árbol, con la posición en cm.
    const seen = b.snap.players.find((p) => p.id === a.id)!
    expect(seen.pos.x).toBeCloseTo(sim.slot(a.id).player.pos.x, 2)
    expect(b.snap.players.map((p) => p.id)).toEqual([a.id])
  })

  it('reparte el RTT que dice cada jugador en su `cmds`', () => {
    const { room, time } = setup()
    const a = new Client(room, time)
    const b = new Client(room, time, 'b')
    join(a, b)
    play(time, 200, [[a], [b]])
    expect(b.snap.players[0].ping).toBe(0)
    a.send({ type: 'cmds', t: time.now(), moves: [{ tick: room.sim!.tick + 1, buttons: 0, yaw: 0, pitch: 0, n: 6 }], actions: [], rtt: 87 })
    play(time, 200, [[b]])
    expect(b.snap.players[0].ping).toBe(87)
  })

  it('el inventario de cada uno solo va en su `you`', () => {
    const { room, time } = setup()
    const a = new Client(room, time)
    const b = new Client(room, time, 'b')
    join(a, b)
    const inventory = room.sim!.slot(a.id).inventory
    inventory.add('wood', 2)
    inventory.add('stone_pickaxe', 1)
    play(time, 300, [[a], [b]])
    b.send({ type: 'resync' })
    time.advance(0)
    expect(a.snap.you.inventory.counts).toEqual({ wood: 2, stone_pickaxe: 1 })
    expect(b.of('state')).toHaveLength(1)
    // B solo sabe lo que A tiene en la mano.
    expect(b.snap.players[0].item).toBe('wood')
    for (const raw of b.raw) expect(raw).not.toContain('stone_pickaxe')
    expect(b.snap.you.inventory.counts).toEqual({})
  })

  it('un snap lleva el inventario solo si ha cambiado, y nunca la orientación ni prev de `you`', () => {
    const { room, time } = setup()
    const a = new Client(room, time)
    join(a)
    play(time, 300, [[a]])
    const raw = () => a.raw.filter((r) => r.startsWith('{"type":"snap"')).map((r) => JSON.parse(r))
    expect(raw().every((s) => s.you.inventory === undefined)).toBe(true)
    expect(raw().every((s) => !('yaw' in s.you.player) && !('prev' in s.you.player))).toBe(true)
    room.sim!.slot(a.id).inventory.add('wood', 3)
    play(time, 300, [[a]])
    expect(raw().filter((s) => s.you.inventory)).toHaveLength(1)
    // Leído, todos lo llevan.
    expect(a.snap.you.inventory.counts).toEqual({ wood: 3 })
    // Tras un estado completo (que ya lo lleva), tampoco se repite.
    a.send({ type: 'resync' })
    play(time, 300, [[a]])
    expect(raw().filter((s) => s.you.inventory)).toHaveLength(1)
  })

  it('mover casillas llega al `you` con las 27; una casilla o una receta que no existen expulsan', () => {
    const { room, time } = setup()
    const a = new Client(room, time)
    join(a)
    room.sim!.slot(a.id).inventory.add('wood', 3)
    play(time, 300, [[a]])
    a.cmds([], [a.action({ kind: 'move', from: 0, to: INVENTORY_SIZE - 1 }, room.sim!.tick + 1)])
    play(time, 300, [[a]])
    expect(a.snap.you.inventory.slots).toHaveLength(INVENTORY_SIZE)
    expect(a.snap.you.inventory.slots[0]).toBe(null)
    expect(a.snap.you.inventory.slots[INVENTORY_SIZE - 1]).toBe('wood')

    const bad = [
      { kind: 'move', from: 0, to: INVENTORY_SIZE },
      { kind: 'craft', recipe: 0 },
      { kind: 'craft', recipe: 'iron_pickaxe' },
    ]
    for (const data of bad) {
      const c = new Client(room, time, 'x')
      c.hello('join')
      time.advance(0)
      // Ha entrado: lo que lo cierra es la acción, no un cmds sin asiento.
      expect(c.welcome).toBeDefined()
      expect(c.closed).toBe(null)
      c.cmds([], [c.action(data as ActionData, room.sim!.tick + 1)])
      time.advance(0)
      expect(c.closed, JSON.stringify(data)).toBe(CloseCode.Invalid)
    }
  })

  it('el chat llega a todos con el nombre de quien escribe; más de uno cada 400 ms se ignora', () => {
    const { room, time } = setup()
    const a = new Client(room, time)
    const b = new Client(room, time, 'b')
    join(a, b)
    b.send({ type: 'say', text: '  hola  ' })
    b.send({ type: 'say', text: 'otra vez' })
    time.advance(CHAT_MS)
    b.send({ type: 'say', text: 'ya' })
    time.advance(0)
    const chat = (text: string) => ({ type: 'chat', id: b.id, name: 'Ana', text })
    expect(a.of('chat')).toEqual([chat('hola'), chat('ya')])
    expect(b.of('chat')).toEqual([chat('hola'), chat('ya')])
    for (const text of ['', ' ', 'x'.repeat(MAX_CHAT + 1), 'a\u0007b', 3]) {
      const c = new Client(room, time, 'c')
      c.hello('join')
      c.send({ type: 'say', text })
      time.advance(0)
      expect(c.closed, String(text)).toBe(CloseCode.Invalid)
    }
  })

  it('las acciones se aplican en su tick, una vez, en orden, y las que llegan tarde en el siguiente', () => {
    const { room, time } = setup()
    const a = new Client(room, time)
    join(a)
    const steps = spySteps(room.sim!)
    const tick = room.sim!.tick
    const ahead = a.action({ kind: 'select', slot: 4 }, tick + 10)
    const after = a.action({ kind: 'select', slot: 5 }, tick + 5)
    a.cmds([{ tick: tick + 1, n: 10, buttons: 0, yaw: 0, pitch: 0 }], [ahead, after])
    time.advance(0)
    // Reenviada sin confirmar: no se duplica.
    a.cmds([], [ahead, after])
    time.advance(LOOP_MS * 6)
    const applied = steps().flatMap((commands) => commands.get(a.id)!.actions.map((x) => [x.seq, commands.get(a.id)!.move.tick]))
    // La de seq 2 es para un tick anterior, pero va detrás de la 1: espera a su tick, nunca se adelanta.
    expect(applied).toEqual([
      [ahead.seq, tick + 10],
      [after.seq, tick + 10],
    ])
    expect(room.sim!.slot(a.id).inventory.selected).toBe(5)
    expect(a.snap.ackSeq).toBe(after.seq)

    const late = a.action({ kind: 'craft', recipe: 'wood_axe' }, room.sim!.tick - 5)
    a.cmds([], [late])
    time.advance(0)
    const next = room.sim!.tick + 1
    time.advance(LOOP_MS * 4)
    const lateTicks = steps().flatMap((commands) => (commands.get(a.id)!.actions.some((x) => x.seq === late.seq) ? [commands.get(a.id)!.move.tick] : []))
    expect(lateTicks).toEqual([next])
    expect(room.sim!.slot(a.id).appliedSeq).toBe(late.seq)
  })

  it('si falta el Move se repite el último sin Attack ni Jump, y luego uno neutro con la misma mirada', () => {
    const { room, time } = setup()
    const a = new Client(room, time)
    join(a)
    const steps = spySteps(room.sim!)
    const tick = room.sim!.tick + 1
    a.cmds([{ tick, buttons: Btn.Fwd | Btn.Attack | Btn.Jump, yaw: 1.2, pitch: -0.3, aim: null }])
    time.advance(LOOP_MS * 4)
    const moves = steps().map((commands) => commands.get(a.id)!.move)
    const at = (t: number) => moves.find((m) => m.tick === t)!
    expect(at(tick).buttons).toBe(Btn.Fwd | Btn.Attack | Btn.Jump)
    for (let t = tick + 1; t <= tick + MOVE_REPEAT; t++) expect(at(t)).toEqual({ tick: t, buttons: Btn.Fwd, yaw: 1.2, pitch: -0.3, aim: null })
    expect(at(tick + MOVE_REPEAT + 1)).toEqual({ tick: tick + MOVE_REPEAT + 1, buttons: 0, yaw: 1.2, pitch: -0.3, aim: null })
    // Un golpe: el Attack repetido no da otro al acabar el cooldown.
    expect(a.events.filter((e) => e.type === 'playerSwing')).toHaveLength(1)
  })

  it('descarta los Move de ticks ya simulados y los demasiado adelantados', () => {
    const { room, time } = setup()
    const a = new Client(room, time)
    join(a)
    play(time, 200, [[a]])
    const steps = spySteps(room.sim!)
    const tick = room.sim!.tick
    a.cmds([
      { tick: tick - 2, n: 3, buttons: Btn.Back, yaw: 0, pitch: 0 },
      { tick: tick + MAX_AHEAD + 1, buttons: Btn.Left, yaw: 0, pitch: 0 },
    ])
    time.advance(LOOP_MS)
    expect(steps()[0].get(a.id)!.move).toMatchObject({ tick: tick + 1, buttons: 0 })
    // El tick de la que llegó tarde cuenta para dejar de reenviarla; el margen es negativo.
    expect(a.snap.ackTick).toBe(tick + MAX_AHEAD + 1)
  })

  it('ev llega antes que snap, y ningún enemigo sale en un snap antes que su enemySpawn', () => {
    const { room, time } = setup()
    const a = new Client(room, time)
    join(a)
    room.sim!.setPhase(DAY_FRACTION + 0.05)
    play(time, 8000, [[a, { buttons: Btn.Fwd, yaw: 0.3, pitch: 0 }]])
    const known = new Set<number>()
    let spawned = 0
    a.msgs.forEach((msg, i) => {
      if (msg.type === 'ev') {
        expect(a.msgs[i + 1]?.type).toBe('snap')
        const next = a.msgs[i + 1] as Snap
        for (const e of msg.list) expect(e.tick).toBeLessThanOrEqual(next.tick)
        for (const e of msg.list) if (e.type === 'enemySpawn') known.add(e.id) && spawned++
      }
      if (msg.type === 'snap') for (const e of msg.enemies) expect(known.has(e.id)).toBe(true)
    })
    expect(spawned).toBeGreaterThan(0)
    expect(a.events.some((e) => e.type === 'clockSet')).toBe(true)
  })

  it('al desconectarse sale del mundo; vuelve con su token y sigue numerando desde appliedSeq + 1', () => {
    const { room, time } = setup()
    const a = new Client(room, time)
    const b = new Client(room, time, 'b')
    join(a, b)
    const tick = room.sim!.tick + 1
    a.cmds([{ tick, buttons: 0, yaw: 0, pitch: 0 }], [a.action({ kind: 'select', slot: 3 }, tick), a.action({ kind: 'select', slot: 2 }, tick)])
    play(time, 200, [[b]])
    expect(room.sim!.slot(a.id).appliedSeq).toBe(2)

    a.transport.close()
    play(time, 200, [[b]])
    expect(room.sim!.slot(a.id).connection).toBe('gone')
    expect(b.of('leave')).toEqual([{ type: 'leave', id: a.id, name: 'Ana' }])
    expect(b.snap.players).toEqual([])
    expect(room.sim!.inWorld().map((s) => s.id)).toEqual([b.id])

    const again = new Client(room, time)
    again.token = a.token
    again.hello('join')
    time.advance(0)
    expect(again.welcome.id).toBe(a.id)
    expect(again.welcome.you.appliedSeq).toBe(2)
    expect(again.welcome.you.inventory.selected).toBe(2)
    expect(again.seq).toBe(2)
    expect(b.of('join').map((j) => j.id)).toEqual([a.id])
    const t2 = room.sim!.tick + 1
    // Una vieja reenviada se descarta; la nueva (seq 3) se aplica.
    again.cmds([{ tick: t2, buttons: 0, yaw: 0, pitch: 0 }], [{ kind: 'select', slot: 7, seq: 1, tick: t2 }, again.action({ kind: 'select', slot: 6 }, t2)])
    time.advance(LOOP_MS)
    expect(room.sim!.slot(a.id).inventory.selected).toBe(6)
    expect(room.sim!.slot(a.id).appliedSeq).toBe(3)
    expect(room.sim!.slot(a.id).connection).toBe('present')
  })

  it('la misma pestaña sustituye su socket; otra pestaña se queda el hueco y cierra la vieja con 4001', () => {
    const { room, time } = setup()
    const a = new Client(room, time, 'uno')
    const b = new Client(room, time, 'b')
    join(a, b)

    const reconnect = new Client(room, time, 'uno')
    reconnect.token = a.token
    reconnect.hello('join')
    time.advance(0)
    expect(a.closed).toBe(CloseCode.Normal)
    expect(reconnect.welcome.id).toBe(a.id)

    const otherTab = new Client(room, time, 'dos')
    otherTab.token = a.token
    otherTab.hello('join')
    time.advance(0)
    expect(reconnect.closed).toBe(CloseCode.OtherTab)
    expect(otherTab.welcome.id).toBe(a.id)
    expect(otherTab.closed).toBeNull()
    // Para los demás no se ha ido nadie.
    expect(b.of('leave')).toEqual([])
    expect(b.of('join')).toEqual([])
    play(time, 100, [[otherTab], [b]])
    expect(room.sim!.slot(a.id).connection).toBe('present')
  })

  it('rechaza mensajes inválidos, otra versión, un segundo hello y el exceso de mensajes', () => {
    const { room, time } = setup()
    const a = new Client(room, time)
    join(a)
    const cases: [string, (c: Client) => void, number][] = [
      ['no JSON', (c) => c.transport.send('{'), CloseCode.Invalid],
      ['cmds sin hello', (c) => c.cmds([]), CloseCode.Invalid],
      ['tipo desconocido', (c) => c.send({ type: 'x' }), CloseCode.Invalid],
      ['otra sala', (c) => c.hello('join', { room: 'ABCDE' }), CloseCode.Invalid],
      ['otra versión', (c) => c.hello('join', { v: PROTOCOL_VERSION + 1 }), CloseCode.Version],
      ['demasiado largo', (c) => c.hello('join', { name: 'x'.repeat(5000) }), CloseCode.Invalid],
    ]
    for (const [name, send, code] of cases) {
      const c = new Client(room, time, 'x')
      send(c)
      time.advance(0)
      expect(c.closed, name).toBe(code)
    }
    const old = new Client(room, time, 'x')
    old.hello('join', { v: PROTOCOL_VERSION + 1 })
    time.advance(0)
    expect(old.msgs).toEqual([{ type: 'reject', reason: 'version', v: PROTOCOL_VERSION }])

    const twice = new Client(room, time, 'x')
    twice.hello('join')
    twice.hello('join')
    time.advance(0)
    expect(twice.closed).toBe(CloseCode.Invalid)
    expect(room.sim!.slot(twice.id).connection).toBe('gone')

    const pitch = new Client(room, time, 'x')
    pitch.hello('join')
    time.advance(0)
    pitch.cmds([{ tick: 1, buttons: 0, yaw: 0, pitch: 3 }])
    time.advance(0)
    expect(pitch.closed).toBe(CloseCode.Invalid)

    for (let i = 0; i < 200; i++) a.cmds([])
    time.advance(0)
    expect(a.closed).toBe(CloseCode.Invalid)
  })

  it('create sobre una sala que existe y join a una que no se rechazan', () => {
    const { room, time } = setup()
    const nobody = new Client(room, time)
    nobody.hello('join')
    time.advance(0)
    expect(nobody.msgs).toEqual([{ type: 'reject', reason: 'not-found' }])
    expect(nobody.closed).toBe(CloseCode.Normal)
    expect(room.sim).toBeNull()

    const a = new Client(room, time)
    a.hello('create')
    time.advance(0)
    expect(a.welcome.id).toBe(0)
    const other = new Client(room, time, 'b')
    other.hello('create')
    time.advance(0)
    expect(other.msgs).toEqual([{ type: 'reject', reason: 'exists' }])
  })

  it(`admite ${MAX_PLAYERS} jugadores en el mundo; los desconectados no cuentan`, () => {
    const { room, time } = setup()
    const clients = Array.from({ length: MAX_PLAYERS }, (_, i) => new Client(room, time, `t${i}`))
    join(clients[0], ...clients.slice(1))
    expect(clients.every((c) => c.welcome)).toBe(true)
    const extra = new Client(room, time, 'extra')
    extra.hello('join')
    time.advance(0)
    expect(extra.msgs).toEqual([{ type: 'reject', reason: 'full' }])
    expect(extra.closed).toBe(CloseCode.RoomFull)

    clients[3].transport.close()
    time.advance(0)
    const late = new Client(room, time, 'late')
    late.hello('join')
    time.advance(0)
    expect(late.welcome.id).toBe(MAX_PLAYERS)
  })

  it(`guarda como mucho ${MAX_SEATS} huecos: se descarta el desconectado más antiguo`, () => {
    const { room, time } = setup()
    const host = new Client(room, time, 'host')
    join(host)
    const first = new Client(room, time, 'first')
    first.hello('join')
    time.advance(10)
    first.transport.close()
    for (let i = 0; i < MAX_SEATS; i++) {
      const c = new Client(room, time, `t${i}`)
      c.hello('join')
      time.advance(10)
      c.transport.close()
      time.advance(10)
    }
    expect(room.sim!.players.size).toBe(MAX_SEATS)
    expect(room.sim!.players.has(first.id)).toBe(false)
    const back = new Client(room, time, 'first')
    back.token = first.token
    back.hello('join')
    time.advance(0)
    // Su hueco ya no existe: entra como nuevo.
    expect(back.welcome.id).not.toBe(first.id)
    expect(back.welcome.token).not.toBe(first.token)
  })

  it('con todos ausentes se para el bucle; al reanudar se rebasa el reloj y todos reciben state', () => {
    const { room, time, storage } = setup()
    const a = new Client(room, time)
    const b = new Client(room, time, 'b')
    join(a, b)
    play(time, 500, [[a], [b]])
    time.advance(ABSENT_MS + LOOP_MS)
    const sim = room.sim!
    expect(sim.slot(a.id).connection).toBe('absent')
    const frozen = sim.tick
    expect(storage.blob).not.toBeNull()
    time.advance(60_000)
    expect(sim.tick).toBe(frozen)

    a.cmds([{ tick: frozen + 1, n: 6, buttons: 0, yaw: 0, pitch: 0 }])
    time.advance(0)
    for (const c of [a, b]) expect(c.of('state').at(-1)!.tick).toBe(frozen)
    time.advance(500)
    // Sin recuperar el minuto parado: medio segundo son 30 ticks.
    expect(sim.tick).toBe(frozen + 30)
    expect(sim.slot(a.id).connection).toBe('present')
    expect(sim.slot(b.id).connection).toBe('absent')
  })

  it('guarda la isla cada 10 s y la restaura con los jugadores, que vuelven con su token', () => {
    const storage = new MemoryStorage()
    const first = setup(storage)
    const a = new Client(first.room, first.time)
    join(a)
    first.room.sim!.slot(a.id).inventory.add('stone', 5)
    play(first.time, 1000, [[a, { buttons: Btn.Fwd, yaw: 0.5, pitch: 0 }]])
    expect(storage.blob).toBeNull()
    play(first.time, SAVE_MS, [[a]])
    expect(storage.blob).not.toBeNull()
    const saved = JSON.parse(storage.blob!)
    expect(saved.schema).toBe(PROTOCOL_VERSION)
    const pos = { ...saved.sim.players[0].player.pos }

    // La sala se crea de nuevo (redespliegue o expulsión de la DO): mismo almacenamiento, sockets perdidos.
    const second = setup(storage)
    const sim = second.room.sim!
    expect(sim.tick).toBe(saved.sim.tick)
    expect(sim.slot(a.id).connection).toBe('gone')
    const back = new Client(second.room, second.time)
    back.token = a.token
    back.hello('join')
    second.time.advance(0)
    expect(back.welcome.id).toBe(a.id)
    expect(back.welcome.you.inventory.counts).toEqual({ stone: 5 })
    expect(back.welcome.you.player.pos).toEqual(pos)
    expect(back.welcome.islandReset).toBeUndefined()
  })

  it('tras hibernar, adopt vuelve a unir un socket a su hueco', () => {
    const storage = new MemoryStorage()
    const first = setup(storage)
    const a = new Client(first.room, first.time)
    join(a)
    play(first.time, 500, [[a]])
    first.time.advance(ABSENT_MS + LOOP_MS)
    expect(storage.blob).not.toBeNull()

    const second = setup(storage)
    const socket = new Client(second.room, second.time)
    expect(second.room.adopt(socket.transport.conn, a.token!, 'tab')).toBe(true)
    expect(second.room.adopt(socket.transport.conn, 'otro', 'tab')).toBe(false)
    expect(second.room.sim!.slot(a.id).connection).toBe('absent')
    socket.cmds([{ tick: second.room.sim!.tick + 1, n: 6, buttons: 0, yaw: 0, pitch: 0 }])
    second.time.advance(LOOP_MS)
    expect(socket.of('state')).toHaveLength(1)
    expect(socket.snap.you.appliedSeq).toBe(0)
    expect(second.room.sim!.slot(a.id).connection).toBe('present')
  })

  it('una isla guardada con otra versión se descarta y quien vuelve empieza una nueva', () => {
    const storage = new MemoryStorage()
    storage.save(JSON.stringify({ schema: PROTOCOL_VERSION - 1, sim: { lo: 'que sea' } }))
    const { room, time } = setup(storage)
    expect(room.sim).toBeNull()
    expect(storage.blob).toBeNull()
    const back = new Client(room, time)
    back.token = 'tok-viejo'
    back.hello('join')
    time.advance(0)
    expect(back.welcome.islandReset).toBe(true)
    expect(back.welcome.id).toBe(0)
    const fresh = new Client(room, time, 'b')
    fresh.hello('join')
    time.advance(0)
    expect(fresh.welcome.islandReset).toBeUndefined()

    storage.save('no es JSON')
    expect(() => setup(storage)).not.toThrow()
  })

  it('cierra a los ausentes a los 10 min y borra la isla 24 h después de irse el último', () => {
    const { room, time, storage } = setup()
    const a = new Client(room, time)
    const b = new Client(room, time, 'b')
    join(a, b)
    play(time, FORGOTTEN_MS, [[b]])
    time.advance(LOOP_MS)
    expect(a.closed).toBe(CloseCode.Normal)
    expect(room.sim!.slot(a.id).connection).toBe('gone')
    expect(b.closed).toBeNull()

    b.transport.close()
    time.advance(ISLAND_TTL_MS - 1000)
    expect(room.sim).not.toBeNull()
    time.advance(1000)
    expect(room.sim).toBeNull()
    expect(storage.blob).toBeNull()
    const late = new Client(room, time)
    late.hello('join')
    time.advance(0)
    expect(late.msgs).toEqual([{ type: 'reject', reason: 'not-found' }])
  })

  it('responde al ping sin contarlo como actividad', () => {
    const { room, time } = setup()
    const a = new Client(room, time)
    const b = new Client(room, time, 'b')
    join(a, b)
    const pongs: string[] = []
    a.transport.onmessage = (data) => pongs.push(data)
    for (let t = 0; t < ABSENT_MS + 200; t += LOOP_MS) {
      a.transport.send('ping')
      b.cmds([{ tick: room.sim!.tick + 1, n: 6, buttons: 0, yaw: 0, pitch: 0 }])
      time.advance(LOOP_MS)
    }
    expect(pongs.filter((p) => p === 'pong').length).toBeGreaterThan(10)
    expect(room.sim!.slot(a.id).connection).toBe('absent')
  })

  it('los trucos de desarrollo se aplican al llegar y lo que emiten sale en el siguiente ev', () => {
    const { room, time } = setup(new MemoryStorage(), true)
    const a = new Client(room, time)
    join(a)
    const sim = room.sim!
    const { x, z } = sim.spawnCenter
    const radius = STRUCTURE_DEFS.campfire.radius
    // Dos sitios donde cabe una fogata, cerca del punto de aparición y lejos uno de otro.
    const free: { x: number; z: number }[] = []
    for (let i = 0; i < 400 && free.length < 2; i++) {
      const at = { x: x + Math.cos(i) * (3 + i * 0.1), z: z + Math.sin(i) * (3 + i * 0.1) }
      const fits = structureSpot(at, 0, radius, [sim.world.grid]).valid
      if (fits && free.every((f) => Math.hypot(f.x - at.x, f.z - at.z) > 4)) free.push(at)
    }
    expect(free).toHaveLength(2)
    a.send({ type: 'dev', op: 'give', item: 'wood', amount: 5 })
    a.send({ type: 'dev', op: 'teleport', x: x + 1, z: z + 1, yaw: 1, pitch: 0.2 })
    a.send({ type: 'dev', op: 'setVitals', health: 50, hunger: 20 })
    a.send({ type: 'dev', op: 'setPhase', phase: 0.8 })
    a.send({ type: 'dev', op: 'spawnEnemy', x: x + 8, z })
    a.send({ type: 'dev', op: 'placeStructure', kind: 'campfire', x: free[0].x, z: free[0].z, yaw: 0 })
    time.advance(0)
    expect(sim.structures.list).toMatchObject([{ kind: 'campfire', x: free[0].x, z: free[0].z - PLACE_DISTANCE }])
    const slot = sim.slot(a.id)
    expect(slot.inventory.count('wood')).toBe(5)
    expect(slot.player.pos.x).toBeCloseTo(x + 1)
    expect(slot.player.pos.z).toBeCloseTo(z + 1)
    expect(slot.player.pitch).toBe(0.2)
    expect(slot.player.health).toBe(50)
    expect(slot.player.hunger).toBe(20)
    expect(sim.clock.phase).toBeCloseTo(0.8, 3)
    expect(sim.enemies.list).toHaveLength(1)
    play(time, LOOP_MS * 2, [[a]])
    const types = a.events.map((e) => e.type)
    expect(types).toContain('clockSet')
    expect(types).toContain('enemySpawn')
    expect(types).toContain('structurePlaced')
    // Sin (x, z) ni yaw: delante del jugador, hacia donde mira.
    a.send({ type: 'dev', op: 'teleport', x: free[1].x, z: free[1].z, yaw: 0, pitch: 0 })
    a.send({ type: 'dev', op: 'placeStructure', kind: 'campfire' })
    time.advance(0)
    expect(sim.structures.list).toHaveLength(2)
    expect(sim.structures.list[1].x).toBeCloseTo(free[1].x)
    expect(sim.structures.list[1].z).toBeCloseTo(free[1].z - PLACE_DISTANCE)
    expect(a.closed).toBeNull()
  })

  it('sin modo de desarrollo, un truco cierra el socket con 4005', () => {
    const { room, time } = setup()
    const a = new Client(room, time)
    join(a)
    a.send({ type: 'dev', op: 'give', item: 'wood', amount: 5 })
    time.advance(0)
    expect(a.closed).toBe(CloseCode.Invalid)
    expect(room.sim!.slot(a.id).inventory.count('wood')).toBe(0)
  })

  it('con las reglas de una sala: el muerto reaparece y, con todos muertos, la isla se reinicia', () => {
    const { room, time } = setup(new MemoryStorage(), true)
    const a = new Client(room, time, 'a')
    const b = new Client(room, time, 'b')
    join(a, b)
    expect(room.sim!.coop).toBe(true)
    a.send({ type: 'dev', op: 'give', item: 'wood', amount: 3 })
    a.send({ type: 'dev', op: 'setVitals', health: 0, hunger: 0 })
    play(time, 200, [[a], [b]])
    expect(b.events.filter((e) => e.type === 'playerDied').map((e) => e.id)).toEqual([a.id])
    expect(b.events.some((e) => e.type === 'pickupSpawn' && e.item === 'wood' && e.amount === 3)).toBe(true)
    const { you } = a.snap
    expect(you).toMatchObject({ alive: false, inventory: expect.objectContaining({ counts: {} }) })
    expect(you.respawnAt).toBeGreaterThan(a.snap.tick)

    // El muerto sigue mandando `cmds` (el cliente, a 1 Hz) y reaparece a los 30 s.
    play(time, 31_000, [[a], [b]])
    expect(a.events.some((e) => e.type === 'playerRespawn' && e.id === a.id)).toBe(true)
    expect(a.snap.you).toMatchObject({ alive: true, respawnAt: null })

    a.send({ type: 'dev', op: 'setVitals', health: 0, hunger: 0 })
    b.send({ type: 'dev', op: 'setVitals', health: 0, hunger: 0 })
    play(time, 10_000, [[a], [b]])
    expect(a.events.filter((e) => e.type === 'gameOver')).toHaveLength(1)
    expect(b.events.filter((e) => e.type === 'worldReset')).toHaveLength(1)
    expect(b.snap.you.alive).toBe(true)
  })

  it('si el único vivo se corta y vuelve antes de los 6 s, el game over se cancela', () => {
    const { room, time } = setup(new MemoryStorage(), true)
    const a = new Client(room, time, 'a')
    const b = new Client(room, time, 'b')
    join(a, b)
    b.send({ type: 'dev', op: 'setVitals', health: 0, hunger: 0 })
    play(time, 200, [[a], [b]])
    a.transport.close()
    play(time, 1000, [[b]])
    expect(b.events.filter((e) => e.type === 'gameOver')).toHaveLength(1)
    const back = new Client(room, time, 'a')
    back.token = a.token
    back.hello('join')
    play(time, 10_000, [[back], [b]])
    expect(b.events.filter((e) => e.type === 'gameOverCancelled')).toHaveLength(1)
    expect(b.events.some((e) => e.type === 'worldReset')).toBe(false)
    expect(b.snap.you.alive).toBe(false)
  })

  it('funciona igual con latencia y jitter', () => {
    const { room, time } = setup()
    let seed = 1
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const lag = { latency: 100, jitter: 30, rng }
    const a = new Client(room, time, 'a', lag)
    const b = new Client(room, time, 'b', lag)
    a.hello('create')
    time.advance(200)
    b.hello('join')
    time.advance(200)
    const sim = room.sim!
    const tree = sim.world.props.find((p) => p.kind === 'tree')!
    const look = aimAt(sim, a.id, tree)
    // Por delante del servidor lo que tarda en llegar.
    for (let t = 0; t < 3000; t += LOOP_MS) {
      a.cmds([{ tick: sim.tick + 8, n: 6, buttons: Btn.Attack, ...look }])
      b.cmds([{ tick: sim.tick + 8, n: 6, buttons: 0, yaw: 0, pitch: 0 }])
      time.advance(LOOP_MS)
    }
    time.advance(300)
    expect(tree.alive).toBe(false)
    expect(b.events.filter((e) => e.type === 'propDestroyed').map((e) => e.id)).toEqual([tree.id])
    expect(a.snap.slack).toBeGreaterThan(0)
    // Los mensajes llegan en orden.
    const ticks = a.of('snap').map((s) => s.tick)
    expect(ticks).toEqual([...ticks].sort((x, y) => x - y))
  })
})
