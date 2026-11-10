import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { DEFAULT_ISLAND, type Island } from '../sim/world/island'
import { enemyFloor } from '../sim/world/terrain'
import { ENEMY_BODY_LIFT, ENEMY_BODY_RADIUS, ENEMY_BODY_SCALE } from '../sim/aim'
import { ENEMY_DEFS, type EnemyType, type HitEfficacy } from '../sim/constants'
import type { ChargeState, EnemyData } from '../sim/enemies'
import type { SimEventData } from '../sim/events'

const HURT_FLASH = 0.15
const LUNGE_TIME = 0.2
const DEATH_TIME = 0.35
const CROUCH_SQUASH = new THREE.Vector3(1.15, 0.7, 1.15)
const RUSH_LEAN = 0.4
const AIM_STRETCH = new THREE.Vector3(0.95, 1.08, 0.95)
const AIM_LEAN = -0.2
const DAZED_TILT = 0.3
// Por debajo de esta fracción de su velocidad no se considera que ande (los empujones entre ellos no lo hacen botar).
const WALK_MIN_SPEED = 0.1

// El cuerpo es también la hitbox (sim/aim.ts).
const bodyGeometry = new THREE.IcosahedronGeometry(ENEMY_BODY_RADIUS, 0)
  .scale(ENEMY_BODY_SCALE.x, ENEMY_BODY_SCALE.y, ENEMY_BODY_SCALE.z)
  .translate(0, ENEMY_BODY_LIFT, 0)
// Cuernos y pies, del mismo color oscuro, en una sola geometría.
const detailGeometry = mergeGeometries([
  new THREE.ConeGeometry(0.08, 0.32, 5).rotateZ(-0.4).translate(0.24, 1.38, 0),
  new THREE.ConeGeometry(0.08, 0.32, 5).rotateZ(0.4).translate(-0.24, 1.38, 0),
  new THREE.BoxGeometry(0.18, 0.15, 0.28).translate(0.2, 0.075, 0.04),
  new THREE.BoxGeometry(0.18, 0.15, 0.28).translate(-0.2, 0.075, 0.04),
])
// Mirando hacia +Z local.
const eyeGeometry = mergeGeometries([
  new THREE.OctahedronGeometry(0.08, 0).translate(0.16, 1.02, 0.4),
  new THREE.OctahedronGeometry(0.08, 0).translate(-0.16, 1.02, 0.4),
])
// Hombros y puños de roca, y pies, del gólem.
const golemDetailGeometry = mergeGeometries([
  new THREE.IcosahedronGeometry(0.27, 0).translate(0.5, 1.02, 0),
  new THREE.IcosahedronGeometry(0.27, 0).translate(-0.5, 1.02, 0),
  new THREE.IcosahedronGeometry(0.2, 0).translate(0.58, 0.5, 0.12),
  new THREE.IcosahedronGeometry(0.2, 0).translate(-0.58, 0.5, 0.12),
  new THREE.BoxGeometry(0.24, 0.16, 0.32).translate(0.22, 0.08, 0.04).toNonIndexed(),
  new THREE.BoxGeometry(0.24, 0.16, 0.32).translate(-0.22, 0.08, 0.04).toNonIndexed(),
])
// Ramas y raíces del espíritu.
const spiritBranchGeometry = mergeGeometries([
  new THREE.ConeGeometry(0.06, 0.55, 4).rotateZ(-0.7).translate(0.38, 1.42, 0),
  new THREE.ConeGeometry(0.06, 0.5, 4).rotateZ(0.8).translate(-0.38, 1.38, 0),
  new THREE.ConeGeometry(0.05, 0.42, 4).translate(0.02, 1.62, -0.04),
  new THREE.ConeGeometry(0.07, 0.3, 4).rotateZ(2.6).translate(0.24, 0.12, 0.04),
  new THREE.ConeGeometry(0.07, 0.3, 4).rotateZ(-2.6).translate(-0.24, 0.12, 0.04),
])
const spiritLeafGeometry = mergeGeometries([
  new THREE.IcosahedronGeometry(0.15, 0).translate(0.58, 1.62, 0),
  new THREE.IcosahedronGeometry(0.13, 0).translate(-0.56, 1.56, 0),
  new THREE.IcosahedronGeometry(0.12, 0).translate(0.02, 1.84, -0.04),
])
// Hocico, orejas, patas y cola del perro (a escala 1: el perro sale más pequeño).
const dogDetailGeometry = mergeGeometries([
  new THREE.BoxGeometry(0.26, 0.22, 0.34).translate(0, 0.9, 0.52),
  new THREE.ConeGeometry(0.09, 0.26, 4).translate(0.2, 1.42, 0.12),
  new THREE.ConeGeometry(0.09, 0.26, 4).translate(-0.2, 1.42, 0.12),
  new THREE.BoxGeometry(0.14, 0.3, 0.14).translate(0.24, 0.15, 0.22),
  new THREE.BoxGeometry(0.14, 0.3, 0.14).translate(-0.24, 0.15, 0.22),
  new THREE.BoxGeometry(0.14, 0.3, 0.14).translate(0.24, 0.15, -0.22),
  new THREE.BoxGeometry(0.14, 0.3, 0.14).translate(-0.24, 0.15, -0.22),
  new THREE.ConeGeometry(0.07, 0.42, 4).rotateX(-1.1).translate(0, 1.0, -0.5),
])
// Las rocas que carga a la espalda el lanzarrocas, y sus puños.
const throwerRockGeometry = mergeGeometries([
  new THREE.IcosahedronGeometry(0.22, 0).translate(0.17, 1.02, -0.44),
  new THREE.IcosahedronGeometry(0.19, 0).translate(-0.18, 0.96, -0.46),
  new THREE.IcosahedronGeometry(0.16, 0).translate(0, 1.26, -0.4),
  new THREE.IcosahedronGeometry(0.17, 0).translate(0.5, 0.66, 0.12),
  new THREE.IcosahedronGeometry(0.17, 0).translate(-0.5, 0.66, 0.12),
])
// La que levanta antes de lanzarla, justo donde sale la de verdad.
const { thrower } = ENEMY_DEFS
const heldRockGeometry = new THREE.IcosahedronGeometry(0.2, 0).translate(0, 3 / thrower.scale, 0)
// El destello de un golpe, según lo que le haya hecho: rojo normal, amarillo si es débil a esa arma y gris si la resiste.
const FLASH_COLORS: Record<HitEfficacy, string> = { normal: '#ff3b2f', effective: '#ffc21f', resisted: '#8e8e8e' }

