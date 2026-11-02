import { describe, expect, it } from 'vitest'
import { Btn, type Action, type ActionData, type Move } from './commands'
import { BERRY_REGROW, CONSUMABLE_DEFS, ENEMY_DEFS, EYE_HEIGHT, HEALTH_REGEN_DELAY, HIT_COOLDOWN, HUNGER_MAX, PROP_DEFS, STEP } from './constants'
import { aimPose } from './interaction'
import { generatePropPlacements, type PropData } from './props'
import { Simulation } from './Simulation'
import { STRUCTURE_DEFS, structureSpot } from './structures'
import { DAY_FRACTION } from './world/daycycle'
import { heightAt } from './world/terrain'

const placements = generatePropPlacements()
const NIGHT = DAY_FRACTION + 0.05

/** Comandos de un tick: botones, orientación y acciones (sin numerar). */
interface Command {
  buttons?: number
  yaw?: number
  pitch?: number
  actions?: ActionData[]
}

/** Simulación con un solo jugador, el 0, como la de LocalSession. */
function solo(seed: number) {
  const sim = new Simulation(seed, placements)
  sim.addPlayer(0)
  return sim
}

/** Como LocalSession: numera las acciones a continuación de la última aplicada. */
function step(sim: Simulation, { buttons = 0, yaw = sim.slot(0).player.yaw, pitch = sim.slot(0).player.pitch, actions = [] }: Command = {}) {
  const tick = sim.tick + 1
  let seq = sim.slot(0).appliedSeq
  const move: Move = { tick, buttons, yaw, pitch }
  return sim.step(new Map([[0, { move, actions: actions.map((a): Action => ({ ...a, seq: ++seq, tick })) }]]))
}

/** Teletransporta al jugador delante del prop, mirándolo, y devuelve la orientación para los `Move`. */
function aimAt(sim: Simulation, prop: PropData) {
  const isFree = (x: number, z: number) => sim.world.props.every((o) => o === prop || !o.alive || Math.hypot(o.x - x, o.z - z) > o.radius + 0.4)
  const pose = aimPose(prop, isFree)
  const pitch = Math.atan2(pose.aimY - heightAt(pose.x, pose.z) - EYE_HEIGHT, pose.horizontal)
  sim.teleport(0, pose.x, pose.z, pose.yaw, pitch)
  return { yaw: pose.yaw, pitch }
}

const firstTree = (sim: Simulation) => sim.world.props.find((p) => p.kind === 'tree')!

