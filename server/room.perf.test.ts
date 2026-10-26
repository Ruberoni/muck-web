import { expect, it } from 'vitest'
import { MAX_PLAYERS, PROTOCOL_VERSION, type Cmds, type Hello } from '../src/net/protocol'
import { ManualTime } from '../src/net/transport'
import { Btn } from '../src/sim/commands'
import { ENEMY_HARD_MAX } from '../src/sim/constants'
import { generatePropPlacements } from '../src/sim/props'
import { STRUCTURE_DEFS, structureSpot, type StructureKind } from '../src/sim/structures'
import { DAY_FRACTION } from '../src/sim/world/daycycle'
import { LOOP_MS, MemoryStorage, Room, type Conn } from './room'

/**
 * Coste de CPU de una vuelta del bucle de la sala (§2): 8 jugadores moviéndose y golpeando de noche con 24 enemigos.
 * Una vuelta = 3 ticks de simulación + `ev` y un `snap` por jugador en JSON. Va con `npm run test:server` (vitest 5 ya no
 * tiene `bench`): imprime la media y el p99 en Node y falla si una vuelta media pasa de la mitad de su presupuesto.
 * Con `base`, los jugadores dan vueltas alrededor de una base (mesa, horno, yunque y 8 fogatas) fundiendo hierro en
 * cada vuelta: colisiones con estructuras, `stationNear` en cada `craft` y un `you` por jugador cuando le sale.
 */
function busyRoom({ base = false } = {}) {
  const time = new ManualTime(1_000_000)
  let tokens = 0
  const room = new Room('BENCH', { storage: new MemoryStorage(), clock: time, scheduler: time, random: { token: () => `t${++tokens}`, seed: () => 7 } })
  let bytes = 0
  /** Lo último que recibe el primer jugador, para medir cuánto ocupa comprimido. */
  const sample: string[] = []
  const conns: Conn[] = []
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const conn: Conn = {
      send: (data) => {
        bytes += data.length
        if (i === 0 && sample.push(data) > 200) sample.shift()
      },
      close: () => {},
    }
    conns.push(conn)
    const hello: Hello = { type: 'hello', v: PROTOCOL_VERSION, t: 0, intent: i === 0 ? 'create' : 'join', room: 'BENCH', name: `J${i}`, tab: `${i}` }
    room.message(conn, JSON.stringify(hello))
  }
  const sim = room.sim!
  sim.setPhase(DAY_FRACTION + 0.05)
  const center = sim.spawnCenter
  for (let i = 0; i < ENEMY_HARD_MAX; i++) {
    const a = (i / ENEMY_HARD_MAX) * Math.PI * 2
    sim.enemies.spawnAt(center.x + Math.cos(a) * 15, center.z + Math.sin(a) * 15)
  }
  if (base) {
    const kinds: StructureKind[] = ['workbench', 'furnace', 'anvil', ...Array<StructureKind>(8).fill('campfire')]
    // Cada una en el primer sitio libre de un anillo alrededor del centro, de frente al centro.
    for (let i = 0, step = 0; i < kinds.length && step < 400; step++) {
      const a = step * 0.7
      const r = 3 + (step % 5)
      const yaw = Math.atan2(Math.cos(a), Math.sin(a))
      const spot = structureSpot({ x: center.x + Math.sin(a) * r, z: center.z + Math.cos(a) * r }, yaw, STRUCTURE_DEFS[kinds[i]].radius, [
        sim.world.grid,
        sim.structures.grid,
      ])
      if (sim.structures.place(spot, kinds[i], 0, yaw)) i++
    }
    for (let i = 0; i < MAX_PLAYERS; i++) {
      sim.slot(i).inventory.add('iron_ore', 1_000_000)
      sim.slot(i).inventory.add('wood', 1_000_000)
    }
  }

  let turn = 0
  const run = () => {
    turn++
    for (let i = 0; i < conns.length; i++) {
      // Siempre vivos y con los enemigos al completo: el peor caso sostenido.
      const slot = sim.slot(i)
      slot.player.health = 100
      const yaw = (turn * 0.05 + i) % (Math.PI * 2)
      const buttons = Btn.Fwd | (turn % 4 === 0 ? Btn.Attack : 0) | (i % 2 ? Btn.Sprint : 0)
      const tick = sim.tick + 1
      const actions: Cmds['actions'] = base ? [{ kind: 'craft', recipe: 'iron_bar', seq: turn, tick }] : []
      const cmds: Cmds = { type: 'cmds', t: time.now(), moves: [{ tick, n: 3, buttons, yaw, pitch: 0 }], actions }
      room.message(conns[i], JSON.stringify(cmds))
    }
    time.advance(LOOP_MS)
  }
  return { run, sim, bytes: () => bytes, sample }
}

/** Lo que ocupa un mensaje con permessage-deflate sin contexto compartido (lo peor: el navegador y workerd suelen compartirlo). */
async function deflated(data: string): Promise<number> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  return (await new Response(stream).arrayBuffer()).byteLength
}

