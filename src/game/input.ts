import { MOUSE_SPIKE_LIMIT, WHEEL_GESTURE_GAP_MS, WHEEL_LINE_PX, WHEEL_STEP_PX } from '../sim/constants'
import type { PlayerInput } from '../sim/player'

/** Códigos de pulsación única del clic izquierdo y derecho (no son e.code reales). */
export const CLICK = 'Mouse0'
export const RIGHT_CLICK = 'Mouse2'

/**
 * Convierte la rueda en pasos de -1, 0 o 1. Una muesca de ratón da 100 px (Chrome) o 3 líneas (Firefox)
 * y un trackpad da muchos eventos pequeños; en macOS una muesca lenta da pocos píxeles, por eso el primer
 * evento tras una pausa o un cambio de sentido cuenta sin acumular.
 */
export class WheelStepper {
  private px = 0
  private dir = 0
  private last = -Infinity

  /** `dy` en píxeles (positivo hacia abajo) y `time` en ms (e.timeStamp). */
  push(dy: number, time: number): number {
    if (dy === 0) return 0
    const dir = Math.sign(dy)
    const fresh = time - this.last > WHEEL_GESTURE_GAP_MS || dir !== this.dir
    this.last = time
    this.dir = dir
    this.px = fresh ? 0 : this.px + Math.abs(dy)
    if (!fresh && this.px < WHEEL_STEP_PX) return 0
    this.px = 0
    return dir
  }

  reset() {
    this.px = this.dir = 0
    this.last = -Infinity
  }
}

interface InputCallbacks {
  onLockChange(locked: boolean): void
  isPlaying(): boolean
}

/** Teclado (por e.code), ratón y pointer lock. */
export class Input {
  private keys = new Set<string>()
  private presses = new Set<string>()
  private taken = new Set<string>()
  private dx = 0
  private dy = 0
  private rawMouse = false
  private wheel = 0
  private stepper = new WheelStepper()
  attackHeld = false
  locked = false

  constructor(
    private element: HTMLElement,
    private callbacks: InputCallbacks,
  ) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') e.preventDefault()
      this.keys.add(e.code)
      if (!e.repeat) this.press(e.code)
    })
    window.addEventListener('keyup', (e) => this.keys.delete(e.code))
    window.addEventListener('blur', () => this.clear())
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.clear()
    })

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return
      // Sin movimiento crudo, Chrome emite picos de cientos o miles: se descartan, no se recortan.
      if (!this.rawMouse && (Math.abs(e.movementX) > MOUSE_SPIKE_LIMIT || Math.abs(e.movementY) > MOUSE_SPIKE_LIMIT)) return
      this.dx += e.movementX
      this.dy += e.movementY
    })
    // El clic que inicia o reanuda llega con el juego aún en menú/pausa, así que no cuenta como golpe.
    document.addEventListener('mousedown', (e) => {
      if (!this.callbacks.isPlaying()) return
      if (e.button === 2) return this.press(RIGHT_CLICK)
      if (e.button !== 0) return
      this.attackHeld = true
      this.press(CLICK)
    })
    // Con el ratón capturado el clic derecho es del juego, no del menú contextual.
    document.addEventListener('contextmenu', (e) => {
      if (this.locked) e.preventDefault()
    })
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.attackHeld = false
    })

    // Solo con el ratón capturado: en menús y pausa la rueda sigue desplazando la página.
    document.addEventListener('wheel', (e) => {
      if (!this.locked) return
      const scale = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? WHEEL_LINE_PX : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? window.innerHeight : 1
      const step = this.stepper.push(e.deltaY * scale, e.timeStamp)
      if (step) this.scroll(step)
    })

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.element
      if (!this.locked) this.clear()
      this.callbacks.onLockChange(this.locked)
    })
  }

  /** Intenta capturar el ratón con movimiento crudo y, si no se puede, sin opciones. */
  async requestLock(): Promise<boolean> {
    try {
      const result = this.element.requestPointerLock?.({ unadjustedMovement: true })
      await result
      this.rawMouse = result !== undefined
      return true
    } catch {
      // NotSupportedError (sin unadjustedMovement) o rechazo por salir hace poco.
    }
    try {
      await this.element.requestPointerLock?.()
      this.rawMouse = false
      return true
    } catch {
      return false
    }
  }

  /** Movimiento de ratón acumulado desde la última llamada. */
  consumeMouse(): { dx: number; dy: number } {
    const delta = { dx: this.dx, dy: this.dy }
    this.dx = this.dy = 0
    return delta
  }

  /** Registra una pulsación única. Como el clic, fuera de partida no cuenta. */
  press(code: string) {
    if (this.callbacks.isPlaying()) this.presses.add(code)
  }

  /** Registra pasos de rueda (positivo hacia abajo). Como el clic, fuera de partida no cuenta. */
  scroll(steps: number) {
    if (this.callbacks.isPlaying()) this.wheel += steps
  }

  /** Pasos de rueda acumulados desde la última llamada. */
  takeWheel(): number {
    const steps = this.wheel
    this.wheel = 0
    return steps
  }

  /**
   * Teclas pulsadas (sin autorrepetición) desde la última llamada, por e.code.
   * Se llama una vez por paso fijo; el Set devuelto solo es válido hasta la siguiente llamada.
   */
  takePresses(): ReadonlySet<string> {
    ;[this.presses, this.taken] = [this.taken, this.presses]
    this.presses.clear()
    return this.taken
  }

  state(): PlayerInput {
    const k = this.keys
    return {
      forward: k.has('KeyW'),
      back: k.has('KeyS'),
      left: k.has('KeyA'),
      right: k.has('KeyD'),
      sprint: k.has('ShiftLeft') || k.has('ShiftRight'),
      jump: k.has('Space'),
    }
  }

  clear() {
    this.keys.clear()
    this.presses.clear()
    this.wheel = 0
    this.stepper.reset()
    this.attackHeld = false
    this.dx = this.dy = 0
  }
}
