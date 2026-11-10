import { describe, expect, it } from 'vitest'
import { Btn, type Action, type ActionData } from './commands'
import { STAMINA_MAX, STEP, WALK_SPEED } from './constants'
import { armorCode, armorOf, armorReduce, BLOCK_SPEED_FACTOR, BLOCK_STAMINA_PER_DAMAGE, damageTaken, EQUIP_DEFS, noEquipment, spendGuard, type Equipped } from './equipment'
import { Inventory } from './inventory'
import { createPlayer } from './player'
import { generatePropPlacements } from './props'
import { quickProps } from './quickProps'
import { Simulation } from './Simulation'
import { DAY_FRACTION } from './world/daycycle'

const NIGHT = DAY_FRACTION + 0.05
const wearing = (equipped: Partial<Equipped>): Equipped => ({ ...noEquipment(), ...equipped })
/** Mirando a +X (forward = (-sin(yaw), -cos(yaw))). */
const EAST = -Math.PI / 2
const guard = (blocking: boolean) => ({ blocking, yaw: EAST, pos: { x: 0, z: 0 } })

describe('daño con equipo', () => {
  it('la armadura quita su parte de todo, venga de donde venga', () => {
    expect(damageTaken(20, wearing({ chest: 'iron_chestplate' }), guard(false)).damage).toBeCloseTo(20 * (1 - 0.11), 6)
    expect(damageTaken(20, wearing({ chest: 'mithril_chestplate' }), guard(false), { x: -5, z: 0 }).damage).toBeCloseTo(20 * (1 - 0.19), 6)
    expect(damageTaken(20, noEquipment(), guard(false), { x: 5, z: 0 })).toEqual({ damage: 20, blocked: 0 })
  })

  it('el escudo solo para lo que llega de frente, y solo bloqueando', () => {
    const shield = wearing({ shield: 'wood_shield' })
    expect(damageTaken(20, shield, guard(true), { x: 5, z: 0 })).toEqual({ damage: expect.closeTo(6, 6), blocked: expect.closeTo(14, 6) })
    // A 50° del frente aún para; de lado (90°) y por detrás, no.
    expect(damageTaken(20, shield, guard(true), { x: Math.cos(0.87), z: Math.sin(0.87) }).blocked).toBeGreaterThan(0)
    expect(damageTaken(20, shield, guard(true), { x: 0, z: 5 }).blocked).toBe(0)
    expect(damageTaken(20, shield, guard(true), { x: -5, z: 0 }).blocked).toBe(0)
    expect(damageTaken(20, shield, guard(false), { x: 5, z: 0 }).blocked).toBe(0)
    // Lo que no dice de dónde viene (un meteorito) no se para.
    expect(damageTaken(20, shield, guard(true)).blocked).toBe(0)
  })

  it('cada escudo para más que el anterior, y con peto se suman', () => {
    const blocked = (shield: 'wood_shield' | 'iron_shield' | 'crystal_shield') => damageTaken(100, wearing({ shield }), guard(true), { x: 5, z: 0 }).damage
    expect([blocked('wood_shield'), blocked('iron_shield'), blocked('crystal_shield')].map((d) => Math.round(d))).toEqual([30, 20, 10])
    expect(damageTaken(100, wearing({ shield: 'iron_shield', chest: 'iron_chestplate' }), guard(true), { x: 5, z: 0 }).damage).toBeCloseTo(20 * (1 - 0.11), 6)
  })

  it('las cuatro piezas se suman: de hierro quitan un 25 % y de mithril un 42 %, y se pueden mezclar', () => {
    const iron = wearing({ head: 'iron_helmet', chest: 'iron_chestplate', legs: 'iron_leggings', feet: 'iron_boots' })
    const mithril = wearing({ head: 'mithril_helmet', chest: 'mithril_chestplate', legs: 'mithril_leggings', feet: 'mithril_boots' })
    expect(armorReduce(iron)).toBeCloseTo(0.25, 6)
    expect(armorReduce(mithril)).toBeCloseTo(0.42, 6)
    expect(armorReduce(wearing({ head: 'mithril_helmet', feet: 'iron_boots' }))).toBeCloseTo(0.08 + 0.03, 6)
    expect(damageTaken(100, mithril, guard(false)).damage).toBeCloseTo(58, 6)
    // Cada pieza, en su hueco.
    for (const [item, def] of Object.entries(EQUIP_DEFS)) if (def.tier) expect(item.endsWith(def.slot === 'head' ? 'helmet' : def.slot === 'chest' ? 'chestplate' : def.slot === 'legs' ? 'leggings' : 'boots')).toBe(true)
  })

  it('la armadura viaja en un número, de 0 a 80, y se lee igual', () => {
    expect(armorCode(noEquipment())).toBe(0)
    const mixed = wearing({ head: 'iron_helmet', legs: 'mithril_leggings', shield: 'iron_shield' })
    expect(armorOf(armorCode(mixed))).toEqual({ head: 'iron', chest: null, legs: 'mithril', feet: null })
    const full = wearing({ head: 'mithril_helmet', chest: 'mithril_chestplate', legs: 'mithril_leggings', feet: 'mithril_boots' })
    expect(armorCode(full)).toBe(80)
  })

  it('parar gasta resistencia y, sin ella, el escudo baja', () => {
    const player = createPlayer({ heightAt: () => 5 }, 0, 0)
    player.blocking = true
    spendGuard(player, 10)
    expect(player.stamina).toBeCloseTo(STAMINA_MAX - 10 * BLOCK_STAMINA_PER_DAMAGE, 6)
    expect(player.blocking).toBe(true)
    spendGuard(player, 1000)
    expect(player).toMatchObject({ stamina: 0, exhausted: true, blocking: false })
  })
})

