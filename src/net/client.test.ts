import { describe, expect, it } from 'vitest'
import { Room, MemoryStorage, ABSENT_MS } from '../../server/room'
import { Btn, type ActionData } from '../sim/commands'
import { EYE_HEIGHT, MAX_PITCH } from '../sim/constants'
import { RECIPE_IDS } from '../sim/crafting'
import { aimPose } from '../sim/interaction'
import { mulberry32 } from '../sim/random'
import { heightAt } from '../sim/world/terrain'
import { clientCraftWorld, CLIENT_STATION_RANGE, sendableActions } from '../ui/recipes'
import { botMove, driveClient } from './bot'
import { LEAVE_GRACE_MS, NetClient, compactMoves, encodeCmds } from './client'
import { MAX_ACTIONS, MAX_MESSAGE, MAX_MOVE_REPEAT, MAX_MOVES, MAX_RTT, parseClientMessage, type Cmds } from './protocol'
import type { MoveInput } from './session'
import { LaggyTransport, ManualTime, type Lag } from './transport'

const CODE = 'K7QX2'
const FRAME_MS = 16

/** Sala con reloj manual y un cliente en red con 100 ms ± 30 de latencia en cada sentido. */
function setup() {
  const time = new ManualTime(1_000_000)
  let tokens = 0
  const room = new Room(CODE, { storage: new MemoryStorage(), clock: time, scheduler: time, random: { token: () => `tok${++tokens}`, seed: () => 7 }, dev: true })
  let seeds = 0
  const connect = (tab: string, intent: 'create' | 'join' = 'join', lag: Lag = { latency: 100, jitter: 30, rng: mulberry32(++seeds) }, token?: string) => {
    const transport = new LaggyTransport(room, time, lag)
    const client = new NetClient(transport, time, { intent, room: CODE, name: tab, tab, ...(token ? { token } : {}) })
    const sent: { at: number; msg: Cmds }[] = []
    const send = transport.send.bind(transport)
    transport.send = (data) => {
      const msg = JSON.parse(data)
      if (msg.type === 'cmds') sent.push({ at: time.now(), msg })
      send(data)
    }
    client.connect()
    return { client, transport, lag, sent }
  }
  return { room, time, connect }
}

/** Lo que hace un jugador en un tick (las acciones, sin numerar). */
type Script = (tick: number) => MoveInput & { actions?: ActionData[] }
const idle: Script = () => ({ buttons: 0, yaw: 0, pitch: 0 })

/** Corre `ms` en frames: avanza el reloj (sala y mensajes) y cada cliente predice los ticks que tocan, envía y pone el espejo al día. */
function run(time: ManualTime, ms: number, players: [NetClient, Script][], afterFrame?: () => void) {
  for (let t = 0; t < ms; t += FRAME_MS) {
    time.advance(FRAME_MS)
    for (const [client, script] of players) {
      const ticks = client.advance()
      for (let i = 0; i < ticks; i++) {
        const { actions = [], ...move } = script(client.predictor!.tick + 1)
        client.step(move, actions)
      }
      client.flush()
      client.render()
    }
    afterFrame?.()
  }
}

/** Andar, esprintar, saltar y girar a la vez, variando con el tick. */
const roam: Script = (tick) => ({
  buttons: (tick % 240 < 160 ? Btn.Fwd : Btn.Back) | (tick % 100 < 40 ? Btn.Sprint : 0) | (tick % 90 === 0 ? Btn.Jump : 0) | (tick % 300 < 50 ? Btn.Left : 0),
  yaw: Math.sin(tick / 50) * 2,
  pitch: Math.sin(tick / 37) * 0.5,
})

const resetStats = (client: NetClient) => Object.assign(client.predictor!.stats, { reconciled: 0, corrections: 0, maxError: 0 })

