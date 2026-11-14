import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Sky } from '../scene'
import type { ItemId } from '../sim/inventory'
import type { WeaponClass } from '../sim/constants'
import { swingCooldown, swingImpact, weaponClass } from '../sim/tiers'
import { weaponModel } from '../view/weapons'

/** Animaciones del objeto en la mano. */
export type HandAction = 'swing' | 'eat' | 'place'

// El golpe de las animaciones sin objeto (los demás jugadores de cajas); el de cada arma va por su cadencia.
export const ACTION_DURATION: Record<HandAction, number> = { swing: 0.32, eat: 0.45, place: 0.3 }
/** Lo que dura el golpe de `item`: casi su cadencia entera, para que se vea con peso sin empalmarse con el siguiente. */
export const swingDuration = (item: ItemId | null) => swingCooldown(item) * 0.95
/** En qué fracción del golpe de `item` pega (`swingImpact`): la animación llega al golpe justo entonces. */
export const swingImpactAt = (item: ItemId | null) => swingImpact(item) / swingDuration(item)
const SWAP_DURATION = 0.18
const SWAP_DROP = 0.45
// FOV propio: el objeto no se deforma aunque cambie el de la cámara del mundo.
const HAND_FOV = 60
// La mano se ve aunque sea de noche cerrada.
const MIN_AMBIENT = 0.35
/** Lo que tarda en fundirse una animación con la que había (o con el reposo), para que nada salte de golpe. */
const BLEND_TIME = 0.12

/**
 * Cómo se lleva cada cosa (espacio de cámara: -Z hacia delante). `rest` es el codo, fuera de la pantalla, desde donde
 * gira el golpe; `grip`, el puño, relativo al codo; `tilt`, cómo se inclina el objeto en el puño, y `twist`, cuánto se
 * gira sobre su mango (para verlo de frente). Las herramientas y espadas van grandes, con el mango saliendo por la
 * esquina de abajo a la derecha: la mano queda fuera del encuadre y parece que se agarra por el mango.
 */
interface Hold {
  rest: THREE.Vector3
  restRotation: THREE.Euler
  grip: THREE.Vector3
  tilt: THREE.Euler
  twist: number
  scale: number
}
const TOOL_REST = new THREE.Vector3(0.43, -0.54, -0.3)
const TOOL_REST_ROTATION = new THREE.Euler(0.04, 0.1, 0)
const TOOL_GRIP = new THREE.Vector3(0, 0, -0.34)
const TOOL_TILT = new THREE.Euler(-0.45, 0, 0.27)
export const HOLDS: Record<WeaponClass, Hold> = {
  // La hoja de cara: se ve ancha, no de canto.
  sword: { rest: TOOL_REST, restRotation: TOOL_REST_ROTATION, grip: TOOL_GRIP, tilt: TOOL_TILT, twist: 0.12, scale: 1.45 },
  // El filo hacia delante y al centro, en tres cuartos: se ve la cabeza entera y hacia dónde va a cortar.
  axe: { rest: TOOL_REST, restRotation: TOOL_REST_ROTATION, grip: TOOL_GRIP, tilt: TOOL_TILT, twist: -0.6, scale: 1.4 },
  pickaxe: { rest: TOOL_REST, restRotation: TOOL_REST_ROTATION, grip: TOOL_GRIP, tilt: TOOL_TILT, twist: -0.4, scale: 1.4 },
  // Lo demás (comida, materiales…), pequeño y cerca, como siempre.
  hand: {
    rest: new THREE.Vector3(0.5, -0.56, -0.55),
    restRotation: new THREE.Euler(0.1, 0.3, -0.1),
    grip: new THREE.Vector3(-0.02, 0.2, -0.28),
    tilt: new THREE.Euler(-0.35, 0, 0.15),
    twist: 0,
    scale: 0.75,
  },
}

// Balanceo al andar: un ocho suave (de lado a lado y abajo en cada paso), con un poco de giro.
const BOB_AMOUNT = 0.022
const BOB_RATE = 1.6
const BOB_TILT = 0.035
/** Respiración en reposo: casi nada, para que el objeto no parezca pegado a la pantalla. */
const BREATH_AMOUNT = 0.004
const BREATH_RATE = 1.7
/** Inercia al mirar: el objeto se queda un poco atrás al girar la cámara (rad de giro por rad/s de cámara, y tope). */
const SWAY_PER_TURN = 0.018
const SWAY_MAX = 0.08
const SWAY_RATE = 10
/** Al caer de un salto baja un poco y vuelve, en LAND_TIME segundos. */
const LAND_DIP = 0.045
const LAND_TIME = 0.35

// La estela de la espada: una cinta que sigue la punta de la hoja por el camino de verdad del golpe.
const TRAIL_SEGMENTS = 22
/** Cuánto del golpe (en fracción de su duración) abarca la estela detrás de la punta. */
const TRAIL_SPAN = 0.11
const TRAIL_OPACITY = 0.5
/** Desde qué parte de la hoja (de la empuñadura a la punta) se dibuja. */
const TRAIL_INNER = 0.72
// El escudo, abajo a la izquierda; al bloquear, delante y al centro, tapando parte de la vista.
const SHIELD_REST = new THREE.Vector3(-0.58, -0.56, -0.62)
const SHIELD_REST_ROTATION = new THREE.Euler(0.1, 0.6, 0.15)
const SHIELD_UP = new THREE.Vector3(-0.3, -0.45, -0.62)
const SHIELD_UP_ROTATION = new THREE.Euler(0, 0.1, 0)
/** Con qué rapidez sube y baja. */
const SHIELD_RATE = 14

export interface HandPose {
  rx: number
  ry?: number
  rz: number
  x: number
  y: number
  z: number
}

const smooth = (t: number) => t * t * (3 - 2 * t)
const smoother = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)
const easeOut = (t: number) => 1 - (1 - t) * (1 - t)
const clamp01 = (t: number) => Math.min(1, Math.max(0, t))

/** Dónde está el objeto al echarse atrás (`wind`) y al pegar (`hit`), relativo al reposo (giros desde el codo). */
interface SwingKeys {
  wind: Required<HandPose>
  hit: Required<HandPose>
}
const pose = (rx: number, ry: number, rz: number, x: number, y: number, z: number): Required<HandPose> => ({ rx, ry, rz, x, y, z })

/**
 * Cinco golpes por clase de arma, casi iguales pero con otro recorrido (inclinación, de qué lado viene, dónde acaba y
 * cuánto se echa atrás), que se van turnando sin repetir el mismo dos veces seguidas. La espada: tajos en diagonal, un
 * revés, uno más plano y uno de arriba. El hacha y el pico: de arriba y en diagonal, más pesados. A mano, empujones.
 */
