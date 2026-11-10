import * as THREE from 'three'
import { sunDirection } from '../world/daycycle'
import { CAMPFIRE_LIGHT_DISTANCE, CAMPFIRE_LIGHT_INTENSITY, CAMPFIRE_LIGHTS } from '../sim/constants'
import { STRUCTURE_DEFS, type Structure, type StructureKind, type StructureSpot } from '../sim/structures'
import { ISLAND_SIZE } from '../sim/world/island'

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
interface BarPlace {
  height: number
  scale: number
}
const SMALL_BAR: BarPlace = { height: BAR_HEIGHT, scale: 1 }
const BIG_LIGHTHOUSE_BAR: BarPlace = { height: 20, scale: 5 }
const BIG_TOTEM_BAR: BarPlace = { height: 7, scale: 3 }
const barBackMaterial = new THREE.SpriteMaterial({ color: '#11100e', transparent: true, opacity: 0.7, depthTest: false })
const barFillMaterial = new THREE.SpriteMaterial({ color: '#ffb13b', depthTest: false })

/** Altura de la lámpara: el faro es enorme a propósito, para verse desde cualquier punto de la isla. */
const LAMP_HEIGHT = 46
// La base y las ruinas se hunden en el suelo, por las pendientes.
const lighthouseBaseGeometry = new THREE.CylinderGeometry(5.6, 6.2, 8, 12)
const lighthouseTowerGeometry = new THREE.CylinderGeometry(2.6, 4.6, 40, 12)
const lighthouseStripeLowGeometry = new THREE.CylinderGeometry(3.75, 4.05, 6, 12)
const lighthouseStripeHighGeometry = new THREE.CylinderGeometry(2.95, 3.25, 6, 12)
const lighthouseGalleryGeometry = new THREE.CylinderGeometry(3.7, 3.7, 0.6, 12)
const lighthouseLampGeometry = new THREE.CylinderGeometry(2.3, 2.3, 3.4, 12)
const lighthouseRoofGeometry = new THREE.ConeGeometry(3, 2.6, 12)
const lighthouseRuinGeometry = new THREE.CylinderGeometry(3.2, 4.6, 16, 9)
const rubbleGeometry = new THREE.IcosahedronGeometry(1.4, 0)
const lighthouseWallMaterial = new THREE.MeshStandardMaterial({ color: '#dcd8cc', flatShading: true })
const lighthouseStripeMaterial = new THREE.MeshStandardMaterial({ color: '#c2304a', flatShading: true })
const ruinMaterial = new THREE.MeshStandardMaterial({ color: '#8d8a80', flatShading: true })
const lighthouseLampMaterial = new THREE.MeshStandardMaterial({ color: '#ffd23f', emissive: '#ffb13b', emissiveIntensity: 0.3, flatShading: true })
// Dos conos opuestos que salen de la lámpara y giran: llegan de punta a punta de la isla, sea cual sea su tamaño.
const BEAM_LENGTH = ISLAND_SIZE
const lighthouseBeamGeometry = new THREE.ConeGeometry(BEAM_LENGTH * 0.1, BEAM_LENGTH, 16, 1, true).rotateZ(Math.PI / 2).translate(BEAM_LENGTH / 2, 0, 0)
const lighthouseBeamMaterial = new THREE.MeshBasicMaterial({ color: '#ffe9a8', transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, fog: false, blending: THREE.AdditiveBlending })
const lighthouseGlowGeometry = new THREE.IcosahedronGeometry(4, 1)
const lighthouseGlowMaterial = new THREE.MeshBasicMaterial({ color: '#ffd98a', transparent: true, opacity: 0.35, depthWrite: false, fog: false, blending: THREE.AdditiveBlending })
/** Los haces bajan despacio y tocan el suelo lejos; la luz que recorre la isla con ellos cae más cerca, donde hay tierra. */
const BEAM_TILT = Math.atan2(LAMP_HEIGHT, BEAM_LENGTH * 0.6)
const BEAM_GROUND = ISLAND_SIZE * 0.35
const BEAM_SPREAD = 0.35
const BEAM_LIGHT = 5
const BEAM_TURN = 0.6
const graveSlabGeometry = new THREE.BoxGeometry(1.2, 0.2, 2)
const graveStoneGeometry = new THREE.BoxGeometry(1, 1.2, 0.25)
const graveColumnGeometry = new THREE.CylinderGeometry(1.4, 1.4, 80, 10, 1, true)
const graveColumnMaterial = new THREE.MeshBasicMaterial({ color: '#f2fbff', transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide, fog: false })
const planeHullGeometry = new THREE.BoxGeometry(1.4, 1.4, 7)
const planeWingGeometry = new THREE.BoxGeometry(8, 0.18, 1.6)
const planeTailGeometry = new THREE.BoxGeometry(0.2, 1.4, 1.2)
const planePropellerGeometry = new THREE.BoxGeometry(2.4, 0.2, 0.1)
const planeMaterial = new THREE.MeshStandardMaterial({ color: '#7f8c8d', flatShading: true })
// La base y las ruinas se hunden en el suelo, por las pendientes.
const totemBaseGeometry = new THREE.BoxGeometry(6, 3, 6)
const totemBodyGeometry = new THREE.BoxGeometry(3.2, 8, 3.2)
const totemHeartGeometry = new THREE.IcosahedronGeometry(1.9, 0)
const totemRuinGeometry = new THREE.BoxGeometry(3, 3.5, 3)
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
  const ruin = new THREE.Group()
  root.add(ruin)
  const rubble = piece(ruin, m, shadows)
  rubble(totemRuinGeometry, ruinMaterial, 0, 1.2, 0, 0.5)
  for (const [x, z] of [[-3, 1.6], [2.4, -2.4]]) rubble(rubbleGeometry, stoneMaterial, x, 0.3, z, x)
  const base = mesh(totemBaseGeometry, stoneMaterial, 0, 0.5, 0)
  const body = mesh(totemBodyGeometry, logMaterial, 0, 6, 0)
  const heart = mesh(totemHeartGeometry, totemHeartMaterial, 0, 12, 0)
  return { root, flame: null, stages: [base, body, heart], ruin, bar: BIG_TOTEM_BAR }
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

