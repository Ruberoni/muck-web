import * as THREE from 'three'
import { sunDirection } from '../world/daycycle'
import { CAMPFIRE_LIGHT_DISTANCE, CAMPFIRE_LIGHT_INTENSITY, CAMPFIRE_LIGHTS } from '../sim/constants'
import type { Structure, StructureKind, StructureSpot } from '../sim/structures'

const LIGHT_HEIGHT = 0.8
// De día la fogata casi no se nota: a pleno sol la luz baja a esta fracción.
const DAY_LIGHT_FACTOR = 0.1

const logGeometry = new THREE.CylinderGeometry(0.07, 0.08, 0.9, 5)
const stoneGeometry = new THREE.IcosahedronGeometry(0.14, 0)
const outerFlameGeometry = new THREE.ConeGeometry(0.28, 0.75, 5).translate(0, 0.375, 0)
const innerFlameGeometry = new THREE.ConeGeometry(0.15, 0.45, 5).translate(0, 0.225, 0)

const logMaterial = new THREE.MeshStandardMaterial({ color: '#6b4426', flatShading: true })
const stoneMaterial = new THREE.MeshStandardMaterial({ color: '#8a877b', flatShading: true })
// Las llamas no dependen de la luz: de noche se ven brillantes.
const outerFlameMaterial = new THREE.MeshBasicMaterial({ color: '#ff7a1f' })
const innerFlameMaterial = new THREE.MeshBasicMaterial({ color: '#ffd23f' })

/** El material con que se dibuja cada pieza a partir del suyo: el mismo, o uno para todas (la vista previa). */
type MaterialFor = (own: THREE.Material) => THREE.Material

/** Modelo low-poly: anillo de piedras, troncos en tipi y dos conos de llama. */
function buildCampfire(m: MaterialFor, shadows: boolean): StructureModel {
  const root = new THREE.Group()
  const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, cast = shadows) => {
    const node = new THREE.Mesh(geometry, m(material))
    node.castShadow = cast
    node.receiveShadow = shadows
    return node
  }
  for (let i = 0; i < 7; i++) {
    const angle = (i / 7) * Math.PI * 2
    const stone = mesh(stoneGeometry, stoneMaterial)
    stone.position.set(Math.cos(angle) * 0.46, 0.04, Math.sin(angle) * 0.46)
    stone.rotation.set(angle, angle * 2, 0)
    root.add(stone)
  }
  for (let i = 0; i < 4; i++) {
    // Cada tronco sale de fuera y se apoya en el centro.
    const pivot = new THREE.Group()
    pivot.rotation.y = (i / 4) * Math.PI * 2 + 0.4
    const log = mesh(logGeometry, logMaterial)
    log.position.set(0.18, 0.3, 0)
    log.rotation.z = 0.65
    pivot.add(log)
    root.add(pivot)
  }
  const flame = new THREE.Group()
  flame.add(mesh(outerFlameGeometry, outerFlameMaterial, false), mesh(innerFlameGeometry, innerFlameMaterial, false))
  flame.position.y = 0.05
  root.add(flame)
  return { root, flame }
}

export interface StructureModel {
  root: THREE.Group
  /** Las llamas que parpadean (solo la fogata). */
  flame: THREE.Group | null
}

/** El modelo de cada tipo de estructura. */
const MODELS: Record<StructureKind, (m: MaterialFor, shadows: boolean) => StructureModel> = {
  campfire: buildCampfire,
}

const own: MaterialFor = (material) => material

/**
 * Las estructuras dibujadas: un modelo por estructura de la simulación, la vista previa al colocar y un grupo
 * fijo de luces para las fogatas más cercanas.
 */
