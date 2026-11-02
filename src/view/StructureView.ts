import * as THREE from 'three'
import { sunDirection } from '../world/daycycle'
import { CAMPFIRE_LIGHT_DISTANCE, CAMPFIRE_LIGHT_INTENSITY, CAMPFIRE_LIGHTS } from '../sim/constants'
import { STRUCTURE_DEFS, type Structure, type StructureKind, type StructureSpot } from '../sim/structures'

const LIGHT_HEIGHT = 0.8
// De día la fogata casi no se nota: a pleno sol la luz baja a esta fracción.
const DAY_LIGHT_FACTOR = 0.1

const logGeometry = new THREE.CylinderGeometry(0.07, 0.08, 0.9, 5)
const stoneGeometry = new THREE.IcosahedronGeometry(0.14, 0)
const outerFlameGeometry = new THREE.ConeGeometry(0.28, 0.75, 5).translate(0, 0.375, 0)
const innerFlameGeometry = new THREE.ConeGeometry(0.15, 0.45, 5).translate(0, 0.225, 0)

const topGeometry = new THREE.BoxGeometry(1.15, 0.12, 0.7)
// Las patas se hunden en el suelo: en pendiente, la de abajo no queda en el aire.
const legGeometry = new THREE.BoxGeometry(0.1, 1, 0.1)
const rungGeometry = new THREE.BoxGeometry(0.9, 0.07, 0.07)
const hammerHeadGeometry = new THREE.BoxGeometry(0.26, 0.1, 0.1)
const hammerHandleGeometry = new THREE.BoxGeometry(0.05, 0.04, 0.34)
const plankGeometry = new THREE.BoxGeometry(0.5, 0.05, 0.18)

// El cuerpo del horno también se hunde en el suelo, por las pendientes.
const furnaceBodyGeometry = new THREE.BoxGeometry(1.1, 1.5, 0.95)
const furnaceTopGeometry = new THREE.BoxGeometry(1.2, 0.1, 1.05)
const chimneyGeometry = new THREE.BoxGeometry(0.3, 0.55, 0.3)
const mouthGeometry = new THREE.BoxGeometry(0.5, 0.4, 0.04)
// Llamas aplastadas contra la boca: se ven dentro de ella sin salir de la cara del horno.
const furnaceOuterFlameGeometry = new THREE.ConeGeometry(0.13, 0.3, 5).scale(1, 1, 0.2).translate(0, 0.15, 0)
const furnaceInnerFlameGeometry = new THREE.ConeGeometry(0.07, 0.18, 5).scale(1, 1, 0.2).translate(0, 0.09, 0)

const stumpGeometry = new THREE.CylinderGeometry(0.28, 0.32, 0.9, 7)
const anvilFootGeometry = new THREE.BoxGeometry(0.42, 0.08, 0.3)
const anvilWaistGeometry = new THREE.BoxGeometry(0.2, 0.16, 0.16)
const anvilFaceGeometry = new THREE.BoxGeometry(0.5, 0.14, 0.24)
const anvilHornGeometry = new THREE.ConeGeometry(0.07, 0.22, 5).rotateZ(-Math.PI / 2)

/** La barra de lo que está haciendo una estación, sobre ella. */
const BAR_HEIGHT = 2
const BAR_WIDTH = 1.2
const barBackMaterial = new THREE.SpriteMaterial({ color: '#11100e', transparent: true, opacity: 0.7, depthTest: false })
const barFillMaterial = new THREE.SpriteMaterial({ color: '#ffb13b', depthTest: false })

const lighthouseBaseGeometry = new THREE.CylinderGeometry(1.6, 1.8, 1.2, 10)
const lighthouseTowerGeometry = new THREE.CylinderGeometry(0.8, 1.3, 8, 10)
const lighthouseLampGeometry = new THREE.CylinderGeometry(0.9, 0.9, 1.3, 10)
const lighthouseWallMaterial = new THREE.MeshStandardMaterial({ color: '#dcd8cc', flatShading: true })
const lighthouseLampMaterial = new THREE.MeshStandardMaterial({ color: '#ffd23f', emissive: '#ffb13b', emissiveIntensity: 0.3, flatShading: true })
// Un cono ancho que sale de la lámpara y gira.
const lighthouseBeamGeometry = new THREE.ConeGeometry(9, 70, 12, 1, true).rotateZ(Math.PI / 2).translate(35, 0, 0)
const lighthouseBeamMaterial = new THREE.MeshBasicMaterial({ color: '#ffe9a8', transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide, fog: false })
const BEAM_TURN = 0.6
const planeHullGeometry = new THREE.BoxGeometry(1.4, 1.4, 7)
const planeWingGeometry = new THREE.BoxGeometry(8, 0.18, 1.6)
const planeTailGeometry = new THREE.BoxGeometry(0.2, 1.4, 1.2)
const planePropellerGeometry = new THREE.BoxGeometry(2.4, 0.2, 0.1)
const planeMaterial = new THREE.MeshStandardMaterial({ color: '#7f8c8d', flatShading: true })
const totemBaseGeometry = new THREE.BoxGeometry(2, 1, 2)
const totemBodyGeometry = new THREE.BoxGeometry(1.2, 3.2, 1.2)
const totemHeartGeometry = new THREE.IcosahedronGeometry(0.8, 0)
const totemHeartMaterial = new THREE.MeshStandardMaterial({ color: '#4a403a', emissive: '#ff5a1f', emissiveIntensity: 0.1, flatShading: true })

