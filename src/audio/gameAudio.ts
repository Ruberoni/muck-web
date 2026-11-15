import { enemyScale, PROP_DEFS, STEP, type EnemyType, type MobLook, type PropFamily } from '../sim/constants'
import type { PlayerId, SimEvent, TargetRef } from '../sim/events'
import type { Hazard } from '../sim/hazards'
import type { ItemId } from '../sim/inventory'
import type { ProjectileEnd, ProjectileKind } from '../sim/projectiles'
import type { PropKind } from '../sim/props'
import { canDamage } from '../sim/tiers'
import type { SoundLoop, SoundName, SoundOut } from './sound'
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
const IMPACT: Record<PropFamily, SoundName> = { tree: 'hitWood', rock: 'hitStone', bush: 'hitBush', herb: 'hitBush' }
const BREAK: Record<PropFamily, SoundName> = { tree: 'breakWood', rock: 'breakStone', bush: 'breakWood', herb: 'breakWood' }
const breakOf = (kind: PropKind) => BREAK[PROP_DEFS[kind].family]

/** Hasta dónde se oye lo que hacen los demás (§8 del plan): golpes y roturas, colocar estructuras, daño, pasos y lo demás. */
export const REMOTE_HEARING = { hit: 30, place: 25, hurt: 20, step: 15, other: 15 } as const
/** La muerte de otro se oye siempre, aunque esté lejos (con esta ganancia como mínimo). */
export const REMOTE_DEATH_GAIN = 0.35

/** Hasta dónde se oyen los pasos de un mob: avisan de que llega, pero son muchos a la vez. */
export const ENEMY_STEP_HEARING = 20
/**
 * La ganancia de un paso de mob pegado a ti: con el efecto `enemyStep` de un trasgo, a 0,8 m, ~4 dB por debajo de un
 * paso propio en energía y ~8 dB con el paso alto a 300 Hz de un altavoz pequeño (medido con
 * `scripts/measure-enemy-steps.mjs`). Discreto, porque se repite muchísimo, pero se oye.
 */
export const ENEMY_STEP_GAIN = 0.62
/**
 * Cómo cae con la distancia: `(1 − d/ENEMY_STEP_HEARING) ^ ENEMY_STEP_FALLOFF`. Más suave que el `near²` de
 * `spatialize`, para que a media distancia no desaparezca: a 10 m queda ~17 dB por debajo de un paso propio (~20 dB
 * en un altavoz pequeño). Por eso a 10 m un mob suena algo más que el paso de un compañero: a propósito, avisa.
 */
export const ENEMY_STEP_FALLOFF = 1.5
/** Mobs que pisan más suave que los demás de su tamaño: el espíritu casi flota. */
export const ENEMY_STEP_SOFT: Partial<Record<EnemyType, number>> = { spirit: 0.55 }
/**
 * Un mob que nada chapotea con `stepWater`, el efecto del paso propio en el agua, que ya suena en la banda alta: se
 * baja por esto para que quede como un paso de mob en tierra y no por encima de los tuyos.
 */
export const ENEMY_SWIM_GAIN = 0.25
/** Pasos de mob que suenan como mucho en un paso fijo, los más cercanos: con la manada encima no deben saturar. */
export const ENEMY_STEPS_PER_FRAME = 2

/** Una roca que sale y una que choca con algo, más bajo que un golpe propio. */
const ROCK_THROW_GAIN = 0.5
const ROCK_HIT_GAIN = 0.4

/** Lo que suena al lanzar: la roca del Lanzarrocas corta el aire, la flecha del gigante suena a arco; lo demás, como un golpe al aire. */
const throwSound = (kind: ProjectileKind): SoundName => (kind === 'rock' ? 'pierce' : kind === 'arrow' ? 'arrowShot' : 'swing')
/** Lo que suena al clavarse en el mundo: la flecha, seco y con chispas; lo demás, a piedra. */
const landSound = (kind: ProjectileKind | undefined): SoundName => (kind === 'arrow' ? 'arrowHit' : 'hitStone')
/** Hasta dónde se oye silbar lo que vuela. */
const WHISTLE_HEARING = 45
/** Lo que silba en el aire: cuánto más agudo que la roca y a qué volumen. La flecha, fina y más baja. */
const WHISTLES: Partial<Record<ProjectileKind, { tone: number; gain: number }>> = { rock: { tone: 1, gain: 1 }, arrow: { tone: 1.9, gain: 0.55 } }
/** Cuánto sube (o baja) el tono por cada m/s que se acerca (o se aleja): el efecto Doppler, exagerado. */
const DOPPLER = 1 / 70