describe('NetClient con la sala en memoria (100 ms ± 30)', () => {
  it('la predicción coincide con el servidor andando, esprintando, saltando y girando', () => {
    const { room, time, connect } = setup()
    const { client } = connect('a', 'create')
    run(time, 2000, [[client, idle]])
    expect(client.state).toBe('online')
    resetStats(client)
    let lastYaw = 0
    run(time, 8000, [[client, (tick) => roam(tick)]], () => {
      // La orientación es siempre la del último Move: reconciliar no la cambia.
      const last = client.predictor!.history.at(-1)?.move
      if (last) lastYaw = last.yaw
      expect(client.predictor!.slot.player.yaw).toBe(lastYaw)
    })
    const { stats } = client.predictor!
    expect(stats.reconciled).toBeGreaterThan(100)
    expect(stats.corrections).toBe(0)
    expect(stats.maxError).toBe(0)
    // Se ha movido de verdad.
    const server = room.sim!.slot(client.id).player
    expect(Math.hypot(server.pos.x - room.sim!.spawnCenter.x, server.pos.z - room.sim!.spawnCenter.z)).toBeGreaterThan(5)
  })

  it('también comiendo, fabricando, moviendo casillas y colocando una fogata', () => {
    const { room, time, connect } = setup()
    const { client } = connect('a', 'create')
    run(time, 500, [[client, idle]])
    const slot = room.sim!.slot(client.id)
    slot.inventory.add('wood', 20)
    slot.inventory.add('stone', 10)
    slot.inventory.add('berry', 3)
    slot.player.hunger = 50
    run(time, 1500, [[client, idle]])
    resetStats(client)

    let start = -1
    const script: Script = (tick) => {
      if (start < 0) start = tick
      const at = tick - start
      const actions: ActionData[] = []
      if (at === 10) actions.push({ kind: 'craft', recipe: 'campfire' })
      if (at === 20) actions.push({ kind: 'select', slot: 3 })
      if (at === 30) actions.push({ kind: 'place' })
      // Dos veces en el mismo tick serían un solo bocado.
      if (at === 40 || at === 45) actions.push({ kind: 'eat' })
      if (at === 60) actions.push({ kind: 'craft', recipe: 'wood_axe' }, { kind: 'select', slot: 0 })
      // Mueve casillas a la mochila y entre ellas; lo siguiente que se fabrica ocupa la primera libre.
      if (at === 70) actions.push({ kind: 'move', from: 0, to: 20 }, { kind: 'move', from: 1, to: 0 })
      if (at === 72) actions.push({ kind: 'move', from: 20, to: 26 }, { kind: 'craft', recipe: 'wood_pickaxe' })
      // Se aparta de la fogata andando hacia atrás.
      return { buttons: at > 80 && at < 140 ? Btn.Back : 0, yaw: 0, pitch: 0, actions }
    }
    run(time, 4000, [[client, script]])
    expect(room.sim!.structures.list).toHaveLength(1)
    expect(client.sim!.structures.list).toHaveLength(1)
    expect(slot.inventory.save()).toEqual(client.predictor!.slot.inventory.save())
    expect(slot.inventory.count('berry')).toBe(1)
    expect(slot.inventory.count('wood_axe')).toBe(1)
    expect(slot.inventory.count('campfire')).toBe(0)
    expect(slot.inventory.slots[26]).toBe('wood')
    expect(slot.inventory.slots[1]).toBe('wood_pickaxe')
    expect(client.predictor!.stats.corrections).toBe(0)
  })

  it('fabrica en la mesa sin correcciones: pulsando desde que la coloca y alejándose hasta el borde del alcance', () => {
    const { room, time, connect } = setup()
    const { client } = connect('a', 'create')
    run(time, 500, [[client, idle]])
    const slot = room.sim!.slot(client.id)
    slot.inventory.add('wood', 10 + 3 * 40)
    slot.inventory.add('stone', 5 * 40)
    run(time, 1500, [[client, idle]])
    resetStats(client)

    // Lo que hace Game: solo manda los `craft` que el cliente da por buenos, con el alcance con margen.
    const world = clientCraftWorld(() => client.sim!.structures.list)
    const fromEdge = () => {
      const bench = client.sim!.structures.list[0]
      const { pos } = client.predictor!.slot.player
      return bench ? Math.hypot(bench.x - pos.x, bench.z - pos.z) - bench.radius : Infinity
    }
    let start = -1
    const sent: { at: number; edge: number }[] = []
    let filtered = 0
    const script: Script = (tick) => {
      if (start < 0) start = tick
      const at = tick - start
      const { inventory, player } = client.predictor!.slot
      const wanted: ActionData[] = []
      if (at === 10) wanted.push({ kind: 'craft', recipe: 'workbench' })
      if (at === 20) wanted.push({ kind: 'select', slot: inventory.slots.indexOf('workbench') }, { kind: 'place' })
      // Desde que la coloca, pide un hacha cada 2 ticks; a partir de 60 se aleja andando hacia atrás.
      const tries = at > 20 && at % 2 === 0
      if (tries) wanted.push({ kind: 'craft', recipe: 'stone_axe' })
      const actions = sendableActions(wanted, inventory, world, player.pos)
      if (tries && actions.some((a) => a.kind === 'craft')) sent.push({ at, edge: fromEdge() })
      else if (tries) filtered++
      return { buttons: at > 60 && fromEdge() < 5 ? Btn.Back : 0, yaw: 0, pitch: 0, actions }
    }
    run(time, 4000, [[client, script]])

    expect(room.sim!.structures.list.map((s) => s.kind)).toEqual(['workbench'])
    // Antes de que llegue `structurePlaced` (un RTT) no se manda nada: la mesa aún no está en el espejo.
    expect(sent[0].at).toBeGreaterThan(22)
    // Se fabrica hasta el borde de los 3,3 m del cliente, y ninguna se pierde en el servidor.
    expect(Math.max(...sent.map((s) => s.edge))).toBeGreaterThan(CLIENT_STATION_RANGE - 0.25)
    expect(Math.max(...sent.map((s) => s.edge))).toBeLessThanOrEqual(CLIENT_STATION_RANGE)
    expect(filtered).toBeGreaterThan(10)
    expect(slot.inventory.count('stone_axe')).toBe(sent.length)
    expect(slot.inventory.save()).toEqual(client.predictor!.slot.inventory.save())
    expect(fromEdge()).toBeGreaterThan(CLIENT_STATION_RANGE)
    expect(client.predictor!.stats.corrections).toBe(0)
  })

  it('una acción que llega tarde se aplica una vez y la predicción vuelve a coincidir', () => {
    const { room, time, connect } = setup()
    const { client, transport } = connect('a', 'create')
    run(time, 500, [[client, idle]])
    room.sim!.slot(client.id).inventory.add('wood', 7)
    run(time, 1500, [[client, idle]])

    let craftTick = -1
    run(time, 100, [
      [
        client,
        (tick) => {
          if (craftTick >= 0) return idle(tick)
          craftTick = tick
          transport.stall(400)
          return { ...idle(tick), actions: [{ kind: 'craft', recipe: 'wood_axe' }] }
        },
      ],
    ])
    run(time, 2000, [[client, idle]])
    // La aplicó el servidor después de su tick.
    const applied = room.sim!.slot(client.id).inventory
    expect(applied.count('wood_axe')).toBe(1)
    expect(applied.count('wood')).toBe(2)
    expect(client.predictor!.slot.inventory.save()).toEqual(applied.save())
    expect(client.predictor!.stats.corrections).toBeGreaterThan(0)
    resetStats(client)
    run(time, 2000, [[client, roam]])
    expect(client.predictor!.stats.corrections).toBe(0)
  })

  it('el margen (slack) converge al objetivo, también si cambia la latencia', () => {
    const { time, connect } = setup()
    const { client, lag } = connect('a', 'create', { latency: 40, jitter: 10, rng: mulberry32(3) })
    run(time, 5000, [[client, roam]])
    const { clock } = client
    expect(Math.abs(clock.margin - clock.targetMargin)).toBeLessThan(1.5)
    const leadBefore = clock.lead

    lag.latency = 150
    lag.jitter = 30
    run(time, 4000, [[client, roam]])
    resetStats(client)
    const slacks: number[] = []
    run(time, 4000, [[client, roam]], () => slacks.push(clock.margin))
    expect(clock.lead).toBeGreaterThan(leadBefore + 5)
    // El objetivo se mueve con el jitter medido: cerca de él, nunca por debajo de lo que hace llegar tarde.
    for (const slack of slacks) expect(Math.abs(slack - clock.targetMargin)).toBeLessThan(2.5)
    expect(Math.min(...slacks)).toBeGreaterThan(2)
    expect(client.predictor!.stats.corrections).toBe(0)
  })

  it('el resync tras 5 s sin enviar deja el estado igual al del servidor', () => {
    const { room, time, connect } = setup()
    const a = connect('a', 'create').client
    const b = connect('b').client
    run(time, 2000, [
      [a, roam],
      [b, roam],
    ])
    a.suspend()
    run(time, 1000, [[b, roam]])
    // Mientras no mira, cae un árbol (sin evento: solo lo sabrá por el estado completo).
    const tree = room.sim!.world.props.find((p) => p.kind === 'tree' && p.alive)!
    tree.alive = false
    run(time, 4000, [[b, roam]], () => expect(a.advance()).toBe(0))
    expect(room.sim!.slot(a.id).connection).toBe('absent')
    expect(a.sim!.world.props[tree.id].alive).toBe(true)

    a.wake()
    run(time, 1000, [
      [a, idle],
      [b, roam],
    ])
    expect(a.sim!.world.props[tree.id].alive).toBe(false)
    expect(room.sim!.slot(a.id).connection).toBe('present')
    expect(a.predictor!.slot.player.pos).toEqual(room.sim!.slot(a.id).player.pos)
    resetStats(a)
    run(time, 3000, [
      [a, roam],
      [b, roam],
    ])
    expect(a.predictor!.stats.reconciled).toBeGreaterThan(30)
    expect(a.predictor!.stats.corrections).toBe(0)
    // Y ve a B donde está (100 ms por detrás de lo último que llega).
    const seen = a.players.sample(a.renderTick()).find((p) => p.id === b.id)!
    const real = room.sim!.slot(b.id).player.pos
    expect(Math.hypot(seen.pose.x - real.x, seen.pose.z - real.z)).toBeLessThan(3)
  })

  it('quieto envía a 4 Hz sin correcciones, y al volver a moverse el lead sigue estable', () => {
    const { time, connect } = setup()
    const { client, sent } = connect('a', 'create')
    const lead = () => client.clock.tick - client.clock.serverTick(time.now())
    run(time, 3000, [[client, roam]])
    resetStats(client)
    run(time, 1000, [[client, roam]])
    const leadMoving = lead()

    sent.length = 0
    run(time, 5000, [[client, idle]])
    const gaps = sent.slice(2).map((s, i) => s.at - sent[i + 1].at)
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(250)
    expect(Math.max(...gaps)).toBeLessThan(250 + FRAME_MS * 2)
    expect(5000 / Math.max(...gaps)).toBeLessThan(ABSENT_MS)

    sent.length = 0
    let moved = -1
    run(time, 3000, [
      [
        client,
        (tick) => {
          if (moved < 0) moved = time.now()
          return roam(tick)
        },
      ],
    ])
    // Al moverse envía en el acto.
    expect(sent[0].at - moved).toBeLessThanOrEqual(FRAME_MS)
    expect(Math.abs(lead() - leadMoving)).toBeLessThan(1.5)
    expect(client.predictor!.stats.corrections).toBe(0)
  })
})

