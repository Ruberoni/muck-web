import { MOUSE_SPIKE_LIMIT } from './constants'
import type { PlayerInput } from './player'

interface InputCallbacks {
  onLockChange(locked: boolean): void
  isPlaying(): boolean
}

/** Teclado (por e.code), ratón y pointer lock. */
export class Input {
  private keys = new Set<string>()
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
      if (e.button === 0 && this.callbacks.isPlaying()) this.attackHeld = true
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
    this.attackHeld = false
    this.dx = this.dy = 0
  }
}
