import { ENEMY_DEFS, type EnemyType } from '../sim/constants'
import { bossOfNight } from '../sim/enemies'

/**
 * Lo que el HUD dice de los jefes: el cartel al amanecer del día que toca y al llegar, y hasta que llega, el aviso
 * bajo el día. Sale de lo que ve el cliente (el reloj y los enemigos), así que no necesita eventos propios.
 */
export class BossWatch {
  private warned = 0
  private arrived = 0
  private alive = false

  /** Por frame: `boss` es el jefe que hay vivo. Devuelve el cartel que toca enseñar ahora y el aviso de esta noche. */
  update(day: number, boss: EnemyType | null): { banner: string | null; tonight: string | null } {
    // Partida nueva.
    if (day < this.warned || day < this.arrived) this.warned = this.arrived = 0
    const coming = bossOfNight(day)
    const appeared = boss !== null && !this.alive
    this.alive = boss !== null
    if (appeared) {
      this.arrived = day
      return { banner: `¡Se acerca el ${ENEMY_DEFS[boss].name}!`, tonight: null }
    }
    if (!coming || boss || this.arrived === day) return { banner: null, tonight: null }
    const tonight = `Esta noche: ${ENEMY_DEFS[coming].name}`
    if (this.warned === day) return { banner: null, tonight }
    this.warned = day
    return { banner: tonight, tonight }
  }
}
