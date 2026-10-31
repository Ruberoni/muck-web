const SHAKE_TIME = 0.7
/** Metros que se mueve la cámara como mucho. */
const SHAKE_AMOUNT = 0.3
/** Desde esta distancia a lo que pasa ya no se nota. */
const SHAKE_RANGE = 110

/** La sacudida de la cámara cuando cae algo grande. Solo es del dibujo: el jugador no se mueve. */
export class CameraShake {
  private left = 0
  private amount = 0
  private offset = { x: 0, y: 0 }

  /** Pasa algo a `distance` metros: cuanto más cerca, más tiembla. */
  start(distance: number) {
    this.left = SHAKE_TIME
    this.amount = SHAKE_AMOUNT * Math.max(0, 1 - distance / SHAKE_RANGE)
  }

  /** Por frame: cuánto apartar la cámara en este momento. */
  update(dt: number) {
    this.left = Math.max(0, this.left - dt)
    const fade = this.amount * (this.left / SHAKE_TIME)
    this.offset.x = Math.sin(this.left * 53) * fade
    this.offset.y = Math.sin(this.left * 71) * fade
    return this.offset
  }
}
