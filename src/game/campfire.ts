import * as THREE from 'three'
import { sunDirection } from '../world/daycycle'
import { MAX_SLOPE, slopeAt } from '../world/props'
import { heightAt, WATER_LEVEL } from '../world/terrain'
import { SpatialGrid, type Collider } from './collision'
import {
  CAMPFIRE_LIGHT_DISTANCE,
  CAMPFIRE_LIGHT_INTENSITY,
  CAMPFIRE_LIGHTS,
  CAMPFIRE_PLACE_DISTANCE,
  CAMPFIRE_RADIUS,
} from './constants'

const LIGHT_HEIGHT = 0.8
// De día la fogata casi no se nota: a pleno sol la luz baja a esta fracción.
const DAY_LIGHT_FACTOR = 0.1
const MIN_GROUND = WATER_LEVEL + 0.2

const logGeometry = new THREE.CylinderGeometry(0.07, 0.08, 0.9, 5)
const stoneGeometry = new THREE.IcosahedronGeometry(0.14, 0)
const outerFlameGeometry = new THREE.ConeGeometry(0.28, 0.75, 5).translate(0, 0.375, 0)
const innerFlameGeometry = new THREE.ConeGeometry(0.15, 0.45, 5).translate(0, 0.225, 0)

const logMaterial = new THREE.MeshStandardMaterial({ color: '#6b4426', flatShading: true })
const stoneMaterial = new THREE.MeshStandardMaterial({ color: '#8a877b', flatShading: true })
// Las llamas no dependen de la luz: de noche se ven brillantes.
const outerFlameMaterial = new THREE.MeshBasicMaterial({ color: '#ff7a1f' })
const innerFlameMaterial = new THREE.MeshBasicMaterial({ color: '#ffd23f' })

interface Materials {
  log: THREE.Material
  stone: THREE.Material
  outerFlame: THREE.Material
  innerFlame: THREE.Material
}

/** Modelo low-poly: anillo de piedras, troncos en tipi y dos conos de llama. */
function buildCampfire(m: Materials, shadows: boolean) {
  const root = new THREE.Group()
  const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, cast = shadows) => {
    const node = new THREE.Mesh(geometry, material)
    node.castShadow = cast
    node.receiveShadow = shadows
    return node
  }
  for (let i = 0; i < 7; i++) {
    const angle = (i / 7) * Math.PI * 2
    const stone = mesh(stoneGeometry, m.stone)
    stone.position.set(Math.cos(angle) * 0.46, 0.04, Math.sin(angle) * 0.46)
    stone.rotation.set(angle, angle * 2, 0)
    root.add(stone)
  }
  for (let i = 0; i < 4; i++) {
    // Cada tronco sale de fuera y se apoya en el centro.
    const pivot = new THREE.Group()
    pivot.rotation.y = (i / 4) * Math.PI * 2 + 0.4
    const log = mesh(logGeometry, m.log)
    log.position.set(0.18, 0.3, 0)
    log.rotation.z = 0.65
    pivot.add(log)
    root.add(pivot)
  }
  const flame = new THREE.Group()
  flame.add(mesh(outerFlameGeometry, m.outerFlame, false), mesh(innerFlameGeometry, m.innerFlame, false))
  flame.position.y = 0.05
  root.add(flame)
  return { root, flame }
}

export interface Campfire extends Collider {
  id: number
  y: number
  /** Giro del modelo: cada fogata distinta, sin depender de cuántas haya. */
  rotY: number
  mesh: THREE.Group
  flame: THREE.Group
}

export interface CampfireSpot {
  x: number
  y: number
  z: number
  valid: boolean
}

const overlaps = (grid: SpatialGrid<Collider>, x: number, z: number, radius: number) => {
  for (const c of grid.query(x, z, radius + grid.maxRadius)) {
    if (c.alive && Math.hypot(c.x - x, c.z - z) < c.radius + radius) return true
  }
  return false
}

