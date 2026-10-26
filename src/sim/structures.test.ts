import { describe, expect, it } from 'vitest'
import { createPropWorld } from './props'
import { heightAt, WATER_LEVEL } from './world/terrain'
import { PLACEABLE_DEFS, placeableOf, STRUCTURE_DEFS, STRUCTURE_KINDS, Structures, structureSpot } from './structures'
import { resolveCircle } from './collision'
import { PLACE_DISTANCE, PLAYER_RADIUS } from './constants'
import type { SimEventData } from './events'
import type { ItemId } from './inventory'

const world = createPropWorld()
const RADIUS = STRUCTURE_DEFS.campfire.radius

/** Un punto en hierba sin props alrededor, para colocar fogatas sin depender del azar. */
function clearGround() {
  for (let x = -60; x <= 60; x += 3) {
    for (let z = -60; z <= 60; z += 3) {
      const spot = structureSpot({ x, z }, 0, RADIUS, [world.grid])
      const free = world.props.every((p) => Math.hypot(p.x - x, p.z - z) > p.radius + 4)
      if (spot.valid && free && heightAt(x, z) > 2) return { x, z }
    }
  }
  throw new Error('sin suelo libre')
}

describe('colocar fogatas', () => {
  it('cae por delante del jugador, a ras de suelo', () => {
    const pos = clearGround()
    // yaw 0 mira hacia -z; yaw π/2, hacia -x.
    const ahead = structureSpot(pos, 0, RADIUS, [world.grid])
    expect(ahead.x).toBeCloseTo(pos.x)
    expect(ahead.z).toBeCloseTo(pos.z - PLACE_DISTANCE)
    expect(ahead.y).toBeCloseTo(heightAt(ahead.x, ahead.z))
    const left = structureSpot(pos, Math.PI / 2, RADIUS, [world.grid])
    expect(left.x).toBeCloseTo(pos.x - PLACE_DISTANCE)
    expect(left.z).toBeCloseTo(pos.z)
  })

  it('no se puede poner en el agua ni encima de un árbol vivo', () => {
    let x = 0
    while (heightAt(x, 0) > WATER_LEVEL - 1) x += 2
    expect(structureSpot({ x, z: PLACE_DISTANCE }, 0, RADIUS, [world.grid]).valid).toBe(false)

    const tree = world.props.find(
      (t) => t.kind === 'tree' && world.props.every((o) => o === t || Math.hypot(o.x - t.x, o.z - t.z) > o.radius + 1),
    )!
    const onTree = { x: tree.x, z: tree.z + PLACE_DISTANCE }
    expect(structureSpot(onTree, 0, RADIUS, [world.grid]).valid).toBe(false)
    tree.alive = false
    try {
      expect(structureSpot(onTree, 0, RADIUS, [world.grid]).x).toBeCloseTo(tree.x)
      // Sin el árbol solo cuenta el suelo (la pendiente en ese punto ya era válida para el árbol).
      expect(structureSpot(onTree, 0, RADIUS, [world.grid]).valid).toBe(true)
    } finally {
      tree.alive = true
    }
  })

  it('una fogata colocada bloquea el paso y otra fogata en el mismo sitio', () => {
    const fires = new Structures()
    const pos = clearGround()
    const spot = structureSpot(pos, 0, RADIUS, [world.grid, fires.grid])
    expect(fires.place(spot, 'campfire')).toBe(fires.list[0])
    expect(fires.list).toHaveLength(1)
    expect(fires.place(structureSpot(pos, 0, RADIUS, [world.grid, fires.grid]), 'campfire')).toBeNull()
    expect(structureSpot(pos, 0, RADIUS, [world.grid, fires.grid]).valid).toBe(false)

    const walker = { x: spot.x + 0.1, z: spot.z }
    expect(resolveCircle(walker, PLAYER_RADIUS, fires.grid)).toBe(true)
    expect(Math.hypot(walker.x - spot.x, walker.z - spot.z)).toBeCloseTo(PLAYER_RADIUS + RADIUS)
  })

  it('cada fogata tiene id y giro propios, guardados en el dato', () => {
    const fires = new Structures()
    fires.place({ x: 0, y: 5, z: 0, valid: true }, 'campfire')
    fires.place({ x: 5, y: 5, z: 0, valid: true }, 'campfire')
    expect(fires.list.map((f) => f.id)).toEqual([0, 1])
    expect(fires.list[1].rotY).toBeCloseTo(1.3)
    fires.clear()
    fires.place({ x: 0, y: 5, z: 0, valid: true }, 'campfire')
    expect(fires.list[0].id).toBe(0)
  })

  it('colocarla emite structurePlaced con el tipo y quién la puso', () => {
    const events: SimEventData[] = []
    const fires = new Structures((e) => void events.push(e))
    const fire = fires.place({ x: 1, y: 5, z: 2, valid: true }, 'campfire', 3)!
    fires.place({ x: 9, y: 5, z: 9, valid: false }, 'campfire', 3)
    expect(events).toEqual([{ type: 'structurePlaced', id: 0, kind: 'campfire', x: 1, y: 5, z: 2, rotY: fire.rotY, by: 3 }])
  })

  it('clear quita todas las fogatas y sus colliders', () => {
    const fires = new Structures()
    const pos = clearGround()
    fires.place(structureSpot(pos, 0, RADIUS, [world.grid, fires.grid]), 'campfire')
    fires.clear()
    expect(fires.list).toHaveLength(0)
    expect(structureSpot(pos, 0, RADIUS, [world.grid, fires.grid]).valid).toBe(true)
  })
})

