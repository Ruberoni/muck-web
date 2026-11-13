import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { SpatialGrid, type Collider } from '../sim/collision'
import { DEFAULT_ISLAND } from '../sim/world/island'
import { WATER_LEVEL } from '../sim/world/terrain'
import { MenuStage, NARROW_WIDTH, ORBIT_RADIUS, orbitCamera, poseYaw, stageScreenX, stageSpot, yawTowards } from './menuStage'
import type { CharacterRig } from './CharacterRig'

/** Una isla redonda de mentira: tierra plana (2 m) hasta 30 m del centro y mar más allá. */
const disc = {
  heightAt: (x: number, z: number) => (Math.hypot(x, z) < 30 ? 2 : -3),
  slopeAt: () => 0,
}

describe('yawTowards', () => {
  it('sigue la convención del jugador: adelante es (-sin(yaw), -cos(yaw))', () => {
    for (const [tx, tz] of [
      [0, -1],
      [1, 0],
      [-3, 4],
    ]) {
      const yaw = yawTowards(0, 0, tx, tz)
      const len = Math.hypot(tx, tz)
      expect(-Math.sin(yaw)).toBeCloseTo(tx / len)
      expect(-Math.cos(yaw)).toBeCloseTo(tz / len)
    }
  })
})

describe('stageSpot', () => {
  it('pone al personaje en tierra, cerca de la orilla y mirando al mar', () => {
    const spot = stageSpot(disc, [], { x: 0, z: 0 })
    const r = Math.hypot(spot.x, spot.z)
    expect(spot.y).toBe(2)
    expect(r).toBeGreaterThan(20)
    expect(r).toBeLessThan(30)
    // El mar queda hacia fuera de la isla.
    expect(-Math.sin(spot.seaYaw) * spot.x - Math.cos(spot.seaYaw) * spot.z).toBeGreaterThan(0)
  })

  it('evita los árboles y rocas en el círculo de la cámara', () => {
    const grid = new SpatialGrid<Collider>(8)
    const free = stageSpot(disc, [], { x: 0, z: 0 })
    grid.insert({ x: free.x, z: free.z, radius: 1, alive: true })
    const spot = stageSpot(disc, [new SpatialGrid<Collider>(8), grid], { x: 0, z: 0 })
    expect(Math.hypot(spot.x - free.x, spot.z - free.z) - 1).toBeGreaterThanOrEqual(ORBIT_RADIUS + 1.5)
  })

  it('sin orilla a la vista se queda en el spawn', () => {
    const land = { heightAt: () => 2, slopeAt: () => 0 }
    expect(stageSpot(land, [], { x: 5, z: 7 })).toEqual({ x: 5, y: 2, z: 7, seaYaw: 0 })
  })

  it('en la isla de siempre encuentra un sitio en tierra', () => {
    const spot = stageSpot(DEFAULT_ISLAND, [], { x: 0, z: 0 })
    expect(DEFAULT_ISLAND.heightAt(spot.x, spot.z)).toBeGreaterThan(WATER_LEVEL)
  })
})

describe('stageScreenX', () => {
  it('centra al personaje en lo que deja el tablón, y en el centro en una ventana estrecha', () => {
    // 1280 px: el tablón llega a 496 px, el hueco va de 496 a 1280 y su centro es 888 px.
    expect(stageScreenX(1280)).toBeCloseTo((888 / 1280) * 2 - 1)
    expect(stageScreenX(NARROW_WIDTH)).toBe(0)
    expect(stageScreenX(NARROW_WIDTH + 1)).toBeGreaterThan(0)
  })
})

describe('orbitCamera', () => {
  const spot = { x: 10, y: 2, z: -4, seaYaw: 0 }

  it('gira a la distancia de la órbita y deja al personaje donde se pide en la pantalla', () => {
    const camera = new THREE.PerspectiveCamera(70, 16 / 10, 0.1, 600)
    camera.rotation.order = 'YXZ'
    for (const screenX of [0, 0.4]) {
      for (const angle of [0, 1, 4]) {
        const view = orbitCamera(spot, angle, () => 0, camera.fov, camera.aspect, screenX)
        expect(Math.hypot(view.x - spot.x, view.z - spot.z)).toBeCloseTo(ORBIT_RADIUS)
        camera.position.set(view.x, view.y, view.z)
        camera.rotation.set(view.pitch, view.yaw, 0)
        camera.updateMatrixWorld()
        const onScreen = new THREE.Vector3(spot.x, spot.y + 1, spot.z).project(camera)
        expect(onScreen.x).toBeCloseTo(screenX, 1)
        expect(Math.abs(onScreen.y)).toBeLessThan(0.5)
      }
    }
  })

  it('nunca baja del suelo ni del agua', () => {
    expect(orbitCamera(spot, 0, () => 9, 70, 1, 0).y).toBeGreaterThan(9)
    expect(orbitCamera({ ...spot, y: -2 }, 0, () => -5, 70, 1, 0).y).toBeGreaterThan(WATER_LEVEL)
  })
})