describe('ponerse y quitarse equipo', () => {
  it('se pone desde su casilla, que queda libre, y lo que llevaba vuelve a ella', () => {
    const inv = new Inventory()
    inv.add('wood', 3)
    inv.add('wood_shield', 1)
    inv.add('iron_shield', 1)
    expect(inv.equip(1)).toBe(true)
    expect(inv.equipped.shield).toBe('wood_shield')
    expect(inv.slots.slice(0, 3)).toEqual(['wood', null, 'iron_shield'])
    expect(inv.has('wood_shield')).toBe(false)
    expect(inv.equip(2)).toBe(true)
    expect(inv.equipped.shield).toBe('iron_shield')
    expect(inv.slots.slice(0, 3)).toEqual(['wood', null, 'wood_shield'])
    // Lo que no se pone, no.
    expect(inv.equip(0)).toBe(false)
    expect(inv.unequip('shield')).toBe(true)
    expect(inv.equipped.shield).toBeNull()
    expect(inv.count('iron_shield')).toBe(1)
    expect(inv.unequip('chest')).toBe(false)
  })

  it('con el inventario lleno no se quita, ni se cambia por uno de una pila', () => {
    const inv = new Inventory(2)
    inv.add('iron_chestplate', 2)
    inv.add('wood', 1)
    expect(inv.equip(0)).toBe(true)
    expect(inv.count('iron_chestplate')).toBe(1)
    inv.add('stone', 1)
    expect(inv.unequip('chest')).toBe(true)
    expect(inv.count('iron_chestplate')).toBe(2)
    inv.add('mithril_chestplate', 1)
    expect(inv.slots).toEqual(['iron_chestplate', 'wood'])
    expect(inv.add('mithril_chestplate', 1)).toBe(false)
    inv.remove('wood', 1)
    inv.add('mithril_chestplate', 1)
    expect(inv.equip(1)).toBe(true)
    expect(inv.equip(0)).toBe(true)
    // Se ha puesto el de hierro (le quedaba otro) y el de mithril ha vuelto a la casilla que dejó libre.
    expect(inv.equipped.chest).toBe('iron_chestplate')
    expect(inv.slots).toEqual(['iron_chestplate', 'mithril_chestplate'])
    const full = new Inventory(1)
    full.add('iron_chestplate', 2)
    full.equip(0)
    expect(full.unequip('chest')).toBe(true)
    full.equip(0)
    full.remove('iron_chestplate', 1)
    full.add('wood', 1)
    expect(full.unequip('chest')).toBe(false)
  })

  it('se guarda con el inventario, y uno guardado sin equipo no lleva nada', () => {
    const inv = new Inventory()
    inv.add('crystal_shield', 1)
    inv.equip(0)
    const copy = new Inventory()
    copy.load(JSON.parse(JSON.stringify(inv.save())))
    expect(copy.equipped).toEqual({ ...noEquipment(), shield: 'crystal_shield' })
    const { equipped: _, ...old } = inv.save()
    copy.load(old)
    expect(copy.equipped).toEqual(noEquipment())
  })
})

