import { describe, expect, it } from 'vitest'
import { Btn } from '../sim/commands'
import type { SimEvent } from '../sim/events'
import { LocalSession } from './session'
import { BOT_RECIPES, botMove, botStep } from './bot'

const ofType = <T extends SimEvent['type']>(events: readonly SimEvent[], type: T) =>
  events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type)

/** Un bot solo en la isla durante `seconds` de juego; devuelve su sesión y lo que ha pasado. */
function play(seconds: number) {
  const session = new LocalSession(1)
  const events: SimEvent[] = []
  for (let tick = 1; tick <= seconds * 60; tick++) {
    const { actions, ...move } = botStep(tick, 1, session.slot)
    events.push(...session.step(move, actions))
  }
  return { session, events }
}

describe('bot', () => {
  it('en tres minutos tala (parándose: no le basta con golpear al pasar), recoge y se fabrica el hacha y el pico de madera', () => {
    const { session, events } = play(180)
    expect(ofType(events, 'propDestroyed').length).toBeGreaterThanOrEqual(2)
    // Golpes que botMove no daría: en esos ticks solo andaría.
    expect(ofType(events, 'propHit').filter((e) => !(botMove(e.tick, 1).buttons & Btn.Attack)).length).toBeGreaterThan(0)
    expect(ofType(events, 'playerCrafted').map((e) => e.recipe)).toEqual([...BOT_RECIPES])
    expect(session.slot.inventory.toJSON()).toMatchObject({ wood_axe: 1, wood_pickaxe: 1 })
  })

  it('delante de algo que puede romper se para y golpea con su mejor herramienta; si no puede, sigue andando', () => {
    const session = new LocalSession(1)
    const { slot, sim } = session
    const tree = sim.world.props.find((p) => p.kind === 'tree')!
    const rock = sim.world.props.find((p) => p.kind === 'rock')!
    const walking = botMove(10, 1)

    // A mano el árbol cae y la roca no.
    slot.target = tree
    expect(botStep(10, 1, slot)).toEqual({ buttons: Btn.Attack, yaw: walking.yaw, pitch: walking.pitch, actions: [] })
    slot.target = rock
    expect(botStep(10, 1, slot)).toEqual({ ...walking, actions: [] })
    // Los arbustos los deja, y lo que ya está roto también.
    slot.target = sim.world.props.find((p) => p.kind === 'bush')!
    expect(botStep(10, 1, slot)).toEqual({ ...walking, actions: [] })
    slot.target = { ...tree, alive: false }
    expect(botStep(10, 1, slot)).toEqual({ ...walking, actions: [] })
    slot.target = rock

    // Con el pico en la hotbar, lo saca para la roca; con el hacha también, la saca para el árbol.
    slot.inventory.add('stone', 1)
    slot.inventory.add('wood_pickaxe', 1)
    slot.inventory.add('wood_axe', 1)
    slot.inventory.add('stone_axe', 1)
    expect(botStep(10, 1, slot)).toEqual({ buttons: Btn.Attack, yaw: walking.yaw, pitch: walking.pitch, actions: [{ kind: 'select', slot: 1 }] })
    slot.target = tree
    expect(botStep(10, 1, slot).actions).toEqual([{ kind: 'select', slot: 3 }])
    slot.inventory.select(3)
    expect(botStep(10, 1, slot).actions).toEqual([])
    // Ante una mena de hierro el pico de madera no sirve: ni lo saca ni se para.
    slot.target = sim.world.props.find((p) => p.kind === 'iron_ore')!
    expect(botStep(10, 1, slot)).toEqual({ ...walking, actions: [] })
  })

  it('solo fabrica lo que le falta y puede pagar, una cosa por tick', () => {
    const { slot } = new LocalSession(1)
    expect(botStep(10, 1, slot).actions).toEqual([])
    slot.inventory.add('wood', 10)
    expect(botStep(10, 1, slot).actions).toEqual([{ kind: 'craft', recipe: 'wood_axe' }])
    slot.inventory.add('wood_axe', 1)
    expect(botStep(10, 1, slot).actions).toEqual([{ kind: 'craft', recipe: 'wood_pickaxe' }])
    slot.inventory.add('wood_pickaxe', 1)
    expect(botStep(10, 1, slot).actions).toEqual([])
  })
})