it('una vuelta del bucle con 8 jugadores y 24 enemigos de noche cabe holgada en sus 50 ms', async () => {
  const room = busyRoom()
  for (let i = 0; i < 200; i++) room.run() // calentamiento (JIT)
  const times: number[] = []
  const start = room.bytes()
  for (let i = 0; i < 1000; i++) {
    const t0 = performance.now()
    room.run()
    times.push(performance.now() - t0)
  }
  times.sort((a, b) => a - b)
  const mean = times.reduce((a, b) => a + b, 0) / times.length
  const p99 = times[Math.floor(times.length * 0.99)]
  const kbPerSecond = (room.bytes() - start) / 1000 / ((times.length * LOOP_MS) / 1000) / MAX_PLAYERS
  const raw = room.sample.reduce((sum, m) => sum + m.length, 0)
  const packed = (await Promise.all(room.sample.map(deflated))).reduce((a, b) => a + b, 0)
  console.log(
    `Vuelta del bucle: media ${mean.toFixed(2)} ms, p99 ${p99.toFixed(2)} ms (presupuesto ${LOOP_MS} ms); ` +
      `${room.sim.enemies.list.length} enemigos; ${kbPerSecond.toFixed(1)} KB/s de salida por jugador ` +
      `(~${((kbPerSecond * packed) / raw).toFixed(1)} KB/s con permessage-deflate)`,
  )
  expect(room.sim.enemies.list.length).toBe(ENEMY_HARD_MAX)
  expect(mean).toBeLessThan(LOOP_MS / 2)
  // El §5.3 del plan estimaba ~30 KB/s en JSON con 8 jugadores y 24 enemigos; sin las tuplas del snap salían ~62.
  expect(kbPerSecond).toBeLessThan(40)
})

it('con una base de estaciones y fogatas, fundiendo en cada vuelta, también cabe holgada', () => {
  const room = busyRoom({ base: true })
  expect(room.sim.structures.list.map((s) => s.kind).sort()).toEqual(['anvil', 'furnace', 'workbench', ...Array(8).fill('campfire')].sort())
  for (let i = 0; i < 200; i++) room.run()
  const bars = () => Array.from({ length: MAX_PLAYERS }, (_, i) => room.sim.slot(i).inventory.count('iron_bar')).reduce((a, b) => a + b, 0)
  const before = bars()
  const start = room.bytes()
  const times: number[] = []
  for (let i = 0; i < 1000; i++) {
    const t0 = performance.now()
    room.run()
    times.push(performance.now() - t0)
  }
  times.sort((a, b) => a - b)
  const mean = times.reduce((a, b) => a + b, 0) / times.length
  const p99 = times[Math.floor(times.length * 0.99)]
  const kbPerSecond = (room.bytes() - start) / 1000 / ((times.length * LOOP_MS) / 1000) / MAX_PLAYERS
  const crafted = bars() - before
  console.log(
    `Con base: media ${mean.toFixed(2)} ms, p99 ${p99.toFixed(2)} ms; ${crafted} lingotes en ${times.length} vueltas; ` +
      `${kbPerSecond.toFixed(1)} KB/s de salida por jugador`,
  )
  // Pasan por el horno de vez en cuando (unas 480 veces), no siempre: así se miden las dos ramas de `stationNear`.
  expect(crafted).toBeGreaterThan(100)
  expect(crafted).toBeLessThan(times.length * MAX_PLAYERS)
  expect(mean).toBeLessThan(LOOP_MS / 2)
  expect(kbPerSecond).toBeLessThan(40)
})

it('abrir una sala es barato: todas comparten las colocaciones y welcome sigue por debajo de 128 KB', () => {
  /** Crea la sala y entra el primer jugador (es cuando se crea la simulación); devuelve lo que recibe. */
  const open = (code: string) => {
    const time = new ManualTime(1_000_000)
    const room = new Room(code, { storage: new MemoryStorage(), clock: time, scheduler: time, random: { token: () => 't', seed: () => 7 } })
    const received: string[] = []
    const hello: Hello = { type: 'hello', v: PROTOCOL_VERSION, t: 0, intent: 'create', room: code, name: 'J', tab: '0' }
    room.message({ send: (data) => void received.push(data), close: () => {} }, JSON.stringify(hello))
    return received
  }
  open('BENCH') // la primera genera (y memoiza) las colocaciones
  const t0 = performance.now()
  for (let i = 0; i < 20; i++) open('BENCH')
  const perRoom = (performance.now() - t0) / 20
  const welcome = open('BENCH').find((m) => m.includes('"welcome"')) ?? ''
  console.log(`Abrir una sala: ${perRoom.toFixed(2)} ms; welcome de ${(welcome.length / 1024).toFixed(1)} KB`)
  expect(welcome).not.toBe('')
  expect(new Room('BENCH', { storage: new MemoryStorage(), clock: new ManualTime(0), scheduler: new ManualTime(0), random: { token: () => 't', seed: () => 7 } }).placements).toBe(generatePropPlacements())
  expect(perRoom).toBeLessThan(25)
  expect(welcome.length).toBeLessThan(128 * 1024)
})