/** Dónde caería una fogata colocada desde `pos` mirando a `yaw`, y si se puede poner ahí. */
export function campfireSpot(
  pos: { x: number; z: number },
  yaw: number,
  blockers: SpatialGrid<Collider>[],
  out: CampfireSpot = { x: 0, y: 0, z: 0, valid: false },
): CampfireSpot {
  // forward = (-sin(yaw), -cos(yaw))
  out.x = pos.x - Math.sin(yaw) * CAMPFIRE_PLACE_DISTANCE
  out.z = pos.z - Math.cos(yaw) * CAMPFIRE_PLACE_DISTANCE
  out.y = heightAt(out.x, out.z)
  out.valid =
    out.y > MIN_GROUND &&
    slopeAt(out.x, out.z) <= MAX_SLOPE &&
    blockers.every((grid) => !overlaps(grid, out.x, out.z, CAMPFIRE_RADIUS))
  return out
}

/** Fogatas colocadas: modelo, collider y un grupo fijo de luces para las más cercanas. */
export class Campfires {
  readonly list: Campfire[] = []
  readonly grid = new SpatialGrid<Campfire>()
  readonly group = new THREE.Group()
  private ghost: THREE.Group
  private ghostMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.45, depthWrite: false })
  private lights: THREE.PointLight[] = []
  private byDistance: Campfire[] = []
  private sun = new THREE.Vector3()
  private nextId = 0

  constructor(scene: THREE.Scene) {
    const g = this.ghostMaterial
    this.ghost = buildCampfire({ log: g, stone: g, outerFlame: g, innerFlame: g }, false).root
    this.ghost.visible = false
    for (let i = 0; i < CAMPFIRE_LIGHTS; i++) {
      // Se crean todas desde el principio con intensidad 0: añadir o esconder luces recompila los shaders.
      const light = new THREE.PointLight('#ff8636', 0, CAMPFIRE_LIGHT_DISTANCE, 2)
      this.lights.push(light)
      scene.add(light)
    }
    scene.add(this.group, this.ghost)
  }

  /** Coloca una fogata si el sitio es válido. */
  place(spot: CampfireSpot): boolean {
    if (!spot.valid) return false
    const { root, flame } = buildCampfire(
      { log: logMaterial, stone: stoneMaterial, outerFlame: outerFlameMaterial, innerFlame: innerFlameMaterial },
      true,
    )
    const id = this.nextId++
    const fire: Campfire = { id, x: spot.x, y: spot.y, z: spot.z, rotY: id * 1.3, radius: CAMPFIRE_RADIUS, alive: true, mesh: root, flame }
    root.position.set(spot.x, spot.y - 0.05, spot.z)
    root.rotation.y = fire.rotY
    this.group.add(root)
    this.list.push(fire)
    this.grid.insert(fire)
    return true
  }

  clear() {
    for (const fire of this.list) this.group.remove(fire.mesh)
    this.list.length = 0
    this.grid.clear()
    this.nextId = 0
    for (const light of this.lights) light.intensity = 0
    this.ghost.visible = false
  }

  /** Vista previa de dónde se colocaría (verde si se puede, roja si no); null la oculta. */
  setGhost(spot: CampfireSpot | null) {
    this.ghost.visible = spot !== null
    if (!spot) return
    this.ghost.position.set(spot.x, spot.y - 0.05, spot.z)
    this.ghostMaterial.color.set(spot.valid ? '#7dff8a' : '#ff5a4f')
  }

  /** Por frame: parpadeo de llamas y luces, que iluminan más cuanto más oscuro está. */
  update(time: number, phase: number, viewer: { x: number; z: number }) {
    const t = time / 1000
    const night = 1 - THREE.MathUtils.smoothstep(sunDirection(phase, this.sun).y, -0.1, 0.25)
    const level = DAY_LIGHT_FACTOR + (1 - DAY_LIGHT_FACTOR) * night
    const flicker = (k: number) => 0.85 + 0.1 * Math.sin(t * 11 + k * 1.7) + 0.05 * Math.sin(t * 23 + k * 3.1)

    this.list.forEach((fire, k) => fire.flame.scale.set(1, flicker(k) + 0.1, 1))

    const d = (f: Campfire) => (f.x - viewer.x) ** 2 + (f.z - viewer.z) ** 2
    this.byDistance.length = 0
    this.byDistance.push(...this.list)
    this.byDistance.sort((a, b) => d(a) - d(b))
    this.lights.forEach((light, i) => {
      const fire = this.byDistance[i]
      if (!fire) {
        light.intensity = 0
        return
      }
      light.position.set(fire.x, fire.y + LIGHT_HEIGHT, fire.z)
      light.intensity = CAMPFIRE_LIGHT_INTENSITY * level * flicker(this.list.indexOf(fire))
    })
  }
}