/** Compartidos por todos (hasta 24 a la vez): el destello cambia de material en vez de clonar uno por enemigo. */
function flashesOf(material: THREE.MeshStandardMaterial) {
  const flash = (color: string) => {
    const clone = material.clone()
    clone.emissive.set(color)
    return clone
  }
  return { normal: flash(FLASH_COLORS.normal), effective: flash(FLASH_COLORS.effective), resisted: flash(FLASH_COLORS.resisted) }
}
const standard = (color: string) => new THREE.MeshStandardMaterial({ color, flatShading: true })
const rockMaterial = standard('#8a877c')
// Los puños y los hombros del guardián, al rojo como su meteorito.
const emberMaterial = new THREE.MeshStandardMaterial({ color: '#4a403a', emissive: '#ff5a1f', emissiveIntensity: 0.8, flatShading: true })
// Sin iluminación: los ojos se ven de noche.
const eyes = (color: string) => ({ geometry: eyeGeometry, material: new THREE.MeshBasicMaterial({ color }), castShadow: false })

/** El aspecto de un tipo de enemigo: el cuerpo (también la hitbox) con su destello, y los detalles sin hitbox. */
interface EnemyLook {
  body: THREE.BufferGeometry
  material: THREE.Material
  flashes: Record<HitEfficacy, THREE.Material>
  details: { geometry: THREE.BufferGeometry; material: THREE.Material; castShadow: boolean }[]
  /** Lo que solo enseña al preparar un lanzamiento. */
  held?: { geometry: THREE.BufferGeometry; material: THREE.Material }
}

/** `glow`: un poco de emisivo para que la silueta se lea de noche. */
function look(color: string, glow: string, details: EnemyLook['details'], held?: EnemyLook['held']): EnemyLook {
  const material = new THREE.MeshStandardMaterial({ color, emissive: glow, flatShading: true })
  return { body: bodyGeometry, material, flashes: flashesOf(material), details, held }
}