describe('el escudo en la partida', () => {
  const setup = () => {
    const sim = new Simulation(1, generatePropPlacements())
    quickProps(sim.world.props)
    sim.addPlayer(0)
    return sim
  }
  const step = (sim: Simulation, buttons = 0, yaw = sim.slot(0).player.yaw, actions: ActionData[] = []) => {
    const tick = sim.tick + 1
    let seq = sim.slot(0).appliedSeq
    return sim.step(new Map([[0, { move: { tick, buttons, yaw, pitch: 0 }, actions: actions.map((a): Action => ({ ...a, seq: ++seq, tick })) }]]))
  }
  /** El daño del primer golpe de un trasgo que llega por el este, mirando a `yaw`. */
  const firstHit = (yaw: number, buttons: number, equip: ActionData[] = []) => {
    const sim = setup()
    const { player, inventory } = sim.slot(0)
    inventory.add('wood_shield', 1)
    inventory.add('iron_chestplate', 1)
    step(sim, 0, yaw, equip)
    sim.setPhase(NIGHT)
    sim.enemies.spawnAt(player.pos.x + 1.2, player.pos.z)
    for (let i = 0; i < 200; i++) {
      const hurt = step(sim, buttons, yaw).find((e) => e.type === 'playerHurt')
      if (hurt) return { hurt, stamina: player.stamina }
    }
    throw new Error('no ha pegado')
  }

  it('bloqueando de frente para el 70 % con el de madera y gasta resistencia; por detrás, no', () => {
    const bare = firstHit(EAST, Btn.Block).hurt
    expect(bare).not.toHaveProperty('blocked')
    const equip: ActionData[] = [{ kind: 'equip', slot: 0 }]
    const front = firstHit(EAST, Btn.Block, equip)
    expect(front.hurt).toMatchObject({ dmg: expect.closeTo(bare.dmg * 0.3, 6), blocked: expect.closeTo(bare.dmg * 0.7, 6) })
    expect(front.stamina).toBeLessThan(STAMINA_MAX)
    expect(firstHit(-EAST, Btn.Block, equip).hurt).toMatchObject({ dmg: bare.dmg })
    expect(firstHit(EAST, 0, equip).hurt).toMatchObject({ dmg: bare.dmg })
    // El peto, siempre.
    expect(firstHit(-EAST, 0, [{ kind: 'equip', slot: 1 }]).hurt).toMatchObject({ dmg: expect.closeTo(bare.dmg * (1 - EQUIP_DEFS.iron_chestplate!.reduce), 6) })
  })

  it('bloqueando se anda a la mitad, sin correr, y no se golpea; sin escudo, Block no hace nada', () => {
    const sim = setup()
    const { player, inventory } = sim.slot(0)
    const speed = (buttons: number) => {
      step(sim, buttons)
      return Math.hypot(player.vel.x, player.vel.z)
    }
    expect(speed(Btn.Fwd | Btn.Block)).toBeCloseTo(WALK_SPEED, 6)
    expect(player.blocking).toBe(false)
    inventory.add('iron_shield', 1)
    step(sim, 0, player.yaw, [{ kind: 'equip', slot: 0 }])
    expect(speed(Btn.Fwd | Btn.Block | Btn.Sprint)).toBeCloseTo(WALK_SPEED * BLOCK_SPEED_FACTOR, 6)
    expect(player.blocking).toBe(true)
    const swings = (buttons: number) => {
      let n = 0
      for (let i = 0; i < Math.round(1 / STEP); i++) n += step(sim, buttons).filter((e) => e.type === 'playerSwing').length
      return n
    }
    expect(swings(Btn.Attack | Btn.Block)).toBe(0)
    expect(swings(Btn.Attack)).toBeGreaterThan(0)
  })

  it('al morir cae también lo que lleva puesto, y ponérselo se avisa', () => {
    const sim = setup()
    const slot = sim.slot(0)
    slot.inventory.add('crystal_shield', 1)
    expect(step(sim, 0, 0, [{ kind: 'equip', slot: 0 }])).toContainEqual(expect.objectContaining({ type: 'playerEquipped', id: 0, item: 'crystal_shield' }))
    slot.player.health = 0
    step(sim)
    expect(slot.alive).toBe(false)
    expect(sim.pickups.list.map((p) => [p.item, p.keep])).toEqual([['crystal_shield', true]])
    expect(slot.inventory.equipped).toEqual(noEquipment())
  })
})