describe('Simulation', () => {
  it('con la misma semilla y los mismos comandos da el mismo resultado', () => {
    const run = () => {
      const sim = solo(42)
      const look = aimAt(sim, firstTree(sim))
      sim.setPhase(NIGHT)
      const events = []
      for (let i = 0; i < 600; i++) events.push(...step(sim, { ...look, buttons: i % 120 < 60 ? Btn.Attack : Btn.Fwd }))
      return { state: JSON.stringify(sim.toJSON()), events: JSON.stringify(events) }
    }
    expect(run()).toEqual(run())
  })

  it('un clic (swing) golpea aunque el ataque no esté mantenido', () => {
    const sim = solo(1)
    const tree = firstTree(sim)
    const look = aimAt(sim, tree)
    const events = step(sim, { ...look, actions: [{ kind: 'swing' }] })
    expect(events.map((e) => e.type)).toContain('playerSwing')
    expect(tree.hp).toBe(tree.maxHp - 1)
  })

  it('un clic durante el cooldown queda pendiente y golpea al acabar, sin duplicar con el ataque mantenido', () => {
    const sim = solo(1)
    const look = aimAt(sim, firstTree(sim))
    const swings: number[] = []
    const run = (ticks: number, command: Command) => {
      for (let i = 0; i < ticks; i++) {
        if (step(sim, { ...look, ...command }).some((e) => e.type === 'playerSwing')) swings.push(sim.tick)
        command = { ...command, actions: [] }
      }
    }
    // Clic con el botón mantenido: un solo golpe.
    run(1, { buttons: Btn.Attack, actions: [{ kind: 'swing' }] })
    // Suelta y vuelve a hacer clic a media espera: el golpe llega justo al acabar el cooldown.
    run(5, {})
    run(1, { actions: [{ kind: 'swing' }] })
    run(60, {})
    const cooldownTicks = Math.round(HIT_COOLDOWN / STEP)
    expect(swings).toEqual([1, 1 + cooldownTicks])
  })

  it('una acción con seq ya aplicado se descarta', () => {
    const sim = solo(1)
    sim.slot(0).inventory.add('wood', 1)
    sim.slot(0).inventory.add('stone', 1)
    const move = (tick: number): Move => ({ tick, buttons: 0, yaw: 0, pitch: 0 })
    sim.step(new Map([[0, { move: move(1), actions: [{ seq: 1, tick: 1, kind: 'select', slot: 1 }] }]]))
    expect(sim.slot(0).inventory.selected).toBe(1)
    // Reenviada (p. ej. porque no llegó el ack): no se vuelve a aplicar.
    sim.slot(0).inventory.select(0)
    sim.step(new Map([[0, { move: move(2), actions: [{ seq: 1, tick: 1, kind: 'select', slot: 1 }] }]]))
    expect(sim.slot(0).inventory.selected).toBe(0)
    expect(sim.slot(0).appliedSeq).toBe(1)
  })

  it('el reloj sale del tick; setPhase y reset lo cambian y lo avisan con un evento', () => {
    const sim = solo(1)
    for (let i = 0; i < 60; i++) step(sim)
    expect(sim.clock.elapsed).toBeCloseTo(1, 9)
    sim.setPhase(NIGHT)
    expect(sim.clock.phase).toBeCloseTo(NIGHT, 4)
    expect(step(sim).map((e) => e.type)).toContain('clockSet')

    sim.slot(0).inventory.add('wood', 3)
    sim.reset()
    expect(sim.clock.elapsed).toBe(0)
    expect(sim.slot(0).inventory.toJSON()).toEqual({})
    const events = step(sim)
    expect(events[0]).toMatchObject({ type: 'worldReset', worldStartTick: sim.tick - 1 })
  })

  it('setDay salta al día pedido a la misma hora y lo avisa con clockSet', () => {
    const sim = solo(1)
    sim.setPhase(NIGHT)
    step(sim)
    const { phase } = sim.clock
    sim.setDay(3)
    expect(sim.clock.day).toBe(3)
    expect(sim.clock.phase).toBeCloseTo(phase, 4)
    expect(step(sim).map((e) => e.type)).toContain('clockSet')
    sim.setDay(1)
    expect(sim.clock.day).toBe(1)
    expect(sim.clock.phase).toBeCloseTo(phase, 3)
  })

  it('comer gasta lo que se lleva en la mano si es consumible; si no, una baya; y si no mejora nada, no gasta', () => {
    const sim = solo(1)
    const { inventory, player } = sim.slot(0)
    inventory.add('raw_meat', 2)
    inventory.add('berry', 2)
    inventory.add('wood', 1)
    player.hunger = 50
    // La carne, en la casilla elegida.
    expect(step(sim, { actions: [{ kind: 'eat' }] })).toContainEqual(expect.objectContaining({ type: 'playerAte', id: 0, item: 'raw_meat' }))
    expect(inventory.count('raw_meat')).toBe(1)
    expect(player.hunger).toBeCloseTo(50 + CONSUMABLE_DEFS.raw_meat!.food, 1)
    // Con madera en la mano, una baya aunque haya carne.
    step(sim, { actions: [{ kind: 'select', slot: 2 }, { kind: 'eat' }] })
    expect(inventory.count('berry')).toBe(1)
    expect(inventory.count('raw_meat')).toBe(1)
    // Con la mano vacía y sin bayas, nada.
    inventory.remove('berry', 1)
    expect(step(sim, { actions: [{ kind: 'select', slot: 5 }, { kind: 'eat' }] }).map((e) => e.type)).not.toContain('playerAte')
    // Lleno: no se gasta.
    player.hunger = HUNGER_MAX
    expect(step(sim, { actions: [{ kind: 'select', slot: 0 }, { kind: 'eat' }] }).map((e) => e.type)).not.toContain('playerAte')
    expect(inventory.count('raw_meat')).toBe(1)
  })

  it('junto a una fogata se cocina: la carne asada llena el triple que las bayas y cura; la infusión cura poco a poco', () => {
    const sim = solo(1)
    const { inventory, player } = sim.slot(0)
    inventory.add('raw_meat', 2)
    inventory.add('berry', 4)
    // Sin fogata cerca no se puede.
    step(sim, { actions: [{ kind: 'craft', recipe: 'cooked_meat' }] })
    expect(inventory.count('raw_meat')).toBe(2)

    sim.structures.place(structureSpot(player.pos, 0, STRUCTURE_DEFS.campfire.radius, [sim.world.grid, sim.structures.grid]), 'campfire')
    const events = step(sim, { actions: [{ kind: 'craft', recipe: 'cooked_meat' }, { kind: 'craft', recipe: 'berry_infusion' }] })
    expect(events).toContainEqual(expect.objectContaining({ type: 'playerCrafted', recipe: 'cooked_meat' }))
    expect(inventory.toJSON()).toEqual({ raw_meat: 1, cooked_meat: 1, berry_infusion: 1 })

    const cooked = CONSUMABLE_DEFS.cooked_meat!
    expect(cooked.food).toBeGreaterThanOrEqual(CONSUMABLE_DEFS.berry!.food * 3)
    expect(cooked.food).toBeGreaterThan(CONSUMABLE_DEFS.raw_meat!.food * 5)
    player.hunger = 40
    player.health = 50
    step(sim, { actions: [{ kind: 'select', slot: inventory.slots.indexOf('cooked_meat') }, { kind: 'eat' }] })
    expect(player.hunger).toBeCloseTo(40 + cooked.food, 1)
    expect(player.health).toBeCloseTo(50 + cooked.heal!, 1)

    step(sim, { actions: [{ kind: 'select', slot: inventory.slots.indexOf('berry_infusion') }, { kind: 'eat' }] })
    expect(player.regenLeft).toBeCloseTo(20, 1)
    expect(player.regenPerSec).toBe(2)
    expect(inventory.count('berry_infusion')).toBe(0)
  })

  it('la hierba curativa se recoge sin herramienta, cura al momento y vuelve a crecer sola', () => {
    const sim = solo(1)
    const { inventory, player } = sim.slot(0)
    const herb = sim.world.props.find((p) => p.kind === 'healing_herb')!
    const look = aimAt(sim, herb)
    expect(step(sim, { ...look, actions: [{ kind: 'swing' }] })).toContainEqual(expect.objectContaining({ type: 'berryTaken', id: herb.id, hp: 0 }))
    expect(inventory.count('healing_herb')).toBe(1)
    expect(herb).toMatchObject({ hp: 0, alive: true })
    // Sin hierba no da nada, ni se rompe.
    for (let i = 0; i < 40; i++) step(sim, { ...look, actions: [{ kind: 'swing' }] })
    expect(inventory.count('healing_herb')).toBe(1)
    expect(herb.alive).toBe(true)

    player.health = 40
    step(sim, { actions: [{ kind: 'eat' }] })
    expect(player.health).toBeCloseTo(40 + CONSUMABLE_DEFS.healing_herb!.heal!, 1)
    expect(inventory.count('healing_herb')).toBe(0)

    const regrow = PROP_DEFS.healing_herb.harvest!.regrow
    expect(regrow).toBeGreaterThan(BERRY_REGROW)
    const grew: string[] = []
    for (let i = 0; i < Math.round(regrow / STEP); i++) grew.push(...step(sim).map((e) => e.type))
    expect(grew).toContain('berryGrew')
    expect(herb.hp).toBe(1)
    expect(herb.regrowLeft).toBe(0)
  })

  it('la espada golpea más seguido que una herramienta', () => {
    const swings = (item: 'wood_sword' | 'wood_axe') => {
      const sim = solo(1)
      sim.slot(0).inventory.add(item, 1)
      let count = 0
      for (let i = 0; i < 120; i++) count += step(sim, { buttons: Btn.Attack }).filter((e) => e.type === 'playerSwing').length
      return count
    }
    expect(swings('wood_sword')).toBe(8)
    expect(swings('wood_axe')).toBe(5)
  })

  describe('golpe en arco', () => {
    /** Un jugador mirando a -Z (yaw 0) con `item`, con enemigos a (dx, dz) de él. */
    function arc(item: 'iron_sword' | 'iron_axe' | null, spots: [number, number][]) {
      const sim = solo(1)
      const slot = sim.slot(0)
      if (item) slot.inventory.add(item, 1)
      const { x, z } = slot.player.pos
      const enemies = spots.map(([dx, dz]) => sim.enemies.spawnAt(x + dx, z + dz))
      return { sim, enemies, swing: () => step(sim, { actions: [{ kind: 'swing' }] }) }
    }

    it('la espada daña a todos los que tiene delante, aunque el golpe vaya al aire', () => {
      const { enemies, swing } = arc('iron_sword', [[0, -2], [1.2, -2], [-1.2, -2]])
      const events = swing()
      for (const e of enemies) expect(e.hp).toBe(e.maxHp - 35)
      expect(events.filter((e) => e.type === 'enemyHit')).toHaveLength(3)
    })

    it('hasta 4 enemigos, los más cercanos', () => {
      const { enemies, swing } = arc('iron_sword', [[0, -3], [-0.5, -1.5], [0.5, -1.5], [-1, -2.2], [1, -2.2]])
      swing()
      expect(enemies.map((e) => e.hp < e.maxHp)).toEqual([false, true, true, true, true])
    })

    it('no alcanza a quien está detrás, de lado o demasiado lejos', () => {
      const { enemies, swing } = arc('iron_sword', [[0, 2], [3, 0.5], [0, -6]])
      swing()
      for (const e of enemies) expect(e.hp).toBe(e.maxHp)
    })

    it('las herramientas y la mano solo golpean a lo que apuntan', () => {
      for (const item of ['iron_axe', null] as const) {
        const { enemies, swing } = arc(item, [[0.6, -2], [-0.6, -2]])
        swing()
        for (const e of enemies) expect(e.hp).toBe(e.maxHp)
      }
    })

    it('nunca toca los props', () => {
      const sim = solo(1)
      sim.slot(0).inventory.add('iron_sword', 1)
      const tree = firstTree(sim)
      const look = aimAt(sim, tree)
      const hp = tree.hp
      sim.enemies.spawnAt(sim.slot(0).player.pos.x, sim.slot(0).player.pos.z + 40)
      step(sim, { ...look, actions: [{ kind: 'swing' }] })
      // Como a mano: un golpe de 1.
      expect(tree.hp).toBe(hp - 1)
    })

    it('lo que mata suelta su botín', () => {
      const { sim, enemies, swing } = arc('iron_sword', [[0, -2], [1, -2]])
      for (const e of enemies) e.hp = 1
      swing()
      expect(enemies.every((e) => !e.alive)).toBe(true)
      expect(sim.pickups.list.filter((p) => p.item === 'raw_meat')).toHaveLength(2)
    })
  })

  it('un enemigo que pega pausa la regeneración natural', () => {
    const sim = solo(1)
    const { player } = sim.slot(0)
    sim.setPhase(NIGHT)
    player.health = 50
    sim.enemies.spawnAt(player.pos.x + 1, player.pos.z)
    let hurtTick = 0
    for (let i = 0; i < 120 && !hurtTick; i++) if (step(sim).some((e) => e.type === 'playerHurt')) hurtTick = sim.tick
    expect(hurtTick).toBeGreaterThan(0)
    expect(player.healDelay).toBeCloseTo(HEALTH_REGEN_DELAY - STEP, 6)
    const health = player.health
    sim.enemies.reset()
    for (let i = 0; i < 60; i++) step(sim)
    expect(player.health).toBe(health)
  })

  it('un golpe mortal mata aunque no tenga hambre', () => {
    const sim = solo(1)
    const slot = sim.slot(0)
    sim.setPhase(NIGHT)
    slot.player.health = ENEMY_DEFS.goblin.damage
    slot.player.hunger = 50
    sim.enemies.spawnAt(slot.player.pos.x + 1, slot.player.pos.z)
    const events: string[] = []
    for (let i = 0; i < 120 && slot.alive; i++) events.push(...step(sim).map((e) => e.type))
    expect(slot.alive).toBe(false)
    expect(slot.player.health).toBe(0)
    expect(events).toContain('playerDied')
  })

  it('con la vida a 0 ya no se come: no salva del golpe mortal de ese mismo paso', () => {
    const sim = solo(1)
    const slot = sim.slot(0)
    slot.inventory.add('berry', 1)
    slot.player.hunger = 50
    slot.player.health = 0
    const events = step(sim, { actions: [{ kind: 'eat' }] }).map((e) => e.type)
    expect(events).not.toContain('playerAte')
    expect(events).toContain('playerDied')
    expect(sim.pickups.list.map((p) => p.item)).toEqual(['berry'])
  })

  it('tirar saca una unidad (o la pila) de la casilla y la deja en el suelo delante, con quién la tiró', () => {
    const sim = solo(1)
    const { inventory, player } = sim.slot(0)
    inventory.add('wood', 5)
    inventory.add('stone', 2)
    const events = step(sim, { actions: [{ kind: 'drop', slot: 0, all: false }] })
    expect(events).toContainEqual(expect.objectContaining({ type: 'playerDropped', id: 0, item: 'wood', amount: 1 }))
    expect(events).toContainEqual(expect.objectContaining({ type: 'pickupSpawn', item: 'wood', amount: 1 }))
    expect(inventory.count('wood')).toBe(4)
    expect(sim.pickups.list).toMatchObject([{ item: 'wood', amount: 1, droppedBy: 0 }])

    step(sim, { actions: [{ kind: 'drop', slot: 1, all: true }] })
    expect(inventory.count('stone')).toBe(0)
    expect(inventory.slots[1]).toBeNull()
    expect(sim.pickups.list.at(-1)).toMatchObject({ item: 'stone', amount: 2 })

    // Una casilla vacía no hace nada.
    expect(step(sim, { actions: [{ kind: 'drop', slot: 5, all: true }] }).map((e) => e.type)).not.toContain('playerDropped')
    // Sale hacia donde mira (yaw 0 → -z) y, quieto encima, no lo recoge hasta pasados los 2 s.
    for (let i = 0; i < 60; i++) step(sim)
    const wood = sim.pickups.list[0]
    expect(player.pos.z - wood.pos.z).toBeGreaterThan(1)
    sim.teleport(0, wood.pos.x, wood.pos.z, 0, 0)
    for (let i = 0; i < 30; i++) step(sim)
    expect(inventory.count('wood')).toBe(4)
    for (let i = 0; i < 90; i++) step(sim)
    expect(inventory.count('wood')).toBe(5)
  })

  it('serializar, restaurar y seguir da lo mismo que no serializar', () => {
    const a = solo(7)
    const { inventory, player } = a.slot(0)
    inventory.add('wood', 20)
    inventory.add('stone', 10)
    inventory.add('berry', 3)
    player.hunger = 50
    const tree = firstTree(a)
    const look = aimAt(a, tree)

    // Lo que se hace en cada tick; lo mismo para las dos simulaciones a partir del corte.
    const script = (sim: Simulation, t: number): Command => {
      if (t === 150) sim.setPhase(NIGHT)
      const slot = sim.slot(0).inventory.slots.indexOf('campfire')
      const actions: ActionData[] =
        t === 100 ? [{ kind: 'craft', recipe: 'campfire' }]
        : t === 101 && slot >= 0 ? [{ kind: 'select', slot }]
        : t === 110 ? [{ kind: 'place' }]
        : t === 111 ? [{ kind: 'select', slot: 0 }]
        : t === 120 ? [{ kind: 'eat' }]
        : t === 130 ? [{ kind: 'move', from: 1, to: 15 }]
        : t % 47 === 0 ? [{ kind: 'swing' }]
        : []
      if (t < 90) return { ...look, buttons: Btn.Attack }
      if (t < 150) return { ...look, actions }
      // De noche: anda en círculos, salta y golpea de vez en cuando mientras llegan los enemigos.
      const buttons = Btn.Fwd | (t % 90 === 0 ? Btn.Jump : 0) | (t % 200 < 100 ? Btn.Sprint : 0) | (t % 60 < 20 ? Btn.Attack : 0)
      return { yaw: look.yaw + t * 0.01, pitch: 0, buttons, actions }
    }

    const SPLIT = 500
    for (let t = 1; t <= SPLIT; t++) step(a, script(a, t))
    expect(tree.alive).toBe(false)
    expect(a.structures.list.length).toBe(1)
    expect(a.enemies.list.length).toBeGreaterThan(0)
    expect(a.slot(0).inventory.slots[15]).not.toBe(null)

    const b = Simulation.fromJSON(JSON.parse(JSON.stringify(a.toJSON())), placements)
    expect(JSON.stringify(b.toJSON())).toBe(JSON.stringify(a.toJSON()))
    const seen = new Set<string>()
    for (let t = SPLIT + 1; t <= SPLIT + 900; t++) {
      const eventsA = step(a, script(a, t))
      const eventsB = step(b, script(b, t))
      expect(JSON.stringify(eventsB)).toBe(JSON.stringify(eventsA))
      for (const e of eventsA) seen.add(e.type)
    }
    // Tras el corte siguen pasando cosas que dependen del estado restaurado.
    expect([...seen]).toEqual(expect.arrayContaining(['enemySpawn', 'enemyAttack', 'playerHurt', 'playerSwing']))
    expect(JSON.stringify(b.toJSON())).toBe(JSON.stringify(a.toJSON()))
    expect(b.slot(0).inventory.slots).toEqual(a.slot(0).inventory.slots)
  })
})