/** Tumba: una lápida con su losa; al activar el tótem lanza una columna de luz que se ve a través de la niebla. */
function buildGrave(m: MaterialFor, shadows: boolean): StructureModel {
  const root = new THREE.Group()
  const mesh = piece(root, m, shadows)
  mesh(graveSlabGeometry, stoneMaterial, 0, 0.1, 0)
  mesh(graveStoneGeometry, stoneMaterial, 0, 0.7, -0.6)
  const beam = new THREE.Mesh(graveColumnGeometry, m(graveColumnMaterial))
  beam.position.y = 40
  beam.visible = false
  root.add(beam)
  return { root, flame: null, beam }
}

// El puesto del mercader: postes, un toldo a rayas, el mostrador y el mercader detrás.
const merchantPostGeometry = new THREE.CylinderGeometry(0.08, 0.1, 2.6, 6)
const merchantRoofGeometry = new THREE.ConeGeometry(2.4, 1.1, 6)
const merchantCounterGeometry = new THREE.BoxGeometry(2.4, 0.9, 0.7)
const merchantBodyGeometry = new THREE.CylinderGeometry(0.3, 0.38, 1.1, 7)
const merchantHeadGeometry = new THREE.IcosahedronGeometry(0.24, 1)
const merchantHatGeometry = new THREE.ConeGeometry(0.32, 0.5, 7)
const merchantCrateGeometry = new THREE.BoxGeometry(0.6, 0.6, 0.6)
const merchantRoofMaterial = new THREE.MeshStandardMaterial({ color: '#8e3fb8', flatShading: true })
const merchantRobeMaterial = new THREE.MeshStandardMaterial({ color: '#3f2a6b', flatShading: true })
const merchantSkinMaterial = new THREE.MeshStandardMaterial({ color: '#d9a77a', flatShading: true })
// La linterna del puesto: se ve de noche, para encontrarlo.
const merchantLampMaterial = new THREE.MeshBasicMaterial({ color: '#ffd866' })
const merchantLampGeometry = new THREE.OctahedronGeometry(0.16, 0)

