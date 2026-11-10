import { MOUSE_SPIKE_LIMIT, WHEEL_GESTURE_GAP_MS, WHEEL_LINE_PX, WHEEL_STEP_PX } from '../sim/constants'
import type { PlayerInput } from '../sim/player'
import { anyOf, binds, CLICK, DEFAULT_BINDINGS, RIGHT_CLICK, type Bindings } from './bindings'

// Los pseudo-códigos del ratón viven en `bindings.ts`, que no importa de aquí; se reexportan para quien ya los usa.
export { CLICK, RIGHT_CLICK }
/** Una tecla pulsada con Ctrl cuenta además como esta pulsación (tampoco es un e.code real): `withCtrl('KeyQ')`. */
export const withCtrl = (code: string) => `Ctrl+${code}`

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
  /** Si cuentan el clic y la rueda: solo vivo y jugando (un espectador que mantiene el clic no golpea al reaparecer). */
  isPlaying(): boolean
  /** Si cuentan las pulsaciones de teclado: también muerto en una sala (Tab cambia a quién se mira, Enter abre el chat). */
  acceptsKeys(): boolean
  /** Si al soltar el ratón se conservan las teclas que se mantienen: con el inventario abierto se sigue andando. */
  keepsKeys?(): boolean
}

/** Teclado (por e.code), ratón y pointer lock. Las teclas de cada acción son las de `bindings`. */
export class Input {
  private keys = new Set<string>()
  private presses = new Set<string>()
  private taken = new Set<string>()
  private dx = 0
  private dy = 0
  private rawMouse = false
  private wheel = 0
  private stepper = new WheelStepper()
  private bindings: Bindings
  locked = false

  constructor(
    private element: HTMLElement,
    private callbacks: InputCallbacks,
    bindings: Bindings = DEFAULT_BINDINGS,
  ) {
    this.bindings = bindings
    window.addEventListener('keydown', (e) => {
      // Saltar no debe desplazar la página, y con el ratón capturado la tecla del inventario no debe mover el foco
      // (Tab cambia a quién mira el espectador). Se mira lo asignado, no unas teclas fijas.
      if (binds(this.bindings.jump, e.code) || (this.locked && binds(this.bindings.inventory, e.code))) e.preventDefault()
      this.keys.add(e.code)
      if (e.repeat) return
      this.press(e.code)
      // Ctrl se mira al pulsar: en el siguiente paso puede estar ya suelta.
      if (e.ctrlKey) this.press(withCtrl(e.code))
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
    // El clic que inicia o reanuda llega con el juego aún en menú/pausa, así que no cuenta como golpe. El botón
    // mantenido entra en `keys` con su pseudo-código: así golpear y bloquear se asignan igual que una tecla.
    document.addEventListener('mousedown', (e) => {
      if (!this.callbacks.isPlaying()) return
      if (e.button === 2) {
        this.keys.add(RIGHT_CLICK)
        return this.press(RIGHT_CLICK)
      }
      if (e.button !== 0) return
      this.keys.add(CLICK)
      this.press(CLICK)
    })
    // Con el ratón capturado el clic derecho es del juego, no del menú contextual.
    document.addEventListener('contextmenu', (e) => {
      if (this.locked) e.preventDefault()
    })
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.keys.delete(CLICK)
      if (e.button === 2) this.keys.delete(RIGHT_CLICK)
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
      if (!this.locked) {
        if (this.callbacks.keepsKeys?.()) this.clearActions()
        else this.clear()
      }
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

  /** Registra una pulsación única. El clic, fuera de partida o de espectador, no cuenta; una tecla, fuera de partida. */
  press(code: string) {
    const mouse = code === CLICK || code === RIGHT_CLICK
    if (mouse ? this.callbacks.isPlaying() : this.callbacks.acceptsKeys()) this.presses.add(code)
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

  /** Si esa tecla está pulsada ahora, por e.code. */
  isDown(code: string) {
    return this.keys.has(code)
  }

  /** Si se mantiene alguna de las teclas asignadas a una acción. */
  isBindingDown(binding: string) {
    return anyOf(this.keys, binding)
  }

  state(): PlayerInput {
    const { keys: k, bindings: b } = this
    return {
      forward: anyOf(k, b.forward),
      back: anyOf(k, b.back),
      left: anyOf(k, b.left),
      right: anyOf(k, b.right),
      sprint: anyOf(k, b.sprint),
      jump: anyOf(k, b.jump),
      block: this.callbacks.isPlaying() && anyOf(k, b.block),
    }
  }

  /** Si se mantiene lo asignado a golpear. Solo en partida, como siempre lo estuvo el clic. */
  get attackHeld() {
    return this.callbacks.isPlaying() && anyOf(this.keys, this.bindings.attack)
  }

  /** Cambia las teclas asignadas (desde los ajustes) y olvida lo pulsado: lo que se soltó puede ser otra tecla. */
  setBindings(bindings: Bindings) {
    this.bindings = bindings
    this.clear()
  }

  clear() {
    this.keys.clear()
    this.clearActions()
  }

  /** Olvida pulsaciones, rueda y botones del ratón, pero no las teclas que se mantienen (para seguir andando). */
  clearActions() {
    this.presses.clear()
    this.wheel = 0
    this.stepper.reset()
    // La captura se puede perder con el botón pulsado, y entonces no llega su `mouseup`.
    this.keys.delete(CLICK)
    this.keys.delete(RIGHT_CLICK)
    this.dx = this.dy = 0
  }
}