const LOOKS: Record<EnemyType, EnemyLook> = {
  goblin: look('#9558bd', '#2b1240', [{ geometry: detailGeometry, material: standard('#3a2348'), castShadow: true }, eyes('#ffe066')]),
  spearGoblin: look('#6a5ccf', '#1e1846', [{ geometry: detailGeometry, material: standard('#2e2860'), castShadow: true }, eyes('#ffe066')]),
  golem: look('#8a877c', '#1c1b18', [{ geometry: golemDetailGeometry, material: standard('#66635a'), castShadow: true }, eyes('#ffb13b')]),
  giant: look('#b0423a', '#2e0f0c', [{ geometry: detailGeometry, material: standard('#4a1f1c'), castShadow: true }, eyes('#ffe066')]),
  spirit: look('#6e4c2f', '#1e140b', [
    { geometry: spiritBranchGeometry, material: standard('#4a3220'), castShadow: true },
    { geometry: spiritLeafGeometry, material: standard('#4f9a3f'), castShadow: true },
    eyes('#b6ff6a'),
  ]),
  thrower: look(
    '#3f7f6f',
    '#0e2420',
    [
      { geometry: detailGeometry, material: standard('#1f3f38'), castShadow: true },
      { geometry: throwerRockGeometry, material: rockMaterial, castShadow: true },
      eyes('#ff9a3b'),
    ],
    { geometry: heldRockGeometry, material: rockMaterial },
  ),
  guardian: look('#3b322d', '#1c0c06', [{ geometry: golemDetailGeometry, material: emberMaterial, castShadow: true }, eyes('#ffd23f')]),
  colossus: look('#9fd8ff', '#1e4a66', [{ geometry: golemDetailGeometry, material: standard('#d6efff'), castShadow: true }, eyes('#ffffff')]),
  dog: look('#a8763e', '#2a1a0a', [{ geometry: dogDetailGeometry, material: standard('#5a3a1c'), castShadow: true }, eyes('#ff5a3b')]),
}

/** Modelo de un enemigo y sus animaciones, que solo existen en la vista. */
interface EnemyModel {
  type: EnemyType
  object: THREE.Group
  body: THREE.Mesh
  held: THREE.Mesh | null
  /** Dónde se dibujó en el último frame (al morir se queda ahí). */
  x: number
  z: number
  yaw: number
  /** Segundos andando: fase del bote. */
  walk: number
  hurt: number
  /** El destello que toca mientras dura `hurt`. */
  efficacy: HitEfficacy
  lunge: number
  /** Por dónde va su embestida (agachado avisa, y cargando va inclinado) o su lanzamiento (con la roca en alto, también avisa). */
  charge: ChargeState
  /** Retroceso tras un golpe: no bota mientras dura. */
  stagger: number
  /** Mientras se desvanece al morir; null si sigue vivo. */
  dying: number | null
}

/**
 * Los enemigos dibujados. Sigue la lista de la simulación en cada frame: crea el modelo de los que
 * aparecen y desvanece los que salen de ella al morir. Las animaciones de golpe y embestida salen de
 * los eventos; el bote, de si se mueve.
 */
export class EnemyView {
  /** El suelo sobre el que andan: el de la partida. */
  island: Island = DEFAULT_ISLAND
  readonly group = new THREE.Group()
  private models = new Map<number, EnemyModel>()
  private seen = new Set<number>()

  /** Aplica lo que ha pasado en un paso. */
  present(events: readonly SimEventData[]) {
    for (const e of events) {
      switch (e.type) {
        case 'enemyHit': {
          const model = this.models.get(e.id)
          if (model) {
            model.hurt = HURT_FLASH
            model.efficacy = e.efficacy
            // Si lo ha aguantado (sin empujón), sigue andando.
            if (e.kx !== 0 || e.kz !== 0) model.stagger = ENEMY_DEFS[model.type].stagger
          }
          break
        }
        case 'enemyDied': {
          const model = this.models.get(e.id)
          if (model) model.hurt = HURT_FLASH
          break
        }
        case 'enemyCharge': {
          const model = this.models.get(e.id)
          if (model) model.charge = e.state
          break
        }
        case 'enemyAttack': {
          const model = this.models.get(e.id)
          if (model) model.lunge = LUNGE_TIME
          break
        }
      }
    }
  }

