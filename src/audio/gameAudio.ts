import type { PlayerId, SimEvent, TargetRef } from '../sim/events'
import type { PropKind } from '../sim/props'
import type { SoundName, SoundOut } from './sound'
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
const IMPACT = { tree: 'hitWood', rock: 'hitStone', bush: 'hitBush' } as const

/** Hasta dónde se oye lo que hacen los demás (§8 del plan): golpes y roturas, fogatas, daño, pasos y lo demás. */
export const REMOTE_HEARING = { hit: 30, place: 25, hurt: 20, step: 15, other: 15 } as const
/** La muerte de otro se oye siempre, aunque esté lejos (con esta ganancia como mínimo). */
export const REMOTE_DEATH_GAIN = 0.35

/** Quién escucha: la cámara del jugador local. */
export interface Listener {
  x: number
  z: number
  yaw: number
}

/** Otro jugador como se dibuja ahora, para sus pasos. */
export interface RemoteWalker {
  id: PlayerId
  x: number
  z: number
  /** Pisando suelo (no en el aire ni flotando). */
  grounded: boolean
  inWater: boolean
  alive: boolean
}

type Point = { x: number; z: number }

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
  /** Pasos de los demás: dónde estaban en el frame anterior y cuánto llevan andado desde el último paso. */
  private walkers = new Map<PlayerId, { x: number; z: number; stride: number }>()

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
   * Sonidos de los eventos de un paso, tal como los oye el jugador `me`. Un golpe suena según lo que
   * golpea; si lo rompe o lo mata, solo suena la rotura o la muerte (que llegan en su propio evento).
   */
  events(list: readonly SimEvent[], me: PlayerId, propKind: (id: number) => PropKind) {
    const s = this.sound
    // Recoger varias piezas en el mismo paso suena una sola vez, y fabricar varias (Mayúsculas + clic), también.
    let collected = false
    const crafted = new Set<number>()
    for (const e of list) {
      switch (e.type) {
        case 'playerSwing':
          if (e.id === me) this.swing(e.target, list, propKind)
          break
        case 'propDestroyed':
          s.play(propKind(e.id) === 'rock' ? 'breakStone' : 'breakWood')
          break
        case 'enemyDied':
          s.play('enemyDeath')
          break
        // Las bayas van directas al inventario; lo demás suena al recogerlo del suelo.
        case 'berryTaken':
          if (e.by === me) this.pickup()
          break
        case 'pickupCollected':
          if (e.by === me && !collected) this.pickup()
          collected ||= e.by === me
          break
        case 'structurePlaced':
          s.play('place')
          break
        case 'playerHurt':
          if (e.id === me) s.play('hurt')
          break
        case 'playerAte':
          if (e.id === me) s.play('eat')
          break
        case 'playerCrafted':
          if (e.id === me && !crafted.has(e.tick)) s.play('craft')
          if (e.id === me) crafted.add(e.tick)
          break
        case 'playerDied':
          if (e.id === me) s.play('death')
          break
      }
    }
  }

  /**
   * Sonidos de lo que hacen los demás (eventos ya en el tick de render), en su sitio: `locate` dice dónde pasa
   * cada evento (null: no se sabe, no suena). Lo que solo le importa a quien lo hace (recoger, bayas) no suena.
   */
  remote(list: readonly SimEvent[], listener: Listener, locate: (e: SimEvent) => Point | null, propKind: (id: number) => PropKind) {
    const at = (e: SimEvent, distance: number, name: SoundName | null, minGain = 0) => {
      const where = name && locate(e)
      if (!where) return
      const { gain, pan } = spatialize(where.x - listener.x, where.z - listener.z, listener.yaw, distance)
      const g = Math.max(gain, minGain)
      if (g > 0) this.sound.play(name, { gain: g, pan })
    }
    // Lo que fabrica cada uno en un mismo paso suena una vez.
    const crafted = new Set<string>()
    for (const e of list) {
      switch (e.type) {
        case 'playerSwing':
          at(e, REMOTE_HEARING.hit, this.impact(e.target, list, propKind))
          break
        case 'propDestroyed':
          at(e, REMOTE_HEARING.hit, propKind(e.id) === 'rock' ? 'breakStone' : 'breakWood')
          break
        case 'enemyDied':
          at(e, REMOTE_HEARING.hit, 'enemyDeath')
          break
        case 'structurePlaced':
          at(e, REMOTE_HEARING.place, 'place')
          break
        case 'playerHurt':
          at(e, REMOTE_HEARING.hurt, 'hurt')
          break
        case 'playerAte':
          at(e, REMOTE_HEARING.other, 'eat')
          break
        case 'playerCrafted':
          if (!crafted.has(`${e.id}:${e.tick}`)) at(e, REMOTE_HEARING.other, 'craft')
          crafted.add(`${e.id}:${e.tick}`)
          break
        case 'playerDied':
          at(e, REMOTE_HEARING.hit, 'death', REMOTE_DEATH_GAIN)
          break
      }
    }
  }

  /** Por frame: los pasos de los demás, un paso cada STRIDE metros como los propios, oídos hasta 15 m. */
  remoteSteps(walkers: readonly RemoteWalker[], listener: Listener) {
    const seen = new Set<PlayerId>()
    for (const w of walkers) {
      seen.add(w.id)
      const last = this.walkers.get(w.id)
      if (!last) {
        this.walkers.set(w.id, { x: w.x, z: w.z, stride: 0 })
        continue
      }
      const moved = Math.hypot(w.x - last.x, w.z - last.z)
      last.x = w.x
      last.z = w.z
      // Un salto grande es una corrección o un teletransporte, no pasos.
      if (!w.alive || !w.grounded || moved >= MAX_STEP_DISTANCE * 4) continue
      last.stride += moved
      if (last.stride < STRIDE) continue
      last.stride -= STRIDE
      const { gain, pan } = spatialize(w.x - listener.x, w.z - listener.z, listener.yaw, REMOTE_HEARING.step)
      if (gain > 0) this.sound.play(w.inWater ? 'stepWater' : 'step', { gain: gain * (0.8 + this.rng() * 0.2), pan })
    }
    for (const id of this.walkers.keys()) if (!seen.has(id)) this.walkers.delete(id)
  }

  /** Impacto de un golpe propio, o al aire si `target` es null. */
  private swing(target: TargetRef | null, list: readonly SimEvent[], propKind: (id: number) => PropKind) {
    const name = this.impact(target, list, propKind)
    if (name) this.sound.play(name)
  }

  /** Lo que suena al golpear `target`: nada si en la misma lista lo rompe o lo mata (suena eso). */
  private impact(target: TargetRef | null, list: readonly SimEvent[], propKind: (id: number) => PropKind): SoundName | null {
    if (!target) return 'swing'
    const killed = list.some(
      (e) => ((e.type === 'propDestroyed' && target.kind === 'prop') || (e.type === 'enemyDied' && target.kind === 'enemy')) && e.id === target.id,
    )
    if (killed) return null
    if (target.kind === 'enemy') return 'enemyHit'
    return IMPACT[propKind(target.id)]
  }

  private pickup() {
    this.sound.play('pickup', { gain: 0.8 })
  }

  /** Partida nueva o teletransporte: no se cuenta como un paso ni como aterrizaje. */
  reset() {
    this.last = null
    this.wasGrounded = true
    this.airTime = 0
    this.stride = 0
    this.growlTimer = GROWL_MIN_INTERVAL
    this.walkers.clear()
  }
}