describe('el espejo de NetClient', () => {
  it('los objetos que caen se ven donde están, y desaparecen al recogerlos', () => {
    const { room, time, connect } = setup()
    const a = connect('a', 'create').client
    const b = connect('b').client
    run(time, 2000, [
      [a, idle],
      [b, idle],
    ])
    const sim = room.sim!
    const { x, z } = sim.spawnCenter
    // Lejos de los dos: caen y se quedan en el suelo.
    sim.pickups.drop('stone', 3, x + 9, heightAt(x + 9, z) + 1, z)
    run(time, 3000, [
      [a, idle],
      [b, idle],
    ])
    expect(sim.pickups.list).toHaveLength(3)
    for (const client of [a, b]) {
      const seen = client.sim!.pickups.list
      expect(seen.map((p) => p.id)).toEqual(sim.pickups.list.map((p) => p.id))
      for (const p of seen) {
        const real = sim.pickups.list.find((q) => q.id === p.id)!
        expect(p.grounded).toBe(true)
        expect(p.item).toBe('stone')
        expect(Math.hypot(p.pos.x - real.pos.x, p.pos.y - real.pos.y, p.pos.z - real.pos.z)).toBeLessThan(0.02)
      }
    }
    // B se pone encima de cada una: las recoge y dejan de verse.
    for (const { pos } of [...sim.pickups.list]) {
      sim.teleport(b.id, pos.x, pos.z, 0, 0)
      run(time, 700, [
        [a, idle],
        [b, idle],
      ])
    }
    expect(sim.pickups.list).toHaveLength(0)
    expect(a.sim!.pickups.list).toHaveLength(0)
    expect(b.sim!.pickups.list).toHaveLength(0)
    expect(b.predictor!.slot.inventory.count('stone')).toBe(3)
  })

  it('enemigos y reloj del día como en el servidor, un poco por detrás', () => {
    const { room, time, connect } = setup()
    const { client } = connect('a', 'create')
    run(time, 1000, [[client, idle]])
    const sim = room.sim!
    sim.setPhase(0.75)
    const { pos } = sim.slot(client.id).player
    sim.enemies.spawnAt(pos.x + 8, pos.z)
    run(time, 1500, [[client, roam]])
    const mirror = client.sim!
    expect(mirror.clock.day).toBe(sim.clock.day)
    // Unos 200 ms por detrás: 100 de interpolación y la mitad del RTT.
    expect(sim.clock.phase - mirror.clock.phase).toBeGreaterThan(0)
    expect(sim.clock.phase - mirror.clock.phase).toBeLessThan(0.5 / 360)
    expect(mirror.enemies.list.map((e) => e.id)).toEqual(sim.enemies.list.map((e) => e.id))
    expect(mirror.enemies.list.length).toBeGreaterThan(0)
    for (const e of mirror.enemies.list) {
      const real = sim.enemies.list.find((r) => r.id === e.id)!
      expect(Math.hypot(e.pos.x - real.pos.x, e.pos.z - real.pos.z)).toBeLessThan(1.5)
    }
  })

  it('cada Move lleva aim; con él se tala el árbol que se ve, y el espejo lo sabe', () => {
    const { room, time, connect } = setup()
    const { client, sent } = connect('a', 'create')
    run(time, 1000, [[client, idle]])
    const sim = room.sim!
    const tree = sim.world.props.find((p) => p.kind === 'tree' && p.alive)!
    const isFree = (x: number, z: number) => sim.world.props.every((o) => o === tree || !o.alive || Math.hypot(o.x - x, o.z - z) > o.radius + 0.4)
    const pose = aimPose(tree, isFree)
    const pitch = Math.atan2(pose.aimY - heightAt(pose.x, pose.z) - EYE_HEIGHT, pose.horizontal)
    sim.teleport(client.id, pose.x, pose.z, pose.yaw, pitch)
    sent.length = 0
    run(time, 4000, [[client, () => ({ buttons: Btn.Attack, yaw: pose.yaw, pitch })]])
    const moves = sent.flatMap((s) => s.msg.moves)
    expect(moves.every((m) => m.aim !== undefined)).toBe(true)
    expect(moves.some((m) => m.aim?.kind === 'prop' && m.aim.id === tree.id)).toBe(true)
    expect(sim.world.props[tree.id].alive).toBe(false)
    expect(client.sim!.world.props[tree.id].alive).toBe(false)
    // Y la madera que suelta.
    run(time, 2000, [[client, idle]])
    expect(client.sim!.pickups.list.map((p) => p.id)).toEqual(sim.pickups.list.map((p) => p.id))
  })

  it('un truco de desarrollo se aplica en el servidor y la predicción lo recoge', () => {
    const { room, time, connect } = setup()
    const { client } = connect('a', 'create')
    run(time, 1500, [[client, roam]])
    client.dev({ op: 'give', item: 'stone', amount: 4 })
    const sentAt = time.now()
    run(time, 1000, [[client, roam]])
    expect(client.lastEcho).toBeGreaterThan(sentAt)
    expect(room.sim!.slot(client.id).inventory.count('stone')).toBe(4)
    expect(client.predictor!.slot.inventory.count('stone')).toBe(4)
    resetStats(client)
    run(time, 2000, [[client, roam]])
    expect(client.predictor!.stats.corrections).toBe(0)
  })

  it('un bot anda solo y los demás lo ven donde está', () => {
    const { room, time, connect } = setup()
    const a = connect('a', 'create').client
    const bot = connect('bot').client
    run(time, 1000, [[a, idle]], () => driveClient(bot, (tick) => botMove(tick, bot.id)))
    resetStats(bot)
    const start = { ...room.sim!.slot(bot.id).player.pos }
    run(time, 4000, [[a, idle]], () => driveClient(bot, (tick) => botMove(tick, bot.id)))
    const real = room.sim!.slot(bot.id).player.pos
    expect(Math.hypot(real.x - start.x, real.z - start.z)).toBeGreaterThan(5)
    const seen = a.shownPlayers.find((p) => p.id === bot.id)!
    expect(Math.hypot(seen.pose.x - real.x, seen.pose.z - real.z)).toBeLessThan(2)
    expect(bot.predictor!.stats.corrections).toBe(0)
  })

  it('avisa de quién entra y sale, y cada uno ve el ping del otro', () => {
    const { time, connect } = setup()
    const a = connect('a', 'create')
    run(time, 500, [[a.client, idle]])
    expect(a.client.takeNotices()).toEqual([])
    const b = connect('b')
    run(time, 3000, [[a.client, roam], [b.client, roam]])
    expect(a.client.takeNotices()).toEqual([{ type: 'join', id: b.client.id, name: 'b' }])
    expect(a.client.takeNotices()).toEqual([])
    // Con 100 ms ± 30 en cada sentido el RTT ronda los 200 ms (más la espera hasta el siguiente envío).
    expect(a.sent.at(-1)!.msg.rtt).toBeGreaterThan(150)
    const ping = a.client.shownPlayers.find((p) => p.id === b.client.id)!.data.ping
    expect(ping).toBeGreaterThan(150)
    expect(ping).toBeLessThan(400)
    b.client.close()
    run(time, 500, [[a.client, idle]])
    // Sale del mundo enseguida, pero "se ha ido" espera por si vuelve (una reconexión).
    expect(a.client.shownPlayers).toEqual([])
    expect(a.client.takeNotices()).toEqual([])
    run(time, LEAVE_GRACE_MS, [[a.client, idle]])
    expect(a.client.takeNotices()).toEqual([{ type: 'leave', id: b.client.id, name: 'b' }])
  })

  it('quien se corta y vuelve enseguida no se avisa como si se fuera y entrara', () => {
    const { time, connect } = setup()
    const a = connect('a', 'create')
    const b = connect('b')
    run(time, 2000, [[a.client, idle], [b.client, idle]])
    a.client.takeNotices()
    const { token, id } = b.client
    b.client.close()
    run(time, 2000, [[a.client, idle]])
    const again = connect('b', 'join', undefined, token)
    run(time, LEAVE_GRACE_MS + 1000, [[a.client, idle], [again.client, idle]])
    expect(again.client.id).toBe(id)
    expect(a.client.takeNotices()).toEqual([])
    expect(a.client.shownPlayers.map((p) => p.id)).toEqual([id])
  })

  it('el chat llega a todos, también a quien escribe, con su nombre', () => {
    const { time, connect } = setup()
    const a = connect('a', 'create')
    const b = connect('b')
    run(time, 2000, [[a.client, idle], [b.client, idle]])
    a.client.takeNotices()
    b.client.takeNotices()
    b.client.say('¡hola!')
    run(time, 500, [[a.client, idle], [b.client, idle]])
    const chat = { type: 'chat', id: b.client.id, name: 'b', text: '¡hola!' }
    expect(a.client.takeNotices()).toEqual([chat])
    expect(b.client.takeNotices()).toEqual([chat])
  })
})

