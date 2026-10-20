import { describe, expect, it } from 'vitest'
import { createPropWorld } from './props'
import { heightAt, WATER_LEVEL } from './world/terrain'
import { Campfires, campfireSpot } from './campfires'
import { resolveCircle } from './collision'
import { CAMPFIRE_PLACE_DISTANCE, CAMPFIRE_RADIUS, PLAYER_RADIUS } from './constants'
import type { SimEventData } from './events'

const world = createPropWorld()

/** Un punto en hierba sin props alrededor, para colocar fogatas sin depender del azar. */
function clearGround() {
  for (let x = -60; x <= 60; x += 3) {
    for (let z = -60; z <= 60; z += 3) {
      const spot = campfireSpot({ x, z }, 0, [world.grid])
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
    const ahead = campfireSpot(pos, 0, [world.grid])
    expect(ahead.x).toBeCloseTo(pos.x)
    expect(ahead.z).toBeCloseTo(pos.z - CAMPFIRE_PLACE_DISTANCE)
    expect(ahead.y).toBeCloseTo(heightAt(ahead.x, ahead.z))
    const left = campfireSpot(pos, Math.PI / 2, [world.grid])
    expect(left.x).toBeCloseTo(pos.x - CAMPFIRE_PLACE_DISTANCE)
    expect(left.z).toBeCloseTo(pos.z)
  })

  it('no se puede poner en el agua ni encima de un árbol vivo', () => {
    let x = 0
    while (heightAt(x, 0) > WATER_LEVEL - 1) x += 2
    expect(campfireSpot({ x, z: CAMPFIRE_PLACE_DISTANCE }, 0, [world.grid]).valid).toBe(false)

    const tree = world.props.find(
      (t) => t.kind === 'tree' && world.props.every((o) => o === t || Math.hypot(o.x - t.x, o.z - t.z) > o.radius + 1),
    )!
    const onTree = { x: tree.x, z: tree.z + CAMPFIRE_PLACE_DISTANCE }
    expect(campfireSpot(onTree, 0, [world.grid]).valid).toBe(false)
    tree.alive = false
    try {
      expect(campfireSpot(onTree, 0, [world.grid]).x).toBeCloseTo(tree.x)
      // Sin el árbol solo cuenta el suelo (la pendiente en ese punto ya era válida para el árbol).
      expect(campfireSpot(onTree, 0, [world.grid]).valid).toBe(true)
    } finally {
      tree.alive = true
    }
  })

  it('una fogata colocada bloquea el paso y otra fogata en el mismo sitio', () => {
    const fires = new Campfires()
    const pos = clearGround()
    const spot = campfireSpot(pos, 0, [world.grid, fires.grid])
    expect(fires.place(spot)).toBe(fires.list[0])
    expect(fires.list).toHaveLength(1)
    expect(fires.place(campfireSpot(pos, 0, [world.grid, fires.grid]))).toBeNull()
    expect(campfireSpot(pos, 0, [world.grid, fires.grid]).valid).toBe(false)

    const walker = { x: spot.x + 0.1, z: spot.z }
    expect(resolveCircle(walker, PLAYER_RADIUS, fires.grid)).toBe(true)
    expect(Math.hypot(walker.x - spot.x, walker.z - spot.z)).toBeCloseTo(PLAYER_RADIUS + CAMPFIRE_RADIUS)
  })

  it('cada fogata tiene id y giro propios, guardados en el dato', () => {
    const fires = new Campfires()
    fires.place({ x: 0, y: 5, z: 0, valid: true })
    fires.place({ x: 5, y: 5, z: 0, valid: true })
    expect(fires.list.map((f) => f.id)).toEqual([0, 1])
    expect(fires.list[1].rotY).toBeCloseTo(1.3)
    fires.clear()
    fires.place({ x: 0, y: 5, z: 0, valid: true })
    expect(fires.list[0].id).toBe(0)
  })

  it('colocarla emite campfirePlaced con quién la puso', () => {
    const events: SimEventData[] = []
    const fires = new Campfires((e) => void events.push(e))
    const fire = fires.place({ x: 1, y: 5, z: 2, valid: true }, 3)!
    fires.place({ x: 9, y: 5, z: 9, valid: false }, 3)
    expect(events).toEqual([{ type: 'campfirePlaced', id: 0, x: 1, y: 5, z: 2, rotY: fire.rotY, by: 3 }])
  })

  it('clear quita todas las fogatas y sus colliders', () => {
    const fires = new Campfires()
    const pos = clearGround()
    fires.place(campfireSpot(pos, 0, [world.grid, fires.grid]))
    fires.clear()
    expect(fires.list).toHaveLength(0)
    expect(campfireSpot(pos, 0, [world.grid, fires.grid]).valid).toBe(true)
  })
})
