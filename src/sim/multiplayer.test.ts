import { describe, expect, it } from 'vitest'
import { Btn, type Action, type ActionData, type PlayerCommands } from './commands'
import type { RecipeId } from './crafting'
import { ENEMY_SPAWN_MIN, EYE_HEIGHT, HIT_COOLDOWN, PICKUP_DELAY, PLACE_DISTANCE, STATION_RANGE, STEP } from './constants'
import { Enemies, enemyCap, enemyCapFor, spawnIntervalFor, type EnemyPrey } from './enemies'
import type { PlayerId, SimEvent, SimEventData, TargetRef } from './events'
import { aimPose } from './interaction'
import { Inventory, type ItemId } from './inventory'
import { Pickups, type Collector } from './pickups'
import { createPropWorld, generatePropPlacements, type PropData } from './props'
import { mulberry32 } from './random'
import { Simulation } from './Simulation'
import { DAY_FRACTION } from './world/daycycle'
import { heightAt, ROCK_LEVEL, SAND_LEVEL } from './world/terrain'

const placements = generatePropPlacements()
const world = createPropWorld(placements)
const NIGHT = DAY_FRACTION + 0.05

/** Comandos de un jugador en un tick: botones, orientación y acciones (sin numerar). */
interface Command {
  buttons?: number
  yaw?: number
  pitch?: number
  /** Lo que el cliente dice tener delante (en red); sin él, lo calcula la simulación. */
  aim?: TargetRef | null
  actions?: ActionData[]
}

/** Simulación con `n` jugadores (ids 0…n-1). */
function withPlayers(n: number, seed = 1) {
  const sim = new Simulation(seed, placements)
  for (let i = 0; i < n; i++) sim.addPlayer()
  return sim
}

/** Un tick con los comandos de cada jugador; las acciones se numeran como en LocalSession. */
function stepAll(sim: Simulation, commands: Record<PlayerId, Command> = {}) {
  const tick = sim.tick + 1
  const map = new Map<PlayerId, PlayerCommands>()
  for (const [key, c] of Object.entries(commands)) {
    const slot = sim.slot(Number(key))
    let seq = slot.appliedSeq
    map.set(slot.id, {
      move: {
        tick,
        buttons: c.buttons ?? 0,
        yaw: c.yaw ?? slot.player.yaw,
        pitch: c.pitch ?? slot.player.pitch,
        ...(c.aim !== undefined ? { aim: c.aim } : {}),
      },
      actions: (c.actions ?? []).map((a): Action => ({ ...a, seq: ++seq, tick })),
    })
  }
  return sim.step(map)
}

/** Pone al jugador delante del prop mirándolo, en un sitio libre que cumpla `also`; devuelve su orientación. */
function aimAt(sim: Simulation, id: PlayerId, prop: PropData, also = (_x: number, _z: number) => true) {
  const isFree = (x: number, z: number) =>
    also(x, z) && sim.world.props.every((o) => o === prop || !o.alive || Math.hypot(o.x - x, o.z - z) > o.radius + 0.4)
  const pose = aimPose(prop, isFree)
  const pitch = Math.atan2(pose.aimY - heightAt(pose.x, pose.z) - EYE_HEIGHT, pose.horizontal)
  sim.teleport(id, pose.x, pose.z, pose.yaw, pitch)
  return { yaw: pose.yaw, pitch, x: pose.x, z: pose.z }
}

const ofType = <T extends SimEvent['type']>(events: readonly SimEvent[], type: T) =>
  events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type)

/** Primer punto de hierba, en espiral desde el centro, sin props en `clearance` metros. */
function clearSpot(clearance: number) {
  for (let i = 0; i < 4000; i++) {
    const angle = i * 0.5
    const r = angle * 0.4
    const x = Math.cos(angle) * r
    const z = Math.sin(angle) * r
    const h = heightAt(x, z)
    if (h < SAND_LEVEL + 0.3 || h > ROCK_LEVEL) continue
    if (world.props.every((p) => Math.hypot(p.x - x, p.z - z) - p.radius > clearance)) return { x, z }
  }
  throw new Error('sin hueco libre')
}

const spot = clearSpot(8)

