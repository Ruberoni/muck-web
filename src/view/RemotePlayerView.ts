import * as THREE from 'three'
import { ACTION_DURATION, actionPose, itemModel, swingDuration, type HandAction, type HandPose } from '../game/handheld'
import { EYE_HEIGHT, TOOL_DEFS } from '../sim/constants'
import type { PlayerId, SimEventData } from '../sim/events'
import type { ItemId } from '../sim/inventory'
import type { RemotePlayer } from '../net/client'
import type { Shown } from '../net/interp'
import { autoSkin } from '../net/skins'
import type { CharacterRig, RigAction } from './CharacterRig'
import type { LoadCharacter } from './characters'
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
/** Con qué rapidez sigue la velocidad que se ve a la de verdad: las posiciones llegan a saltos. */
const SPEED_BLEND = 14
/** Golpe de quien no lleva ninguna herramienta ni arma, comer y colocar, y cuánto dura recibir un golpe. */
const HURT_SECONDS = 0.4
const ACTION_CLIP: Record<Exclude<HandAction, 'swing'>, RigAction> = { eat: 'Interact', place: 'Interact' }
/** El escudo, colgado a la izquierda de cara a fuera; al bloquear, delante del pecho de cara al frente. */
const SHIELD_SCALE = 1.5
const SHIELD_DOWN = new THREE.Vector3(-0.42, 0.55, 0)
const SHIELD_RAISED = new THREE.Vector3(-0.12, 0.8, -0.42)

const isTool = (item: ItemId) => TOOL_DEFS[item] !== undefined

/** Un color distinto por jugador, el mismo en todos los clientes y el mismo que en el HUD (`playerCss`). */
export function playerColor(id: PlayerId, out = new THREE.Color()): THREE.Color {
  return out.setHSL(playerHue(id), PLAYER_SATURATION, PLAYER_LIGHTNESS, THREE.SRGBColorSpace)
}

interface Model {
  object: THREE.Group
  /** El cuerpo de cajas: se ve hasta que carga su personaje, o siempre si no se puede cargar. */
  boxes: THREE.Group
  head: THREE.Mesh
  arm: THREE.Group
  rig: CharacterRig | null
  /** La skin que tiene o que se está cargando. */
  skin: number | null
  /** Su velocidad en este frame y dónde estaba en el anterior. */
  vx: number
  vz: number
  last: { x: number; z: number }
  material: THREE.MeshStandardMaterial
  held: THREE.Object3D | null
  item: ItemId | null
  action: HandAction | null
  actionTime: number
  actionLength: number
  shield: THREE.Object3D | null
  shieldItem: ItemId | null
}

/**
 * Los demás jugadores, con su skin (`load`) y sus animaciones. Hasta que carga, o si no se puede o no hay `load`, con
 * un cuerpo low-poly de su color: tronco, cabeza que mira con el pitch y un brazo con lo que llevan en la mano, que golpea
 * y come como la mano propia (`actionPose`), y los muertos quedan tumbados. Sigue la lista interpolada de NetClient en
 * cada frame; las animaciones salen de sus eventos y de cómo se mueven.
 */
export class RemotePlayerView {
  readonly group = new THREE.Group()
  private models = new Map<PlayerId, Model>()
  private items = new Map<ItemId, THREE.Group>()
  private pose: HandPose = { rx: 0, rz: 0, x: 0, y: 0, z: 0 }

  constructor(private load: LoadCharacter | null = null) {}

  /** Animaciones de los demás (los eventos propios no llegan aquí con modelo, así que se ignoran). */
  present(events: readonly SimEventData[]) {
    for (const e of events) {
      if (e.type === 'playerHurt') {
        const { rig } = this.models.get(e.id) ?? {}
        if (rig && !rig.busy) rig.act('HitRecieve', HURT_SECONDS)
        continue
      }
      const action =
        e.type === 'playerSwing' ? 'swing' : e.type === 'playerAte' ? 'eat' : e.type === 'playerPlaced' || e.type === 'playerDropped' ? 'place' : null
      if (!action || !('id' in e)) continue
      const model = this.models.get(e.id)
      if (!model) continue
      model.action = action
      model.actionTime = 0
      model.actionLength = e.type === 'playerSwing' ? swingDuration(e.item) : ACTION_DURATION[action]
      model.rig?.act(action === 'swing' ? (e.type === 'playerSwing' && e.item && isTool(e.item) ? 'Sword_Slash' : 'Punch_Right') : ACTION_CLIP[action], model.actionLength)
    }
  }

  /** `skinOf`: la skin de cada jugador. */
  update(dt: number, players: readonly Shown<RemotePlayer>[], skinOf: (id: PlayerId) => number = autoSkin) {
    const seen = new Set<PlayerId>()
    for (const { id, pose, data } of players) {
      seen.add(id)
      const model = this.models.get(id) ?? this.create(id, pose)
      this.dress(id, model, skinOf(id))
      const { object, rig } = model
      object.position.set(pose.x, pose.y, pose.z)
      object.rotation.set(0, pose.yaw, data.alive || rig ? 0 : Math.PI / 2)
      model.head.rotation.x = pose.pitch
      this.hold(model, data.item)
      this.wear(model, data.alive ? data.shield : null, data.blocking)
      this.track(model, dt, pose.x, pose.z)
      if (rig) {
        // La armadura que lleva puesta: cada pieza tapa su parte del cuerpo.
        rig.setArmor(data.armor)
        // forward = (-sin(yaw), -cos(yaw)), y su derecha, (cos(yaw), -sin(yaw)).
        const sin = Math.sin(pose.yaw)
        const cos = Math.cos(pose.yaw)
        rig.update(dt, -model.vx * sin - model.vz * cos, model.vx * cos - model.vz * sin, pose.pitch, data.alive)
      } else this.animate(model, dt, pose.pitch)
    }
    for (const [id, model] of this.models) if (!seen.has(id)) this.remove(id, model)
  }