export const SWING_KEYS: Record<WeaponClass, readonly SwingKeys[]> = {
  sword: [
    { wind: pose(0.3, -0.25, -0.15, 0.04, 0.04, 0.04), hit: pose(-0.12, 0.35, 0.56, -0.04, 0.11, -0.08) },
    { wind: pose(0.3, 0.25, 0.33, -0.03, 0.12, 0.03), hit: pose(-0.12, -0.3, -0.28, 0.05, -0.22, -0.08) },
    { wind: pose(0.15, -0.35, -0.36, 0.06, -0.06, 0.03), hit: pose(-0.05, 0.45, 0.53, -0.05, 0.12, -0.08) },
    { wind: pose(0.45, -0.05, 0.12, 0.02, 0.01, 0.05), hit: pose(-0.3, 0.08, 0.29, -0.03, -0.02, -0.12) },
    { wind: pose(0.35, -0.15, -0.07, 0.03, 0.03, 0.04), hit: pose(-0.2, 0.25, 0.46, -0.04, 0.03, -0.1) },
  ],
  axe: [
    { wind: pose(0.45, 0.14, -0.2, 0.04, -0.02, 0.06), hit: pose(-0.4, 0.12, 0.25, -0.05, 0.13, -0.12) },
    { wind: pose(0.4, 0.15, -0.45, 0.07, -0.02, 0.04), hit: pose(-0.36, 0.09, 0.45, -0.08, 0.18, -0.1) },
    { wind: pose(0.52, 0.29, -0.3, 0.06, -0.05, 0.08), hit: pose(-0.45, 0.08, 0.35, -0.06, 0.14, -0.13) },
    { wind: pose(0.48, -0.05, 0.05, 0, 0.01, 0.06), hit: pose(-0.42, 0.15, 0.15, -0.03, 0.1, -0.12) },
    { wind: pose(0.32, 0.11, -0.65, 0.09, -0.03, 0.03), hit: pose(-0.3, 0.13, 0.5, -0.1, 0.2, -0.1) },
  ],
  pickaxe: [
    { wind: pose(0.55, 0.19, -0.05, 0.02, 0.04, 0.06), hit: pose(-0.45, 0.22, 0.1, -0.03, 0.13, -0.13) },
    { wind: pose(0.48, 0.24, -0.3, 0.05, 0.02, 0.05), hit: pose(-0.4, 0.23, 0.3, -0.06, 0.16, -0.12) },
    { wind: pose(0.6, 0.34, -0.15, 0.03, 0, 0.08), hit: pose(-0.5, 0.2, 0.2, -0.05, 0.14, -0.14) },
    { wind: pose(0.52, 0.06, 0.12, -0.01, 0.07, 0.06), hit: pose(-0.44, 0.23, 0.02, -0.02, 0.14, -0.12) },
    { wind: pose(0.42, 0.17, -0.08, 0.02, 0.05, 0.04), hit: pose(-0.36, 0.25, 0.12, -0.03, 0.13, -0.1) },
  ],
  hand: [
    { wind: pose(0.15, 0, 0, 0, 0, 0.08), hit: pose(-0.25, 0, 0.1, -0.05, -0.02, -0.25) },
    { wind: pose(0.1, -0.2, -0.1, 0.05, 0, 0.06), hit: pose(-0.2, 0.25, 0.15, -0.12, -0.02, -0.22) },
    { wind: pose(0.2, 0.05, 0.05, 0, 0.03, 0.1), hit: pose(-0.3, -0.05, 0.05, -0.03, -0.05, -0.27) },
    { wind: pose(0.12, -0.1, -0.15, 0.06, 0.02, 0.07), hit: pose(-0.22, 0.15, 0.2, -0.08, -0.03, -0.24) },
    { wind: pose(0.18, 0.1, 0.1, -0.02, 0.02, 0.09), hit: pose(-0.28, -0.1, 0, 0, -0.04, -0.26) },
  ],
}
/** Cuánto sigue de largo tras pegar (en fracción del recorrido del golpe): la espada corta y sigue; lo pesado se para antes. */
const FOLLOW: Record<WeaponClass, number> = { sword: 0.2, axe: 0.1, pickaxe: 0.08, hand: 0.08 }
/** Si pega en algo, en vez de seguir rebota un poco hacia atrás (en fracción del recorrido). */
const REBOUND = 0.07

/** Las fases del golpe, en fracción de su duración, con `impact` la del golpe. */
export function swingPhases(impact: number) {
  return {
    /** Hasta aquí se echa atrás. */
    wind: impact * 0.62,
    /** Aguanta arriba, cargando, hasta aquí; luego cae cada vez más deprisa hasta pegar. */
    load: impact * 0.74,
    impact,
    /** Sigue de largo (o rebota) hasta aquí, frenando, y vuelve despacio al reposo. */
    follow: impact + (1 - impact) * 0.2,
  }
}

const REST_POSE = pose(0, 0, 0, 0, 0, 0)
const loaded = pose(0, 0, 0, 0, 0, 0)
const after = pose(0, 0, 0, 0, 0, 0)

function mix(out: HandPose, a: Required<HandPose>, b: Required<HandPose>, t: number) {
  out.rx = a.rx + (b.rx - a.rx) * t
  out.ry = a.ry + (b.ry - a.ry) * t
  out.rz = a.rz + (b.rz - a.rz) * t
  out.x = a.x + (b.x - a.x) * t
  out.y = a.y + (b.y - a.y) * t
  out.z = a.z + (b.z - a.z) * t
}

/**
 * El golpe de `item` (la variante `variant` de su clase) en el instante `p` (0 a 1 de su duración): se echa atrás,
 * aguanta un momento arriba, cae cada vez más deprisa hasta pegar justo en `swingImpactAt(item)`, sigue un poco de largo
 * frenando (o, con `landed`, rebota en lo que golpea) y vuelve despacio al reposo.
 */
export function swingPose(item: ItemId | null, variant: number, p: number, out: HandPose = { rx: 0, rz: 0, x: 0, y: 0, z: 0 }, landed = false): HandPose {
  const cls = weaponClass(item)
  const variants = SWING_KEYS[cls]
  const { wind, hit } = variants[((variant % variants.length) + variants.length) % variants.length]
  const phase = swingPhases(swingImpactAt(item))
  p = clamp01(p)
  // Cargando: un poco más atrás que `wind`. Tras pegar: más allá de `hit`, o algo antes si ha dado en algo.
  mix(loaded, wind, hit, -0.05)
  mix(after, wind, hit, landed ? 1 - REBOUND : 1 + FOLLOW[cls])
  if (p < phase.wind) mix(out, REST_POSE, wind, smooth(p / phase.wind))
  else if (p < phase.load) mix(out, wind, loaded, easeOut((p - phase.wind) / (phase.load - phase.wind)))
  else if (p < phase.impact) mix(out, loaded, hit, ((p - phase.load) / (phase.impact - phase.load)) ** 2.2)
  else if (p < phase.follow) mix(out, hit, after, easeOut((p - phase.impact) / (phase.follow - phase.impact)))
  else mix(out, after, REST_POSE, smoother((p - phase.follow) / (1 - phase.follow)))
  return out
}

