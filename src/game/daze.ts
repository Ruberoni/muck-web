/** Lo que dura en pantalla el aturdimiento de una flecha: más que el frenazo (ARROW_DAZE), para que se note y se pase. */
export const DAZE_TIME = 1
/** Cuánto se ladea la cámara (rad) y cuánto se mueve de lado (m) como mucho. */
const ROLL = 0.07
const SWAY = 0.06

/**
 * Aturdido por una flecha del trasgo gigante: la cámara se tambalea, la pantalla se nubla y se tiñe de azul por los
 * bordes, y se va pasando. Solo es del dibujo: el frenazo lo hace la simulación.
 */
export class Daze {
  private left = 0
  private time = 0
  private state = { amount: 0, roll: 0, sway: 0 }

  /** Otra flecha: vuelve a empezar. */
  start() {
    this.left = DAZE_TIME
  }

  /** Por frame: cuánto se nota (0 a 1), cuánto ladear la cámara y cuánto moverla de lado. */
  update(dt: number) {
    this.left = Math.max(0, this.left - dt)
    this.time += dt
    const k = this.left / DAZE_TIME
    // Fuerte al principio y se va suave.
    const amount = k * k * (3 - 2 * k)
    this.state.amount = amount
    this.state.roll = Math.sin(this.time * 7) * ROLL * amount
    this.state.sway = Math.sin(this.time * 4.3) * SWAY * amount
    return this.state
  }
}