  reset() {
    for (const [id, model] of this.models) this.remove(id, model)
  }

  /** Pide su personaje si ha cambiado de skin. Hasta que llega, y si falla, sigue con lo que tenía. */
  private dress(id: PlayerId, model: Model, skin: number) {
    if (!this.load || model.skin === skin) return
    model.skin = skin
    this.load(skin).then(
      (rig) => {
        if (this.models.get(id) !== model || model.skin !== skin) return
        if (model.rig) model.object.remove(model.rig.object)
        model.rig = rig
        model.boxes.visible = false
        model.object.add(rig.object)
        // Lo que llevaba pasa a su mano.
        model.held?.removeFromParent()
        model.held = null
        model.item = null
      },
      (error) => console.warn('No se ha podido cargar el personaje', error),
    )
  }

  /** La velocidad a la que se mueve, de lo que ha cambiado su posición. */
  private track(model: Model, dt: number, x: number, z: number) {
    if (dt <= 0) return
    model.vx = THREE.MathUtils.damp(model.vx, (x - model.last.x) / dt, SPEED_BLEND, dt)
    model.vz = THREE.MathUtils.damp(model.vz, (z - model.last.z) / dt, SPEED_BLEND, dt)
    model.last.x = x
    model.last.z = z
  }

  private create(id: PlayerId, { x, z }: { x: number; z: number }): Model {
    const material = new THREE.MeshStandardMaterial({ color: playerColor(id), flatShading: true })
    const object = new THREE.Group()
    const body = new THREE.Mesh(bodyGeometry, material)
    const head = new THREE.Mesh(headGeometry, material)
    head.position.y = EYE_HEIGHT
    head.add(new THREE.Mesh(visorGeometry, visorMaterial))
    const arm = new THREE.Group()
    arm.position.copy(SHOULDER)
    arm.add(new THREE.Mesh(armGeometry, material))
    const boxes = new THREE.Group()
    boxes.add(body, head, arm)
    object.add(boxes)
    object.traverse((o) => (o.castShadow = true))
    this.group.add(object)
    const model: Model = { object, boxes, head, arm, rig: null, skin: null, vx: 0, vz: 0, last: { x, z }, material, held: null, item: null, action: null, actionTime: 0, actionLength: 0, shield: null, shieldItem: null }
    this.models.set(id, model)
    return model
  }

  private remove(id: PlayerId, model: Model) {
    this.models.delete(id)
    this.group.remove(model.object)
    model.material.dispose()
  }

  /** El modelo de `item` a la escala de su mano, hecho una vez: se clona, compartiendo geometría y material. */
  private template(item: ItemId): THREE.Group {
    let template = this.items.get(item)
    if (!template) {
      template = itemModel(item)
      template.scale.setScalar(ITEM_SCALE)
      template.traverse((o) => (o.castShadow = true))
      this.items.set(item, template)
    }
    return template
  }

  /** Cambia el objeto de la mano si ha cambiado (un clon que comparte geometría y material). */
  private hold(model: Model, item: ItemId | null) {
    if (model.item === item && (item === null || model.held)) return
    model.held?.removeFromParent()
    model.item = item
    model.held = null
    if (!item) return
    model.held = this.template(item).clone()
    if (model.rig) model.rig.hand.add(model.held)
    else {
      model.held.position.set(0, 0, -0.5)
      model.arm.add(model.held)
    }
  }

  /** Cambia el escudo si ha cambiado y lo pone abajo o arriba. */
  private wear(model: Model, item: ItemId | null, blocking: boolean) {
    if (model.shieldItem !== item) {
      model.shield?.removeFromParent()
      model.shieldItem = item
      model.shield = null
      if (item) {
        model.shield = this.template(item).clone()
        model.shield.scale.setScalar(SHIELD_SCALE)
        model.object.add(model.shield)
      }
    }
    if (!model.shield) return
    model.shield.position.copy(blocking ? SHIELD_RAISED : SHIELD_DOWN)
    model.shield.rotation.set(0, blocking ? 0 : Math.PI / 2, 0)
  }

  /** El brazo apunta hacia donde mira y, si hay una acción en curso, sigue su pose. */
  private animate(model: Model, dt: number, pitch: number) {
    const { arm } = model
    const { pose } = this
    pose.rx = pose.rz = pose.x = pose.y = pose.z = 0
    if (model.action) {
      model.actionTime += dt
      if (model.actionTime >= model.actionLength) model.action = null
      else actionPose(model.action, model.actionTime / model.actionLength, pose)
    }
    arm.rotation.set(pitch * 0.5 - 0.6 + pose.rx * 1.5, 0, pose.rz)
    arm.position.set(SHOULDER.x + pose.x, SHOULDER.y + pose.y, SHOULDER.z + pose.z)
  }
}
