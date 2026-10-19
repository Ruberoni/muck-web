import { MOUSE_SPIKE_LIMIT } from './constants'
import type { PlayerInput } from './player'

/** Códigos de pulsación única del clic izquierdo y derecho (no son e.code reales). */
export const CLICK = 'Mouse0'
export const RIGHT_CLICK = 'Mouse2'

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
    this.attackHeld = false
    this.dx = this.dy = 0
  }
}
