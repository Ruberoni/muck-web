import { expect, it } from 'vitest'
import { MAX_PLAYERS, PROTOCOL_VERSION, type Cmds, type Hello } from '../src/net/protocol'
import { ManualTime } from '../src/net/transport'
import { Btn } from '../src/sim/commands'
import { ENEMY_HARD_MAX } from '../src/sim/constants'
import { DAY_FRACTION } from '../src/sim/world/daycycle'
import { LOOP_MS, MemoryStorage, Room, type Conn } from './room'

/**
 * Coste de CPU de una vuelta del bucle de la sala (§2): 8 jugadores moviéndose y golpeando de noche con 24 enemigos.
 * Una vuelta = 3 ticks de simulación + `ev` y un `snap` por jugador en JSON. Va con `npm run test:server` (vitest 5 ya no
 * tiene `bench`): imprime la media y el p99 en Node y falla si una vuelta media pasa de la mitad de su presupuesto.
 */
function busyRoom() {
  const time = new ManualTime(1_000_000)
  let tokens = 0
  const room = new Room('BENCH', { storage: new MemoryStorage(), clock: time, scheduler: time, random: { token: () => `t${++tokens}`, seed: () => 7 } })
  let bytes = 0
  const conns: Conn[] = []
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const conn: Conn = { send: (data) => void (bytes += data.length), close: () => {} }
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

  let turn = 0
  const run = () => {
    turn++
    for (let i = 0; i < conns.length; i++) {
      // Siempre vivos y con los enemigos al completo: el peor caso sostenido.
      const slot = sim.slot(i)
      slot.player.health = 100
      const yaw = (turn * 0.05 + i) % (Math.PI * 2)
      const buttons = Btn.Fwd | (turn % 4 === 0 ? Btn.Attack : 0) | (i % 2 ? Btn.Sprint : 0)
      const cmds: Cmds = { type: 'cmds', t: time.now(), moves: [{ tick: sim.tick + 1, n: 3, buttons, yaw, pitch: 0 }], actions: [] }
      room.message(conns[i], JSON.stringify(cmds))
    }
    time.advance(LOOP_MS)
  }
  return { run, sim, bytes: () => bytes }
}

it('una vuelta del bucle con 8 jugadores y 24 enemigos de noche cabe holgada en sus 50 ms', () => {
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
  console.log(
    `Vuelta del bucle: media ${mean.toFixed(2)} ms, p99 ${p99.toFixed(2)} ms (presupuesto ${LOOP_MS} ms); ` +
      `${room.sim.enemies.list.length} enemigos; ${kbPerSecond.toFixed(1)} KB/s de salida por jugador`,
  )
  expect(room.sim.enemies.list.length).toBe(ENEMY_HARD_MAX)
  expect(mean).toBeLessThan(LOOP_MS / 2)
})