describe('poseYaw', () => {
  it('mira a tres cuartos de la cámara, hacia el lado del mar', () => {
    const spot = { x: 0, y: 0, z: 0, seaYaw: yawTowards(0, 0, 1, 0) }
    const toCamera = yawTowards(0, 0, 0, -5)
    const yaw = poseYaw(spot, 0, -5)
    expect(Math.abs(yaw - toCamera)).toBeGreaterThan(0.2)
    expect(Math.abs(yaw - toCamera)).toBeLessThan(0.8)
    // Girado hacia el mar (+x): adelante tiene x positiva.
    expect(-Math.sin(yaw)).toBeGreaterThan(0)
  })
})

describe('MenuStage', () => {
  it('no descarga el personaje hasta que se ve, y lo anima con su propio dt', async () => {
    const updates: number[] = []
    const rig = { object: new THREE.Group(), update: (dt: number) => updates.push(dt) } as unknown as CharacterRig
    let loads = 0
    const stage = new MenuStage(async () => (loads++, rig), () => 0)
    const camera = new THREE.PerspectiveCamera(70, 1.6, 0.1, 600)
    expect(stage.place(camera, 0.016, 1280)).toBe(false)
    stage.setIsland(disc, [], { x: 0, z: 0 })
    expect(loads).toBe(0)
    expect(stage.place(camera, 0.016, 1280)).toBe(true)
    await Promise.resolve()
    stage.place(camera, 0.02, 1280)
    expect(loads).toBe(1)
    expect(stage.group.children).toContain(rig.object)
    expect(updates).toEqual([0.02])
    expect(stage.group.visible).toBe(true)
    stage.place(camera, 0.02, NARROW_WIDTH)
    expect(stage.group.visible).toBe(false)
    // Tapado por un tablón más ancho: no se ve ni se anima.
    stage.place(camera, 0.02, 1280, false)
    expect(stage.group.visible).toBe(false)
    expect(updates).toEqual([0.02])
  })

  const fakeRig = () => ({ object: new THREE.Group(), update: () => {} }) as unknown as CharacterRig

  it('recalcula el sitio solo cuando cambia la isla', () => {
    const stage = new MenuStage(async () => fakeRig(), () => 0)
    stage.setIsland(disc, [], { x: 0, z: 0 })
    const first = stage.center
    stage.setIsland(disc, [], { x: 50, z: 50 })
    expect(stage.center).toBe(first)
    const shifted = { heightAt: (x: number, z: number) => disc.heightAt(x - 100, z), slopeAt: () => 0 }
    stage.setIsland(shifted, [], { x: 100, z: 0 })
    expect(stage.center!.x).toBeGreaterThan(60)
  })

  it('con el movimiento reducido la cámara no gira', () => {
    let reduced = true
    const stage = new MenuStage(async () => fakeRig(), () => 0, () => reduced)
    stage.setIsland(disc, [], { x: 0, z: 0 })
    const camera = new THREE.PerspectiveCamera(70, 1.6, 0.1, 600)
    stage.place(camera, 0.1, 1280)
    const still = camera.position.clone()
    stage.place(camera, 0.1, 1280)
    expect(camera.position.distanceTo(still)).toBe(0)
    reduced = false
    stage.place(camera, 0.1, 1280)
    expect(camera.position.distanceTo(still)).toBeGreaterThan(0.01)
  })

  it('tras un fallo al descargar el personaje vuelve a intentarlo al rato, no en cada frame', async () => {
    vi.useFakeTimers()
    try {
      let loads = 0
      const stage = new MenuStage(async () => {
        loads++
        throw new Error('sin red')
      }, () => 0)
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      stage.setIsland(disc, [], { x: 0, z: 0 })
      const camera = new THREE.PerspectiveCamera(70, 1.6, 0.1, 600)
      stage.place(camera, 0.016, 1280)
      await vi.advanceTimersByTimeAsync(0)
      for (let i = 0; i < 10; i++) stage.place(camera, 0.016, 1280)
      expect(loads).toBe(1)
      await vi.advanceTimersByTimeAsync(10_000)
      stage.place(camera, 0.016, 1280)
      expect(loads).toBe(2)
      warn.mockRestore()
    } finally {
      vi.useRealTimers()
    }
  })
})