/** Pose relativa al reposo para una animación en el instante `p` (0 a 1 de su duración). */
export function actionPose(action: HandAction, p: number, out: HandPose = { rx: 0, rz: 0, x: 0, y: 0, z: 0 }): HandPose {
  out.rx = out.rz = out.x = out.y = out.z = 0
  out.ry = 0
  p = clamp01(p)
  if (action === 'swing') {
    // Echa el brazo atrás, golpea hacia delante y abajo y vuelve.
    const WIND = 0.45
    const STRIKE = -0.65
    let strike = 0
    if (p < 0.25) out.rx = WIND * smooth(p / 0.25)
    else if (p < 0.5) {
      strike = (p - 0.25) / 0.25
      out.rx = WIND + (STRIKE - WIND) * strike * strike
    } else {
      strike = 1 - smooth((p - 0.5) / 0.5)
      out.rx = STRIKE * strike
    }
    out.rz = 0.35 * strike
    out.x = -0.1 * strike
    out.y = -0.06 * strike
    out.z = -0.18 * strike
  } else if (action === 'eat') {
    // Se lleva a la boca (centro de la pantalla) con un par de mordiscos.
    const a = Math.sin(Math.PI * p)
    out.x = -0.3 * a
    out.y = 0.12 * a + 0.02 * Math.sin(p * Math.PI * 6) * a
    out.z = 0.22 * a
    out.rx = 0.4 * a
  } else {
    // Empuja hacia abajo, como si lo dejara en el suelo.
    const a = Math.sin(Math.PI * p)
    out.rx = -0.6 * a
    out.y = -0.16 * a
    out.z = -0.1 * a
  }
  return out
}

const mat = (color: string) => new THREE.MeshStandardMaterial({ color, flatShading: true })
const handle = mat('#8a5a32')
const woodHead = mat('#c8955a')
const stoneHead = mat('#9a978a')
const ironHead = new THREE.MeshStandardMaterial({ color: '#d5dae0', flatShading: true, metalness: 0.25, roughness: 0.4 })
const mithrilHead = new THREE.MeshStandardMaterial({ color: '#8fd0f2', flatShading: true, metalness: 0.25, roughness: 0.35 })
const darkIron = new THREE.MeshStandardMaterial({ color: '#5f6670', flatShading: true, metalness: 0.25, roughness: 0.5 })
const furnaceStone = mat('#8f8a80')
const ember = new THREE.MeshBasicMaterial({ color: '#ff7a1f' })
const bark = mat('#7a5230')
const birchBark = mat('#ece8dc')
const birchMark = mat('#2f2c28')
const darkBark = mat('#3e2c20')
const deadBark = mat('#8d7b68')
const ore = mat('#7b7268')
const oreVein = new THREE.MeshStandardMaterial({ color: '#c8743a', flatShading: true, metalness: 0.4, roughness: 0.5 })
const mithrilRock = mat('#6c7080')
const mithrilVein = new THREE.MeshStandardMaterial({ color: '#4fb3f0', flatShading: true, metalness: 0.4, roughness: 0.4 })
const coalLump = new THREE.MeshStandardMaterial({ color: '#1c1b1a', flatShading: true, roughness: 0.35 })
const crystalGlass = new THREE.MeshStandardMaterial({ color: '#7ff0ff', emissive: '#2a9fb0', emissiveIntensity: 0.5, flatShading: true, roughness: 0.15 })
const plank = mat('#a8743f')
// Lo del meteorito brilla un poco por sí mismo, como su roca.
const meteorHead = new THREE.MeshStandardMaterial({ color: '#ff7a2f', emissive: '#c8400f', emissiveIntensity: 0.6, flatShading: true })
const meteorRock = mat('#3b322d')
const oilGold = mat('#d9a632')
const meteorVein = new THREE.MeshStandardMaterial({ color: '#ff7a1f', emissive: '#ff5a1f', flatShading: true })
const berryRed = mat('#c2304a')
const leaf = mat('#3d7d35')
const meat = mat('#c75a5a')
const roast = mat('#8f5128')
const fat = mat('#f0d6c8')
const mug = mat('#d9cdb8')
const herbLeaf = mat('#57a85a')
const herbFlower = mat('#f2a6d8')
const mintLeaf = mat('#7fd18a')
const mintTip = mat('#bff2ff')

const part = (geometry: THREE.BufferGeometry, material: THREE.Material) => new THREE.Mesh(geometry, material)

function sword(blade: THREE.Material) {
  const g = new THREE.Group()
  g.add(part(new THREE.BoxGeometry(0.04, 0.16, 0.04).translate(0, 0.02, 0), handle))
  g.add(part(new THREE.BoxGeometry(0.17, 0.03, 0.05).translate(0, 0.11, 0), darkIron))
  g.add(part(new THREE.BoxGeometry(0.065, 0.5, 0.02).translate(0, 0.37, 0), blade))
  return g
}

function axe(head: THREE.Material) {
  const g = new THREE.Group()
  g.add(part(new THREE.BoxGeometry(0.045, 0.62, 0.045).translate(0, 0.2, 0), handle))
  // Hoja hacia delante (-Z) en lo alto del mango.
  // Hoja hacia el centro de la pantalla (-X) en lo alto del mango.
  g.add(part(new THREE.BoxGeometry(0.17, 0.14, 0.03).translate(-0.085, 0.43, 0), head))
  return g
}

function pickaxe(head: THREE.Material) {
  const g = new THREE.Group()
  g.add(part(new THREE.BoxGeometry(0.045, 0.62, 0.045).translate(0, 0.2, 0), handle))
  // Cabeza en arco: una punta a cada lado, algo caídas.
  const tip = (side: number) =>
    new THREE.ConeGeometry(0.035, 0.24, 5)
      .rotateZ(side * (Math.PI / 2 + 0.3))
      .translate(side * -0.12, 0.45, 0)
  g.add(part(mergeGeometries([tip(1), tip(-1), new THREE.BoxGeometry(0.08, 0.06, 0.06).translate(0, 0.48, 0)]), head))
  return g
}

function berries() {
  const g = new THREE.Group()
  const spots = [
    [0, 0.07, 0],
    [0.07, 0.04, 0.03],
    [-0.06, 0.05, -0.03],
    [0.02, 0.12, -0.04],
  ]
  g.add(part(mergeGeometries(spots.map(([x, y, z]) => new THREE.IcosahedronGeometry(0.045, 0).translate(x, y, z))), berryRed))
  g.add(part(new THREE.IcosahedronGeometry(0.05, 0).scale(1.4, 0.4, 0.8).translate(0, 0.16, 0.02), leaf))
  return g
}

