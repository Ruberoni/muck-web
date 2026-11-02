import { describe, expect, it } from 'vitest'
import { Btn } from './commands'
import { ENEMY_DEFS, GRAVE_HOLD, HEALTH_MAX, MOTOR_TIME, STEP, TOTEM_HOLD } from './constants'
import type { SimEvent } from './events'
import type { ItemId } from './inventory'
import { Simulation } from './Simulation'
import { STRUCTURE_DEFS, structureSpot, type Structure } from './structures'

/** Una partida de verdad, conducida con comandos: lo único regalado son los materiales. */
function game() {
  const sim = new Simulation(5)
  sim.addPlayer(0)
  sim.startMatch({ players: 1, difficulty: 'normal' })
  const slot = sim.slot(0)
  const { player, inventory } = slot
  const seen: SimEvent[] = []
  /** Un paso con estos botones, sin morirse de hambre ni por los mobs: aquí se prueba el camino, no el combate. */
  const step = (buttons = 0, yaw = 0) => {
    Object.assign(player, { health: HEALTH_MAX, hunger: 100 })
    seen.push(...sim.step(new Map([[0, { move: { tick: sim.tick + 1, buttons, yaw, pitch: 0 }, actions: [] }]])))
  }
  const run = (seconds: number, buttons = 0, yaw = 0) => {
    for (let i = 0; i < Math.round(seconds / STEP); i++) step(buttons, yaw)
  }
  const near = (s: Structure) => {
    sim.teleport(0, s.x + s.radius + 1.5, s.z, 0, 0)
    step()
  }
  const give = (items: Partial<Record<ItemId, number>>) => {
    for (const [item, amount] of Object.entries(items)) inventory.add(item as ItemId, amount!)
  }
  const press = () => {
    step(Btn.Use)
    step()
  }
  return { sim, slot, player, inventory, seen, step, run, near, give, press }
}

describe('una partida entera', () => {
  it('del tótem al avión: se puede ganar de principio a fin', () => {
    const { sim, player, inventory, seen, step, run, near, give, press } = game()
    const grave = sim.structures.list.find((s) => s.kind === 'grave')!
    expect(grave).toBeDefined()

    // El tótem, con los materiales: la tumba sigue dormida.
    const totem = sim.structures.place(structureSpot(player.pos, 0, STRUCTURE_DEFS.totem.radius, sim.obstacles), 'totem')!
    near(grave)
    run(GRAVE_HOLD + 0.1, Btn.Use)
    expect(grave.opened).toBeUndefined()
    near(totem)
    give({ stone: 500, dark_wood: 500, iron_bar: 500, meteor_fragment: 3, boss_trophy: 1 })
    press()
    press()
    press()
    expect(totem.build!.phase).toBe(3)

    // Se activa: cae el avión.
    run(TOTEM_HOLD + 0.1, Btn.Use)
    step()
    expect(seen.map((e) => e.type)).toContain('planeCrashed')
    const plane = sim.structures.list.find((s) => s.kind === 'plane')!
    expect(sim.threat.state.totem).toBe(true)

    // Se abre la tumba y nace su jefe, por el que casi no pasan las armas hasta romper la coraza.
    near(grave)
    run(GRAVE_HOLD + 0.1, Btn.Use)
    step()
    expect(grave.opened).toBe(true)
    const colossus = sim.enemies.list.find((e) => e.type === 'colossus')!
    expect(colossus).toMatchObject({ maxHp: ENEMY_DEFS.colossus.hp, shell: ENEMY_DEFS.colossus.shell })

    // Se mata a golpes de verdad: primero el pico, luego la espada.
    const yawTo = () => Math.atan2(-(colossus.pos.x - player.pos.x), -(colossus.pos.z - player.pos.z))
    const fight = (item: ItemId, until: () => boolean) => {
      inventory.add(item, 1)
      inventory.select(inventory.slots.indexOf(item))
      for (let i = 0; i < 60 * 300 && !until(); i++) {
        sim.teleport(0, colossus.pos.x + 2, colossus.pos.z, yawTo(), 0)
        step(Btn.Attack, yawTo())
      }
    }
    fight('mithril_pickaxe', () => colossus.shell <= 0)
    expect(colossus.shell).toBe(0)
    expect(seen.map((e) => e.type)).toContain('shellBroken')
    expect(colossus.hp).toBe(colossus.maxHp)
    colossus.hp = 40
    fight('meteor_sword', () => !colossus.alive)
    expect(colossus.alive).toBe(false)

    // Suelta el motor, que hay que ir a recoger.
    const engine = () => sim.pickups.list.find((p) => p.item === 'plane_engine')
    for (let i = 0; i < 300 && engine(); i++) {
      const { pos } = engine()!
      sim.teleport(0, pos.x, pos.z, 0, 0)
      step()
    }
    expect(inventory.count('plane_engine')).toBe(1)

    // Se repara y se despega.
    near(plane)
    give({ wood: 500, iron_bar: 500 })
    press()
    press()
    expect(plane.build!.phase).toBe(2)
    press()
    expect(plane.plane!.running).toBe(true)
    run(MOTOR_TIME + 1)
    expect(sim.result).toMatchObject({ end: 'escaped', players: [{ id: 0, escaped: true }] })
    expect(seen.map((e) => e.type)).toContain('matchEnded')
  })

  it('el Coloso casi no recibe daño con la coraza, y el pico no le quita vida hasta romperla', () => {
    const sim = new Simulation(5)
    const colossus = sim.enemies.spawnAt(0, 0, 'colossus', 2)
    expect(colossus).toMatchObject({ maxHp: ENEMY_DEFS.colossus.hp * 2, shell: ENEMY_DEFS.colossus.shell! * 2, lootScale: 1 })
    sim.enemies.hit(colossus, 100, { x: 1, z: 0 }, 0, 'normal', 'sword')
    expect(colossus.hp).toBe(colossus.maxHp - 10)
    const { hp, shell } = colossus
    sim.enemies.hit(colossus, 100, { x: 1, z: 0 }, 0, 'normal', 'pickaxe')
    expect(colossus.hp).toBe(hp)
    expect(colossus.shell).toBe(shell - 100)
  })

  it('no cuenta para el tope ni sube con la amenaza', () => {
    const sim = new Simulation(5)
    sim.enemies.scaling.hp = 5
    expect(sim.enemies.spawnAt(0, 0, 'colossus').maxHp).toBe(ENEMY_DEFS.colossus.hp)
  })

  it('empezar otra partida pone otra tumba, y solo una', () => {
    const { sim } = game()
    sim.startMatch({ players: 1, difficulty: 'easy' })
    expect(sim.structures.list.map((s) => s.kind)).toEqual(['grave'])
  })
})