const logMaterial = new THREE.MeshStandardMaterial({ color: '#6b4426', flatShading: true })
const stoneMaterial = new THREE.MeshStandardMaterial({ color: '#8a877b', flatShading: true })
const plankMaterial = new THREE.MeshStandardMaterial({ color: '#c8955a', flatShading: true })
const handleMaterial = new THREE.MeshStandardMaterial({ color: '#8a5a32', flatShading: true })
const furnaceMaterial = new THREE.MeshStandardMaterial({ color: '#9a958a', flatShading: true })
const furnaceTopMaterial = new THREE.MeshStandardMaterial({ color: '#77736a', flatShading: true })
const mouthMaterial = new THREE.MeshStandardMaterial({ color: '#2a211c', flatShading: true })
// Poco metálico: sin envMap, el metal pierde la luz difusa y se vería casi negro.
const ironMaterial = new THREE.MeshStandardMaterial({ color: '#5f6670', flatShading: true, metalness: 0.25, roughness: 0.5 })
// Las llamas no dependen de la luz: de noche se ven brillantes.
const outerFlameMaterial = new THREE.MeshBasicMaterial({ color: '#ff7a1f' })
const innerFlameMaterial = new THREE.MeshBasicMaterial({ color: '#ffd23f' })

/** El material con que se dibuja cada pieza a partir del suyo: el mismo, o uno para todas (la vista previa). */
type MaterialFor = (own: THREE.Material) => THREE.Material

/** Una pieza de un modelo: `m(material)` en (x, y, z) con su giro, con o sin sombras. */
function piece(root: THREE.Object3D, m: MaterialFor, shadows: boolean) {
  return (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, rotY = 0) => {
    const node = new THREE.Mesh(geometry, m(material))
    node.position.set(x, y, z)
    node.rotation.y = rotY
    node.castShadow = shadows
    node.receiveShadow = shadows
    root.add(node)
    return node
  }
}

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

/** Mesa de trabajo: tablero sobre cuatro patas con travesaños, un martillo de piedra y una tabla encima. */
function buildWorkbench(m: MaterialFor, shadows: boolean): StructureModel {
  const root = new THREE.Group()
  const mesh = piece(root, m, shadows)
  for (const x of [-0.47, 0.47]) for (const z of [-0.25, 0.25]) mesh(legGeometry, logMaterial, x, 0.22, z)
  for (const z of [-0.25, 0.25]) mesh(rungGeometry, logMaterial, 0, 0.2, z)
  mesh(topGeometry, plankMaterial, 0, 0.78, 0)
  mesh(plankGeometry, handleMaterial, -0.25, 0.865, 0.1, 0.2)
  mesh(hammerHandleGeometry, handleMaterial, 0.28, 0.86, 0.02, 0.5)
  mesh(hammerHeadGeometry, stoneMaterial, 0.2, 0.89, -0.13, 0.5)
  return { root, flame: null }
}

/** Horno: bloque de piedra con chimenea y la boca hacia quien lo coloca (+Z), con fuego dentro. */
function buildFurnace(m: MaterialFor, shadows: boolean): StructureModel {
  const root = new THREE.Group()
  const mesh = piece(root, m, shadows)
  mesh(furnaceBodyGeometry, furnaceMaterial, 0, 0.2, 0)
  mesh(furnaceTopGeometry, furnaceTopMaterial, 0, 1, 0)
  mesh(chimneyGeometry, furnaceTopMaterial, 0.28, 1.3, -0.22)
  // La boca, alta para que no quede enterrada si se coloca de cara a una cuesta.
  mesh(mouthGeometry, mouthMaterial, 0, 0.55, 0.485)
  // El fuego asoma por la boca; no da luz (solo las fogatas iluminan), pero parpadea como ellas.
  const flame = new THREE.Group()
  const fire = piece(flame, m, false)
  fire(furnaceOuterFlameGeometry, outerFlameMaterial, 0, 0, 0)
  fire(furnaceInnerFlameGeometry, innerFlameMaterial, 0, 0, 0.012)
  flame.position.set(0, 0.36, 0.53)
  root.add(flame)
  return { root, flame }
}