describe('estructuras en general', () => {
  it('cada tipo sale de un objeto colocable con su radio, y solo esos objetos se colocan', () => {
    for (const kind of STRUCTURE_KINDS) {
      const { item, radius } = STRUCTURE_DEFS[kind]
      expect(PLACEABLE_DEFS[item]).toEqual({ kind, radius })
      expect(placeableOf(item)).toEqual({ kind, radius })
    }
    expect(placeableOf('campfire')).toEqual({ kind: 'campfire', radius: 0.6 })
    expect(placeableOf('wood')).toBeNull()
    expect(placeableOf(null)).toBeNull()
    expect(placeableOf('constructor' as ItemId)).toBeNull()
  })

  it('el sitio libre depende del radio: una más ancha choca donde una estrecha cabe', () => {
    const fires = new Structures()
    const pos = clearGround()
    fires.place({ x: pos.x, y: heightAt(pos.x, pos.z), z: pos.z - PLACE_DISTANCE - 1.4, valid: true }, 'campfire')
    // Su centro queda a 1,4 m de la fogata, que mide 0,6: cabe con radio 0,7 y no con 0,9.
    expect(structureSpot(pos, 0, 0.7, [world.grid, fires.grid]).valid).toBe(true)
    expect(structureSpot(pos, 0, 0.9, [world.grid, fires.grid]).valid).toBe(false)
  })

  it('guardar y cargar conserva tipo, giro y colisión, y sigue numerando donde iba', () => {
    const a = new Structures()
    a.place({ x: 0, y: 5, z: 0, valid: true }, 'campfire')
    a.place({ x: 6, y: 5, z: 0, valid: true }, 'campfire')
    const b = new Structures()
    b.load(JSON.parse(JSON.stringify(a.save())))
    expect(b.save()).toEqual(a.save())
    const walker = { x: 6.1, z: 0 }
    expect(resolveCircle(walker, PLAYER_RADIUS, b.grid)).toBe(true)
    expect(b.place({ x: 12, y: 5, z: 0, valid: true }, 'campfire')!.id).toBe(2)
  })

  it('add (el espejo del cliente) añade con el radio de su tipo, no repite ids y sigue numerando', () => {
    const mirror = new Structures()
    mirror.add({ id: 4, kind: 'campfire', x: 1, y: 5, z: 2, rotY: 0.3 })
    mirror.add({ id: 4, kind: 'campfire', x: 1, y: 5, z: 2, rotY: 0.3 })
    expect(mirror.list).toEqual([{ id: 4, kind: 'campfire', x: 1, y: 5, z: 2, rotY: 0.3, radius: RADIUS, alive: true }])
    expect(mirror.save().nextId).toBe(5)
    expect(resolveCircle({ x: 1.1, z: 2 }, PLAYER_RADIUS, mirror.grid)).toBe(true)
  })
})