  /** Por frame: coloca los modelos entre el paso anterior y el actual (alpha = 1: posición simulada). */
  update(dt: number, enemies: readonly EnemyData[], alpha: number) {
    this.seen.clear()
    for (const e of enemies) {
      this.seen.add(e.id)
      let model = this.models.get(e.id)
      const x = e.prev.x + (e.pos.x - e.prev.x) * alpha
      const z = e.prev.z + (e.pos.z - e.prev.z) * alpha
      if (!model) {
        model = this.create(e.id, e.type, x, z)
      } else if (model.stagger <= 0 && dt > 0 && Math.hypot(x - model.x, z - model.z) > WALK_MIN_SPEED * ENEMY_DEFS[e.type].speed * dt) {
        model.walk += dt
      }
      model.x = x
      model.z = z
      model.yaw = e.yaw
    }
    for (const [id, model] of this.models) {
      if (model.dying === null && !this.seen.has(id)) model.dying = DEATH_TIME
      model.hurt = Math.max(0, model.hurt - dt)
      model.lunge = Math.max(0, model.lunge - dt)
      model.stagger = Math.max(0, model.stagger - dt)
      if (model.dying !== null) {
        model.dying -= dt
        if (model.dying <= 0) {
          this.remove(id, model)
          continue
        }
      }
      this.place(model)
    }
    this.group.updateMatrixWorld()
  }

  /** Reinicio de partida: quita todos los modelos sin desvanecerlos. */
  reset() {
    for (const [id, model] of this.models) this.remove(id, model)
  }

  private create(id: number, type: EnemyType, x: number, z: number): EnemyModel {
    const look = LOOKS[type]
    const object = new THREE.Group()
    const body = new THREE.Mesh(look.body, look.material)
    body.castShadow = true
    object.add(body)
    for (const { geometry, material, castShadow } of look.details) {
      const mesh = new THREE.Mesh(geometry, material)
      mesh.castShadow = castShadow
      object.add(mesh)
    }
    // Para reconocerlo en un raycast contra la vista (test de paridad con sim/aim.ts).
    for (const mesh of object.children) mesh.userData.enemy = id
    // Después: no es parte de la hitbox.
    const held = look.held ? new THREE.Mesh(look.held.geometry, look.held.material) : null
    if (held) {
      held.castShadow = true
      held.visible = false
      object.add(held)
    }
    this.group.add(object)
    const model: EnemyModel = { type, object, body, held, x, z, yaw: 0, walk: 0, hurt: 0, efficacy: 'normal', lunge: 0, charge: 'idle', stagger: 0, dying: null }
    this.models.set(id, model)
    return model
  }

  private remove(id: number, model: EnemyModel) {
    this.models.delete(id)
    this.group.remove(model.object)
  }

  private place(model: EnemyModel) {
    const { x, z, yaw } = model
    const bob = Math.abs(Math.sin(model.walk * 9)) * 0.12
    // Al atacar se lanza un poco hacia delante.
    const lunge = Math.sin((Math.PI * model.lunge) / LUNGE_TIME) * 0.35
    const o = model.object
    o.position.set(x + Math.sin(yaw) * lunge, enemyFloor(this.island, x, z) + bob, z + Math.cos(yaw) * lunge)
    o.rotation.y = yaw
    // Muere encogiéndose y hundiéndose.
    const s = model.dying === null ? 1 : Math.max(0, model.dying / DEATH_TIME)
    o.scale.set(1 + (1 - s) * 0.3, s, 1 + (1 - s) * 0.3).multiplyScalar(ENEMY_DEFS[model.type].scale)
    // Antes de embestir se agacha y brilla; embistiendo va inclinado hacia delante. Antes de lanzar se echa atrás con la roca en alto, y también brilla.
    const { charge } = model
    if (charge === 'crouch') o.scale.multiply(CROUCH_SQUASH)
    if (charge === 'aim') o.scale.multiply(AIM_STRETCH)
    o.rotation.x = charge === 'rush' ? RUSH_LEAN : charge === 'aim' ? AIM_LEAN : 0
    // Aturdido se tambalea: es el momento de golpearlo.
    o.rotation.z = charge === 'dazed' ? Math.sin(model.walk + performance.now() / 180) * DAZED_TILT : 0
    if (model.held) model.held.visible = charge === 'aim'
    const look = LOOKS[model.type]
    const warning = charge === 'crouch' || charge === 'aim'
    model.body.material = warning ? look.flashes.normal : charge === 'dazed' ? look.flashes.effective : model.hurt > 0 ? look.flashes[model.efficacy] : look.material
  }
}
