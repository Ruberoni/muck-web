import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Sky } from '../scene'
import type { ItemId } from '../sim/inventory'

/** Animaciones del objeto en la mano. */
export type HandAction = 'swing' | 'eat' | 'place'

// Más corto que HIT_COOLDOWN: manteniendo el clic queda una pausa entre golpe y golpe.
export const ACTION_DURATION: Record<HandAction, number> = { swing: 0.32, eat: 0.45, place: 0.3 }
const SWAP_DURATION = 0.18
const SWAP_DROP = 0.45
// FOV propio: el objeto no se deforma aunque cambie el de la cámara del mundo.
const HAND_FOV = 60
// El brazo gira desde el codo, abajo a la derecha (espacio de cámara: -Z hacia delante).
const REST = new THREE.Vector3(0.5, -0.56, -0.55)
const REST_ROTATION = new THREE.Euler(0.1, 0.3, -0.1)
// Del codo al puño.
const FIST = new THREE.Vector3(-0.02, 0.2, -0.28)
const BOB_AMOUNT = 0.018
const BOB_RATE = 1.6
// La mano se ve aunque sea de noche cerrada.
const MIN_AMBIENT = 0.35

export interface HandPose {
  rx: number
  rz: number
  x: number
  y: number
  z: number
}

const smooth = (t: number) => t * t * (3 - 2 * t)
const clamp01 = (t: number) => Math.min(1, Math.max(0, t))

