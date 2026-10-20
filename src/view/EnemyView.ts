import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { heightAt } from '../sim/world/terrain'
import { ENEMY_BODY_LIFT, ENEMY_BODY_RADIUS, ENEMY_BODY_SCALE, ENEMY_MODEL_SCALE } from '../sim/aim'
import { ENEMY_SPEED, ENEMY_STAGGER } from '../sim/constants'
import type { EnemyData } from '../sim/enemies'
import type { SimEventData } from '../sim/events'

const HURT_FLASH = 0.15
const LUNGE_TIME = 0.2
const DEATH_TIME = 0.35
// Por debajo de esta velocidad no se considera que ande (los empujones entre ellos no lo hacen botar).
const WALK_MIN_SPEED = ENEMY_SPEED * 0.1

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
// Un poco de emisivo para que la silueta se lea de noche.
const BODY_GLOW = new THREE.Color('#2b1240')
const bodyMaterial = new THREE.MeshStandardMaterial({ color: '#9558bd', emissive: BODY_GLOW, flatShading: true })
const detailMaterial = new THREE.MeshStandardMaterial({ color: '#3a2348', flatShading: true })
// Sin iluminación: los ojos se ven de noche.
const eyeMaterial = new THREE.MeshBasicMaterial({ color: '#ffe066' })
const HURT_COLOR = new THREE.Color('#ff3b2f')

/** Modelo de un enemigo y sus animaciones, que solo existen en la vista. */
interface EnemyModel {
  object: THREE.Group
  material: THREE.MeshStandardMaterial
  /** Dónde se dibujó en el último frame (al morir se queda ahí). */
  x: number
  z: number
  yaw: number
  /** Segundos andando: fase del bote. */
  walk: number
  hurt: number
  lunge: number
  /** Retroceso tras un golpe: no bota mientras dura. */
  stagger: number
  /** Mientras se desvanece (muerto o al amanecer); null si sigue vivo. */
  dying: number | null
}

/**
 * Los enemigos dibujados. Sigue la lista de la simulación en cada frame: crea el modelo de los que
 * aparecen y desvanece los que salen de ella (muertos o al amanecer). Las animaciones de golpe y
 * embestida salen de los eventos; el bote, de si se mueve.
 */
export class EnemyView {
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
            model.stagger = ENEMY_STAGGER
          }
          break
        }
        case 'enemyDied': {
          const model = this.models.get(e.id)
          if (model) model.hurt = HURT_FLASH
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
        model = this.create(e.id, x, z)
      } else if (model.stagger <= 0 && dt > 0 && Math.hypot(x - model.x, z - model.z) > WALK_MIN_SPEED * dt) {
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

  private create(id: number, x: number, z: number): EnemyModel {
    const material = bodyMaterial.clone()
    const object = new THREE.Group()
    const body = new THREE.Mesh(bodyGeometry, material)
    const detail = new THREE.Mesh(detailGeometry, detailMaterial)
    const eyes = new THREE.Mesh(eyeGeometry, eyeMaterial)
    body.castShadow = detail.castShadow = true
    object.add(body, detail, eyes)
    // Para reconocerlo en un raycast contra la vista (test de paridad con sim/aim.ts).
    for (const mesh of object.children) mesh.userData.enemy = id
    this.group.add(object)
    const model: EnemyModel = { object, material, x, z, yaw: 0, walk: 0, hurt: 0, lunge: 0, stagger: 0, dying: null }
    this.models.set(id, model)
    return model
  }

  private remove(id: number, model: EnemyModel) {
    this.models.delete(id)
    this.group.remove(model.object)
    model.material.dispose()
  }

  private place(model: EnemyModel) {
    const { x, z, yaw } = model
    const bob = Math.abs(Math.sin(model.walk * 9)) * 0.12
    // Al atacar se lanza un poco hacia delante.
    const lunge = Math.sin((Math.PI * model.lunge) / LUNGE_TIME) * 0.35
    const o = model.object
    o.position.set(x + Math.sin(yaw) * lunge, heightAt(x, z) + bob, z + Math.cos(yaw) * lunge)
    o.rotation.y = yaw
    // Muere encogiéndose y hundiéndose.
    const s = model.dying === null ? 1 : Math.max(0, model.dying / DEATH_TIME)
    o.scale.set(1 + (1 - s) * 0.3, s, 1 + (1 - s) * 0.3).multiplyScalar(ENEMY_MODEL_SCALE)
    model.material.emissive.copy(model.hurt > 0 ? HURT_COLOR : BODY_GLOW)
  }
}