/** Puesto del mercader: un toldo morado con su linterna, el mostrador y el mercader, que mira hacia +Z. */
function buildMerchant(m: MaterialFor, shadows: boolean): StructureModel {
  const root = new THREE.Group()
  const mesh = piece(root, m, shadows)
  for (const [x, z] of [[-1.1, 0.6], [1.1, 0.6], [-1.1, -0.9], [1.1, -0.9]]) mesh(merchantPostGeometry, logMaterial, x, 1.3, z)
  mesh(merchantRoofGeometry, merchantRoofMaterial, 0, 3.1, -0.15)
  mesh(merchantCounterGeometry, plankMaterial, 0, 0.45, 0.55)
  mesh(merchantBodyGeometry, merchantRobeMaterial, 0, 0.55, -0.35)
  mesh(merchantHeadGeometry, merchantSkinMaterial, 0, 1.35, -0.35)
  mesh(merchantHatGeometry, merchantRoofMaterial, 0, 1.75, -0.35)
  mesh(merchantCrateGeometry, plankMaterial, -1.6, 0.3, -0.4, 0.3)
  mesh(merchantCrateGeometry, plankMaterial, 1.6, 0.3, -0.6, -0.2)
  const lamp = new THREE.Mesh(merchantLampGeometry, m(merchantLampMaterial))
  lamp.position.set(1.1, 2.4, 0.75)
  root.add(lamp)
  return { root, flame: null }
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

/** Faro: una torre en ruinas que se ve desde lejos y, según avanza la obra, el cimiento, la torre y la lámpara. */
function buildLighthouse(m: MaterialFor, shadows: boolean): StructureModel {
  const root = new THREE.Group()
  const stage = () => {
    const group = new THREE.Group()
    root.add(group)
    return { group, mesh: piece(group, m, shadows) }
  }
  const ruin = stage()
  ruin.mesh(lighthouseRuinGeometry, ruinMaterial, 0, 8, 0)
  for (const [x, z] of [[-7, 3], [6.5, 4.5], [2, -7.5], [-5, -6]]) ruin.mesh(rubbleGeometry, stoneMaterial, x, 0.5, z, x)
  const base = stage()
  base.mesh(lighthouseBaseGeometry, stoneMaterial, 0, 0, 0)
  const tower = stage()
  tower.mesh(lighthouseTowerGeometry, lighthouseWallMaterial, 0, 24, 0)
  tower.mesh(lighthouseStripeLowGeometry, lighthouseStripeMaterial, 0, 19, 0)
  tower.mesh(lighthouseStripeHighGeometry, lighthouseStripeMaterial, 0, 35, 0)
  tower.mesh(lighthouseGalleryGeometry, stoneMaterial, 0, 44.3, 0)
  const lamp = stage()
  lamp.mesh(lighthouseLampGeometry, lighthouseLampMaterial, 0, LAMP_HEIGHT, 0)
  lamp.mesh(lighthouseRoofGeometry, lighthouseStripeMaterial, 0, LAMP_HEIGHT + 3, 0)
  const beam = new THREE.Group()
  beam.position.y = LAMP_HEIGHT
  beam.visible = false
  for (const turn of [0, Math.PI]) {
    const arm = new THREE.Mesh(lighthouseBeamGeometry, m(lighthouseBeamMaterial))
    arm.rotation.set(0, turn, -BEAM_TILT)
    beam.add(arm)
  }
  beam.add(new THREE.Mesh(lighthouseGlowGeometry, m(lighthouseGlowMaterial)))
  root.add(beam)
  return { root, flame: null, stages: [base.group, tower.group, lamp.group], ruin: ruin.group, beam, bar: BIG_LIGHTHOUSE_BAR }
}

export interface StructureModel {
  root: THREE.Group
  /** Las llamas que parpadean (la fogata y el fuego del horno). */
  flame: THREE.Group | null
  /** Dónde va y cuánto se agranda la barra de progreso, si no es la normal. */
  bar?: BarPlace
  /** La barra de progreso y su relleno: se crean al ponerle el primer trabajo. */
  progress?: { back: THREE.Sprite; fill: THREE.Sprite }
  /** Lo que aparece con cada fase de una construcción. */
  stages?: THREE.Object3D[]
  /** Lo que se ve antes de reparar la torre o el cuerpo. */
  ruin?: THREE.Object3D
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
  grave: buildGrave,
  merchant: buildMerchant,
}

const own: MaterialFor = (material) => material

/**
 * El contorno de lo que se puede usar: blanco semitransparente y dibujado del revés, para que de la copia inflada solo
 * se vea lo que asoma por fuera de la silueta (una línea por el borde, nunca sobre las caras ni las aristas interiores).
 */
export const outlineMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.4, side: THREE.BackSide, depthWrite: false })

