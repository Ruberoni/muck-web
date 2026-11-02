import * as THREE from 'three'

/** Lo que hace el torso sin que dejen de moverse las piernas. */
export type RigAction = 'Sword_Slash' | 'Punch_Right' | 'Interact' | 'HitRecieve'

const LOCOMOTION = ['Idle', 'Walk', 'Run', 'Run_Back', 'Run_Left', 'Run_Right'] as const
type Locomotion = (typeof LOCOMOTION)[number]
const RIG_ACTIONS: readonly RigAction[] = ['Sword_Slash', 'Punch_Right', 'Interact', 'HitRecieve']

/** Por debajo de esta velocidad está quieta, y hasta esta otra anda: el juego anda tan rápido como ella corre. */
const STILL_SPEED = 0.5
const WALK_UNTIL = 3.5
/** Velocidad (m/s) a la que cada animación no resbala: más rápido, va más deprisa. */
const WALK_PACE = 2.5
const RUN_PACE = 6
/** Con qué rapidez se pasa de una animación a otra. */
const LOCOMOTION_BLEND = 12
const ACTION_BLEND = 25
/** Hasta dónde llega el torso: lo demás son las piernas. */
const UPPER_BODY = 'Abdomen'
/** Qué huesos giran al mirar arriba o abajo, y cuánto de ese giro hace cada uno. */
const LOOK_SHARES = { Chest: 0.35, Head: 0.65 } as const
/** Lo que se lleva en la mano va donde el modelo original agarra su espada, entre los dedos. */
const HAND_BONE = 'Middle1R'
const GRIP_POSITION = new THREE.Vector3(-0.0004, 0.091, -0.025)
const GRIP_ROTATION = new THREE.Quaternion(0.497, -0.503, -0.503, 0.496)
/** La hoja de esa espada va por +Z, y los objetos del juego crecen por +Y. */
const ITEM_UP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)
/** Los objetos de los demás vienen agrandados para las cajas: en una mano de verdad se ven enormes. */
const ITEM_SCALE = 0.7

const RIGHT = new THREE.Vector3(1, 0, 0)

/** La animación según cómo se mueve, en el espacio del personaje (m/s). */
export function chooseLocomotion(forward: number, side: number): Locomotion {
  const speed = Math.hypot(forward, side)
  if (speed < STILL_SPEED) return 'Idle'
  if (Math.abs(side) > Math.abs(forward)) return side > 0 ? 'Run_Right' : 'Run_Left'
  if (forward < 0) return 'Run_Back'
  return speed < WALK_UNTIL ? 'Walk' : 'Run'
}

/** La parte de una animación que mueve los huesos que `keep` acepta. */
const partOf = (clip: THREE.AnimationClip, keep: (bone: string) => boolean) =>
  new THREE.AnimationClip(
    clip.name,
    clip.duration,
    clip.tracks.filter((track) => keep(track.name.slice(0, track.name.indexOf('.')))),
  )

const named = (clips: readonly THREE.AnimationClip[], name: string) => {
  const clip = THREE.AnimationClip.findByName(clips as THREE.AnimationClip[], name)
  if (!clip) throw new Error(`Falta la animación ${name}`)
  return clip
}

/**
 * Un personaje con esqueleto y sus animaciones. Las piernas y el torso se animan por separado, para poder correr y
 * golpear a la vez. Mira a −Z, como el resto de avatares, y `hand` es donde va lo que lleva en la mano.
 */
export class CharacterRig {
  readonly object = new THREE.Group()
  /** Lo que lleva en la mano se añade aquí. */
  readonly hand = new THREE.Group()
  private mixer: THREE.AnimationMixer
  private legs = new Map<Locomotion, THREE.AnimationAction>()
  private torso = new Map<Locomotion, THREE.AnimationAction>()
  private actions = new Map<RigAction, THREE.AnimationAction>()
  private death: THREE.AnimationAction
  private weights = new Map<Locomotion, number>(LOCOMOTION.map((name) => [name, name === 'Idle' ? 1 : 0]))
  private acting: THREE.AnimationAction | null = null
  private actionLeft = 0
  private actionWeight = 0
  private dead = false
  /** El mezclador no reescribe un hueso que no cambia: la mirada se quita antes de mezclar, o se acumularía. */
  private look: { bone: THREE.Object3D; pose: THREE.Quaternion; share: number }[]
  private axis = new THREE.Vector3()
  private turn = new THREE.Quaternion()
  private parentTurn = new THREE.Quaternion()
  private ownTurn = new THREE.Quaternion()