describe('Simulation con varios jugadores', () => {
  it('el primero aparece en el punto de aparición y los demás en un anillo alrededor; reset los devuelve ahí', () => {
    const sim = withPlayers(4)
    const { x, z } = sim.spawnCenter
    const positions = sim.inWorld().map((s) => ({ ...s.player.pos }))
    expect(positions[0]).toMatchObject({ x, z })
    for (const pos of positions.slice(1)) expect(Math.hypot(pos.x - x, pos.z - z)).toBeCloseTo(2.5, 9)
    // Cada uno en su sitio.
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) expect(Math.hypot(positions[i].x - positions[j].x, positions[i].z - positions[j].z)).toBeGreaterThan(1)

    for (let i = 0; i < 30; i++) stepAll(sim, { 0: { buttons: Btn.Fwd }, 3: { buttons: Btn.Back } })
    expect(sim.slot(0).player.pos.z).not.toBeCloseTo(z, 3)
    sim.slot(2).inventory.add('wood', 3)
    sim.reset()
    sim.inWorld().forEach((s, i) => {
      expect(s.player.pos).toMatchObject(positions[i])
      expect(s.inventory.toJSON()).toEqual({})
    })
  })

  it('no depende del orden en que llegan los comandos', () => {
    const run = (order: PlayerId[]) => {
      const sim = withPlayers(3, 9)
      sim.setPhase(NIGHT)
      const events: SimEvent[] = []
      for (let t = 0; t < 900; t++) {
        const commands: Record<PlayerId, Command> = {}
        for (const id of order) commands[id] = { buttons: Btn.Fwd | (t % 50 < 10 ? Btn.Attack : 0), yaw: id * 2 + t * 0.01 }
        events.push(...stepAll(sim, commands))
      }
      return JSON.stringify({ state: sim.toJSON(), events })
    }
    expect(run([2, 0, 1])).toBe(run([0, 1, 2]))
  })

  it('dos jugadores talan el mismo árbol en la mitad de tiempo y cae una sola vez', () => {
    const sim = withPlayers(2)
    const tree = sim.world.props.find((p) => p.kind === 'tree')!
    const a = aimAt(sim, 0, tree)
    const b = aimAt(sim, 1, tree, (x, z) => Math.hypot(x - a.x, z - a.z) > 1)
    const events: SimEvent[] = []
    let fell = 0
    for (let t = 1; t <= 60 && !fell; t++) {
      events.push(...stepAll(sim, { 0: { ...a, buttons: Btn.Attack }, 1: { ...b, buttons: Btn.Attack } }))
      if (!tree.alive) fell = t
    }
    // A mano son 3 golpes: dos a la vez y el tercero al acabar el cooldown.
    expect(fell).toBe(1 + Math.round(HIT_COOLDOWN / STEP))
    expect(ofType(events, 'propHit').map((e) => e.by)).toEqual([0, 1])
    expect(ofType(events, 'propDestroyed')).toEqual([expect.objectContaining({ id: tree.id, by: 0 })])
    // El segundo golpe de ese tick ya no encuentra el árbol.
    const lastSwings = ofType(events, 'playerSwing').filter((e) => e.tick === fell)
    expect(lastSwings.map((e) => [e.id, e.target?.id ?? null])).toEqual([[0, tree.id], [1, null]])
    expect(sim.pickups.list.filter((p) => p.item === 'wood')).toHaveLength(4)
    expect(sim.slot(0).target).toBeNull()
    expect(sim.slot(1).target).toBeNull()
  })

  it('una roca: el que va a mano no le hace nada y el del pico de madera la rompe él solo', () => {
    const sim = withPlayers(2)
    const rock = sim.world.props.find((p) => p.kind === 'rock')!
    const { inventory } = sim.slot(1)
    inventory.add('wood_pickaxe', 1)
    inventory.select(inventory.slots.indexOf('wood_pickaxe'))
    const a = aimAt(sim, 0, rock)
    const b = aimAt(sim, 1, rock, (x, z) => Math.hypot(x - a.x, z - a.z) > 1)
    const events: SimEvent[] = []
    let broke = 0
    for (let t = 1; t <= 60 && !broke; t++) {
      events.push(...stepAll(sim, { 0: { ...a, buttons: Btn.Attack }, 1: { ...b, buttons: Btn.Attack } }))
      if (!rock.alive) broke = t
    }
    // 4 de vida y 2 por golpe: el segundo golpe del pico, al acabar el cooldown.
    expect(broke).toBe(1 + Math.round(HIT_COOLDOWN / STEP))
    // Los dos golpean (y se oyen), pero solo los del pico le quitan vida.
    expect(ofType(events, 'playerSwing').filter((e) => e.target?.id === rock.id).map((e) => [e.id, e.item])).toEqual([
      [0, null],
      [1, 'wood_pickaxe'],
      [0, null],
      [1, 'wood_pickaxe'],
    ])
    expect(ofType(events, 'propHit')).toEqual([expect.objectContaining({ id: rock.id, hp: 2, by: 1 })])
    expect(ofType(events, 'propDestroyed')).toEqual([expect.objectContaining({ id: rock.id, by: 1 })])
    expect(sim.pickups.list.filter((p) => p.item === 'stone')).toHaveLength(3)
  })

  it('las bayas van al inventario de quien golpea', () => {
    const sim = withPlayers(2)
    const bush = sim.world.props.find((p) => p.kind === 'bush')!
    const look = aimAt(sim, 1, bush)
    const events = stepAll(sim, { 0: {}, 1: { ...look, actions: [{ kind: 'swing' }] } })
    expect(ofType(events, 'berryTaken')).toEqual([expect.objectContaining({ id: bush.id, by: 1 })])
    expect(sim.slot(1).inventory.count('berry')).toBe(1)
    expect(sim.slot(0).inventory.count('berry')).toBe(0)
  })

  it('dos fogatas en el mismo sitio y el mismo tick: solo cabe la del id menor', () => {
    const sim = withPlayers(2)
    for (const id of [0, 1]) {
      const { inventory } = sim.slot(id)
      inventory.add('campfire', 1)
      inventory.select(inventory.slots.indexOf('campfire'))
      sim.teleport(id, spot.x, spot.z, 0, 0)
    }
    const events = stepAll(sim, { 0: { actions: [{ kind: 'place' }] }, 1: { actions: [{ kind: 'place' }] } })
    expect(ofType(events, 'structurePlaced').map((e) => e.by)).toEqual([0])
    expect(ofType(events, 'playerPlaced')).toEqual([expect.objectContaining({ id: 0, item: 'campfire' })])
    expect(sim.structures.list).toHaveLength(1)
    expect(sim.slot(0).inventory.count('campfire')).toBe(0)
    expect(sim.slot(1).inventory.count('campfire')).toBe(1)
  })

  it('dos fogatas en sitios distintos y el mismo tick: caben las dos, con ids por orden de jugador', () => {
    const sim = withPlayers(2)
    for (const id of [0, 1]) {
      const { inventory } = sim.slot(id)
      inventory.add('campfire', 1)
      inventory.select(inventory.slots.indexOf('campfire'))
      // Uno mira hacia -z y el otro hacia +z: caen a 4,4 m una de otra.
      sim.teleport(id, spot.x, spot.z, id * Math.PI, 0)
    }
    const events = stepAll(sim, { 0: { actions: [{ kind: 'place' }] }, 1: { actions: [{ kind: 'place' }] } })
    expect(ofType(events, 'structurePlaced').map((e) => [e.id, e.by])).toEqual([[0, 0], [1, 1]])
    expect(sim.structures.list.map((s) => s.kind)).toEqual(['campfire', 'campfire'])
    expect(sim.structures.list[1].z - sim.structures.list[0].z).toBeCloseTo(2 * PLACE_DISTANCE)
    expect([0, 1].map((id) => sim.slot(id).inventory.count('campfire'))).toEqual([0, 0])
  })

  it('la mesa de trabajo: fabrican en ella los que están cerca, también dos en el mismo tick, y el que está lejos no', () => {
    const sim = withPlayers(3)
    const { inventory } = sim.slot(0)
    inventory.add('wood', 10)
    sim.teleport(0, spot.x, spot.z, 0, 0)
    stepAll(sim, { 0: { actions: [{ kind: 'craft', recipe: 'workbench' }] } })
    expect(inventory.count('wood')).toBe(0)
    const events = stepAll(sim, { 0: { actions: [{ kind: 'select', slot: inventory.slots.indexOf('workbench') }, { kind: 'place' }] } })
    expect(ofType(events, 'playerPlaced')).toEqual([expect.objectContaining({ id: 0, item: 'workbench' })])
    const [bench] = sim.structures.list
    expect(bench).toMatchObject({ kind: 'workbench', radius: 0.7, rotY: 0 })

    // 1 al otro lado de la mesa; 2 a 1 m más del alcance, contando desde el borde.
    sim.teleport(1, bench.x, bench.z - 1.5, Math.PI, 0)
    sim.teleport(2, bench.x + bench.radius + STATION_RANGE + 1, bench.z, Math.PI / 2, 0)
    const craftAxe: Command = { actions: [{ kind: 'craft', recipe: 'stone_axe' }] }
    for (const id of [0, 1, 2]) {
      sim.slot(id).inventory.add('wood', 3)
      sim.slot(id).inventory.add('stone', 5)
    }
    const crafted = stepAll(sim, { 0: craftAxe, 1: craftAxe, 2: craftAxe })
    expect(ofType(crafted, 'playerCrafted').map((e) => [e.id, e.recipe])).toEqual([[0, 'stone_axe'], [1, 'stone_axe']])
    expect([0, 1, 2].map((id) => sim.slot(id).inventory.count('stone_axe'))).toEqual([1, 1, 0])
    expect(sim.slot(2).inventory.toJSON()).toEqual({ wood: 3, stone: 5 })

    // Al acercarse, el lejano también puede.
    sim.teleport(2, bench.x + bench.radius + STATION_RANGE - 0.5, bench.z, Math.PI / 2, 0)
    expect(ofType(stepAll(sim, { 2: craftAxe }), 'playerCrafted').map((e) => e.id)).toEqual([2])
  })

  it('hierro: con la mesa, el horno y el yunque se pasa del mineral a las herramientas de hierro; lejos de ellos, no', () => {
    const sim = withPlayers(2)
    const { inventory } = sim.slot(0)
    inventory.add('wood', 10 + 4 + 7)
    inventory.add('stone', 12 + 6)
    inventory.add('iron_ore', 7)
    inventory.add('birch_wood', 4)
    const craft = (id: PlayerId, recipe: RecipeId, times = 1) =>
      ofType(stepAll(sim, { [id]: { actions: Array.from({ length: times }, () => ({ kind: 'craft' as const, recipe })) } }), 'playerCrafted').length
    /** Coloca lo que diga `item` mirando a `yaw` desde el centro del claro. */
    const place = (item: ItemId, yaw: number) => {
      sim.teleport(0, spot.x, spot.z, yaw, 0)
      return ofType(stepAll(sim, { 0: { actions: [{ kind: 'select', slot: inventory.slots.indexOf(item) }, { kind: 'place' }] } }), 'structurePlaced')
    }
    sim.teleport(0, spot.x, spot.z, 0, 0)

    // Sin estaciones no sale nada de lo nuevo.
    expect(craft(0, 'furnace') + craft(0, 'iron_bar')).toBe(0)
    expect(craft(0, 'workbench')).toBe(1)
    expect(place('workbench', 0)).toHaveLength(1)
    expect(craft(0, 'furnace')).toBe(1)
    // El horno, a la izquierda y de frente: se funde al momento, uno por clic.
    expect(place('furnace', Math.PI / 2)).toEqual([expect.objectContaining({ kind: 'furnace', rotY: Math.PI / 2, by: 0 })])
    expect(craft(0, 'iron_bar', 5) + craft(0, 'iron_bar', 5)).toBe(7)
    expect(inventory.toJSON()).toMatchObject({ iron_bar: 7, stone: 6, birch_wood: 4 })
    expect(inventory.count('iron_ore')).toBe(0)
    expect(inventory.count('wood')).toBe(0)
    // El yunque sale de la mesa, y en él las herramientas.
    expect(craft(0, 'iron_pickaxe')).toBe(0)
    expect(craft(0, 'anvil')).toBe(1)
    expect(place('anvil', Math.PI)).toEqual([expect.objectContaining({ kind: 'anvil', rotY: Math.PI })])
    expect(sim.structures.list.map((s) => [s.kind, s.radius])).toEqual([['workbench', 0.7], ['furnace', 0.8], ['anvil', 0.5]])
    expect(craft(0, 'iron_pickaxe')).toBe(1)
    expect(craft(0, 'iron_axe')).toBe(0)
    expect(inventory.toJSON()).toMatchObject({ iron_pickaxe: 1, birch_wood: 2 })

    // El otro jugador, con todo en el inventario pero fuera del alcance del horno y del yunque, no puede.
    const anvil = sim.structures.list[2]
    const other = sim.slot(1).inventory
    other.add('iron_ore', 1)
    other.add('wood', 1)
    other.add('iron_bar', 3)
    other.add('birch_wood', 2)
    sim.teleport(1, anvil.x, anvil.z + anvil.radius + STATION_RANGE + 1, 0, 0)
    expect(craft(1, 'iron_bar') + craft(1, 'iron_axe')).toBe(0)
    sim.teleport(1, anvil.x, anvil.z + anvil.radius + STATION_RANGE - 0.5, 0, 0)
    expect(craft(1, 'iron_axe')).toBe(1)
    // Ahí el horno aún queda lejos; en el centro del claro, no.
    expect(craft(1, 'iron_bar')).toBe(0)
    sim.teleport(1, spot.x, spot.z, 0, 0)
    expect(craft(1, 'iron_bar')).toBe(1)
    expect(other.toJSON()).toEqual({ iron_axe: 1, iron_bar: 1 })
  })

  it('el pico de hierro rompe una mena de hierro en 2 golpes', () => {
    const sim = withPlayers(1)
    const ore = sim.world.props.find((p) => p.kind === 'iron_ore')!
    const { inventory } = sim.slot(0)
    inventory.add('iron_pickaxe', 1)
    inventory.select(inventory.slots.indexOf('iron_pickaxe'))
    const look = aimAt(sim, 0, ore)
    let broke = 0
    for (let t = 1; t <= 60 && !broke; t++) {
      stepAll(sim, { 0: { ...look, buttons: Btn.Attack } })
      if (!ore.alive) broke = t
    }
    expect(broke).toBe(1 + Math.round(HIT_COOLDOWN / STEP))
    expect(sim.pickups.list.filter((p) => p.item === 'iron_ore')).toHaveLength(3)
  })

  it('cada jugador recibe su daño; el que muere deja de moverse, de comer y de ser objetivo', () => {
    const sim = withPlayers(2)
    sim.teleport(0, spot.x - 3, spot.z, 0, 0)
    sim.teleport(1, spot.x + 3, spot.z, 0, 0)
    sim.setPhase(NIGHT)
    const enemy = sim.enemies.spawnAt(spot.x + 4.5, spot.z)
    const events: SimEvent[] = []
    for (let i = 0; i < 120; i++) events.push(...stepAll(sim))
    expect(ofType(events, 'enemyAttack').every((e) => e.target === 1)).toBe(true)
    expect(ofType(events, 'playerHurt').map((e) => e.id)).toContain(1)
    expect(ofType(events, 'playerHurt').map((e) => e.id)).not.toContain(0)
    expect(sim.slot(0).player.health).toBeGreaterThan(sim.slot(1).player.health)

    // Muere de hambre en el siguiente paso.
    Object.assign(sim.slot(1).player, { hunger: 0, health: 0.001 })
    const died = stepAll(sim)
    expect(ofType(died, 'playerDied')).toEqual([expect.objectContaining({ id: 1 })])
    const dead = sim.slot(1)
    const at = { ...dead.player.pos }
    const after: SimEvent[] = []
    for (let i = 0; i < 240; i++) {
      after.push(...stepAll(sim, { 1: { buttons: Btn.Fwd, actions: i === 0 ? [{ kind: 'eat' }] : [] } }))
    }
    expect(dead.player.pos).toEqual(at)
    expect(dead.appliedSeq).toBe(1)
    expect(ofType(after, 'playerDied')).toHaveLength(0)
    expect(ofType(after, 'playerAte')).toHaveLength(0)
    // El enemigo se va a por el que queda vivo.
    expect(enemy.target).toBe(0)
    expect(ofType(after, 'enemyAttack').every((e) => e.target === 0)).toBe(true)
  })

  it('un jugador desconectado (gone) sale del mundo: ni se mueve, ni lo persiguen, ni recoge, ni cuenta', () => {
    const sim = withPlayers(2)
    sim.teleport(0, spot.x - 6, spot.z, 0, 0)
    sim.teleport(1, spot.x + 2, spot.z, 0, 0)
    sim.setConnection(1, 'gone')
    expect(sim.inWorld().map((s) => s.id)).toEqual([0])
    const gone = sim.slot(1)
    const at = { ...gone.player.pos }
    const hunger = gone.player.hunger
    sim.setPhase(NIGHT)
    sim.enemies.spawnAt(spot.x + 3, spot.z)
    sim.pickups.dropPile('wood', 1, at.x, at.y + 0.5, at.z)
    const events: SimEvent[] = []
    for (let i = 0; i < 120; i++) events.push(...stepAll(sim, { 1: { buttons: Btn.Fwd } }))
    expect(gone.player.pos).toEqual(at)
    expect(gone.player.hunger).toBe(hunger)
    expect(gone.inventory.count('wood')).toBe(0)
    expect(ofType(events, 'enemyAttack').every((e) => e.target === 0)).toBe(true)
    expect(sim.enemies.list.every((e) => e.target === 0)).toBe(true)

    // Al volver sigue donde estaba.
    sim.setConnection(1, 'present')
    for (let i = 0; i < 10; i++) stepAll(sim, { 1: { buttons: Btn.Fwd } })
    expect(gone.player.pos).not.toEqual(at)
  })

  it('serializar, restaurar y seguir da lo mismo que no serializar, con 4 jugadores y uno desconectado', () => {
    const a = withPlayers(4, 3)
    a.slot(2).inventory.add('wood', 20)
    a.slot(2).inventory.add('stone', 10)
    a.slot(3).inventory.add('berry', 4)
    a.slot(3).player.hunger = 40
    const tree = a.world.props.find((p) => p.kind === 'tree')!
    const look = aimAt(a, 1, tree)

    const script = (sim: Simulation, t: number): Record<PlayerId, Command> => {
      if (t === 120) sim.setPhase(NIGHT)
      if (t === 300) sim.setConnection(0, 'gone')
      if (t === 700) sim.setConnection(0, 'present')
      const campfire = sim.slot(2).inventory.slots.indexOf('campfire')
      return {
        0: { buttons: Btn.Fwd | Btn.Sprint, yaw: t * 0.02 },
        1: t < 100 ? { ...look, buttons: Btn.Attack } : { buttons: Btn.Fwd | (t % 60 < 20 ? Btn.Attack : 0), yaw: -t * 0.015 },
        2: {
          buttons: t > 200 ? Btn.Fwd | (t % 90 === 0 ? Btn.Jump : 0) : 0,
          yaw: -1 + t * 0.01,
          actions:
            t === 50 ? [{ kind: 'craft', recipe: 'campfire' }]
            : t === 51 && campfire >= 0 ? [{ kind: 'select', slot: campfire }]
            : t === 60 ? [{ kind: 'place' }]
            : t === 61 ? [{ kind: 'select', slot: 0 }]
            : t % 41 === 0 ? [{ kind: 'swing' }]
            : [],
        },
        3: { buttons: t % 200 < 100 ? Btn.Back : Btn.Left, actions: t % 150 === 0 ? [{ kind: 'eat' }] : [] },
      }
    }

    const SPLIT = 500
    for (let t = 1; t <= SPLIT; t++) stepAll(a, script(a, t))
    expect(tree.alive).toBe(false)
    expect(a.structures.list).toHaveLength(1)
    expect(a.enemies.list.length).toBeGreaterThan(0)
    expect(a.slot(0).connection).toBe('gone')

    const b = Simulation.fromJSON(JSON.parse(JSON.stringify(a.toJSON())), placements)
    expect(JSON.stringify(b.toJSON())).toBe(JSON.stringify(a.toJSON()))
    const seen = new Set<string>()
    const hurt = new Set<PlayerId>()
    for (let t = SPLIT + 1; t <= SPLIT + 900; t++) {
      const eventsA = stepAll(a, script(a, t))
      const eventsB = stepAll(b, script(b, t))
      expect(JSON.stringify(eventsB)).toBe(JSON.stringify(eventsA))
      for (const e of eventsA) {
        seen.add(e.type)
        if (e.type === 'playerHurt') hurt.add(e.id)
      }
    }
    expect([...seen]).toEqual(expect.arrayContaining(['enemySpawn', 'enemyAttack', 'playerHurt', 'playerSwing']))
    expect(hurt.size).toBeGreaterThan(1)
    expect(JSON.stringify(b.toJSON())).toBe(JSON.stringify(a.toJSON()))
    for (const id of [0, 1, 2, 3]) expect(b.slot(id).inventory.slots).toEqual(a.slot(id).inventory.slots)
  })
})