function meatCut(flesh: THREE.Material) {
  const g = new THREE.Group()
  g.add(part(new THREE.IcosahedronGeometry(0.11, 0).scale(1, 0.8, 1.3).translate(0, 0.14, -0.04), flesh))
  g.add(part(new THREE.CylinderGeometry(0.02, 0.02, 0.16, 5).translate(0, 0.04, 0), fat))
  return g
}

function herb(leaf = herbLeaf, flower = herbFlower) {
  const g = new THREE.Group()
  g.add(part(new THREE.IcosahedronGeometry(0.08, 0).scale(1, 0.7, 1).translate(0, 0.09, 0), leaf))
  g.add(part(new THREE.IcosahedronGeometry(0.04, 0).translate(0, 0.17, 0), flower))
  return g
}

function infusion() {
  const g = new THREE.Group()
  g.add(part(new THREE.CylinderGeometry(0.075, 0.06, 0.14, 7).translate(0, 0.08, 0), mug))
  g.add(part(new THREE.CylinderGeometry(0.066, 0.066, 0.01, 7).translate(0, 0.15, 0), berryRed))
  return g
}

function campfireBundle() {
  const g = new THREE.Group()
  for (let i = 0; i < 3; i++) {
    const log = part(new THREE.CylinderGeometry(0.035, 0.04, 0.34, 5), bark)
    log.position.set(0, 0.08 + i * 0.05, 0)
    log.rotation.set(Math.PI / 2, 0, (i - 1) * 0.6)
    g.add(log)
  }
  g.add(part(new THREE.IcosahedronGeometry(0.06, 0).translate(0.06, 0.2, 0.02), stoneHead))
  return g
}

function workbench() {
  const g = new THREE.Group()
  g.add(part(new THREE.BoxGeometry(0.2, 0.03, 0.13).translate(0, 0.13, 0), woodHead))
  const legs = [-1, 1].flatMap((x) => [-1, 1].map((z) => new THREE.BoxGeometry(0.025, 0.12, 0.025).translate(x * 0.08, 0.06, z * 0.045)))
  g.add(part(mergeGeometries(legs), bark))
  g.add(part(new THREE.BoxGeometry(0.06, 0.025, 0.025).translate(0.03, 0.157, 0), stoneHead))
  return g
}

function ingot(material: THREE.Material) {
  const g = new THREE.Group()
  // Lingote: un tronco de pirámide, más ancho por abajo.
  const bar = new THREE.CylinderGeometry(0.07, 0.1, 0.06, 4).rotateY(Math.PI / 4).scale(1.6, 1, 0.8).rotateY(0.4)
  g.add(part(bar.translate(0, 0.03, 0), material))
  return g
}

function furnace() {
  const g = new THREE.Group()
  g.add(part(new THREE.BoxGeometry(0.17, 0.17, 0.15).translate(0, 0.09, 0), furnaceStone))
  g.add(part(new THREE.BoxGeometry(0.05, 0.08, 0.05).translate(0.04, 0.21, -0.03), stoneHead))
  // La boca con brasas, hacia la cámara.
  g.add(part(new THREE.BoxGeometry(0.08, 0.05, 0.01).translate(0, 0.06, 0.076), ember))
  return g
}

function anvil() {
  const g = new THREE.Group()
  const pieces = [
    new THREE.BoxGeometry(0.12, 0.03, 0.08).translate(0, 0.015, 0),
    new THREE.BoxGeometry(0.06, 0.05, 0.05).translate(0, 0.055, 0),
    new THREE.BoxGeometry(0.15, 0.045, 0.07).translate(-0.01, 0.1, 0),
    new THREE.ConeGeometry(0.022, 0.07, 5).rotateZ(-Math.PI / 2).translate(0.1, 0.105, 0),
  ]
  g.add(part(mergeGeometries(pieces), darkIron))
  return g
}

function log(material: THREE.Material) {
  const g = new THREE.Group()
  g.add(part(new THREE.CylinderGeometry(0.06, 0.07, 0.36, 6).rotateX(Math.PI / 2 - 0.3).translate(0, 0.08, -0.04), material))
  return g
}

function birchLog() {
  const g = new THREE.Group()
  const tilt = (geometry: THREE.BufferGeometry) => geometry.rotateX(Math.PI / 2 - 0.3).translate(0, 0.08, -0.04)
  g.add(part(tilt(new THREE.CylinderGeometry(0.06, 0.07, 0.36, 6)), birchBark))
  // Dos marcas oscuras que asoman apenas del tronco (radio 0,07 abajo y 0,06 arriba).
  const mark = (y: number) => {
    const r = 0.065 - (y / 0.36) * 0.01 + 0.004
    return tilt(new THREE.CylinderGeometry(r, r, 0.03, 6).translate(0, y, 0))
  }
  g.add(part(mergeGeometries([mark(0.07), mark(-0.08)]), birchMark))
  return g
}

function oreChunk(rock: THREE.Material, vein: THREE.Material) {
  const g = new THREE.Group()
  g.add(part(new THREE.IcosahedronGeometry(0.1, 0).translate(0, 0.09, 0), rock))
  const spots = [
    [0.06, 0.14, 0.03],
    [-0.05, 0.12, -0.05],
    [0.02, 0.07, 0.08],
  ]
  g.add(part(mergeGeometries(spots.map(([x, y, z]) => new THREE.OctahedronGeometry(0.03, 0).translate(x, y, z))), vein))
  return g
}

/** Unos cristales alargados que salen de un mismo punto. */
function crystalCluster() {
  const g = new THREE.Group()
  const shard = (h: number, rz: number, rx: number) => new THREE.OctahedronGeometry(0.04, 0).scale(1, h, 1).rotateZ(rz).rotateX(rx).translate(0, 0.06, 0)
  g.add(part(mergeGeometries([shard(2.6, 0, 0), shard(1.8, 0.5, 0.2), shard(1.6, -0.45, -0.3)]), crystalGlass))
  return g
}

/** Un escudo redondo de cara a −Z: la cara, el borde y el refuerzo del centro. */
function shield(face: THREE.Material, rim: THREE.Material, boss: THREE.Material) {
  const g = new THREE.Group()
  // La cara asoma por los dos lados del borde: por detrás también se ve de qué es.
  g.add(part(new THREE.CylinderGeometry(0.19, 0.19, 0.025, 10).rotateX(Math.PI / 2).translate(0, 0.17, 0), rim))
  g.add(part(new THREE.CylinderGeometry(0.165, 0.165, 0.035, 10).rotateX(Math.PI / 2).translate(0, 0.17, 0), face))
  g.add(part(new THREE.SphereGeometry(0.045, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-Math.PI / 2).translate(0, 0.17, -0.017), boss))
  // El asa, detrás.
  g.add(part(new THREE.BoxGeometry(0.03, 0.12, 0.025).translate(0, 0.17, 0.03), handle))
  return g
}

