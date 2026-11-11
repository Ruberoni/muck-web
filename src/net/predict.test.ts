import { describe, expect, it } from 'vitest'
import { Btn, missingMove, type Action, type ActionData, type Move } from '../sim/commands'
import { CONSUMABLE_DEFS } from '../sim/constants'
import { NO_STATIONS } from '../sim/crafting'
import { generatePropPlacements } from '../sim/props'
import { Simulation, type PlayerSlot } from '../sim/Simulation'
import { structureSpot } from '../sim/structures'
import { Predictor, SMOOTH_MAX } from './predict'
import type { You } from './protocol'

const placements = generatePropPlacements()

/** Lo que manda la sala en `snap.you`, pasado por JSON como por el cable. */
const youOf = (slot: PlayerSlot): You =>
  JSON.parse(
    JSON.stringify({ player: slot.player, inventory: slot.inventory.save(), combat: slot.combat, inventoryFull: slot.inventoryFull, alive: slot.alive, appliedSeq: slot.appliedSeq }),
  )

/** Un "servidor" (la simulación entera) y un cliente que predice al mismo jugador sobre su espejo de la isla. */
function setup() {
  const server = new Simulation(9, placements)
  server.addPlayer(0)
  const mirror = new Simulation(0, placements)
  const slot = mirror.addPlayer(0)
  const predictor = new Predictor(slot, {
    env: mirror.env,
    canPlace: (p, radius) => structureSpot(p.pos, p.yaw, radius, [mirror.world.grid, mirror.structures.grid]).valid,
    ...NO_STATIONS,
  })
  predictor.start(server.tick, youOf(server.slot(0)))
  /** Estado del servidor al final de cada tick, para reconciliar con retraso. */
  const states = new Map<number, You>()
  /** El servidor aplica `moves`/`actions` tal cual (como si llegaran a tiempo). */
  const serverStep = (move: Move, actions: Action[]) => {
    server.step(new Map([[0, { move, actions }]]))
    states.set(server.tick, youOf(server.slot(0)))
  }
  return { server, mirror, slot, predictor, states, serverStep }
}

const walk = (tick: number): Omit<Move, 'tick'> => ({ buttons: Btn.Fwd | (tick % 50 < 20 ? Btn.Sprint : 0) | (tick % 70 === 0 ? Btn.Jump : 0), yaw: tick * 0.03, pitch: 0.1 })

