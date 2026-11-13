import { describe, expect, it } from 'vitest'
import { Room, MemoryStorage, ABSENT_MS } from '../../server/room'
import { Btn, type ActionData } from '../sim/commands'
import { EYE_HEIGHT, MAX_PITCH } from '../sim/constants'
import { RECIPE_IDS } from '../sim/crafting'
import { FISH_DELAY } from '../sim/fish'
import { isLit, putInto } from '../sim/stations'
import { aimPose } from '../sim/interaction'
import { quickProps } from '../sim/quickProps'
import { mulberry32 } from '../sim/random'
import { structureSpot } from '../sim/structures'
import type { Simulation } from '../sim/Simulation'
import { heightAt } from '../sim/world/terrain'
import { clientCraftWorld, CLIENT_STATION_RANGE, sendableActions } from '../ui/recipes'
import { botMove, botStep, driveClient } from './bot'
import { LEAVE_GRACE_MS, NetClient, compactMoves, encodeCmds } from './client'
import { MAX_ACTIONS, MAX_MESSAGE, MAX_MOVE_REPEAT, MAX_MOVES, MAX_RTT, parseClientMessage, type Cmds } from './protocol'
import type { MoveInput } from './session'
import { LaggyTransport, ManualTime, type Lag } from './transport'

const CODE = 'K7QX2'
const FRAME_MS = 16