  constructor(body: THREE.Object3D, clips: readonly THREE.AnimationClip[]) {
    // Los modelos miran a +Z.
    body.rotation.y = Math.PI
    this.object.add(body)
    body.traverse((node) => {
      if (!(node as THREE.Mesh).isMesh) return
      node.castShadow = true
      // Su caja es la de la pose inicial, y al animarse se saldría de ella.
      node.frustumCulled = false
    })
    this.mixer = new THREE.AnimationMixer(body)
    const upper = new Set<string>()
    body.getObjectByName(UPPER_BODY)?.traverse((bone) => upper.add(bone.name))
    for (const name of LOCOMOTION) {
      const clip = named(clips, name)
      this.legs.set(name, this.mixer.clipAction(partOf(clip, (bone) => !upper.has(bone))).play())
      this.torso.set(name, this.mixer.clipAction(partOf(clip, (bone) => upper.has(bone))).play())
    }
    for (const name of RIG_ACTIONS) {
      const action = this.mixer.clipAction(partOf(named(clips, name), (bone) => upper.has(bone)))
      action.setLoop(THREE.LoopOnce, 1)
      action.clampWhenFinished = true
      this.actions.set(name, action)
    }
    this.death = this.mixer.clipAction(named(clips, 'Death'))
    this.death.setLoop(THREE.LoopOnce, 1)
    this.death.clampWhenFinished = true
    this.look = Object.entries(LOOK_SHARES).flatMap(([name, share]) => {
      const bone = body.getObjectByName(name)
      return bone ? [{ bone, pose: bone.quaternion.clone(), share }] : []
    })
    this.hand.position.copy(GRIP_POSITION)
    this.hand.quaternion.copy(GRIP_ROTATION).multiply(ITEM_UP)
    this.hand.scale.setScalar(ITEM_SCALE)
    body.getObjectByName(HAND_BONE)?.add(this.hand)
  }

  /** Empieza `name`, que dura `seconds`, aunque hubiera otra a medias. */
  act(name: RigAction, seconds: number) {
    const action = this.actions.get(name)!
    if (this.acting && this.acting !== action) this.acting.stop()
    action.reset()
    action.setEffectiveTimeScale(action.getClip().duration / seconds)
    action.play()
    this.acting = action
    this.actionLeft = seconds
  }

  /** Si tiene el torso ocupado: un golpe recibido no debe cortar lo que esté haciendo. */
  get busy() {
    return this.actionLeft > 0
  }

  /** Por frame. `forward` y `side`: su velocidad hacia delante y a su derecha (m/s). `pitch`: hacia dónde mira. */
  update(dt: number, forward: number, side: number, pitch: number, alive: boolean) {
    this.setDead(!alive)
    const current = chooseLocomotion(forward, side)
    const speed = Math.hypot(forward, side)
    const pace = current === 'Idle' ? 1 : speed / (current === 'Walk' ? WALK_PACE : RUN_PACE)
    this.actionLeft = Math.max(0, this.actionLeft - dt)
    this.actionWeight = THREE.MathUtils.damp(this.actionWeight, this.actionLeft > 0 ? 1 : 0, ACTION_BLEND, dt)
    for (const name of LOCOMOTION) {
      const weight = THREE.MathUtils.damp(this.weights.get(name)!, name === current ? 1 : 0, LOCOMOTION_BLEND, dt)
      this.weights.set(name, weight)
      const shown = this.dead ? 0 : weight
      this.legs.get(name)!.setEffectiveWeight(shown).setEffectiveTimeScale(pace)
      this.torso.get(name)!.setEffectiveWeight(shown * (1 - this.actionWeight)).setEffectiveTimeScale(pace)
    }
    this.acting?.setEffectiveWeight(this.dead ? 0 : this.actionWeight)
    for (const { bone, pose } of this.look) bone.quaternion.copy(pose)
    this.mixer.update(dt)
    for (const { bone, pose } of this.look) pose.copy(bone.quaternion)
    if (alive) this.lookAt(pitch)
  }

  /** Muere una vez; al volver, se levanta. */
  private setDead(dead: boolean) {
    if (dead === this.dead) return
    this.dead = dead
    if (dead) this.death.reset().setEffectiveWeight(1).play()
    else this.death.stop()
  }

  /** Inclina esos huesos sobre el eje que va de hombro a hombro, sea cual sea la pose. */
  private lookAt(pitch: number) {
    this.object.getWorldQuaternion(this.ownTurn)
    for (const { bone, share } of this.look) {
      bone.parent!.getWorldQuaternion(this.parentTurn)
      this.axis.copy(RIGHT).applyQuaternion(this.ownTurn).applyQuaternion(this.parentTurn.invert())
      bone.quaternion.premultiply(this.turn.setFromAxisAngle(this.axis, pitch * share))
    }
  }
}
