import * as THREE from 'three'
import type { EnemyClips, EnemyTemplate, FlashKind } from './enemyModels'

/** Segundos en que se funde un clip con otro. */
const FADE = 0.15
/** Velocidad (m/s, a escala 1) a la que el clip de andar o el de correr van a su ritmo: más deprisa, más rápido. */
const WALK_PACE = 1.6
const RUN_PACE = 4
/** Por debajo, quieto; por encima de esta fracción del ritmo de correr, corre. */
const STILL_SPEED = 0.25
const RUN_FROM = 0.7

/**
 * Las animaciones de un enemigo con modelo: anda o corre según cómo se mueve, y los golpes, los lanzamientos, los
 * ataques especiales, los golpes recibidos y la muerte salen de los eventos, de una vez y fundidos con lo de debajo.
 */
export class EnemyRig {
  readonly root: THREE.Object3D
  private mixer: THREE.AnimationMixer
  private clips: Map<string, THREE.AnimationClip>
  private loop: THREE.AnimationAction | null = null
  private once: THREE.AnimationAction | null = null
  /** Segundos que le quedan al de una vez antes de volver a andar; null: hasta que se suelte (`release`). */
  private onceLeft: number | null = null
  private dead = false
  private meshes: THREE.Mesh[] = []
  private materials: THREE.Material[] = []
  private flash: FlashKind | null = null

  constructor(
    private template: EnemyTemplate,
    private names: EnemyClips,
    /** Escala del modelo (la de su tipo por la de su apariencia): los pasos son más largos en uno grande. */
    private size: number,
  ) {
    this.root = template.clone()
    this.root.scale.setScalar(template.fit)
    this.root.position.y = template.lift
    this.root.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh) return
      const mesh = o as THREE.Mesh
      this.meshes.push(mesh)
      this.materials.push(mesh.material as THREE.Material)
    })
    this.mixer = new THREE.AnimationMixer(this.root)
    this.clips = new Map(template.clips.map((c) => [c.name, c]))
    this.setLoop(names.idle, 1)
  }

  has(name: string) {
    return this.clips.has(name)
  }

  /** Lo que dura un clip, o 0 si no lo tiene. */
  duration(name: string) {
    return this.clips.get(name)?.duration ?? 0
  }

  /** El segundo de un clip que dice su `extras` (`golpe`, `soltar`…), o `fallback`. */
  mark(name: string, key: string, fallback: number) {
    const value = this.clips.get(name)?.userData?.[key]
    return typeof value === 'number' ? value : fallback
  }

  /** Por frame, con la velocidad a la que se mueve (m/s). */
  update(dt: number, speed: number) {
    if (this.once && this.onceLeft !== null) {
      this.onceLeft -= dt
      if (this.onceLeft <= 0) this.release()
    }
    if (!this.once && !this.dead) {
      const pace = speed / this.size
      const runs = this.names.run && pace > RUN_PACE * RUN_FROM
      if (pace < STILL_SPEED) this.setLoop(this.names.idle, 1)
      else if (runs) this.setLoop(this.names.run!, pace / RUN_PACE)
      else this.setLoop(this.names.walk, Math.max(0.4, pace / WALK_PACE))
    }
    this.mixer.update(dt)
  }

  /**
   * Un clip de una vez a `timeScale`. Con `hold`, se queda hasta que se suelte (`release`); si no, vuelve a andar al
   * acabar. Mientras se muere no hace nada más.
   */
  play(name: string, timeScale = 1, hold = false) {
    const clip = this.clips.get(name)
    if (!clip || this.dead) return
    const action = this.mixer.clipAction(clip)
    action.reset()
    action.setLoop(THREE.LoopOnce, 1)
    action.clampWhenFinished = true
    action.timeScale = timeScale
    action.fadeIn(FADE).play()
    if (this.once && this.once !== action) this.once.fadeOut(FADE)
    this.loop?.fadeOut(FADE)
    this.loop = null
    this.once = action
    this.onceLeft = hold ? null : clip.duration / timeScale
  }

  /** Si está haciendo algo de una vez. */
  get busy() {
    return this.once !== null
  }

  /** Vuelve a andar (o a estar quieto). */
  release() {
    if (!this.once || this.dead) return
    this.once.fadeOut(FADE)
    this.once = null
    this.onceLeft = null
  }

  /** Se muere: el clip de muerte, y se queda en su última pose. */
  die() {
    if (this.dead) return
    this.play(this.names.death, 1, true)
    this.dead = true
  }

  /** Lo que dura su muerte. */
  get deathTime() {
    return this.duration(this.names.death) || 1
  }

  /** Destello en todos sus materiales que se iluminan (null: el suyo). */
  setFlash(kind: FlashKind | null) {
    if (kind === this.flash) return
    this.flash = kind
    this.meshes.forEach((mesh, i) => {
      const own = this.materials[i]
      mesh.material = kind ? (this.template.flashes.get(own)?.[kind] ?? own) : own
    })
  }

  private setLoop(name: string, timeScale: number) {
    const clip = this.clips.get(name) ?? this.clips.get(this.names.idle)
    if (!clip) return
    const action = this.mixer.clipAction(clip)
    action.timeScale = timeScale
    if (this.loop === action) return
    action.reset().fadeIn(FADE).play()
    this.loop?.fadeOut(FADE)
    this.loop = action
  }
}