/**
 * Cómo suenan los peligros del Guardián: el tajo y cada anillo de fuego, al salir; los charcos sisean al avisar y
 * prenden al acabar el aviso; el meteorito pequeño silba al bajar y estalla al caer (con `delay`, lo que tarda).
 */
export function guardianSounds(h: Pick<Hazard, 'look' | 'ring' | 'startTick' | 'hitTick'>): { name: SoundName; delay: number }[] {
  const delay = (h.hitTick - h.startTick) * STEP
  switch (h.look) {
    case 'fire':
      return [{ name: h.ring ? 'flameWave' : 'lavaSlash', delay }]
    case 'lava':
      return [
        { name: 'lavaHiss', delay: 0 },
        { name: 'lavaIgnite', delay },
      ]
    case 'meteor':
      return [
        { name: 'meteorFall', delay: 0 },
        { name: 'meteorCrash', delay },
      ]
    default:
      return []
  }
}

/** Lo que quita el escudo suena a metal; lo que quita el fuego mientras arde, a chisporroteo. */
const hurtSound = (e: { blocked?: number; burning?: true }): SoundName => (e.blocked ? 'clank' : e.burning ? 'burnTick' : 'hurt')

/** Una roca suena al chocar con el mundo; al dar a un jugador ya suena su daño. */
const rockLands = (end: ProjectileEnd) => end === 'ground' || end === 'obstacle'

/** El impacto de un meteorito se oye en toda la isla: de lejos, más bajo pero nunca menos que esto. */
const METEOR_HEARING = 180
/** El humo de una aparición se oye hasta algo más allá de donde salen (ENEMY_SPAWN_MAX). */
const SPAWN_HEARING = 70
const SPAWN_MIN_GAIN = 0.15
const METEOR_MIN_GAIN = 0.3

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

/** Un mob para sus pasos: lo que ya tiene la simulación (un `EnemyData` cumple). */
export interface EnemyWalker {
  id: number
  type: EnemyType
  pos: { x: number; z: number }
  alive: boolean
  /** Su apariencia: en la Noche Eterna un trasgo crece, y sus pasos pesan y se espacian con él. */
  look?: MobLook
}

/**
 * Cómo suena un paso del mob `type` (con la apariencia `look`) a (`dx`, `dz`) del oyente que mira a `yaw`: su ganancia
 * (0 fuera de alcance), su paneo y su peso (la escala visible, para el efecto).
 */
export function enemyStepVolume(dx: number, dz: number, yaw: number, type: EnemyType, look: MobLook = 0) {
  const { pan } = spatialize(dx, dz, yaw, ENEMY_STEP_HEARING)
  const near = Math.max(0, 1 - Math.hypot(dx, dz) / ENEMY_STEP_HEARING)
  const gain = near ** ENEMY_STEP_FALLOFF * ENEMY_STEP_GAIN * (ENEMY_STEP_SOFT[type] ?? 1)
  return { gain, pan, weight: enemyScale(type, look) }
}

/**
 * El oyente: la cámara del jugador local, o, en espectador, el compañero al que se mira con el giro de la cámara que
 * lo sigue (`spectatorYaw`; null si no se mira a nadie), para que el paneo cuadre con lo que se ve.
 */