/** Pose relativa al reposo para una animación en el instante `p` (0 a 1 de su duración). */
export function actionPose(action: HandAction, p: number, out: HandPose = { rx: 0, rz: 0, x: 0, y: 0, z: 0 }): HandPose {
  out.rx = out.rz = out.x = out.y = out.z = 0
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
const skin = mat('#e0ad84')
const sleeve = mat('#3f6a8c')
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
const ore = mat('#7b7268')
const oreVein = new THREE.MeshStandardMaterial({ color: '#c8743a', flatShading: true, metalness: 0.4, roughness: 0.5 })
const mithrilRock = mat('#6c7080')
const mithrilVein = new THREE.MeshStandardMaterial({ color: '#4fb3f0', flatShading: true, metalness: 0.4, roughness: 0.4 })
const berryRed = mat('#c2304a')
const leaf = mat('#3d7d35')
const meat = mat('#c75a5a')
const fat = mat('#f0d6c8')

const part = (geometry: THREE.BufferGeometry, material: THREE.Material) => new THREE.Mesh(geometry, material)

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

function rawMeat() {
  const g = new THREE.Group()
  g.add(part(new THREE.IcosahedronGeometry(0.11, 0).scale(1, 0.8, 1.3).translate(0, 0.14, -0.04), meat))
  g.add(part(new THREE.CylinderGeometry(0.02, 0.02, 0.16, 5).translate(0, 0.04, 0), fat))
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

/** Modelo de un objeto a escala de la mano (también se usa, escalado, para los objetos en el suelo). */
export function itemModel(item: ItemId): THREE.Group {
  switch (item) {
    case 'wood_axe':
      return axe(woodHead)
    case 'stone_axe':
      return axe(stoneHead)
    case 'iron_axe':
      return axe(ironHead)
    case 'mithril_axe':
      return axe(mithrilHead)
    case 'wood_pickaxe':
      return pickaxe(woodHead)
    case 'stone_pickaxe':
      return pickaxe(stoneHead)
    case 'iron_pickaxe':
      return pickaxe(ironHead)
    case 'mithril_pickaxe':
      return pickaxe(mithrilHead)
    case 'wood':
      return log(bark)
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
      return rawMeat()
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
      return furnace()
    case 'anvil':
      return anvil()
  }
}

/** Antebrazo del codo al puño, y el puño. */
function arm() {
  const g = new THREE.Group()
  const length = FIST.length()
  const forearm = part(new THREE.BoxGeometry(0.09, 0.09, length).translate(0, 0, -length / 2), sleeve)
  forearm.lookAt(FIST.clone().negate())
  const fist = part(new THREE.BoxGeometry(0.09, 0.09, 0.1), skin)
  fist.position.copy(FIST)
  g.add(forearm, fist)
  return g
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
  private actionTime = 0
  private swap = 1
  private bob = 0
  private bobWeight = 0
  private root = new THREE.Group()
  private holder = new THREE.Group()
  private models = new Map<ItemId, THREE.Group>()
  private hemi = new THREE.HemisphereLight()
  private ambient = new THREE.AmbientLight('#ffffff', MIN_AMBIENT)
  private light = new THREE.DirectionalLight()
  private pose: HandPose = { rx: 0, rz: 0, x: 0, y: 0, z: 0 }

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(HAND_FOV, aspect, 0.01, 10)
    // Luz fija respecto a la cámara: de arriba a la izquierda y algo por detrás.
    this.light.position.set(-1, 2, 1.5)
    this.root.add(arm(), this.holder)
    // El objeto sale del puño, algo inclinado hacia delante y hacia el centro.
    this.holder.position.copy(FIST)
    this.holder.rotation.set(-0.35, 0, 0.15)
    this.holder.scale.setScalar(0.75)
    this.scene.add(this.hemi, this.ambient, this.light, this.root)
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
    this.swap = 0
    this.show(item)
  }

  /** Empieza una animación; un golpe nuevo reinicia el anterior. Con `item`, la hace con ese objeto. */
  play(action: HandAction, item?: ItemId) {
    this.action = action
    this.actionTime = 0
    if (item !== undefined) this.show(item)
  }

  private show(item: ItemId | null) {
    if (item === this.item) return
    this.item = item
    this.holder.clear()
    if (!item) return
    let model = this.models.get(item)
    if (!model) {
      model = itemModel(item)
      this.models.set(item, model)
    }
    this.holder.add(model)
  }

  /** Por frame: anima con `speed` (velocidad horizontal) y copia la luz del cielo. */
  update(dt: number, speed: number, grounded: boolean, sky?: Pick<Sky, 'hemi' | 'sun'>) {
    if (this.action) {
      this.actionTime += dt
      if (this.actionTime >= ACTION_DURATION[this.action]) this.action = null
    }
    this.swap = Math.min(1, this.swap + dt / SWAP_DURATION)

    // Balanceo al andar, que se desvanece al pararse o en el aire.
    const moving = grounded && speed > 0.5
    this.bobWeight += ((moving ? 1 : 0) - this.bobWeight) * Math.min(1, dt * 8)
    this.bob += dt * speed * BOB_RATE

    const pose = this.pose
    if (this.action) actionPose(this.action, this.actionTime / ACTION_DURATION[this.action], pose)
    else pose.rx = pose.rz = pose.x = pose.y = pose.z = 0
    const bobX = Math.sin(this.bob) * BOB_AMOUNT * this.bobWeight
    const bobY = -Math.abs(Math.cos(this.bob)) * BOB_AMOUNT * this.bobWeight
    const drop = (1 - smooth(this.swap)) * SWAP_DROP

    this.root.position.set(REST.x + pose.x + bobX, REST.y + pose.y + bobY - drop, REST.z + pose.z)
    this.root.rotation.set(REST_ROTATION.x + pose.rx, REST_ROTATION.y, REST_ROTATION.z + pose.rz)

    if (sky) {
      this.hemi.color.copy(sky.hemi.color)
      this.hemi.groundColor.copy(sky.hemi.groundColor)
      this.hemi.intensity = sky.hemi.intensity
      this.light.color.copy(sky.sun.color)
      this.light.intensity = sky.sun.intensity
    }
  }

  /** Se dibuja después del mundo, borrando solo la profundidad. */
  render(renderer: THREE.WebGLRenderer) {
    renderer.clearDepth()
    renderer.render(this.scene, this.camera)
  }
}