describe('muerte en red', () => {
  it('el muerto envía a 1 Hz sin pasar a ausente, y su reaparición le llega como propia', () => {
    const { room, time, connect } = setup()
    const { client: a, sent } = connect('a', 'create')
    const { client: b } = connect('b')
    run(time, 1500, [[a, idle], [b, idle]])
    // Lo que presenta como propio, al llegar.
    const own: string[] = []
    const render = a.render.bind(a)
    a.render = () => {
      const shown = render()
      own.push(...shown.own.map((e) => e.type))
      return shown
    }
    a.dev({ op: 'setVitals', health: 0, hunger: 0 })
    let deadAt = 0
    run(time, 1000, [[a, roam], [b, idle]], () => {
      if (!deadAt && !a.predictor!.slot.alive) deadAt = time.now()
    })
    expect(own).toContain('playerDied')
    expect(a.predictor!.slot.respawnAt).toBeGreaterThan(room.sim!.tick)
    expect(a.predictor!.slot.inventory.toJSON()).toEqual({})

    // Aunque siga pulsando teclas, muerto solo manda el keepalive.
    const from = sent.length
    run(time, 10_000, [[a, roam], [b, idle]])
    const gaps = sent.slice(from + 1).map((s, i) => s.at - sent[from + i].at)
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(1000)
    expect(room.sim!.slot(a.id).connection).toBe('present')

    run(time, 21_000, [[a, idle], [b, idle]])
    expect(own).toContain('playerRespawn')
    expect(a.predictor!.slot.alive).toBe(true)
    expect(time.now() - deadAt).toBeGreaterThanOrEqual(29_000)
  })
})