/** Sala con reloj manual y un cliente en red con 100 ms ± 30 de latencia en cada sentido. Con `randomIslands`, cada isla al azar. */
function setup(quickStart = true, randomIslands = false) {
  const time = new ManualTime(1_000_000)
  let tokens = 0
  let islands = 6
  const seed = randomIslands ? () => ++islands : () => 7
  const room = new Room(CODE, { storage: new MemoryStorage(), clock: time, scheduler: time, random: { token: () => `tok${++tokens}`, seed }, dev: true, quickStart, randomIslands })
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
      // Comer tarda: mientras se come no empieza otro, así que el segundo bocado va al acabar el primero.
      if (at === 40 || at === 90) actions.push({ kind: 'eat' })
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
      expect(e).toMatchObject({ type: real.type, maxHp: real.maxHp })
    }
  })

  it('los proyectiles: se siguen hasta su `projectileHit`, y quien entra a mitad también los ve', () => {
    const { room, time, connect } = setup()
    const { client } = connect('a', 'create')
    run(time, 1000, [[client, idle]])
    const sim = room.sim!
    const { pos } = sim.slot(client.id).player
    // Hacia arriba, lejos de todo: tarda en caer.
    sim.projectiles.launch(sim.tick, 'rock', { x: pos.x + 20, y: pos.y + 10, z: pos.z }, { x: 0, y: 20, z: 0 }, 1)
    run(time, 500, [[client, idle]])
    const mirror = client.sim!.projectiles.list
    expect(mirror).toHaveLength(1)
    const real = sim.projectiles.list[0]
    // Va por delante del render: en el tick de la predicción, algo adelantado respecto al servidor.
    expect(Math.abs(mirror[0].pos.y - real.pos.y)).toBeLessThan(5)

    const { client: late } = connect('b')
    run(time, 500, [[client, idle], [late, idle]])
    expect(late.sim!.projectiles.list.map((p) => p.id)).toEqual([real.id])
    run(time, 5000, [[client, idle], [late, idle]])
    expect(sim.projectiles.list).toEqual([])
    expect(client.sim!.projectiles.list).toEqual([])
    expect(late.sim!.projectiles.list).toEqual([])
  })

  it('cada partida es en otra isla, y todos los espejos pasan a ella con sus props', () => {
    const { room, time, connect } = setup(false, true)
    const { client: a } = connect('a', 'create')
    const { client: b } = connect('b')
    time.advance(500)
    const lobby = room.sim!.island.seed
    expect(a.sim!.island.seed).toBe(lobby)
    expect(a.sim!.world.placements).toEqual(room.sim!.world.placements)
    a.start('normal')
    run(time, 1500, [[a, idle], [b, idle]])
    const { island, world, structures } = room.sim!
    expect(island.seed).not.toBe(lobby)
    for (const c of [a, b]) {
      expect(c.sim!.island.seed).toBe(island.seed)
      expect(c.sim!.world.placements).toEqual(world.placements)
      expect(c.sim!.structures.list.map((s) => [s.kind, s.x, s.z])).toEqual(structures.list.map((s) => [s.kind, s.x, s.z]))
      // En el punto de aparición de la isla nueva.
      const { pos } = c.sim!.slot(c.id).player
      expect(Math.hypot(pos.x - room.sim!.slot(c.id).player.pos.x, pos.z - room.sim!.slot(c.id).player.pos.z)).toBeLessThan(0.5)
    }
  })

  it('el lobby: se espera sin predecir, y al empezar el espejo recibe las reglas', () => {
    const { room, time, connect } = setup(false)
    const { client: a } = connect('a', 'create')
    const { client: b } = connect('b')
    time.advance(500)
    expect(a.match).toMatchObject({ phase: 'lobby', host: a.id })
    expect(a.match!.players.map((p) => p.name)).toEqual(['a', 'b'])

    let changes = 0
    b.onmatch = () => changes++
    a.start('hard')
    time.advance(500)
    expect(b.match).toMatchObject({ phase: 'playing', rules: { players: 2, difficulty: 'hard' } })
    expect(changes).toBe(1)
    expect(b.sim!.rules).toEqual(room.sim!.rules)
    run(time, 1000, [[a, idle], [b, idle]])
    expect(room.sim!.tick).toBeGreaterThan(0)
    expect(a.predictor!.stats.corrections).toBe(0)

    a.surrender(true)
    b.surrender(true)
    run(time, 500, [[a, idle], [b, idle]])
    expect(b.match).toMatchObject({ phase: 'lobby', result: { end: 'surrendered' } })
  })

  it('el espejo ve encenderse la fogata con la leña y apagarse sola al acabarse, sin cocinar nada', () => {
    const { room, time, connect } = setup()
    const { client } = connect('a', 'create')
    run(time, 1000, [[client, idle]])
    const sim = room.sim!
    const fire = sim.structures.place(structureSpot(sim.slot(client.id).player.pos, 0, 0.6, sim.obstacles), 'campfire')!
    run(time, 500, [[client, idle]])
    const mirror = () => client.sim!.structures.byId(fire.id)!.station!
    expect(isLit(mirror())).toBe(false)
    putInto('campfire', fire.station!, 'fuel', 'wood', 1)
    run(time, 500, [[client, idle]])
    expect(isLit(mirror())).toBe(true)
    expect(mirror().burnTotal).toBe(60)
    run(time, 61_000, [[client, idle]])
    expect(isLit(fire.station!)).toBe(false)
    expect(isLit(mirror())).toBe(false)
  })

  it('el calor de la fogata se predice: cura al encenderla y deja de curar al apagarse, casi sin correcciones', () => {
    const { room, time, connect } = setup()
    const { client } = connect('a', 'create')
    run(time, 1000, [[client, idle]])
    const sim = room.sim!
    const slot = sim.slot(client.id)
    const fire = sim.structures.place(structureSpot(slot.player.pos, 0, 0.6, sim.obstacles), 'campfire')!
    // Poca vida y poco hambre (sin regeneración natural): lo que sube es del calor.
    slot.player.health = 10
    slot.player.hunger = 29
    run(time, 1000, [[client, idle]])
    const predicted = client.predictor!.slot.player
    expect(predicted.health).toBe(10)
    resetStats(client)
    putInto('campfire', fire.station!, 'fuel', 'wood', 1)
    sim.structures.stationChanged(fire)
    run(time, 10_000, [[client, idle]])
    expect(slot.player.health).toBeGreaterThan(14)
    expect(Math.abs(predicted.health - slot.player.health)).toBeLessThan(0.5)
    // Encenderla cuesta como mucho la corrección de cuando llega el aviso (el cliente no predice la leña de otro).
    expect(client.predictor!.stats.corrections).toBeLessThanOrEqual(1)
    resetStats(client)
    run(time, 55_000, [[client, idle]])
    expect(isLit(fire.station!)).toBe(false)
    const healed = slot.player.health
    expect(healed).toBeCloseTo(10 + 60 * 0.5, 0)
    // Al apagarse, la predicción ya la da por apagada en el tick que predice (la copia va por detrás): como mucho,
    // una corrección por lo que la copia del render se separa del servidor.
    expect(client.predictor!.stats.corrections).toBeLessThanOrEqual(1)
    run(time, 3000, [[client, idle]])
    expect(slot.player.health).toBe(healed)
    expect(predicted.health).toBe(healed)
  })

  it('el espejo sigue lo que hay en las estaciones y la obra, y quien reconecta las recibe', () => {
    const { room, time, connect } = setup()
    const { client } = connect('a', 'create')
    run(time, 1000, [[client, idle]])
    const sim = room.sim!
    const slot = sim.slot(client.id)
    const furnace = sim.structures.place(structureSpot(slot.player.pos, 0, 0.8, sim.obstacles), 'furnace')!
    putInto('furnace', furnace.station!, 'input', 'iron_ore', 2)
    putInto('furnace', furnace.station!, 'fuel', 'wood', 1)
    const lighthouse = sim.structures.place(structureSpot(slot.player.pos, Math.PI, 1.8, sim.obstacles), 'lighthouse')!
    slot.inventory.add('stone', 5)
    sim.structures.deliver(lighthouse, slot.inventory, sim.rules)
    run(time, 500, [[client, idle]])
    const mirror = client.sim!.structures
    // Al coger la madera avisa: el espejo ve el mineral, el combustible gastado y la barra que avanza.
    expect(mirror.byId(furnace.id)!.station).toMatchObject({ input: { item: 'iron_ore', amount: 2 }, fuel: null, output: null, time: 15 })
    expect(mirror.byId(furnace.id)!.station!.progress).toBeGreaterThan(0)
    expect(mirror.byId(lighthouse.id)!.build).toEqual(lighthouse.build)

    const { client: late } = connect('b')
    run(time, 500, [[client, idle], [late, idle]])
    expect(late.sim!.structures.byId(lighthouse.id)!.build).toEqual(lighthouse.build)
    expect(late.sim!.structures.byId(furnace.id)!.station).toMatchObject({ input: { item: 'iron_ore', amount: 2 } })
    run(time, 16_000, [[client, idle], [late, idle]])
    // Sin más madera se queda con un lingote hecho y el otro mineral esperando.
    for (const c of [client, late]) {
      expect(c.sim!.structures.byId(furnace.id)!.station).toMatchObject({ input: { item: 'iron_ore', amount: 1 }, output: { item: 'iron_bar', amount: 1 } })
    }
  })

  it('ponerse un escudo se predice, y los demás lo ven en su mano y saben si bloquea', () => {
    const { room, time, connect } = setup()
    const { client: a } = connect('a', 'create')
    const { client: b } = connect('b')
    run(time, 1000, [[a, idle], [b, idle]])
    room.sim!.slot(a.id).inventory.add('iron_shield', 1)
    run(time, 500, [[a, idle], [b, idle]])
    // Lo que da el servidor por su cuenta no se predice: desde aquí, sí.
    resetStats(a)
    let sent = false
    const equip: Script = () => {
      const actions: ActionData[] = sent ? [] : [{ kind: 'equip', slot: 0 }]
      sent = true
      return { buttons: Btn.Block, yaw: 0, pitch: 0, actions }
    }
    run(time, 100, [[a, equip], [b, idle]])
    // La predicción ya lo lleva puesto y bloquea, antes de que conteste el servidor.
    expect(a.sim!.slot(a.id).inventory.equipped.shield).toBe('iron_shield')
    expect(a.sim!.slot(a.id).player.blocking).toBe(true)
    run(time, 1000, [[a, equip], [b, idle]])
    expect(room.sim!.slot(a.id).inventory.equipped.shield).toBe('iron_shield')
    expect(b.shownPlayers.find((p) => p.id === a.id)!.data).toMatchObject({ shield: 'iron_shield', blocking: true })
    run(time, 1000, [[a, idle], [b, idle]])
    expect(b.shownPlayers.find((p) => p.id === a.id)!.data).toMatchObject({ shield: 'iron_shield', blocking: false })
    expect(a.predictor!.stats.corrections).toBe(0)
  })

  it('tras un parón de frames sin pausa (la ventana tapada) pide el estado y sigue, en vez de adelantarse y atascarse', () => {
    const { room, time, connect } = setup()
    const { client, transport } = connect('a', 'create')
    run(time, 1000, [[client, idle]])
    const resyncs: string[] = []
    const send = transport.send.bind(transport)
    transport.send = (data) => {
      if (data.includes('"resync"')) resyncs.push(data)
      send(data)
    }
    // Sin frames y sin `suspend`: el servidor lo da por ausente y para el bucle.
    time.advance(10_000)
    expect(room.sim!.slot(client.id).connection).toBe('absent')
    run(time, 3000, [[client, idle]])
    expect(resyncs).toHaveLength(1)
    expect(room.sim!.slot(client.id).connection).toBe('present')
    // Va justo por delante del servidor, no los diez segundos del parón.
    expect(client.predictor!.tick - room.sim!.tick).toBeLessThan(40)
    const reconciled = client.predictor!.stats.reconciled
    run(time, 2000, [[client, idle]])
    expect(client.predictor!.stats.reconciled).toBeGreaterThan(reconciled + 20)
    // Con un frame cada segundo (la pestaña frenada) no pide nada: se pone al día y sigue presente.
    for (let i = 0; i < 6; i++) {
      time.advance(1000)
      const ticks = client.advance()
      for (let t = 0; t < ticks; t++) client.step(idle(client.predictor!.tick + 1))
      client.flush()
      client.render()
    }
    expect(resyncs).toHaveLength(1)
    expect(room.sim!.slot(client.id).connection).toBe('present')
  })

  it('el pez: los espejos saben a quién ronda y cuándo se va, y quien entra después también', () => {
    const { room, time, connect } = setup()
    const { client: a } = connect('a', 'create')
    const { client: b } = connect('b')
    run(time, 1000, [[a, idle], [b, idle]])
    const sim = room.sim!
    // Lejos de la orilla, en el mar.
    sim.teleport(a.id, 0, 94, 0, 0)
    run(time, (FISH_DELAY + 1) * 1000, [[a, idle], [b, idle]])
    expect(sim.fishes.list.map((f) => f.target)).toEqual([a.id])
    for (const c of [a, b]) expect(c.sim!.fishes.list.map((f) => f.target)).toEqual([a.id])
    const { client: late } = connect('c')
    run(time, 500, [[a, idle], [b, idle], [late, idle]])
    expect(late.sim!.fishes.list.map((f) => f.target)).toEqual([a.id])
    sim.teleport(a.id, sim.spawnCenter.x, sim.spawnCenter.z, 0, 0)
    run(time, 500, [[a, idle], [b, idle], [late, idle]])
    for (const c of [a, b, late]) expect(c.sim!.fishes.list).toEqual([])
  })

  it('la tumba: el espejo sabe cuándo se abre, y quien entra después también', () => {
    const { room, time, connect } = setup()
    const { client } = connect('a', 'create')
    run(time, 1000, [[client, idle]])
    const sim = room.sim!
    const grave = sim.structures.place(structureSpot(sim.slot(client.id).player.pos, Math.PI, 1, sim.obstacles), 'grave')!
    sim.threat.awaken()
    run(time, 3500, [[client, () => ({ buttons: Btn.Use, yaw: 0, pitch: 0 })]])
    run(time, 500, [[client, idle]])
    expect(grave.opened).toBe(true)
    expect(client.sim!.structures.byId(grave.id)!.opened).toBe(true)
    expect(client.sim!.enemies.list.map((e) => e.type)).toContain('colossus')

    const { client: late } = connect('b')
    run(time, 500, [[client, idle], [late, idle]])
    expect(late.sim!.structures.byId(grave.id)!.opened).toBe(true)
  })

  it('el meteorito: el espejo lo sigue, choca con su roca y quien entra a mitad también lo ve', () => {
    const { room, time, connect } = setup()
    const { client } = connect('a', 'create')
    run(time, 1000, [[client, idle]])
    const sim = room.sim!
    const { pos } = sim.slot(client.id).player
    const [x, z] = [pos.x + 12, pos.z]
    sim.meteor(x, z)
    run(time, 500, [[client, idle]])
    const mirror = client.sim!
    expect(mirror.worldEvents.meteor).toEqual(sim.worldEvents.meteor)
    const blocked = (game: Simulation) => game.env.collide!({ x, y: 0, z })
    expect(blocked(mirror)).toBe(false)

    run(time, 6000, [[client, idle]])
    expect(mirror.worldEvents.meteor).toMatchObject({ landed: true, coolDay: null })
    // La predicción choca con la roca como el servidor.
    expect(blocked(mirror)).toBe(true)

    const { client: late } = connect('b')
    run(time, 500, [[client, idle], [late, idle]])
    expect(late.sim!.worldEvents.meteor).toEqual(sim.worldEvents.meteor)
    expect(blocked(late.sim!)).toBe(true)

    const guardian = sim.enemies.list.find((e) => e.type === 'guardian')!
    sim.enemies.hit(guardian, guardian.hp, { x, z }, client.id)
    run(time, 500, [[client, idle], [late, idle]])
    expect(mirror.worldEvents.meteor).toMatchObject({ coolDay: sim.clock.day })
    expect(late.sim!.worldEvents.meteor).toMatchObject({ coolDay: sim.clock.day })

    sim.setDay(sim.clock.day + 1)
    run(time, 500, [[client, idle], [late, idle]])
    expect(mirror.worldEvents.meteor).toBeNull()
    expect(late.sim!.worldEvents.meteor).toBeNull()
    expect(blocked(mirror)).toBe(false)

    sim.meteor(x, z)
    run(time, 500, [[client, idle], [late, idle]])
    expect(mirror.worldEvents.meteor).not.toBeNull()
    sim.reset()
    run(time, 500, [[client, idle], [late, idle]])
    expect(mirror.worldEvents.meteor).toBeNull()
    expect(late.sim!.worldEvents.meteor).toBeNull()
  })

  it('cada Move lleva aim; con él se tala el árbol que se ve, y el espejo lo sabe', () => {
    const { room, time, connect } = setup()
    const { client, sent } = connect('a', 'create')
    run(time, 1000, [[client, idle]])
    const sim = room.sim!
    quickProps(sim.world.props)
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

  it('un bot anda solo y los demás lo ven donde está; con madera se fabrica sus herramientas, como predice', () => {
    const { room, time, connect } = setup()
    const a = connect('a', 'create').client
    const bot = connect('bot').client
    // Primero solo anda (botMove): si se parase a talar, lo que recoge llegaría del servidor como corrección.
    const walk = () => driveClient(bot, (tick) => botMove(tick, bot.id))
    const drive = () => driveClient(bot, (tick) => botStep(tick, bot.id, bot.predictor!.slot))
    run(time, 1000, [[a, idle]], walk)
    resetStats(bot)
    const start = { ...room.sim!.slot(bot.id).player.pos }
    run(time, 4000, [[a, idle]], walk)
    const real = room.sim!.slot(bot.id).player.pos
    expect(Math.hypot(real.x - start.x, real.z - start.z)).toBeGreaterThan(5)
    const seen = a.shownPlayers.find((p) => p.id === bot.id)!
    expect(Math.hypot(seen.pose.x - real.x, seen.pose.z - real.z)).toBeLessThan(2)
    expect(bot.predictor!.stats.corrections).toBe(0)

    // La madera llega del servidor (una corrección, como cualquier truco o lo que se recoge); lo que fabrica con
    // ella lo predice bien. Se cuenta hasta que el servidor confirma las dos herramientas: después puede ponerse a
    // talar, y lo que recoja también llega del servidor.
    bot.dev({ op: 'give', item: 'wood', amount: 10 })
    let corrections = -1
    run(time, 2000, [[a, idle]], () => {
      drive()
      const { slot, pending, stats } = bot.predictor!
      if (corrections < 0 && slot.inventory.has('wood_pickaxe') && pending.length === 0) corrections = stats.corrections
    })
    expect(room.sim!.slot(bot.id).inventory.toJSON()).toMatchObject({ wood_axe: 1, wood_pickaxe: 1 })
    expect(corrections).toBe(1)
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