/** Yunque de hierro sobre un tocón, con el cuerno hacia un lado. */
function buildAnvil(m: MaterialFor, shadows: boolean): StructureModel {
  const root = new THREE.Group()
  const mesh = piece(root, m, shadows)
  // El tocón se hunde en el suelo, como las patas de la mesa.
  mesh(stumpGeometry, logMaterial, 0, 0.05, 0)
  mesh(anvilFootGeometry, ironMaterial, 0, 0.54, 0)
  mesh(anvilWaistGeometry, ironMaterial, 0, 0.66, 0)
  mesh(anvilFaceGeometry, ironMaterial, -0.03, 0.81, 0)
  mesh(anvilHornGeometry, ironMaterial, 0.33, 0.83, 0)
  return { root, flame: null }
}

/** Tótem: estacas y, según avanza la obra, la base, el cuerpo y el corazón, que arde al activarlo. */
function buildTotem(m: MaterialFor, shadows: boolean): StructureModel {
  const root = new THREE.Group()
  const mesh = piece(root, m, shadows)
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) mesh(legGeometry, logMaterial, x, 0.3, z)
  const base = mesh(totemBaseGeometry, stoneMaterial, 0, 0.5, 0)
  const body = mesh(totemBodyGeometry, logMaterial, 0, 2.6, 0)
  const heart = mesh(totemHeartGeometry, totemHeartMaterial, 0, 4.9, 0)
  return { root, flame: null, stages: [base, body, heart] }
}

/** Avión: el fuselaje caído, con un ala rota y llamas; al repararlo aparece la hélice. */
function buildPlane(m: MaterialFor, shadows: boolean): StructureModel {
  const root = new THREE.Group()
  const hull = new THREE.Group()
  hull.rotation.z = 0.12
  root.add(hull)
  const mesh = piece(hull, m, shadows)
  mesh(planeHullGeometry, planeMaterial, 0, 1, 0)
  mesh(planeWingGeometry, planeMaterial, 0, 1.3, 0.3)
  mesh(planeTailGeometry, planeMaterial, 0, 1.9, -3.3)
  const propeller = mesh(planePropellerGeometry, ironMaterial, 0, 1, 3.7)
  const flame = new THREE.Group()
  flame.add(new THREE.Mesh(outerFlameGeometry, m(outerFlameMaterial)), new THREE.Mesh(innerFlameGeometry, m(innerFlameMaterial)))
  flame.position.set(1.8, 1.4, 0.3)
  flame.scale.setScalar(2)
  hull.add(flame)
  return { root, flame, stages: [propeller] }
}

/** Destilador: una caldera de madera con su alambique. */
function buildDistiller(m: MaterialFor, shadows: boolean): StructureModel {
  const root = new THREE.Group()
  const mesh = piece(root, m, shadows)
  mesh(stumpGeometry, plankMaterial, 0, 0.45, 0)
  mesh(chimneyGeometry, ironMaterial, 0, 1.1, 0)
  mesh(hammerHandleGeometry, ironMaterial, 0.3, 1.25, 0, Math.PI / 2)
  return { root, flame: null }
}

/** Faro: estacas en el sitio y, según avanza la obra, el cimiento, la torre y la lámpara. */
function buildLighthouse(m: MaterialFor, shadows: boolean): StructureModel {
  const root = new THREE.Group()
  const mesh = piece(root, m, shadows)
  for (const [x, z] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) mesh(legGeometry, logMaterial, x, 0.3, z)
  const base = mesh(lighthouseBaseGeometry, stoneMaterial, 0, 0.6, 0)
  const tower = mesh(lighthouseTowerGeometry, lighthouseWallMaterial, 0, 5, 0)
  const lamp = mesh(lighthouseLampGeometry, lighthouseLampMaterial, 0, 9.6, 0)
  const beam = new THREE.Mesh(lighthouseBeamGeometry, m(lighthouseBeamMaterial))
  beam.position.y = 9.6
  beam.visible = false
  root.add(beam)
  return { root, flame: null, stages: [base, tower, lamp], beam }
}