export class StructureView {
  readonly group = new THREE.Group()
  private models = new Map<number, StructureModel>()
  private seen = new Set<number>()
  /** Una vista previa por tipo, creada la primera vez que hace falta; solo se ve una a la vez. */
  private ghosts = new Map<StructureKind, THREE.Group>()
  private ghostMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.45, depthWrite: false })
  private lights: THREE.PointLight[] = []
  private fires: Structure[] = []
  private sun = new THREE.Vector3()

  constructor(private scene: THREE.Scene) {
    for (let i = 0; i < CAMPFIRE_LIGHTS; i++) {
      // Se crean todas desde el principio con intensidad 0: añadir o esconder luces recompila los shaders.
      const light = new THREE.PointLight('#ff8636', 0, CAMPFIRE_LIGHT_DISTANCE, 2)
      this.lights.push(light)
      scene.add(light)
    }
    scene.add(this.group)
  }

  /** Modelo de la estructura `id`, si ya se ha dibujado. */
  modelOf(id: number): StructureModel | undefined {
    return this.models.get(id)
  }

  /** Vista previa de dónde se colocaría una estructura `kind` (verde si se puede, roja si no); null la oculta. */
  setGhost(ghost: { kind: StructureKind; spot: StructureSpot } | null) {
    for (const [kind, model] of this.ghosts) model.visible = kind === ghost?.kind
    if (!ghost) return
    const { kind, spot } = ghost
    let model = this.ghosts.get(kind)
    if (!model) {
      const g = this.ghostMaterial
      model = MODELS[kind](() => g, false).root
      this.ghosts.set(kind, model)
      this.scene.add(model)
    }
    model.visible = true
    model.position.set(spot.x, spot.y - 0.05, spot.z)
    this.ghostMaterial.color.set(spot.valid ? '#7dff8a' : '#ff5a4f')
  }

  /** Por frame: modelos de las estructuras, parpadeo de llamas y luces, que iluminan más cuanto más oscuro está. */
  update(time: number, phase: number, viewer: { x: number; z: number }, structures: readonly Structure[]) {
    this.sync(structures)
    const t = time / 1000
    const night = 1 - THREE.MathUtils.smoothstep(sunDirection(phase, this.sun).y, -0.1, 0.25)
    const level = DAY_LIGHT_FACTOR + (1 - DAY_LIGHT_FACTOR) * night
    // Cada fogata parpadea a su ritmo, según su id (no cambia al colocar otras).
    const flicker = (id: number) => 0.85 + 0.1 * Math.sin(t * 11 + id * 1.7) + 0.05 * Math.sin(t * 23 + id * 3.1)

    this.fires.length = 0
    for (const s of structures) {
      const { flame } = this.models.get(s.id)!
      if (flame) flame.scale.set(1, flicker(s.id) + 0.1, 1)
      if (s.kind === 'campfire') this.fires.push(s)
    }

    const d = (f: Structure) => (f.x - viewer.x) ** 2 + (f.z - viewer.z) ** 2
    this.fires.sort((a, b) => d(a) - d(b))
    this.lights.forEach((light, i) => {
      const fire = this.fires[i]
      if (!fire) {
        light.intensity = 0
        return
      }
      light.position.set(fire.x, fire.y + LIGHT_HEIGHT, fire.z)
      light.intensity = CAMPFIRE_LIGHT_INTENSITY * level * flicker(fire.id)
    })
  }

  /** Reinicio de partida: sin estructuras, luces apagadas y sin vista previa. */
  reset() {
    for (const { root } of this.models.values()) this.group.remove(root)
    this.models.clear()
    for (const light of this.lights) light.intensity = 0
    this.setGhost(null)
  }

  /** Crea el modelo de las estructuras nuevas y quita el de las que ya no están. */
  private sync(structures: readonly Structure[]) {
    this.seen.clear()
    for (const s of structures) {
      this.seen.add(s.id)
      if (this.models.has(s.id)) continue
      const model = MODELS[s.kind](own, true)
      model.root.position.set(s.x, s.y - 0.05, s.z)
      model.root.rotation.y = s.rotY
      this.group.add(model.root)
      this.models.set(s.id, model)
    }
    for (const [id, { root }] of this.models) {
      if (this.seen.has(id)) continue
      this.models.delete(id)
      this.group.remove(root)
    }
  }
}