/** Un peto: el pecho y las hombreras. */
function chestplate(metal: THREE.Material) {
  const g = new THREE.Group()
  const pieces = [
    new THREE.BoxGeometry(0.2, 0.22, 0.09).translate(0, 0.13, 0),
    new THREE.BoxGeometry(0.08, 0.05, 0.11).translate(-0.12, 0.22, 0),
    new THREE.BoxGeometry(0.08, 0.05, 0.11).translate(0.12, 0.22, 0),
  ]
  g.add(part(mergeGeometries(pieces), metal))
  // El cuello, hundido.
  g.add(part(new THREE.BoxGeometry(0.08, 0.03, 0.095).translate(0, 0.235, 0), darkIron))
  return g
}

/** Un casco: la cúpula y las carrilleras. */
function helmet(metal: THREE.Material) {
  const g = new THREE.Group()
  g.add(part(new THREE.SphereGeometry(0.11, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.08, 0), metal))
  g.add(part(mergeGeometries([new THREE.BoxGeometry(0.03, 0.08, 0.1).translate(-0.1, 0.05, 0.01), new THREE.BoxGeometry(0.03, 0.08, 0.1).translate(0.1, 0.05, 0.01)]), metal))
  // La cresta, más oscura.
  g.add(part(new THREE.BoxGeometry(0.02, 0.03, 0.2).translate(0, 0.19, 0), darkIron))
  return g
}

/** Unos pantalones: el cinto y las dos perneras. */
function leggings(metal: THREE.Material) {
  const g = new THREE.Group()
  g.add(part(mergeGeometries([new THREE.BoxGeometry(0.08, 0.2, 0.08).translate(-0.05, 0.1, 0), new THREE.BoxGeometry(0.08, 0.2, 0.08).translate(0.05, 0.1, 0)]), metal))
  g.add(part(new THREE.BoxGeometry(0.19, 0.04, 0.09).translate(0, 0.21, 0), darkIron))
  return g
}

/** Un par de botas. */
function boots(metal: THREE.Material) {
  const g = new THREE.Group()
  const boot = (x: number) => [new THREE.BoxGeometry(0.06, 0.12, 0.06).translate(x, 0.08, 0), new THREE.BoxGeometry(0.06, 0.04, 0.11).translate(x, 0.02, 0.025)]
  g.add(part(mergeGeometries([...boot(-0.05), ...boot(0.05)]), metal))
  return g
}

const glass = new THREE.MeshStandardMaterial({ color: '#dff4ff', transparent: true, opacity: 0.45, flatShading: true })
const cork = mat('#a87a4a')
const POTION_COLORS = { healing_potion: '#e0443a', speed_potion: '#f2c94c', stamina_potion: '#5fd18a', stone_potion: '#8a877c' } as const
const potionLiquid = Object.fromEntries(Object.entries(POTION_COLORS).map(([item, color]) => [item, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25, flatShading: true })]))
const incenseStick = mat('#5a3a1c')
const incenseTip = new THREE.MeshBasicMaterial({ color: '#ff7a1f' })
const amuletGold = new THREE.MeshStandardMaterial({ color: '#d8b04a', flatShading: true, metalness: 0.3, roughness: 0.5 })
const amuletGem = new THREE.MeshStandardMaterial({ color: '#9fd8ff', emissive: '#1e4a66', flatShading: true })

/** Un frasco redondo con su líquido y su corcho. */
function potion(item: keyof typeof POTION_COLORS) {
  const g = new THREE.Group()
  g.add(part(new THREE.IcosahedronGeometry(0.07, 1).translate(0, 0.07, 0), potionLiquid[item]))
  g.add(part(new THREE.IcosahedronGeometry(0.085, 1).translate(0, 0.07, 0), glass))
  g.add(part(new THREE.CylinderGeometry(0.025, 0.03, 0.07, 6).translate(0, 0.17, 0), glass))
  g.add(part(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 6).translate(0, 0.215, 0), cork))
  return g
}

function incense() {
  const g = new THREE.Group()
  g.add(part(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 5).translate(0, 0.15, 0), incenseStick))
  g.add(part(new THREE.OctahedronGeometry(0.02, 0).translate(0, 0.31, 0), incenseTip))
  return g
}

function amulet() {
  const g = new THREE.Group()
  g.add(part(new THREE.TorusGeometry(0.07, 0.012, 5, 10).translate(0, 0.12, 0), amuletGold))
  g.add(part(new THREE.OctahedronGeometry(0.04, 0).translate(0, 0.12, 0), amuletGem))
  return g
}

/** Modelo de un objeto a escala de la mano (también se usa, escalado, para los objetos en el suelo). */
export function itemModel(item: ItemId): THREE.Group {
  switch (item) {
    case 'wood_axe':
      return weaponModel('Hacha', woodHead) ?? axe(woodHead)
    case 'stone_axe':
      return weaponModel('Hacha', stoneHead) ?? axe(stoneHead)
    case 'iron_axe':
      return weaponModel('Hacha', ironHead) ?? axe(ironHead)
    case 'mithril_axe':
      return weaponModel('Hacha', mithrilHead) ?? axe(mithrilHead)
    case 'meteor_axe':
      return axe(meteorHead)
    case 'wood_pickaxe':
      return pickaxe(woodHead)
    case 'stone_pickaxe':
      return pickaxe(stoneHead)
    case 'iron_pickaxe':
      return pickaxe(ironHead)
    case 'mithril_pickaxe':
      return pickaxe(mithrilHead)
    case 'meteor_pickaxe':
      return pickaxe(meteorHead)
    case 'wood_sword':
      return weaponModel('Espada', woodHead) ?? sword(woodHead)
    case 'stone_sword':
      return weaponModel('Espada', stoneHead) ?? sword(stoneHead)
    case 'iron_sword':
      return weaponModel('Espadon', ironHead) ?? sword(ironHead)
    case 'mithril_sword':
      return weaponModel('Espadon', mithrilHead) ?? sword(mithrilHead)
    case 'meteor_sword':
      return weaponModel('Espadon', meteorHead) ?? sword(meteorHead)
    case 'meteor_fragment':
      return oreChunk(meteorRock, meteorVein)
    case 'wood':
      return log(bark)
    case 'dry_wood':
      return log(deadBark)
    case 'dark_wood':
      return log(darkBark)
    case 'stone': {
      const rock = new THREE.Group()
      rock.add(part(new THREE.IcosahedronGeometry(0.1, 0).translate(0, 0.09, 0), stoneHead))
      return rock
    }
    case 'berry':
      return berries()
    case 'raw_meat':
      return meatCut(meat)
    case 'cooked_meat':
      return meatCut(roast)
    case 'berry_infusion':
      return infusion()
    case 'healing_herb':
      return herb()
    case 'mint':
      return herb(mintLeaf, mintTip)
    case 'healing_potion':
    case 'speed_potion':
    case 'stamina_potion':
    case 'stone_potion':
      return potion(item)
    case 'calm_incense':
      return incense()
    case 'forget_amulet':
      return amulet()
    case 'campfire':
      return campfireBundle()
    case 'workbench':
      return workbench()
    case 'birch_wood':
      return birchLog()
    case 'iron_ore':
      return oreChunk(ore, oreVein)
    case 'mithril_ore':
      return oreChunk(mithrilRock, mithrilVein)
    case 'iron_bar':
      return ingot(ironHead)
    case 'mithril_bar':
      return ingot(mithrilHead)
    case 'furnace':
    case 'distiller':
      return furnace()
    case 'boss_trophy':
      return ingot(oilGold)
    case 'plane_engine':
      return ingot(ironHead)
    case 'oil':
      return ingot(oilGold)
    case 'anvil':
      return anvil()
    case 'coin':
      return coin()
    case 'coal':
      return oreChunk(coalLump, coalLump)
    case 'crystal':
      return crystalCluster()
    case 'wood_shield':
      return shield(plank, handle, darkIron)
    case 'iron_shield':
      return shield(ironHead, darkIron, ironHead)
    case 'crystal_shield':
      return shield(crystalGlass, ironHead, crystalGlass)
    case 'iron_chestplate':
      return chestplate(ironHead)
    case 'mithril_chestplate':
      return chestplate(mithrilHead)
    case 'iron_helmet':
      return helmet(ironHead)
    case 'mithril_helmet':
      return helmet(mithrilHead)
    case 'iron_leggings':
      return leggings(ironHead)
    case 'mithril_leggings':
      return leggings(mithrilHead)
    case 'iron_boots':
      return boots(ironHead)
    case 'mithril_boots':
      return boots(mithrilHead)
  }
}