describe('enemigos con varios jugadores', () => {
  const prey = (id: PlayerId, x: number, z: number, alive = true): EnemyPrey => ({ id, pos: { x, z }, alive })

  it('con más jugadores caben más y aparecen antes, hasta un tope', () => {
    expect(enemyCapFor(1, 1)).toBe(enemyCap(1))
    expect(enemyCapFor(1, 3)).toBe(enemyCap(1) + 8)
    expect(enemyCapFor(100, 8)).toBe(24)
    expect(spawnIntervalFor(1)).toBe(5)
    expect(spawnIntervalFor(4)).toBe(2.5)
  })

  it('aparecen por turnos alrededor de cada jugador vivo y lejos de todos', () => {
    const spawns: { x: number; z: number }[] = []
    const enemies = new Enemies([world.grid], mulberry32(5), (e: SimEventData) => {
      if (e.type === 'enemySpawn') spawns.push({ x: e.x, z: e.z })
    })
    const players = [prey(0, spot.x, spot.z), prey(1, spot.x - 50, spot.z + 10), prey(2, spot.x - 30, spot.z - 30, false)]
    for (let i = 0; i < Math.round(60 / STEP); i++) enemies.step(STEP, players, NIGHT, 1)
    // Cuentan los tres (también el muerto), pero solo aparecen alrededor de los vivos.
    expect(spawns.length).toBe(enemyCapFor(1, 3))
    const near = (p: EnemyPrey) => spawns.filter((s) => Math.hypot(s.x - p.pos.x, s.z - p.pos.z) < 45).length
    expect(near(players[0])).toBeGreaterThan(2)
    expect(near(players[1])).toBeGreaterThan(2)
    for (const s of spawns) for (const p of players.slice(0, 2)) expect(Math.hypot(s.x - p.pos.x, s.z - p.pos.z)).toBeGreaterThanOrEqual(ENEMY_SPAWN_MIN - 1e-9)
  })

  it('si no queda nadie vivo no aparecen ni atacan', () => {
    const enemies = new Enemies([world.grid], mulberry32(5))
    const e = enemies.spawnAt(spot.x + 1, spot.z)
    let damage = 0
    for (let i = 0; i < 120; i++) for (const d of enemies.step(STEP, [prey(0, spot.x, spot.z, false)], NIGHT, 1)) damage += d.damage
    expect(damage).toBe(0)
    expect(enemies.list).toEqual([e])
    expect(e.target).toBeNull()
  })

  it('persiguen al más cercano y solo cambian si otro está bastante más cerca', () => {
    const enemies = new Enemies([world.grid], mulberry32(5))
    const e = enemies.spawnAt(spot.x, spot.z)
    const a = prey(0, spot.x - 6, spot.z)
    const b = prey(1, spot.x + 7, spot.z)
    enemies.step(STEP, [a, b], NIGHT, 1)
    expect(e.target).toBe(0)
    // A huye a 10 m y B se pone siempre `closer` metros más cerca, al otro lado.
    const placeB = (closer: number) => {
      a.pos.x = e.pos.x - 10
      b.pos.x = e.pos.x + 10 - closer
    }
    // 2 m más cerca no compensa cambiar.
    for (let i = 0; i < 60; i++) {
      placeB(2)
      enemies.step(STEP, [a, b], NIGHT, 1)
    }
    expect(e.target).toBe(0)
    // 4 m más cerca: cambia en la siguiente reevaluación (como mucho medio segundo).
    for (let i = 0; i < 31; i++) {
      placeB(4)
      enemies.step(STEP, [a, b], NIGHT, 1)
    }
    expect(e.target).toBe(1)
  })

  it('el daño va a quien atacan, sumado por jugador', () => {
    const enemies = new Enemies([world.grid], mulberry32(5))
    const a = prey(0, spot.x - 4, spot.z)
    const b = prey(1, spot.x + 4, spot.z)
    enemies.spawnAt(spot.x - 3, spot.z)
    enemies.spawnAt(spot.x - 4, spot.z + 1)
    enemies.spawnAt(spot.x + 3, spot.z)
    const total = new Map<PlayerId, number>()
    for (let i = 0; i < 120; i++) {
      for (const { playerId, damage } of enemies.step(STEP, [a, b], NIGHT, 1)) total.set(playerId, (total.get(playerId) ?? 0) + damage)
    }
    expect(total.get(0)).toBe(2 * total.get(1)!)
  })
})