export interface StructureModel {
  root: THREE.Group
  /** Las llamas que parpadean (la fogata y el fuego del horno). */
  flame: THREE.Group | null
  /** La barra de progreso y su relleno: se crean al ponerle el primer trabajo. */
  bar?: { back: THREE.Sprite; fill: THREE.Sprite }
  /** Lo que aparece con cada fase de una construcción. */
  stages?: THREE.Object3D[]
  /** El haz del faro: se ve desde lejos, también en la niebla. */
  beam?: THREE.Object3D
}

/** El modelo de cada tipo de estructura. */
const MODELS: Record<StructureKind, (m: MaterialFor, shadows: boolean) => StructureModel> = {
  campfire: buildCampfire,
  workbench: buildWorkbench,
  furnace: buildFurnace,
  anvil: buildAnvil,
  lighthouse: buildLighthouse,
  distiller: buildDistiller,
  totem: buildTotem,
  plane: buildPlane,
}

const own: MaterialFor = (material) => material

/**
 * Las estructuras dibujadas: un modelo por estructura de la simulación, la vista previa al colocar y un grupo
 * fijo de luces para las fogatas más cercanas.
 */
export class StructureView {
  readonly group = new THREE.Group()
  private models = new Map<number, StructureModel & { kind: StructureKind }>()
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

  /**
   * Vista previa de dónde se colocaría una estructura `kind` (verde si se puede, roja si no) mirando a `yaw`; null la
   * oculta. Las estaciones salen giradas como quedarán; las redondas, sin giro.
   */
  setGhost(ghost: { kind: StructureKind; spot: StructureSpot; yaw: number } | null) {
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
    model.rotation.y = STRUCTURE_DEFS[kind].facesPlacer ? ghost.yaw : 0
    this.ghostMaterial.color.set(spot.valid ? '#7dff8a' : '#ff5a4f')
  }

  /** Por frame: modelos de las estructuras, parpadeo de llamas y luces, que iluminan más cuanto más oscuro está. */
  update(time: number, phase: number, viewer: { x: number; z: number }, structures: readonly Structure[]) {
    this.sync(structures)
    const t = time / 1000
    const night = 1 - THREE.MathUtils.smoothstep(sunDirection(phase, this.sun).y, -0.1, 0.25)
    const level = DAY_LIGHT_FACTOR + (1 - DAY_LIGHT_FACTOR) * night
    // Cada fuego parpadea a su ritmo, según su id (no cambia al colocar otras).
    const flicker = (id: number) => 0.85 + 0.1 * Math.sin(t * 11 + id * 1.7) + 0.05 * Math.sin(t * 23 + id * 3.1)

    this.fires.length = 0
    for (const s of structures) {
      const model = this.models.get(s.id)!
      if (model.flame) model.flame.scale.set(1, flicker(s.id) + 0.1, 1)
      if (s.kind === 'campfire' || s.fire?.burning) this.fires.push(s)
      this.showProgress(model, s)
      if (model.beam) {
        model.beam.visible = s.fire?.burning ?? false
        model.beam.rotation.y = t * BEAM_TURN
      }
    }
    lighthouseLampMaterial.emissiveIntensity = structures.some((s) => s.fire?.burning) ? 3 : 0.3
    totemHeartMaterial.emissiveIntensity = structures.some((s) => s.awake) ? 2.5 : 0.1

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

  /** La barra de lo que está haciendo o de cómo va la obra, si hay algo que enseñar. */
  private showProgress(model: StructureModel, { jobs, build }: Structure) {
    const job = jobs[0]
    if (model.stages && build) model.stages.forEach((stage, i) => (stage.visible = build.phase > i))
    const building = build && build.progress < 1
    if (!job && !building && !model.bar) return
    if (!model.bar) {
      const back = new THREE.Sprite(barBackMaterial)
      const fill = new THREE.Sprite(barFillMaterial)
      back.scale.set(BAR_WIDTH + 0.08, 0.2, 1)
      back.position.y = fill.position.y = BAR_HEIGHT
      back.renderOrder = 1
      fill.renderOrder = 2
      fill.center.set(0, 0.5)
      fill.position.x = -BAR_WIDTH / 2
      model.root.add(back, fill)
      model.bar = { back, fill }
    }
    model.bar.back.visible = model.bar.fill.visible = job !== undefined || !!building
    const done = job ? 1 - job.left / job.time : (build?.progress ?? 0)
    model.bar.fill.scale.set(Math.max(0.01, BAR_WIDTH * done), 0.12, 1)
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
      const old = this.models.get(s.id)
      // Un id que vuelve con otro tipo o en otro sitio (otra partida) es otra estructura.
      if (old && old.kind === s.kind && old.root.position.x === s.x && old.root.position.z === s.z) continue
      if (old) this.group.remove(old.root)
      const model = { ...MODELS[s.kind](own, true), kind: s.kind }
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