/** Una moneda de canto, que se ve girar en el suelo. */
function coin() {
  const g = new THREE.Group()
  g.add(part(new THREE.CylinderGeometry(0.1, 0.1, 0.025, 12).rotateX(Math.PI / 2).translate(0, 0.12, 0), oilGold))
  return g
}

/** El color de la estela de cada espada: casi blanca, con el tinte de su material. */
const TRAIL_COLORS: Partial<Record<ItemId, string>> = {
  wood_sword: '#fff1d6',
  stone_sword: '#f4f4f0',
  iron_sword: '#e6f5ff',
  mithril_sword: '#a6e8ff',
  meteor_sword: '#ffb27a',
}

const trailPose: HandPose = { rx: 0, ry: 0, rz: 0, x: 0, y: 0, z: 0 }
const blendTo = pose(0, 0, 0, 0, 0, 0)
const rootMatrix = new THREE.Matrix4()
const gripMatrix = new THREE.Matrix4()
const euler = new THREE.Euler()
const quaternion = new THREE.Quaternion()
const position = new THREE.Vector3()
const ONE = new THREE.Vector3(1, 1, 1)
const tip = new THREE.Vector3()

/** La cinta de la estela: un par de vértices (filo y parte de dentro de la hoja) por cada punto del camino. */
function trailGeometry() {
  const geometry = new THREE.BufferGeometry()
  const vertices = (TRAIL_SEGMENTS + 1) * 2
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices * 3), 3).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(vertices * 3), 3).setUsage(THREE.DynamicDrawUsage))
  const index: number[] = []
  for (let i = 0; i < TRAIL_SEGMENTS; i++) {
    const o = i * 2
    index.push(o, o + 1, o + 2, o + 1, o + 3, o + 2)
  }
  geometry.setIndex(index)
  return geometry
}

/**
 * Objeto seleccionado en primera persona, en su propia escena y cámara: se dibuja encima del
 * mundo (sin atravesar árboles) y con su propio FOV.
 */
export class Handheld {
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  /** Objeto en la mano (null = mano vacía). */
  item: ItemId | null = null
  action: HandAction | null = null
  /** La estela del golpe de espada: sigue la punta de la hoja por el camino del golpe. */
  readonly trail: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  private actionTime = 0
  private actionLength = 0
  private swap = 1
  private bob = 0
  private bobWeight = 0
  private time = 0
  /** El codo, desde donde gira el golpe; el puño (con la inclinación del objeto) y el giro sobre el mango. */
  private root = new THREE.Group()
  private holder = new THREE.Group()
  private twist = new THREE.Group()
  private hold: Hold = HOLDS.hand
  /** Lo que mide la hoja (o el objeto) desde el puño, para la estela. */
  private reach = 0
  private models = new Map<ItemId, THREE.Group>()
  /** El último golpe de cada clase de arma: el siguiente es otro. */
  private lastVariant: Partial<Record<WeaponClass, number>> = {}
  private variant = 0
  /** El golpe en curso ha dado en algo: rebota en vez de seguir, y tiembla un poco. */
  private landed = false
  private recoil = 0
  /** La pose de la que viene (al empezar una animación) y lo que queda de fundido. */
  private from: Required<HandPose> = pose(0, 0, 0, 0, 0, 0)
  private blendLeft = 0
  private hemi = new THREE.HemisphereLight()
  private ambient = new THREE.AmbientLight('#ffffff', MIN_AMBIENT)
  private light = new THREE.DirectionalLight()
  private pose: Required<HandPose> = pose(0, 0, 0, 0, 0, 0)
  /** Inercia al mirar y al caer de un salto. */
  private sway = { x: 0, y: 0 }
  private lastLook: { yaw: number; pitch: number } | null = null
  private airborne = false
  private landAge = Infinity
  /** Lo que se suma a la pose este frame (balanceo, inercia…): la estela lo copia para ir pegada a la hoja. */
  private offset = pose(0, 0, 0, 0, 0, 0)
  /** El escudo puesto, en la mano izquierda, y cuánto está levantado (0 a 1). */
  private shield = new THREE.Group()
  private shieldItem: ItemId | null = null
  private shieldUp = 0
  private blocking = false

  constructor(
    aspect: number,
    private rng: () => number = Math.random,
  ) {
    this.camera = new THREE.PerspectiveCamera(HAND_FOV, aspect, 0.01, 10)
    // Luz fija respecto a la cámara: de arriba a la izquierda y algo por detrás.
    this.light.position.set(-1, 2, 1.5)
    // Solo el objeto, sin la mano: el puño queda fuera del encuadre.
    this.root.add(this.holder)
    this.holder.add(this.twist)
    this.applyHold(HOLDS.hand)
    this.trail = new THREE.Mesh(
      trailGeometry(),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: TRAIL_OPACITY,
        vertexColors: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    )
    this.trail.frustumCulled = false
    this.trail.visible = false
    this.shield.scale.setScalar(0.9)
    this.scene.add(this.hemi, this.ambient, this.light, this.root, this.trail, this.shield)
  }