describe('Predictor', () => {
  it('predice lo mismo que la simulación entera, y reconciliar con retraso no corrige nada', () => {
    const { server, predictor, slot, states, serverStep } = setup()
    for (let i = 0; i < 300; i++) {
      const tick = predictor.tick + 1
      const actions: ActionData[] = i === 40 ? [{ kind: 'select', slot: 4 }] : []
      predictor.step(tick, walk(tick), actions)
      serverStep({ ...walk(tick), tick }, predictor.pending.filter((a) => a.tick === tick))
      // El servidor va 12 ticks por detrás.
      if (tick > 12 && tick % 3 === 0) predictor.reconcile(tick - 12, states.get(tick - 12)!)
    }
    expect(predictor.stats.reconciled).toBeGreaterThan(90)
    expect(predictor.stats.corrections).toBe(0)
    expect(slot.player.pos).toEqual(server.slot(0).player.pos)
    expect(slot.inventory.selected).toBe(4)
    // Lo confirmado sale del historial y de las acciones pendientes.
    expect(predictor.history.length).toBeLessThanOrEqual(15)
    expect(predictor.pending).toEqual([])
  })

  it('tirar se predice: el inventario queda como en el servidor sin correcciones', () => {
    const { server, predictor, slot, states, serverStep } = setup()
    server.slot(0).inventory.add('wood', 5)
    slot.inventory.add('wood', 5)
    // Menos de DROP_PICKUP_DELAY: lo tirado sigue en el suelo del servidor (las recogidas no se predicen).
    for (let i = 0; i < 100; i++) {
      const tick = predictor.tick + 1
      const actions: ActionData[] = i === 20 ? [{ kind: 'drop', slot: 0, all: false }] : i === 50 ? [{ kind: 'drop', slot: 0, all: true }] : []
      predictor.step(tick, walk(tick), actions)
      serverStep({ ...walk(tick), tick }, predictor.pending.filter((a) => a.tick === tick))
      if (tick > 12 && tick % 3 === 0) predictor.reconcile(tick - 12, states.get(tick - 12)!)
    }
    expect(predictor.stats.corrections).toBe(0)
    expect(slot.inventory.count('wood')).toBe(0)
    expect(server.slot(0).inventory.count('wood')).toBe(0)
    expect(server.pickups.list.map((p) => p.amount)).toEqual([1, 4])
  })

  it('comer y curarse poco a poco se predicen sin correcciones', () => {
    const { raw_meat } = CONSUMABLE_DEFS
    CONSUMABLE_DEFS.raw_meat = { time: 1, food: 5, heal: 10, regen: { perSec: 2, seconds: 0.5 } }
    const { server, predictor, slot, states, serverStep } = setup()
    for (const s of [server.slot(0), slot]) {
      s.inventory.add('raw_meat', 2)
      s.player.health = 40
      s.player.hunger = 60
    }
    predictor.start(server.tick, youOf(server.slot(0)))
    for (let i = 0; i < 160; i++) {
      const tick = predictor.tick + 1
      // Comer tarda (1 s aquí): el segundo, al acabar el primero.
      const actions: ActionData[] = i === 10 || i === 75 ? [{ kind: 'eat' }] : []
      predictor.step(tick, walk(tick), actions)
      serverStep({ ...walk(tick), tick }, predictor.pending.filter((a) => a.tick === tick))
      if (tick > 12 && tick % 3 === 0) predictor.reconcile(tick - 12, states.get(tick - 12)!)
    }
    CONSUMABLE_DEFS.raw_meat = raw_meat
    expect(predictor.stats.corrections).toBe(0)
    expect(slot.player.health).toBe(server.slot(0).player.health)
    expect(slot.player.regenLeft).toBe(server.slot(0).player.regenLeft)
    expect(slot.inventory.count('raw_meat')).toBe(0)
  })

  it('al corregir re-simula con la orientación de cada Move y deja la actual', () => {
    const { server, predictor, slot, states, serverStep } = setup()
    for (let i = 0; i < 30; i++) {
      const tick = predictor.tick + 1
      predictor.step(tick, walk(tick), [])
      serverStep({ ...walk(tick), tick }, [])
    }
    // El servidor lo ha empujado 0,1 m en el tick 20 (algo que el cliente no predijo).
    const pushed = { ...states.get(20)! }
    pushed.player = { ...pushed.player, pos: { ...pushed.player.pos, x: pushed.player.pos.x + 0.1 } }
    const yaw = slot.player.yaw
    const error = predictor.reconcile(20, pushed)
    expect(error).toBeCloseTo(0.1)
    expect(predictor.stats.corrections).toBe(1)
    expect(slot.player.yaw).toBe(yaw)
    // Lo que va por delante se ha vuelto a simular desde ahí, con el yaw de cada tick: 0,1 m más allá en x.
    expect(slot.player.pos.x - server.slot(0).player.pos.x).toBeCloseTo(0.1, 5)
    // El salto es pequeño: se dibuja desvaneciéndose.
    expect(Math.hypot(predictor.offset.x, predictor.offset.z)).toBeCloseTo(0.1, 5)
    predictor.decay(100)
    expect(Math.abs(predictor.offset.x)).toBeLessThan(0.01)

    const far = { ...states.get(25)! }
    far.player = { ...far.player, pos: { ...far.player.pos, x: far.player.pos.x + SMOOTH_MAX * 2 } }
    predictor.reconcile(25, far)
    expect(predictor.offset).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('una acción que el servidor aún no ha aplicado se re-aplica: en su tick o, si ya pasó, en el siguiente', () => {
    const { predictor, slot, states, serverStep } = setup()
    for (let i = 0; i < 20; i++) {
      const tick = predictor.tick + 1
      predictor.step(tick, walk(tick), i === 5 ? [{ kind: 'select', slot: 6 }] : [])
      // Al servidor no le llega.
      serverStep({ ...walk(tick), tick }, [])
    }
    const late = predictor.pending[0]
    expect(late).toMatchObject({ seq: 1, tick: 6 })
    // El estado del tick 15 no la tiene: se re-aplica en el 16 y la casilla sigue elegida.
    predictor.reconcile(15, states.get(15)!)
    expect(slot.appliedSeq).toBe(1)
    expect(slot.inventory.selected).toBe(6)
    expect(predictor.pending).toEqual([late])
    expect(predictor.unsent(0)).toEqual([late])
    expect(predictor.unsent(1)).toEqual([])
  })

  it('rellena los ticks saltados como la sala: el último Move sin Attack ni Jump y luego neutro', () => {
    const { server, predictor, slot, serverStep } = setup()
    const move = { buttons: Btn.Fwd | Btn.Jump | Btn.Attack, yaw: 0.5, pitch: 0 }
    predictor.step(1, move, [])
    serverStep({ ...move, tick: 1 }, [])
    predictor.step(12, move, [])
    const last: Move = { ...move, tick: 1 }
    for (let tick = 2; tick < 12; tick++) serverStep(missingMove(last, tick - 2, tick), [])
    serverStep({ ...move, tick: 12 }, [])
    expect(predictor.history.filter((h) => h.filled).map((h) => h.move.buttons)).toEqual([...Array(6).fill(Btn.Fwd), 0, 0, 0, 0])
    expect(slot.player.pos).toEqual(server.slot(0).player.pos)
  })
})
