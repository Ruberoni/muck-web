import type { Target } from '../game/interaction'
import type { SoundOut } from './sound'
import { spatialize } from './sound'

/** Metros recorridos entre dos pasos: al correr suenan más seguidos sin tocar nada. */
export const STRIDE = 2.1
/** Más que esto en un paso fijo es un teletransporte, no un paso. */
const MAX_STEP_DISTANCE = 1
/** Un aterrizaje solo suena tras este tiempo en el aire (no en cada bache del terreno). */
const MIN_AIR_TIME = 0.3
export const GROWL_DISTANCE = 28
const GROWL_MIN_INTERVAL = 2.5
const GROWL_RANDOM_INTERVAL = 4

interface PlayerLike {
  pos: { x: number; z: number }
  vel: { y: number }
  yaw: number
  grounded: boolean
  inWater: boolean
  floating: boolean
}

/** Traduce lo que pasa en la partida a efectos: pasos, saltos, golpes y gruñidos de enemigos. */
export class GameAudio {
  private last: { x: number; z: number } | null = null
  private wasGrounded = true
  private airTime = 0
  private stride = 0
  private growlTimer = GROWL_MIN_INTERVAL

  constructor(
    private sound: SoundOut,
    private rng: () => number = Math.random,
  ) {}

  /** Paso fijo, tras mover al jugador. */
  step(dt: number, player: PlayerLike, enemies: readonly { pos: { x: number; z: number } }[]) {
    const { pos } = player
    if (this.last) {
      const moved = Math.hypot(pos.x - this.last.x, pos.z - this.last.z)
      if (player.grounded && !player.floating && moved < MAX_STEP_DISTANCE) {
        this.stride += moved
        if (this.stride >= STRIDE) {
          this.stride -= STRIDE
          this.sound.play(player.inWater ? 'stepWater' : 'step', { gain: 0.8 + this.rng() * 0.2 })
        }
      }
    }
    this.last = { x: pos.x, z: pos.z }

    if (this.wasGrounded && !player.grounded && player.vel.y > 0) this.sound.play('jump')
    if (!this.wasGrounded && player.grounded && this.airTime >= MIN_AIR_TIME) {
      this.sound.play(player.inWater ? 'stepWater' : 'land')
      // El primer paso tras aterrizar llega antes.
      this.stride = STRIDE / 2
    }
    this.airTime = player.grounded ? 0 : this.airTime + dt
    this.wasGrounded = player.grounded

    this.growlTimer -= dt
    if (this.growlTimer <= 0 && enemies.length) {
      this.growlTimer = GROWL_MIN_INTERVAL + this.rng() * GROWL_RANDOM_INTERVAL
      const e = enemies[Math.floor(this.rng() * enemies.length)]
      const { gain, pan } = spatialize(e.pos.x - pos.x, e.pos.z - pos.z, player.yaw, GROWL_DISTANCE)
      this.sound.play('growl', { gain, pan })
    }
  }

  /**
   * Un golpe con la herramienta (o la mano) sobre `target`, o al aire si es null;
   * `dropped` si soltó algo (lo rompió, lo mató o cogió una baya).
   */
  hit(target: Target | null, dropped: boolean) {
    const s = this.sound
    switch (target?.kind) {
      case undefined:
        s.play('swing')
        break
      case 'tree':
        s.play(dropped ? 'breakWood' : 'hitWood')
        break
      case 'rock':
        s.play(dropped ? 'breakStone' : 'hitStone')
        break
      case 'bush':
        s.play('hitBush')
        break
      case 'enemy':
        s.play(dropped ? 'enemyDeath' : 'enemyHit')
        break
    }
    // Las bayas van directas al inventario; lo demás suena al recogerlo del suelo (pickup()).
    if (dropped && target?.kind === 'bush') this.pickup()
  }

  /** Se mete algo en el inventario al recogerlo. */
  pickup() {
    this.sound.play('pickup', { gain: 0.8 })
  }

  /** Partida nueva o teletransporte: no se cuenta como un paso ni como aterrizaje. */
  reset() {
    this.last = null
    this.wasGrounded = true
    this.airTime = 0
    this.stride = 0
    this.growlTimer = GROWL_MIN_INTERVAL
  }
}