  /** El escudo que se lleva puesto (null: ninguno) y si está arriba. */
  setShield(item: ItemId | null, blocking: boolean) {
    this.blocking = item !== null && blocking
    if (item === this.shieldItem) return
    this.shieldItem = item
    this.shield.clear()
    if (!item) return
    // Un clon: el mismo objeto puede estar a la vez en la mano derecha.
    this.shield.add(this.modelOf(item).clone())
  }

  setAspect(aspect: number) {
    this.camera.aspect = aspect
    this.camera.updateProjectionMatrix()
  }

  /**
   * Cambia el objeto: el nuevo sube desde abajo y se corta la animación en curso. Comiendo o
   * colocando se espera a que acabe, para que la última baya o fogata no desaparezca a medias.
   */
  setItem(item: ItemId | null) {
    if (item === this.item || this.action === 'eat' || this.action === 'place') return
    this.action = null
    this.blendLeft = 0
    this.swap = 0
    this.show(item)
  }

  /**
   * Empieza una animación, fundiéndose con lo que estuviera haciendo (un golpe nuevo no salta desde la mitad del
   * anterior). Con `item`, la hace con ese objeto. Cada golpe es una variante de su arma distinta de la anterior.
   */
  play(action: HandAction, item?: ItemId, seconds?: number) {
    Object.assign(this.from, this.pose)
    this.blendLeft = BLEND_TIME
    this.action = action
    this.actionTime = 0
    this.landed = false
    if (item !== undefined) this.show(item)
    this.actionLength = seconds ?? (action === 'swing' ? swingDuration(this.item) : ACTION_DURATION[action])
    if (action === 'swing') {
      const cls = weaponClass(this.item)
      const count = SWING_KEYS[cls].length
      const last = this.lastVariant[cls]
      this.variant = last === undefined ? Math.floor(this.rng() * count) : (last + 1 + Math.floor(this.rng() * (count - 1))) % count
      this.lastVariant[cls] = this.variant
    }
  }

  /** El golpe en curso ha dado en algo: rebota y tiembla un momento, en vez de seguir de largo. */
  hit() {
    if (this.action !== 'swing') return
    this.landed = true
    this.recoil = 1
  }

  /** Corta `action` si es la que está haciendo (comer, al cancelarse). */
  stop(action: HandAction) {
    if (this.action !== action) return
    Object.assign(this.from, this.pose)
    this.blendLeft = BLEND_TIME
    this.action = null
  }

  /** La variante del golpe en curso: para las pruebas. */
  get swingVariant() {
    return this.variant
  }

  /** Vuelve a hacer los modelos (al llegar las armas de verdad, en vez de las hechas en código). */
  refresh() {
    const item = this.item
    const shield = this.shieldItem
    this.models.clear()
    this.item = null
    this.shieldItem = null
    this.show(item)
    if (shield) this.setShield(shield, this.blocking)
  }

  private modelOf(item: ItemId) {
    let model = this.models.get(item)
    if (!model) {
      model = itemModel(item)
      this.models.set(item, model)
    }
    return model
  }

  private applyHold(hold: Hold) {
    this.hold = hold
    this.holder.position.copy(hold.grip)
    this.holder.rotation.copy(hold.tilt)
    this.holder.scale.setScalar(hold.scale)
    this.twist.rotation.set(0, hold.twist, 0)
    this.twist.updateMatrix()
  }

  private show(item: ItemId | null) {
    if (item === this.item) return
    this.item = item
    this.twist.clear()
    this.applyHold(HOLDS[weaponClass(item)])
    if (!item) return
    const model = this.modelOf(item)
    // De lo que mide el objeto desde el puño (el origen del modelo, hacia +Y) sale la estela. Se mide suelto, antes de
    // colgarlo: así no cuentan el tamaño ni el giro de la mano.
    model.updateMatrixWorld(true)
    this.reach = new THREE.Box3().setFromObject(model).max.y
    this.twist.add(model)
  }

  /**
   * Por frame: anima con `speed` (velocidad horizontal), `grounded` y `look` (hacia dónde mira, para la inercia al
   * girar), y copia la luz del cielo.
   */
  update(dt: number, speed: number, grounded: boolean, sky?: Pick<Sky, 'hemi' | 'sun'>, look?: { yaw: number; pitch: number }) {
    this.time += dt
    if (this.action) {
      this.actionTime += dt
      if (this.actionTime >= this.actionLength) this.action = null
    }
    this.swap = Math.min(1, this.swap + dt / SWAP_DURATION)
    this.blendLeft = Math.max(0, this.blendLeft - dt)

    // La animación, fundida con la anterior al empezar.
    const target = this.pose
    if (this.action === 'swing') swingPose(this.item, this.variant, this.actionTime / this.actionLength, target, this.landed)
    else if (this.action) actionPose(this.action, this.actionTime / this.actionLength, target)
    else Object.assign(target, REST_POSE)
    if (this.blendLeft > 0) mix(target, this.from, Object.assign(blendTo, target), smooth(1 - this.blendLeft / BLEND_TIME))

    this.updateMotion(dt, speed, grounded, look)
    const { rest, restRotation } = this.hold
    const o = this.offset
    const drop = (1 - smooth(this.swap)) * SWAP_DROP
    this.root.position.set(rest.x + target.x + o.x, rest.y + target.y + o.y - drop, rest.z + target.z + o.z)
    this.root.rotation.set(restRotation.x + target.rx + o.rx, restRotation.y + target.ry + o.ry, restRotation.z + target.rz + o.rz)
    this.updateTrail()
    this.updateShield(dt)

    if (sky) {
      this.hemi.color.copy(sky.hemi.color)
      this.hemi.groundColor.copy(sky.hemi.groundColor)
      this.hemi.intensity = sky.hemi.intensity
      this.light.color.copy(sky.sun.color)
      this.light.intensity = sky.sun.intensity
    }
  }