describe('compactMoves', () => {
  it('junta los Move seguidos e iguales con n', () => {
    const m = (tick: number, buttons = 0) => ({ tick, buttons, yaw: 0, pitch: 0 })
    expect(compactMoves([m(1), m(2), m(3), m(4, Btn.Fwd), m(6, Btn.Fwd)])).toEqual([{ ...m(1), n: 3 }, m(4, Btn.Fwd), m(6, Btn.Fwd)])
    expect(compactMoves([{ ...m(1), aim: null }, { ...m(2), aim: { kind: 'prop', id: 3 } }])).toHaveLength(2)
  })
})

describe('encodeCmds', () => {
  const longest = RECIPE_IDS.reduce((a, b) => (b.length > a.length ? b : a))
  /** Lo más largo que manda un cliente de verdad: ticks de 190 días de sala, millones de acciones y ángulos con todos sus decimales. */
  const TICK = 1_000_000_000
  const SEQ = 10_000_000
  const big = (tick: number, seq: number): Cmds => ({
    type: 'cmds',
    t: 1_800_000_000_000.123,
    moves: Array.from({ length: MAX_MOVES }, (_, i) => ({
      tick: tick + i * MAX_MOVE_REPEAT,
      buttons: 127,
      yaw: -Math.PI / 3 - 1e-9,
      pitch: -MAX_PITCH + 1e-12,
      n: MAX_MOVE_REPEAT,
      aim: { kind: 'enemy', id: 1_000_000 },
    })),
    actions: Array.from({ length: MAX_ACTIONS }, (_, i) => ({ kind: 'craft', recipe: longest, seq: seq + i, tick: tick + i })),
    rtt: MAX_RTT,
  })

  it('el mensaje más largo realista cabe entero', () => {
    const data = encodeCmds(big(TICK, SEQ))
    expect(data.length).toBeLessThanOrEqual(MAX_MESSAGE)
    expect(JSON.parse(data).actions).toHaveLength(MAX_ACTIONS)
    expect(parseClientMessage(data).ok).toBe(true)
  })

  it('si no cabe, quita acciones del final hasta que quepa y la sala lo acepta', () => {
    const cmds = big(Number.MAX_SAFE_INTEGER - 2000, Number.MAX_SAFE_INTEGER - 100)
    expect(JSON.stringify(cmds).length).toBeGreaterThan(MAX_MESSAGE)
    const data = encodeCmds(cmds)
    expect(data.length).toBeLessThanOrEqual(MAX_MESSAGE)
    const sent = JSON.parse(data)
    expect(sent.actions.length).toBeGreaterThan(0)
    expect(sent.actions).toEqual(cmds.actions.slice(0, sent.actions.length))
    expect(sent.moves).toEqual(cmds.moves)
    expect(parseClientMessage(data).ok).toBe(true)
  })

  it('sin acciones que quitar, quita los Move más viejos', () => {
    const cmds = big(TICK, SEQ)
    const many: Cmds = { ...cmds, actions: [], moves: Array.from({ length: 4 }, () => cmds.moves).flat() }
    expect(JSON.stringify(many).length).toBeGreaterThan(MAX_MESSAGE)
    const sent = JSON.parse(encodeCmds(many))
    expect(JSON.stringify(sent).length).toBeLessThanOrEqual(MAX_MESSAGE)
    expect(sent.moves).toEqual(many.moves.slice(-sent.moves.length))
  })

  it('nunca manda más de MAX_ACTIONS', () => {
    const cmds: Cmds = { type: 'cmds', t: 1, moves: [], actions: Array.from({ length: MAX_ACTIONS + 5 }, (_, i) => ({ kind: 'eat', seq: i + 1, tick: 1 })) }
    expect(JSON.parse(encodeCmds(cmds)).actions).toHaveLength(MAX_ACTIONS)
  })
})
