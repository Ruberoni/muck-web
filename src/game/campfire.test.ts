import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createProps } from '../world/props'
import { heightAt, WATER_LEVEL } from '../world/terrain'
import { Campfires, campfireSpot } from './campfire'
import { resolveCircle } from './collision'
import { CAMPFIRE_LIGHTS, CAMPFIRE_PLACE_DISTANCE, CAMPFIRE_RADIUS, PLAYER_RADIUS } from './constants'

const world = createProps()

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
    const fires = new Campfires(new THREE.Scene())
    const pos = clearGround()
    const spot = campfireSpot(pos, 0, [world.grid, fires.grid])
    expect(fires.place(spot)).toBe(true)
    expect(fires.list).toHaveLength(1)
    expect(campfireSpot(pos, 0, [world.grid, fires.grid]).valid).toBe(false)

    const walker = { x: spot.x + 0.1, z: spot.z }
    expect(resolveCircle(walker, PLAYER_RADIUS, fires.grid)).toBe(true)
    expect(Math.hypot(walker.x - spot.x, walker.z - spot.z)).toBeCloseTo(PLAYER_RADIUS + CAMPFIRE_RADIUS)
  })

  it('cada fogata tiene id y giro propios, guardados en el dato', () => {
    const fires = new Campfires(new THREE.Scene())
    fires.place({ x: 0, y: 5, z: 0, valid: true })
    fires.place({ x: 5, y: 5, z: 0, valid: true })
    expect(fires.list.map((f) => f.id)).toEqual([0, 1])
    expect(fires.list[1].rotY).toBeCloseTo(1.3)
    expect(fires.list[1].mesh.rotation.y).toBe(fires.list[1].rotY)
    fires.clear()
    fires.place({ x: 0, y: 5, z: 0, valid: true })
    expect(fires.list[0].id).toBe(0)
  })

  it('clear quita todas las fogatas y sus colliders', () => {
    const scene = new THREE.Scene()
    const fires = new Campfires(scene)
    const pos = clearGround()
    fires.place(campfireSpot(pos, 0, [world.grid, fires.grid]))
    fires.clear()
    expect(fires.list).toHaveLength(0)
    expect(fires.group.children).toHaveLength(0)
    expect(campfireSpot(pos, 0, [world.grid, fires.grid]).valid).toBe(true)
  })
})

describe('luz de las fogatas', () => {
  const lightsOf = (scene: THREE.Scene) => scene.children.filter((c): c is THREE.PointLight => c instanceof THREE.PointLight)

  it('el número de luces es fijo e iluminan las fogatas más cercanas', () => {
    const scene = new THREE.Scene()
    const fires = new Campfires(scene)
    const lights = lightsOf(scene)
    expect(lights).toHaveLength(CAMPFIRE_LIGHTS)
    fires.update(0, 0.8, { x: 0, z: 0 })
    expect(lights.every((l) => l.intensity === 0)).toBe(true)

    const base = clearGround()
    for (let i = 0; i <= CAMPFIRE_LIGHTS; i++) {
      fires.place({ x: base.x + i * 3, y: 5, z: base.z, valid: true })
    }
    fires.update(0, 0.8, { x: base.x, z: base.z })
    expect(lightsOf(scene)).toHaveLength(CAMPFIRE_LIGHTS)
    expect(lights.every((l) => l.intensity > 0)).toBe(true)
    // La más lejana se queda sin luz.
    const farthest = base.x + CAMPFIRE_LIGHTS * 3
    expect(lights.some((l) => l.position.x === farthest)).toBe(false)
  })

  it('de noche ilumina bastante más que a mediodía', () => {
    const scene = new THREE.Scene()
    const fires = new Campfires(scene)
    const [light] = lightsOf(scene)
    fires.place({ x: 0, y: 5, z: 0, valid: true })
    fires.update(0, 0.325, { x: 0, z: 0 })
    const noon = light.intensity
    fires.update(0, 0.825, { x: 0, z: 0 })
    const midnight = light.intensity
    expect(midnight).toBeGreaterThan(noon * 3)
  })
})