  /**
   * Lo que se mueve el objeto aparte de la animación: un ocho suave al andar (menos mientras golpea, y nada en el aire),
   * la respiración en reposo, la inercia al girar la cámara, el bajón al caer de un salto y el temblor de un golpe que da.
   */
  private updateMotion(dt: number, speed: number, grounded: boolean, look?: { yaw: number; pitch: number }) {
    const moving = grounded && speed > 0.5
    const swinging = this.action === 'swing'
    this.bobWeight += ((moving ? (swinging ? 0.35 : 1) : 0) - this.bobWeight) * Math.min(1, dt * 6)
    this.bob += dt * speed * BOB_RATE
    const w = this.bobWeight
    const o = this.offset
    o.x = Math.sin(this.bob) * BOB_AMOUNT * w
    o.y = -Math.abs(Math.cos(this.bob)) * BOB_AMOUNT * w
    o.z = 0
    o.rz = Math.sin(this.bob) * BOB_TILT * w
    o.rx = Math.cos(this.bob * 2) * BOB_TILT * 0.4 * w
    o.ry = 0

    const still = (1 - w) * (swinging ? 0 : 1)
    o.y += Math.sin(this.time * BREATH_RATE) * BREATH_AMOUNT * still
    o.rx += Math.sin(this.time * BREATH_RATE + 0.6) * BREATH_AMOUNT * 1.5 * still

    if (look && dt > 0) {
      const last = this.lastLook ?? look
      const turn = Math.atan2(Math.sin(look.yaw - last.yaw), Math.cos(look.yaw - last.yaw)) / dt
      const tilt = (look.pitch - last.pitch) / dt
      const clampSway = (v: number) => Math.max(-SWAY_MAX, Math.min(SWAY_MAX, v))
      this.sway.x = THREE.MathUtils.damp(this.sway.x, clampSway(turn * SWAY_PER_TURN), SWAY_RATE, dt)
      this.sway.y = THREE.MathUtils.damp(this.sway.y, clampSway(-tilt * SWAY_PER_TURN), SWAY_RATE, dt)
      this.lastLook = { yaw: look.yaw, pitch: look.pitch }
    }
    o.x += this.sway.x
    o.y += this.sway.y
    o.ry += this.sway.x * 0.8
    o.rx -= this.sway.y * 0.6

    if (!grounded) this.airborne = true
    else if (this.airborne) {
      this.airborne = false
      this.landAge = 0
    }
    this.landAge += dt
    if (this.landAge < LAND_TIME) o.y -= Math.sin(Math.PI * (this.landAge / LAND_TIME)) * LAND_DIP

    this.recoil = THREE.MathUtils.damp(this.recoil, 0, 12, dt)
    o.x += Math.sin(this.time * 70) * 0.008 * this.recoil
    o.y += Math.cos(this.time * 55) * 0.006 * this.recoil
  }

  /**
   * La estela de la espada: la cinta entre el filo y la parte de dentro de la hoja por donde ha pasado en el último
   * trozo del golpe (TRAIL_SPAN), calculada con la misma pose del golpe: va por su camino de verdad en cada variante.
   * Aparece al caer, culmina al pegar y se apaga al seguir de largo.
   */
  private updateTrail() {
    const color = this.item ? TRAIL_COLORS[this.item] : undefined
    const p = this.action === 'swing' && color ? this.actionTime / this.actionLength : -1
    const phase = swingPhases(swingImpactAt(this.item))
    const start = phase.load
    const end = phase.follow
    const head = Math.min(p, end)
    const tail = Math.max(start, p - TRAIL_SPAN)
    const fade = p > end ? 1 - (p - end) / (TRAIL_SPAN * 0.6) : Math.min(1, (p - start) / 0.04)
    const visible = p > start && head > tail && fade > 0
    this.trail.visible = visible
    if (!visible) return
    this.trail.material.color.set(color!)
    this.trail.material.opacity = TRAIL_OPACITY
    const positions = this.trail.geometry.getAttribute('position') as THREE.BufferAttribute
    const colors = this.trail.geometry.getAttribute('color') as THREE.BufferAttribute
    for (let i = 0; i <= TRAIL_SEGMENTS; i++) {
      const k = i / TRAIL_SEGMENTS
      this.strikeMatrix(tail + (head - tail) * k)
      for (const [side, along] of [[0, 1], [1, TRAIL_INNER]] as const) {
        tip.set(0, this.reach * along, 0).applyMatrix4(rootMatrix)
        positions.setXYZ(i * 2 + side, tip.x, tip.y, tip.z)
        // Brilla hacia la punta y hacia lo más reciente; la parte de dentro, apenas.
        const glow = k ** 2.4 * fade * (side === 0 ? 1 : 0.05)
        colors.setXYZ(i * 2 + side, glow, glow, glow)
      }
    }
    positions.needsUpdate = true
    colors.needsUpdate = true
  }

  /** Deja en `rootMatrix` dónde está el objeto (del puño hacia +Y) en el instante `p` del golpe en curso. */
  private strikeMatrix(p: number) {
    gripMatrix.compose(this.holder.position, this.holder.quaternion, this.holder.scale).multiply(this.twist.matrix)
    const { rest, restRotation } = this.hold
    const o = this.offset
    swingPose(this.item, this.variant, p, trailPose, this.landed)
    position.set(rest.x + trailPose.x + o.x, rest.y + trailPose.y + o.y, rest.z + trailPose.z + o.z)
    euler.set(restRotation.x + trailPose.rx + o.rx, restRotation.y + (trailPose.ry ?? 0) + o.ry, restRotation.z + trailPose.rz + o.rz)
    rootMatrix.compose(position, quaternion.setFromEuler(euler), ONE).multiply(gripMatrix)
  }

  /**
   * Hacia dónde cruza la pantalla la punta del golpe en curso al pegar (radianes desde la horizontal, hacia arriba):
   * así el tajo que deja la espada en el enemigo va en la misma dirección que el golpe. null si no está golpeando.
   */
  slashAngle(): number | null {
    if (this.action !== 'swing') return null
    const phase = swingPhases(swingImpactAt(this.item))
    const screen = (p: number) => {
      this.strikeMatrix(p)
      tip.set(0, this.reach * 0.8, 0).applyMatrix4(rootMatrix)
      return { x: tip.x / -tip.z, y: tip.y / -tip.z }
    }
    const from = screen(phase.load)
    const to = screen(phase.impact)
    return Math.atan2(to.y - from.y, to.x - from.x)
  }

  private updateShield(dt: number) {
    this.shieldUp = THREE.MathUtils.damp(this.shieldUp, this.blocking ? 1 : 0, SHIELD_RATE, dt)
    const up = smooth(this.shieldUp)
    const o = this.offset
    this.shield.position.lerpVectors(SHIELD_REST, SHIELD_UP, up)
    this.shield.position.x += o.x * 0.6
    this.shield.position.y += o.y * 0.6
    this.shield.rotation.set(
      THREE.MathUtils.lerp(SHIELD_REST_ROTATION.x, SHIELD_UP_ROTATION.x, up),
      THREE.MathUtils.lerp(SHIELD_REST_ROTATION.y, SHIELD_UP_ROTATION.y, up),
      THREE.MathUtils.lerp(SHIELD_REST_ROTATION.z, SHIELD_UP_ROTATION.z, up),
    )
  }

  /** Se dibuja después del mundo, borrando solo la profundidad. */
  render(renderer: THREE.WebGLRenderer) {
    renderer.clearDepth()
    renderer.render(this.scene, this.camera)
  }
}