export const listenerFor = (pos: Point, lookYaw: number, spectatorYaw: number | null): Listener => ({
  x: pos.x,
  z: pos.z,
  yaw: spectatorYaw ?? lookYaw,
})

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
  /** Las rocas que silban en el aire, por proyectil (null: sin sonido todavía). */
  private whistles = new Map<number, SoundLoop | null>()
  private flying = new Set<number>()
  /** Lo lanzado que aún vuela, por id: al caer se sabe qué era (el evento del golpe no lo dice). */
  private thrown = new Map<number, ProjectileKind>()
  /** Los gigantes que están embistiendo: al pararse suena si han pegado o no. */
  private rushing = new Set<number>()
  /** Pasos de los demás: dónde estaban en el frame anterior y cuánto llevan andado desde el último paso. */
  private walkers = new Map<PlayerId, { x: number; z: number; stride: number }>()
  /** Pasos de los mobs: lo mismo, por id de enemigo. */
  private mobs = new Map<number, { x: number; z: number; stride: number }>()
  /** Los pasos de mob de este paso fijo, los más cercanos: se reutiliza, no se reserva nada por frame. */
  private mobSteps = Array.from({ length: ENEMY_STEPS_PER_FRAME }, () => ({ gain: 0, pan: 0, weight: 1, water: false }))

  constructor(
    private sound: SoundOut,
    private rng: () => number = Math.random,
  ) {}

  /** Paso fijo, tras mover al jugador. */
  step(dt: number, player: PlayerLike, enemies: readonly { type?: string; pos: { x: number; z: number } }[]) {
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
      this.sound.play(e.type === 'dog' ? 'bark' : 'growl', { gain, pan })
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
    // Los charcos de lava salen juntos: suenan una vez.
    let pools = false
    for (const e of list) {
      switch (e.type) {
        case 'playerSwing':
          // Al empezar, el aire; lo que suena al dar, al pegar.
          if (e.id === me) this.sound.play('swing')
          break
        case 'playerStrike':
          if (e.id === me && e.target) this.swing(e.item, e.target, list, propKind)
          break
        case 'propDestroyed':
          s.play(breakOf(propKind(e.id)))
          break
        case 'enemyDied':
          s.play('enemyDeath')
          break
        case 'enemyHit':
          if (e.by === me && e.efficacy !== 'normal') s.play(e.efficacy === 'effective' ? 'hitEffective' : 'hitResisted')
          break
        case 'enemyCharge':
          if (e.state === 'crouch') s.play('roar')
          if (e.state === 'aim') s.play('growl')
          this.rushSound(e.id, e.state, list, (name) => s.play(name))
          break
        case 'eternalNight':
        case 'bell':
          s.play('bell')
          break
        case 'playerTraded':
          // Una mejora es un paso adelante, no una recogida: suena como fabricar.
          if (e.id === me) s.play(e.op === 'boost' ? 'craft' : 'pickup')
          break
        case 'projectileThrown':
          this.thrown.set(e.id, e.kind)
          s.play(throwSound(e.kind), { gain: ROCK_THROW_GAIN })
          break
        case 'hazardAdded':
          if (e.hazard.look === 'rock') s.play('smash')
          if (e.hazard.look === 'stomp') s.play('quake')
          if (e.hazard.look === 'lava' && pools) break
          pools ||= e.hazard.look === 'lava'
          for (const { name, delay } of guardianSounds(e.hazard)) s.play(name, { delay })
          break
        case 'enemyFury':
          s.play('fury')
          break
        case 'projectileHit':
          if (rockLands(e.end)) s.play(landSound(this.thrown.get(e.id)), { gain: ROCK_HIT_GAIN })
          this.thrown.delete(e.id)
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
        // Lo que para el escudo suena a metal.
        case 'playerHurt':
          if (e.id === me) s.play(hurtSound(e))
          if (e.id === me && e.dazed) s.play('daze')
          if (e.id === me && e.ignited) s.play('ignite')
          break
        case 'playerEquipped':
          if (e.id === me) s.play('place')
          break
        // El pez avisa antes de morder.
        case 'fishAppeared':
          if (e.id === me) s.play('growl')
          break
        case 'playerAte':
          if (e.id === me) s.play('eat')
          break
        // Tirar algo suena como un golpe al aire.
        case 'playerDropped':
          if (e.id === me) s.play('swing')
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
   * La embestida del gigante: suena al salir corriendo, y al pararse (`dazed`, justo después) según si ha pegado en
   * ese mismo paso.
   */
  private rushSound(id: number, state: string, list: readonly SimEvent[], play: (name: SoundName) => void) {
    if (state === 'rush') {
      this.rushing.add(id)
      play('rush')
    } else if (state === 'dazed' && this.rushing.delete(id)) {
      play(list.some((other) => other.type === 'enemyAttack' && other.id === id) ? 'spearHit' : 'rushStop')
    }
  }

  /**
   * Por frame: cada roca y cada flecha en el aire silba desde donde va, más fuerte cuanto más cerca, más aguda si se acerca y más
   * grave si se aleja. Al caer (o al pasar la lista vacía, en pausa) se calla.
   */
  flyby(projectiles: readonly { id: number; kind: ProjectileKind; pos: { x: number; z: number }; prev: { x: number; z: number } }[], listener: Listener) {
    this.flying.clear()
    for (const p of projectiles) {
      const whistle = WHISTLES[p.kind]
      if (!whistle) continue
      this.flying.add(p.id)
      let loop = this.whistles.get(p.id) ?? null
      if (!loop) {
        loop = this.sound.whistle?.(whistle.tone) ?? null
        this.whistles.set(p.id, loop)
      }
      if (!loop) continue
      const dx = p.pos.x - listener.x
      const dz = p.pos.z - listener.z
      const d = Math.hypot(dx, dz)
      const { gain, pan } = spatialize(dx, dz, listener.yaw, WHISTLE_HEARING)
      // Lo que se acerca por segundo (negativo: se aleja).
      const closing = d < 1e-6 ? 0 : -(dx * (p.pos.x - p.prev.x) + dz * (p.pos.z - p.prev.z)) / d / STEP
      loop.set(gain * whistle.gain, pan, Math.max(0.7, Math.min(1.4, 1 + closing * DOPPLER)))
    }
    for (const [id, loop] of this.whistles) {
      if (this.flying.has(id)) continue
      loop?.stop()
      this.whistles.delete(id)
    }
  }

  /** Un meteorito se anuncia: el silbido viene de todas partes. */
  meteorIncoming() {
    this.sound.play('meteorWhistle')
  }

  /** Cae en (x, z), y de ahí viene el golpe. */
  /** Humo donde va a salir un mob: se oye desde su sitio, más fuerte cuanto más cerca, también a través de la niebla. */
  spawnPuff(x: number, z: number, listener: Listener) {
    const { gain, pan } = spatialize(x - listener.x, z - listener.z, listener.yaw, SPAWN_HEARING)
    if (gain > 0) this.sound.play('spawnPuff', { gain: Math.max(gain, SPAWN_MIN_GAIN), pan })
  }

  meteorLanded(x: number, z: number, listener: Listener) {
    const { gain, pan } = spatialize(x - listener.x, z - listener.z, listener.yaw, METEOR_HEARING)
    this.sound.play('meteorImpact', { gain: Math.max(gain, METEOR_MIN_GAIN), pan })
  }

  /**
   * Sonidos de lo que hacen los demás (eventos ya en el tick de render), en su sitio: `locate` dice dónde pasa
   * cada evento (null: no se sabe, no suena). Lo que solo le importa a quien lo hace (recoger, bayas) no suena.
   */
  remote(list: readonly SimEvent[], listener: Listener, locate: (e: SimEvent) => Point | null, propKind: (id: number) => PropKind) {
    const at = (e: SimEvent, distance: number, name: SoundName | null, minGain = 0, delay = 0) => {
      const where = name && locate(e)
      if (!where) return
      const { gain, pan } = spatialize(where.x - listener.x, where.z - listener.z, listener.yaw, distance)
      const g = Math.max(gain, minGain)
      if (g > 0) this.sound.play(name, { gain: g, pan, ...(delay > 0 ? { delay } : {}) })
    }
    // Lo que fabrica cada uno en un mismo paso suena una vez, y los charcos de lava que salen juntos, también.
    const crafted = new Set<string>()
    let pools = false
    for (const e of list) {
      switch (e.type) {
        case 'playerSwing':
          at(e, REMOTE_HEARING.hit, 'swing')
          break
        case 'playerStrike':
          if (e.target) at(e, REMOTE_HEARING.hit, this.impact(e.item, e.target, list, propKind))
          break
        case 'propDestroyed':
          at(e, REMOTE_HEARING.hit, breakOf(propKind(e.id)))
          break
        case 'enemyDied':
          at(e, REMOTE_HEARING.hit, 'enemyDeath')
          break
        case 'enemyCharge':
          if (e.state === 'crouch') this.sound.play('roar')
          if (e.state === 'aim') this.sound.play('growl')
          this.rushSound(e.id, e.state, list, (name) => this.sound.play(name))
          break
        case 'eternalNight':
        case 'bell':
          this.sound.play('bell')
          break
        case 'projectileThrown':
          this.thrown.set(e.id, e.kind)
          at(e, REMOTE_HEARING.hit, throwSound(e.kind))
          break
        case 'hazardAdded':
          if (e.hazard.look === 'rock') at(e, REMOTE_HEARING.hit, 'smash')
          if (e.hazard.look === 'stomp') at(e, REMOTE_HEARING.hit, 'quake')
          if (e.hazard.look === 'lava' && pools) break
          pools ||= e.hazard.look === 'lava'
          for (const { name, delay } of guardianSounds(e.hazard)) at(e, REMOTE_HEARING.hit, name, 0, delay)
          break
        case 'enemyFury':
          this.sound.play('fury')
          break
        case 'projectileHit':
          if (rockLands(e.end)) at(e, REMOTE_HEARING.hit, landSound(this.thrown.get(e.id)))
          this.thrown.delete(e.id)
          break
        case 'structurePlaced':
          at(e, REMOTE_HEARING.place, 'place')
          break
        case 'playerHurt':
          at(e, REMOTE_HEARING.hurt, hurtSound(e))
          break
        case 'fishAppeared':
          at(e, REMOTE_HEARING.other, 'growl')
          break
        case 'playerAte':
          at(e, REMOTE_HEARING.other, 'eat')
          break
        case 'playerDropped':
          at(e, REMOTE_HEARING.other, 'swing')
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

  /**
   * Por paso fijo (también en espectador): los pasos de los mobs, uno cada STRIDE metros por su escala visible (los del
   * Coloso son largos y graves, los de un perro cortos y ligeros). Sutiles, hasta ENEMY_STEP_HEARING, y como mucho
   * ENEMY_STEPS_PER_FRAME, los más cercanos: con 24 mobs a la vez no deben saturar. `swimming` dice dónde no hacen
   * pie: ahí nadan y chapotean en vez de pisar.
   */
  enemySteps(enemies: readonly EnemyWalker[], listener: Listener, swimming: (x: number, z: number) => boolean) {
    const picks = this.mobSteps
    let picked = 0
    for (const e of enemies) {
      const last = this.mobs.get(e.id)
      if (!last) {
        this.mobs.set(e.id, { x: e.pos.x, z: e.pos.z, stride: 0 })
        continue
      }
      const moved = Math.hypot(e.pos.x - last.x, e.pos.z - last.z)
      last.x = e.pos.x
      last.z = e.pos.z
      // Un salto grande es una corrección del servidor o una aparición, no un paso; un muerto no anda.
      if (!e.alive || moved >= MAX_STEP_DISTANCE * 4) continue
      last.stride += moved
      const stride = STRIDE * enemyScale(e.type, e.look)
      if (last.stride < stride) continue
      last.stride -= stride
      const { gain, pan, weight } = enemyStepVolume(e.pos.x - listener.x, e.pos.z - listener.z, listener.yaw, e.type, e.look)
      if (gain <= 0) continue
      // De los que pisan en este paso, se guardan los más cercanos (los de más ganancia).
      let slot = picked
      if (picked === picks.length) {
        slot = 0
        for (let i = 1; i < picks.length; i++) if (picks[i].gain < picks[slot].gain) slot = i
        if (picks[slot].gain >= gain) continue
      } else picked++
      picks[slot].gain = gain
      picks[slot].pan = pan
      picks[slot].weight = weight
      picks[slot].water = swimming(e.pos.x, e.pos.z)
    }
    for (let i = 0; i < picked; i++) {
      const { gain, pan, weight, water } = picks[i]
      const jitter = 0.85 + this.rng() * 0.3
      if (water) this.sound.play('stepWater', { gain: gain * ENEMY_SWIM_GAIN * jitter, pan })
      else this.sound.play('enemyStep', { gain: gain * jitter, pan, weight })
    }
    // El mapa no se queda con los que ya no están: se limpia solo cuando sobra, sin reservar un Set en cada frame.
    if (this.mobs.size > enemies.length) {
      const left = new Set(enemies.map((e) => e.id))
      for (const id of this.mobs.keys()) if (!left.has(id)) this.mobs.delete(id)
    }
  }

  /** Impacto de un golpe propio con `item`, o al aire si `target` es null. */
  private swing(item: ItemId | null, target: TargetRef | null, list: readonly SimEvent[], propKind: (id: number) => PropKind) {
    const name = this.impact(item, target, list, propKind)
    if (name) this.sound.play(name)
  }

  /**
   * Lo que suena al golpear `target` con `item`: nada si en la misma lista lo rompe o lo mata (suena eso), y `clank`
   * si no se le puede hacer nada con eso (una roca a mano): el cliente lo decide solo, sin evento nuevo.
   */
  private impact(item: ItemId | null, target: TargetRef | null, list: readonly SimEvent[], propKind: (id: number) => PropKind): SoundName | null {
    if (!target) return 'swing'
    const killed = list.some(
      (e) => ((e.type === 'propDestroyed' && target.kind === 'prop') || (e.type === 'enemyDied' && target.kind === 'enemy')) && e.id === target.id,
    )
    if (killed) return null
    if (target.kind === 'enemy') return 'enemyHit'
    const kind = propKind(target.id)
    return canDamage(item, kind) ? IMPACT[PROP_DEFS[kind].family] : 'clank'
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
    this.mobs.clear()
  }
}
