import * as THREE from 'three'
import { ACTION_DURATION, actionPose, itemModel, type HandAction, type HandPose } from '../game/handheld'
import { EYE_HEIGHT } from '../sim/constants'
import type { PlayerId, SimEventData } from '../sim/events'
import type { ItemId } from '../sim/inventory'
import type { RemotePlayer } from '../net/client'
import type { Shown } from '../net/interp'
import { PLAYER_LIGHTNESS, PLAYER_SATURATION, playerHue } from '../ui/playerColor'

const BODY_WIDTH = 0.6
/** Del suelo al cuello: la cabeza va encima, a la altura de los ojos. */
const BODY_HEIGHT = 1.45
const BODY_DEPTH = 0.36
const HEAD_SIZE = 0.38
/** El objeto en la mano, algo más grande que en primera persona para que se vea de lejos. */
const ITEM_SCALE = 1.6
/** El brazo sale del hombro derecho, hacia delante (−Z local, como la cámara). */
const SHOULDER = new THREE.Vector3(BODY_WIDTH / 2 + 0.08, BODY_HEIGHT - 0.1, -0.05)

const bodyGeometry = new THREE.BoxGeometry(BODY_WIDTH, BODY_HEIGHT, BODY_DEPTH).translate(0, BODY_HEIGHT / 2 + 0.05, 0)
const headGeometry = new THREE.BoxGeometry(HEAD_SIZE, HEAD_SIZE, HEAD_SIZE)
const visorGeometry = new THREE.BoxGeometry(HEAD_SIZE * 0.8, HEAD_SIZE * 0.22, 0.04).translate(0, 0.03, -HEAD_SIZE / 2 - 0.01)
const armGeometry = new THREE.BoxGeometry(0.14, 0.14, 0.5).translate(0, 0, -0.25)
const visorMaterial = new THREE.MeshStandardMaterial({ color: '#1d2230', flatShading: true })

/** Un color distinto por jugador, el mismo en todos los clientes y el mismo que en el HUD (`playerCss`). */
export function playerColor(id: PlayerId, out = new THREE.Color()): THREE.Color {
  return out.setHSL(playerHue(id), PLAYER_SATURATION, PLAYER_LIGHTNESS, THREE.SRGBColorSpace)
}

interface Model {
  object: THREE.Group
  head: THREE.Mesh
  arm: THREE.Group
  material: THREE.MeshStandardMaterial
  held: THREE.Object3D | null
  item: ItemId | null
  action: HandAction | null
  actionTime: number
}

/**
 * Los demás jugadores, con un cuerpo low-poly de su color: tronco, cabeza que mira con el pitch y un brazo con
 * lo que llevan en la mano, que golpea y come como la mano propia (`actionPose`). Los muertos quedan tumbados.
 * Sigue la lista interpolada de NetClient en cada frame; las animaciones salen de sus eventos.
 */
export class RemotePlayerView {
  readonly group = new THREE.Group()
  private models = new Map<PlayerId, Model>()
  private items = new Map<ItemId, THREE.Group>()
  private pose: HandPose = { rx: 0, rz: 0, x: 0, y: 0, z: 0 }

  /** Animaciones de los demás (los eventos propios no llegan aquí con modelo, así que se ignoran). */
  present(events: readonly SimEventData[]) {
    for (const e of events) {
      const action = e.type === 'playerSwing' ? 'swing' : e.type === 'playerAte' ? 'eat' : e.type === 'playerPlaced' ? 'place' : null
      if (!action || !('id' in e)) continue
      const model = this.models.get(e.id)
      if (!model) continue
      model.action = action
      model.actionTime = 0
    }
  }

  update(dt: number, players: readonly Shown<RemotePlayer>[]) {
    const seen = new Set<PlayerId>()
    for (const { id, pose, data } of players) {
      seen.add(id)
      const model = this.models.get(id) ?? this.create(id)
      const { object } = model
      object.position.set(pose.x, pose.y, pose.z)
      object.rotation.set(0, pose.yaw, data.alive ? 0 : Math.PI / 2)
      model.head.rotation.x = pose.pitch
      this.hold(model, data.item)
      this.animate(model, dt, pose.pitch)
    }
    for (const [id, model] of this.models) if (!seen.has(id)) this.remove(id, model)
  }

  reset() {
    for (const [id, model] of this.models) this.remove(id, model)
  }

  private create(id: PlayerId): Model {
    const material = new THREE.MeshStandardMaterial({ color: playerColor(id), flatShading: true })
    const object = new THREE.Group()
    const body = new THREE.Mesh(bodyGeometry, material)
    const head = new THREE.Mesh(headGeometry, material)
    head.position.y = EYE_HEIGHT
    head.add(new THREE.Mesh(visorGeometry, visorMaterial))
    const arm = new THREE.Group()
    arm.position.copy(SHOULDER)
    arm.add(new THREE.Mesh(armGeometry, material))
    object.add(body, head, arm)
    object.traverse((o) => (o.castShadow = true))
    this.group.add(object)
    const model: Model = { object, head, arm, material, held: null, item: null, action: null, actionTime: 0 }
    this.models.set(id, model)
    return model
  }

  private remove(id: PlayerId, model: Model) {
    this.models.delete(id)
    this.group.remove(model.object)
    model.material.dispose()
  }

  /** Cambia el objeto de la mano si ha cambiado (un clon que comparte geometría y material). */
  private hold(model: Model, item: ItemId | null) {
    if (model.item === item && (item === null || model.held)) return
    if (model.held) model.arm.remove(model.held)
    model.item = item
    model.held = null
    if (!item) return
    let template = this.items.get(item)
    if (!template) {
      template = itemModel(item)
      template.scale.setScalar(ITEM_SCALE)
      template.traverse((o) => (o.castShadow = true))
      this.items.set(item, template)
    }
    model.held = template.clone()
    model.held.position.set(0, 0, -0.5)
    model.arm.add(model.held)
  }

  /** El brazo apunta hacia donde mira y, si hay una acción en curso, sigue su pose. */
  private animate(model: Model, dt: number, pitch: number) {
    const { arm } = model
    const { pose } = this
    pose.rx = pose.rz = pose.x = pose.y = pose.z = 0
    if (model.action) {
      model.actionTime += dt
      if (model.actionTime >= ACTION_DURATION[model.action]) model.action = null
      else actionPose(model.action, model.actionTime / ACTION_DURATION[model.action], pose)
    }
    arm.rotation.set(pitch * 0.5 - 0.6 + pose.rx * 1.5, 0, pose.rz)
    arm.position.set(SHOULDER.x + pose.x, SHOULDER.y + pose.y, SHOULDER.z + pose.z)
  }
}