describe('objetos del suelo con varios jugadores', () => {
  const setup = () => {
    const pickups = new Pickups([], mulberry32(1))
    pickups.dropPile('wood', 2, spot.x, heightAt(spot.x, spot.z) + 0.5, spot.z)
    for (let i = 0; i < Math.round((PICKUP_DELAY + 1) / STEP); i++) pickups.step(STEP, [])
    const [p] = pickups.list
    expect(p.grounded).toBe(true)
    const collector = (id: PlayerId, dx: number): Collector & { inventory: Inventory } => ({
      id,
      pos: { x: p.pos.x + dx, y: p.pos.y, z: p.pos.z },
      inventory: new Inventory(),
    })
    return { pickups, p, collector }
  }

  it('se desliza hacia el más cercano al que le cabe, y lo recoge él', () => {
    const { pickups, p, collector } = setup()
    const a = collector(0, 1.4)
    const b = collector(1, -1.1)
    let result = pickups.step(STEP, [a, b])
    expect(p.claimedBy).toBe(1)
    for (let i = 0; i < 30 && pickups.list.length; i++) result = pickups.step(STEP, [a, b])
    expect(pickups.list).toHaveLength(0)
    expect(b.inventory.count('wood')).toBe(2)
    expect(a.inventory.count('wood')).toBe(0)
    expect(result[1].collected).toBe(2)
  })

  it('al que no le cabe ni lo atrae ni lo recoge; se va al otro', () => {
    const { pickups, collector } = setup()
    const a = collector(0, 1.4)
    // Las 27 casillas no se llenan con los objetos que hay: un inventario de una casilla, ocupada.
    const b = { ...collector(1, -0.5), inventory: new Inventory(1) }
    b.inventory.add('stone', 1)
    const first = pickups.step(STEP, [a, b])
    expect(first[1].full).toBe(true)
    for (let i = 0; i < 30 && pickups.list.length; i++) pickups.step(STEP, [a, b])
    expect(a.inventory.count('wood')).toBe(2)
  })

  it('sigue hacia quien lo atrajo aunque otro se acerque un poco más', () => {
    const { pickups, p, collector } = setup()
    const a = collector(0, 1.5)
    const b = collector(1, -3)
    pickups.step(STEP, [a, b])
    expect(p.claimedBy).toBe(0)
    b.pos.x = p.pos.x - 1.3
    const before = p.pos.x
    pickups.step(STEP, [a, b])
    expect(p.claimedBy).toBe(0)
    expect(p.pos.x).toBeGreaterThan(before)
  })

  it('si dos lo tienen encima a la misma distancia, lo recoge el de menor id', () => {
    const { pickups, collector } = setup()
    const a = collector(1, 0.5)
    const b = collector(3, -0.5)
    const result = pickups.step(STEP, [a, b])
    expect(result.map((r) => r.collected)).toEqual([2, 0])
    expect(a.inventory.count('wood')).toBe(2)
  })
})