/** Grosor del contorno: una parte de cada pieza, con un suelo para que se vea y un techo para que no sea un borrón. */
const OUTLINE_SHARE = 0.02
const OUTLINE_MIN = 0.012
const OUTLINE_MAX = 0.18

/**
 * La geometría empujada hacia fuera por sus normales: es lo que da el grosor del contorno. Se clona, porque las de los
 * modelos son compartidas entre estructuras y con las vistas previas.
 */
function hullOf(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  geometry.computeBoundingSphere()
  const hull = geometry.clone()
  const thickness = THREE.MathUtils.clamp(geometry.boundingSphere!.radius * OUTLINE_SHARE, OUTLINE_MIN, OUTLINE_MAX)
  const position = hull.getAttribute('position') as THREE.BufferAttribute
  const normal = hull.getAttribute('normal') as THREE.BufferAttribute
  for (let i = 0; i < position.count; i++) {
    position.setXYZ(i, position.getX(i) + normal.getX(i) * thickness, position.getY(i) + normal.getY(i) * thickness, position.getZ(i) + normal.getZ(i) * thickness)
  }
  position.needsUpdate = true
  return hull
}

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
  /** Geometrías infladas por la de origen: el contorno de cada pieza se calcula una vez y se reutiliza. */
  private hulls = new Map<THREE.BufferGeometry, THREE.BufferGeometry>()
  /** Los contornos puestos ahora; cada uno es hijo de la pieza que contornea. */
  private outline: { parent: THREE.Object3D; hull: THREE.Mesh }[] = []
  /** La estructura contorneada ahora (null: ninguna). */
  private outlineId: number | null = null
  private lights: THREE.PointLight[] = []
  /** La luz que los haces del faro pasean por el suelo. */
  private sweeps: THREE.SpotLight[] = []
  private fires: Structure[] = []
  private sun = new THREE.Vector3()

  constructor(private scene: THREE.Scene) {
    for (let i = 0; i < CAMPFIRE_LIGHTS; i++) {
      // Se crean todas desde el principio con intensidad 0: añadir o esconder luces recompila los shaders.
      const light = new THREE.PointLight('#ff8636', 0, CAMPFIRE_LIGHT_DISTANCE, 2)
      this.lights.push(light)
      scene.add(light)
    }
    for (let i = 0; i < 2; i++) {
      const sweep = new THREE.SpotLight('#ffe9a8', 0, 0, BEAM_SPREAD, 0.7, 0)
      this.sweeps.push(sweep)
      scene.add(sweep, sweep.target)
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

  /**
   * El contorno blanco de la estructura con la que se puede hacer algo ahora (`null` lo quita). Cada pieza sólida se
   * contornea con una copia inflada dibujada del revés, y va como hija suya: hereda su transformación y lo que aún no
   * está construido (fases de una obra, la hélice del avión) tampoco se contornea. Los haces y resplandores, que son
   * transparentes, se dejan fuera: el contorno es de lo sólido.
   */
  setOutline(structure: { id: number } | null) {
    const id = structure?.id ?? null
    if (id === this.outlineId) return
    this.clearOutline()
    if (id === null) return
    const model = this.models.get(id)
    if (!model) return
    this.outlineId = id
    model.root.traverse((node) => {
      const piece = node as THREE.Mesh
      if (!piece.isMesh || (piece.material as THREE.Material).transparent) return
      let hull = this.hulls.get(piece.geometry)
      if (!hull) this.hulls.set(piece.geometry, (hull = hullOf(piece.geometry)))
      const outline = new THREE.Mesh(hull, outlineMaterial)
      piece.add(outline)
      this.outline.push({ parent: piece, hull: outline })
    })
  }

  private clearOutline() {
    for (const { parent, hull } of this.outline) parent.remove(hull)
    this.outline.length = 0
    this.outlineId = null
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
    const awake = structures.some((s) => s.awake)
    for (const s of structures) {
      const model = this.models.get(s.id)!
      if (model.flame) model.flame.scale.set(1, flicker(s.id) + 0.1, 1)
      if (s.kind === 'campfire') this.fires.push(s)
      this.showProgress(model, s)
      if (model.beam) {
        model.beam.visible = s.kind === 'grave' ? awake && !s.opened : (s.fire?.burning ?? false)
        model.beam.rotation.y = t * BEAM_TURN
      }
    }
    const burning = structures.find((s) => s.fire?.burning)
    lighthouseLampMaterial.emissiveIntensity = burning ? 3 : 0.3
    this.sweeps.forEach((sweep, i) => {
      sweep.intensity = burning ? BEAM_LIGHT * level : 0
      if (!burning) return
      const angle = t * BEAM_TURN + burning.rotY + i * Math.PI
      sweep.position.set(burning.x, burning.y + LAMP_HEIGHT, burning.z)
      sweep.target.position.set(burning.x + Math.cos(angle) * BEAM_GROUND, burning.y, burning.z - Math.sin(angle) * BEAM_GROUND)
      sweep.target.updateMatrixWorld()
    })
    totemHeartMaterial.emissiveIntensity = awake ? 2.5 : 0.1

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
  private showProgress(model: StructureModel, { station, build }: Structure) {
    const job = station && station.time > 0 ? station : undefined
    if (model.stages && build) model.stages.forEach((stage, i) => (stage.visible = build.phase > i))
    if (model.ruin && build) model.ruin.visible = build.phase < 2
    const building = build && build.progress < 1
    if (!job && !building && !model.progress) return
    const { height, scale } = model.bar ?? SMALL_BAR
    if (!model.progress) {
      const back = new THREE.Sprite(barBackMaterial)
      const fill = new THREE.Sprite(barFillMaterial)
      back.scale.set((BAR_WIDTH + 0.08) * scale, 0.2 * scale, 1)
      back.position.y = fill.position.y = height
      back.renderOrder = 1
      fill.renderOrder = 2
      fill.center.set(0, 0.5)
      fill.position.x = (-BAR_WIDTH / 2) * scale
      model.root.add(back, fill)
      model.progress = { back, fill }
    }
    model.progress.back.visible = model.progress.fill.visible = job !== undefined || !!building
    const done = job ? job.progress / job.time : (build?.progress ?? 0)
    model.progress.fill.scale.set(Math.max(0.01, BAR_WIDTH * done) * scale, 0.12 * scale, 1)
  }

  /** Reinicio de partida: sin estructuras, luces apagadas y sin vista previa. */
  reset() {
    this.clearOutline()
    for (const { root } of this.models.values()) this.group.remove(root)
    this.models.clear()
    for (const light of [...this.lights, ...this.sweeps]) light.intensity = 0
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
      // El modelo contorneado se rehace: su contorno se va con él y se vuelve a poner en cuanto se dibuje el nuevo.
      if (s.id === this.outlineId) this.clearOutline()
      const model = { ...MODELS[s.kind](own, true), kind: s.kind }
      model.root.position.set(s.x, s.y - 0.05, s.z)
      model.root.rotation.y = s.rotY
      this.group.add(model.root)
      this.models.set(s.id, model)
    }
    for (const [id, { root }] of this.models) {
      if (this.seen.has(id)) continue
      if (id === this.outlineId) this.clearOutline()
      this.models.delete(id)
      this.group.remove(root)
    }
  }
}