describe('objetivo que manda el cliente (Move.aim)', () => {
  const swing = (sim: Simulation, look: Command) => ofType(stepAll(sim, { 0: { ...look, actions: [{ kind: 'swing' }] } }), 'playerSwing')[0]

  it('se acepta si es creíble aunque el rayo no lo toque', () => {
    const sim = withPlayers(1)
    const tree = sim.world.props.find((p) => p.kind === 'tree')!
    const look = aimAt(sim, 0, tree)
    // Mirando 30° a un lado el rayo ya no toca el tronco, pero sigue dentro del cono.
    expect(swing(sim, { yaw: look.yaw + Math.PI / 6, pitch: look.pitch, aim: { kind: 'prop', id: tree.id } }).target).toEqual({ kind: 'prop', id: tree.id })
    expect(tree.hp).toBe(tree.maxHp - 1)
  })

  it('null es golpe al aire aunque haya algo delante', () => {
    const sim = withPlayers(1)
    const tree = sim.world.props.find((p) => p.kind === 'tree')!
    const look = aimAt(sim, 0, tree)
    expect(swing(sim, { ...look, aim: null }).target).toBeNull()
    expect(tree.hp).toBe(tree.maxHp)
  })

  it('se rechaza lejos, a la espalda, roto o inexistente', () => {
    const sim = withPlayers(1)
    const tree = sim.world.props.find((p) => p.kind === 'tree')!
    const look = aimAt(sim, 0, tree)
    const far = sim.world.props.find((p) => Math.hypot(p.x - tree.x, p.z - tree.z) > 15)!
    expect(swing(sim, { ...look, aim: { kind: 'prop', id: far.id } }).target).toBeNull()
    for (let i = 0; i < 30; i++) stepAll(sim, { 0: look })
    expect(swing(sim, { yaw: look.yaw + Math.PI, pitch: 0, aim: { kind: 'prop', id: tree.id } }).target).toBeNull()
    for (let i = 0; i < 30; i++) stepAll(sim, { 0: look })
    expect(swing(sim, { ...look, aim: { kind: 'enemy', id: 99 } }).target).toBeNull()
    for (let i = 0; i < 30; i++) stepAll(sim, { 0: look })
    tree.alive = false
    expect(swing(sim, { ...look, aim: { kind: 'prop', id: tree.id } }).target).toBeNull()
    expect(tree.hp).toBe(tree.maxHp)
  })

  it('a un enemigo con más margen: el cliente lo ve en el pasado', () => {
    const sim = withPlayers(1)
    sim.setPhase(NIGHT)
    sim.teleport(0, spot.x, spot.z, 0, 0)
    stepAll(sim, { 0: {} })
    const enemy = sim.enemies.list[0] ?? sim.enemies.spawnAt(spot.x, spot.z - 3)
    // Delante (−Z) y algo más lejos que el alcance: con el margen de 1,5 m vale.
    Object.assign(enemy.pos, { x: spot.x + 0.5, z: spot.z - 5 })
    Object.assign(enemy.prev, enemy.pos)
    const event = swing(sim, { yaw: 0, pitch: 0, aim: { kind: 'enemy', id: enemy.id } })
    expect(event.target).toEqual({ kind: 'enemy', id: enemy.id })
  })
})
