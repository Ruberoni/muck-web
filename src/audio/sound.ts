/** Efectos que suenan una vez. Todos se generan con Web Audio: no hay archivos de audio. */
export type SoundName =
  | 'swing'
  | 'hitWood'
  | 'hitStone'
  | 'hitBush'
  /** Golpe que no hace nada: sin la herramienta que pide el prop (una roca a mano). */
  | 'clank'
  | 'breakWood'
  | 'breakStone'
  | 'pickup'
  | 'eat'
  | 'craft'
  | 'place'
  | 'hurt'
  | 'enemyHit'
  /** Encima del golpe, si el enemigo es débil a esa arma o si la resiste. */
  | 'hitEffective'
  | 'hitResisted'
  | 'enemyDeath'
  | 'growl'
  /** Un jefe se agacha para embestir: se oye esté donde esté. */
  | 'roar'
  /** Un perro salvaje: dos ladridos secos. */
  | 'bark'
  /** Sale humo donde va a aparecer un mob: un soplo grave con un siseo. */
  | 'spawnPuff'
  /** La campana de la Noche Eterna: se oye en toda la isla. */
  | 'bell'
  /** Un meteorito que baja: suena `METEOR_WARNING` segundos, y se oye en toda la isla. */
  | 'meteorWhistle'
  | 'meteorImpact'
  /** El golpe al suelo del Lanzarrocas: un golpe grave, un soplo de viento y piedritas. */
  | 'smash'
  /** La roca rápida sale: un chasquido seco que corta el aire (luego silba con `whistle`). */
  | 'pierce'
  /** El pisotón del trasgo gigante: un golpe muy grave, el suelo que se agrieta y un brillo encima. */
  | 'quake'
  /** El trasgo gigante sale embistiendo: un soplo de viento que crece. */
  | 'rush'
  /** La lanza del gigante te alcanza al embestir: un golpe con un tintineo brillante. */
  | 'spearHit'
  /** La embestida se para sin pegar: un frenazo en seco. */
  | 'rushStop'
  /** El gigante suelta una flecha: la cuerda del arco y un brillo. */
  | 'arrowShot'
  /** Una flecha del gigante se clava en algo: un golpe seco con chispas. */
  | 'arrowHit'
  /** Te ha aturdido una flecha: un pitido en los oídos. */
  | 'daze'
  /** El tajo de lava del Guardián: un golpe grave, el fuego que sale del golpe y chisporroteo. */
  | 'lavaSlash'
  /** Sale su anillo de fuego: los puños contra el suelo y el rugido de la pared de llamas. */
  | 'flameWave'
  /** Los charcos de lava avisan: el suelo sisea y retumba. */
  | 'lavaHiss'
  /** Prenden los charcos: un golpe de fuego y la lava que borbotea. */
  | 'lavaIgnite'
  /** Baja un meteorito pequeño: un silbido que cae y el fuego que crece. */
  | 'meteorFall'
  /** Cae: un estallido grave, tierra y fuego. */
  | 'meteorCrash'
  /** Te ha prendido el fuego: una llamarada pegada a ti. */
  | 'ignite'
  /** Lo que quita el fuego mientras arde: un chisporroteo, en vez del golpe de siempre. */
  | 'burnTick'
  /** El Guardián se enfurece: un rugido con fuego. */
  | 'fury'
  | 'step'
  | 'stepWater'
  /** Un paso de un mob: un golpe sordo en tierra, más grave y más fuerte cuanto más grande es (`weight`, su escala). */
  | 'enemyStep'
  | 'jump'
  | 'land'
  | 'death'
  /** Un botón del menú: un toc de madera corto. */
  | 'uiClick'
  /** Cada número de la cuenta atrás de la sala. */
  | 'uiTick'

export interface PlayOptions {
  /** Multiplica el volumen del efecto (0..1). */
  gain?: number
  /** Estéreo: -1 izquierda, 1 derecha. */
  pan?: number
  /**
   * El tamaño de lo que suena, para los efectos que cambian con él (hoy solo `enemyStep`: la escala visible del mob).
   * Los demás efectos lo ignoran.
   */
  weight?: number
  /** Segundos hasta que empieza: lo que tarda en caer lo que se anuncia ahora (el meteorito pequeño, un charco). */
  delay?: number
}

/** Un sonido que dura mientras pasa algo: se le cambia el volumen, el paneo y el tono en cada frame, hasta `stop`. */
export interface SoundLoop {
  /** `gain` 0..1, `pan` -1..1 y `pitch` 1 = el tono de siempre. */
  set(gain: number, pan: number, pitch: number): void
  stop(): void
}

export interface SoundOut {
  play(name: SoundName, options?: PlayOptions): void
  /** El silbido de algo que vuela, `tone` veces más agudo que el de la roca (null sin sonido todavía). */
  whistle?(tone?: number): SoundLoop | null
}

/** Estado del ambiente, por frame. */
export interface AmbientState {
  /** false en menú, pausa y muerte: el ambiente se calla, los efectos no. */
  active: boolean
  /** 0 de día, 1 de noche cerrada. */
  night: number
  /** 0 lejos de cualquier fogata, 1 junto a una. */
  campfire: number
}

/** El oído percibe el volumen de forma logarítmica: un deslizador lineal se siente mejor al cuadrado. */
export const volumeToGain = (volume: number) => Math.min(1, Math.max(0, volume)) ** 2

/**
 * Volumen y paneo de una fuente en el plano XZ, relativa al oyente que mira a `yaw`
 * (forward = (-sin yaw, -cos yaw), derecha = (cos yaw, -sin yaw)).
 */
export function spatialize(dx: number, dz: number, yaw: number, maxDistance: number): { gain: number; pan: number } {
  const d = Math.hypot(dx, dz)
  const near = Math.max(0, 1 - d / maxDistance)
  const pan = d < 1e-6 ? 0 : ((dx * Math.cos(yaw) - dz * Math.sin(yaw)) / d) * 0.8
  return { gain: near * near, pan }
}

const AMBIENT_FADE = 0.4
/** El silbido de lo que vuela: ruido en una banda estrecha y un tono suave encima, en Hz, y su volumen máximo. */
const WHISTLE_FREQ = 1700
const WHISTLE_TONE = 1250
const WHISTLE_GAIN = 1.6
/** Lo que tardan en seguir los cambios de volumen, paneo y tono (s): sin saltos entre frames. */
const WHISTLE_SMOOTH = 0.03
const MASTER_HEADROOM = 0.8
// Los efectos se definen a escala cómoda (0..1) y aquí se suben al nivel del resto de la mezcla.
const EFFECT_GAIN = 3
const AMBIENT_GAIN = 2.5

interface ToneOptions {
  type?: OscillatorType
  /** Frecuencia final (rampa exponencial). */
  to?: number
  gain?: number
  attack?: number
  delay?: number
  /** Paso bajo opcional, para suavizar ondas cuadradas y de sierra. */
  lowpass?: number
  vibrato?: { rate: number; depth: number }
}

interface NoiseOptions {
  filter?: BiquadFilterType
  freq?: number
  q?: number
  gain?: number
  attack?: number
  delay?: number
}

/** Motor de audio. Hasta unlock() (en un gesto del usuario) no hay AudioContext y todo es silencio. */
export class Sound implements SoundOut {
  private ctx: AudioContext | null = null
  private master!: GainNode
  private ambient!: GainNode
  private windGain!: GainNode
  private windFilter!: BiquadFilterNode
  private fireGain!: GainNode
  private noiseBuffer!: AudioBuffer
  private out: AudioNode | null = null
  private volume = 1
  private timers = { bird: 2, cricket: 0, crackle: 0, wind: 0 }
  /** El `delay` del efecto que suena ahora: todos sus tonos y ruidos empiezan tanto después. */
  private lag = 0

  constructor(private rng: () => number = Math.random) {}

  /** Variación al azar para que dos golpes seguidos no suenen idénticos. */
  random() {
    return this.rng()
  }

  /** Crea o reanuda el contexto. Llamar desde un clic o una tecla: si no, el navegador lo bloquea. */
  unlock() {
    if (!this.ctx) {
      const Ctor = globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return
      try {
        this.ctx = new Ctor()
      } catch {
        return
      }
      this.build(this.ctx)
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  setVolume(volume: number) {
    this.volume = volumeToGain(volume)
    if (this.ctx) this.master.gain.setTargetAtTime(this.volume * MASTER_HEADROOM, this.ctx.currentTime, 0.02)
  }

  play(name: SoundName, { gain = 1, pan = 0, weight, delay = 0 }: PlayOptions = {}) {
    const ctx = this.ctx
    if (!ctx || ctx.state !== 'running' || gain <= 0.001) return
    const bus = ctx.createGain()
    bus.gain.value = gain * EFFECT_GAIN
    let node: AudioNode = bus
    if (pan !== 0 && ctx.createStereoPanner) {
      const panner = ctx.createStereoPanner()
      panner.pan.value = Math.max(-1, Math.min(1, pan))
      bus.connect(panner)
      node = panner
    }
    node.connect(this.master)
    this.out = bus
    this.lag = Math.max(0, delay)
    const length = EFFECTS[name](this, weight)
    this.lag = 0
    this.out = null
    // Desconectar al acabar para que el grafo no crezca.
    setTimeout(() => node.disconnect(), (length + 0.2) * 1000)
  }

  /**
   * El silbido de algo que vuela (la roca del Lanzarrocas; la flecha del gigante, `pitch` veces más aguda): suena hasta
   * `stop()`, y quien lo usa le cambia el volumen, el paneo y el tono en cada frame según por dónde va. Antes de
   * `unlock` no hay sonido: null.
   */
  whistle(pitch = 1): SoundLoop | null {
    const ctx = this.ctx
    if (!ctx || ctx.state !== 'running') return null
    const base = WHISTLE_FREQ * pitch
    const toneBase = WHISTLE_TONE * pitch
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = base
    filter.Q.value = 7
    const tone = ctx.createOscillator()
    tone.frequency.value = toneBase
    const toneGain = ctx.createGain()
    toneGain.gain.value = 0.04
    const gain = ctx.createGain()
    gain.gain.value = 0
    const noise = this.loopNoise(ctx)
    noise.connect(filter).connect(gain)
    tone.connect(toneGain).connect(gain)
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null
    const out = panner ? gain.connect(panner) : gain
    out.connect(this.master)
    tone.start()
    let stopped = false
    return {
      set: (g, pan, shift) => {
        if (stopped) return
        const now = ctx.currentTime
        gain.gain.setTargetAtTime(Math.max(0, g) * WHISTLE_GAIN, now, WHISTLE_SMOOTH)
        panner?.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), now, WHISTLE_SMOOTH)
        filter.frequency.setTargetAtTime(base * shift, now, WHISTLE_SMOOTH)
        tone.frequency.setTargetAtTime(toneBase * shift, now, WHISTLE_SMOOTH)
      },
      stop: () => {
        if (stopped) return
        stopped = true
        const now = ctx.currentTime
        gain.gain.setTargetAtTime(0, now, 0.04)
        noise.stop(now + 0.25)
        tone.stop(now + 0.25)
        setTimeout(() => out.disconnect(), 400)
      },
    }
  }

  /** Por frame: viento, pájaros de día, grillos de noche y crepitar de fogatas. */
  update(dt: number, state: AmbientState) {
    const ctx = this.ctx
    if (!ctx || ctx.state !== 'running') return
    const now = ctx.currentTime
    this.ambient.gain.setTargetAtTime(state.active ? AMBIENT_GAIN : 0, now, AMBIENT_FADE)
    this.fireGain.gain.setTargetAtTime(0.25 * state.campfire, now, 0.3)
    if (!state.active) return

    const t = this.timers
    const rng = this.rng
    // El viento cambia despacio de intensidad y tono; de noche es más suave.
    t.wind -= dt
    if (t.wind <= 0) {
      t.wind = 2 + rng() * 3
      const strength = (0.5 + rng() * 0.5) * (1 - 0.4 * state.night)
      this.windGain.gain.setTargetAtTime(0.12 * strength, now, 1.5)
      this.windFilter.frequency.setTargetAtTime(250 + rng() * 350, now, 2)
    }
    t.bird -= dt
    if (t.bird <= 0) {
      t.bird = 3 + rng() * 6
      if (state.night < 0.5) this.ambientEffect(() => this.birdCall(), (1 - state.night) * 0.5, rng() * 1.6 - 0.8)
    }
    t.cricket -= dt
    if (t.cricket <= 0) {
      t.cricket = 0.35 + rng() * 0.6
      if (state.night > 0.3) this.ambientEffect(() => this.cricket(), state.night * 0.35, rng() * 1.6 - 0.8)
    }
    t.crackle -= dt
    if (t.crackle <= 0) {
      t.crackle = 0.05 + rng() * 0.25
      if (state.campfire > 0.01) this.ambientEffect(() => this.crackle(), state.campfire * 0.6, rng() * 0.6 - 0.3)
    }
  }

  private build(ctx: AudioContext) {
    this.master = ctx.createGain()
    this.master.gain.value = this.volume * MASTER_HEADROOM
    // Un compresor suave evita que varios golpes a la vez saturen.
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -10
    limiter.ratio.value = 6
    this.master.connect(limiter).connect(ctx.destination)

    this.ambient = ctx.createGain()
    this.ambient.gain.value = 0
    this.ambient.connect(this.master)

    // Ruido blanco compartido: cada efecto lo lee desde un punto al azar.
    const length = ctx.sampleRate * 2
    this.noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate)
    const data = this.noiseBuffer.getChannelData(0)
    for (let i = 0; i < length; i++) data[i] = this.rng() * 2 - 1

    this.windFilter = ctx.createBiquadFilter()
    this.windFilter.type = 'lowpass'
    this.windFilter.frequency.value = 400
    this.windGain = ctx.createGain()
    this.windGain.gain.value = 0.08
    this.loopNoise(ctx).connect(this.windFilter).connect(this.windGain).connect(this.ambient)

    // Rumor grave de la fogata; los chasquidos van aparte, en crackle().
    const fireFilter = ctx.createBiquadFilter()
    fireFilter.type = 'lowpass'
    fireFilter.frequency.value = 220
    this.fireGain = ctx.createGain()
    this.fireGain.gain.value = 0
    this.loopNoise(ctx).connect(fireFilter).connect(this.fireGain).connect(this.ambient)
  }

  private loopNoise(ctx: AudioContext) {
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuffer
    src.loop = true
    src.start(0, this.rng() * 2)
    return src
  }

  private ambientEffect(effect: () => number, gain: number, pan: number) {
    const ctx = this.ctx!
    const bus = ctx.createGain()
    bus.gain.value = gain
    const panner = ctx.createStereoPanner()
    panner.pan.value = pan
    bus.connect(panner).connect(this.ambient)
    this.out = bus
    const length = effect()
    this.out = null
    setTimeout(() => panner.disconnect(), (length + 0.2) * 1000)
  }

  /** Oscilador con envolvente de ataque corto y caída exponencial. Devuelve cuándo acaba. */
  tone(freq: number, duration: number, o: ToneOptions = {}): number {
    const ctx = this.ctx!
    const start = ctx.currentTime + this.lag + (o.delay ?? 0)
    const end = start + duration
    const osc = ctx.createOscillator()
    osc.type = o.type ?? 'sine'
    osc.frequency.setValueAtTime(freq, start)
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, end)
    if (o.vibrato) {
      const lfo = ctx.createOscillator()
      const depth = ctx.createGain()
      lfo.frequency.value = o.vibrato.rate
      depth.gain.value = o.vibrato.depth
      lfo.connect(depth).connect(osc.frequency)
      lfo.start(start)
      lfo.stop(end)
    }
    let node: AudioNode = osc
    if (o.lowpass) {
      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = o.lowpass
      node = node.connect(filter)
    }
    node.connect(this.envelope(start, end, o.gain ?? 0.3, o.attack ?? 0.005))
    osc.start(start)
    osc.stop(end)
    return this.lag + (o.delay ?? 0) + duration
  }

  /** Ráfaga de ruido filtrado. Devuelve cuándo acaba. */
  noise(duration: number, o: NoiseOptions = {}): number {
    const ctx = this.ctx!
    const start = ctx.currentTime + this.lag + (o.delay ?? 0)
    const end = start + duration
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuffer
    const filter = ctx.createBiquadFilter()
    filter.type = o.filter ?? 'lowpass'
    filter.frequency.value = o.freq ?? 1000
    filter.Q.value = o.q ?? 1
    src.connect(filter).connect(this.envelope(start, end, o.gain ?? 0.3, o.attack ?? 0.003))
    src.start(start, this.rng() * 1.5)
    src.stop(end)
    return this.lag + (o.delay ?? 0) + duration
  }

  private envelope(start: number, end: number, peak: number, attack: number) {
    const env = this.ctx!.createGain()
    env.gain.setValueAtTime(0.0001, start)
    env.gain.exponentialRampToValueAtTime(peak, start + attack)
    env.gain.exponentialRampToValueAtTime(0.0001, end)
    env.connect(this.out!)
    return env
  }

  private birdCall() {
    const base = 2200 + this.rng() * 1500
    const notes = 2 + Math.floor(this.rng() * 3)
    let end = 0
    for (let i = 0; i < notes; i++) {
      end = this.tone(base * (1 + 0.15 * (i % 2)), 0.09, { to: base * 1.3, gain: 0.12, attack: 0.01, delay: i * 0.13 })
    }
    return end
  }

  private cricket() {
    const freq = 4200 + this.rng() * 600
    let end = 0
    for (let i = 0; i < 3; i++) end = this.tone(freq, 0.025, { gain: 0.15, attack: 0.004, delay: i * 0.045 })
    return end
  }

  private crackle() {
    return this.noise(0.02 + this.rng() * 0.03, { filter: 'highpass', freq: 1800 + this.rng() * 2500, gain: 0.5, attack: 0.001 })
  }
}

/** La escala del trasgo, el mob de referencia: a esta escala un paso de mob suena "normal". */
const STEP_REFERENCE_SCALE = 1.25

/**
 * Un paso de mob de escala `scale`: un golpe sordo en tierra con un roce corto encima. El golpe (paso bajo a ~600 Hz) y
 * el roce (~1,5 kHz) caen en la banda que sí reproducen los altavoces de portátil y móvil; el tono grave solo da cuerpo
 * con audífonos. Cuanto más grande, más grave, algo más fuerte y más largo: el Coloso retumba y el perro apenas roza.
 */
export function enemyStepSound(s: Sound, scale = STEP_REFERENCE_SCALE) {
  const k = Math.min(2.2, Math.max(0.5, scale / STEP_REFERENCE_SCALE))
  const pitch = k ** -0.6
  const loud = k ** 0.7
  const length = 0.08 * k ** 0.35
  return Math.max(
    s.noise(length, { filter: 'lowpass', freq: (560 + s.random() * 160) * pitch, gain: 0.55 * loud, attack: 0.004 }),
    s.noise(0.035 * k ** 0.3, { filter: 'bandpass', freq: (1350 + s.random() * 450) * pitch, q: 1.3, gain: 0.14 * loud, attack: 0.003 }),
    s.tone(125 * pitch, length * 1.3, { type: 'triangle', to: 70 * pitch, gain: 0.08 * loud * Math.min(1, k) }),
  )
}

/** Chasquidos sueltos de fuego, a esos segundos: lo que chisporrotea en los efectos del Guardián. */
const crackles = (s: Sound, delays: number[], gain: number) =>
  delays.map((delay) => s.noise(0.03, { filter: 'highpass', freq: 2600 + s.random() * 2000, gain, delay }))

// Cada efecto suena por el bus del momento y devuelve su duración en segundos. `weight` es el de `PlayOptions`.
const EFFECTS: Record<SoundName, (s: Sound, weight?: number) => number> = {
  swing: (s) => s.noise(0.14, { filter: 'bandpass', freq: 700 + s.random() * 300, q: 0.7, gain: 0.25, attack: 0.05 }),
  hitWood: (s) =>
    Math.max(
      s.tone(170 + s.random() * 30, 0.13, { type: 'triangle', to: 95, gain: 0.55 }),
      s.noise(0.06, { filter: 'bandpass', freq: 900, q: 1.2, gain: 0.35 }),
    ),
  hitStone: (s) =>
    Math.max(
      s.noise(0.05, { filter: 'bandpass', freq: 2600 + s.random() * 600, q: 3, gain: 0.6 }),
      s.tone(1250 + s.random() * 200, 0.07, { type: 'triangle', to: 900, gain: 0.18 }),
      s.tone(260, 0.06, { type: 'triangle', to: 180, gain: 0.3 }),
    ),
  hitBush: (s) =>
    Math.max(
      s.noise(0.18, { filter: 'highpass', freq: 2200, gain: 0.25, attack: 0.03 }),
      s.noise(0.12, { filter: 'bandpass', freq: 900, gain: 0.15, attack: 0.02, delay: 0.05 }),
    ),
  // Seco y metálico, con parciales inarmónicos: distinto de hitStone, que suena a que se rompe algo.
  clank: (s) =>
    Math.max(
      s.tone(1850 + s.random() * 120, 0.16, { type: 'triangle', gain: 0.16 }),
      s.tone(2770 + s.random() * 160, 0.11, { type: 'sine', gain: 0.1 }),
      s.tone(410, 0.05, { type: 'square', to: 300, gain: 0.08, lowpass: 1500 }),
      s.noise(0.03, { filter: 'highpass', freq: 4000, gain: 0.2 }),
    ),
  breakWood: (s) =>
    Math.max(
      s.tone(130, 0.4, { type: 'triangle', to: 55, gain: 0.6 }),
      s.noise(0.35, { filter: 'lowpass', freq: 700, gain: 0.4, attack: 0.01 }),
      s.noise(0.08, { filter: 'bandpass', freq: 1400, gain: 0.3, delay: 0.12 }),
    ),
  breakStone: (s) =>
    Math.max(
      s.noise(0.3, { filter: 'bandpass', freq: 1300, q: 0.8, gain: 0.5 }),
      s.noise(0.04, { filter: 'bandpass', freq: 3000, q: 2, gain: 0.35, delay: 0.08 }),
      s.noise(0.04, { filter: 'bandpass', freq: 2500, q: 2, gain: 0.3, delay: 0.16 }),
      s.tone(150, 0.25, { type: 'triangle', to: 70, gain: 0.35 }),
    ),
  pickup: (s) => Math.max(s.tone(660, 0.08, { gain: 0.18 }), s.tone(990, 0.12, { gain: 0.18, delay: 0.06 })),
  eat: (s) => {
    let end = 0
    for (let i = 0; i < 3; i++) end = s.noise(0.06, { filter: 'bandpass', freq: 1300 + s.random() * 700, q: 1.5, gain: 0.4, delay: i * 0.13 })
    return end
  },
  craft: (s) => Math.max(...[523, 659, 784].map((f, i) => s.tone(f, 0.18, { type: 'triangle', gain: 0.2, delay: i * 0.07 }))),
  place: (s) =>
    Math.max(s.noise(0.25, { filter: 'lowpass', freq: 450, gain: 0.5, attack: 0.01 }), s.tone(95, 0.2, { type: 'triangle', to: 60, gain: 0.4 })),
  hurt: (s) =>
    Math.max(
      s.tone(230, 0.22, { type: 'sawtooth', to: 130, gain: 0.5, lowpass: 1200 }),
      s.noise(0.1, { filter: 'lowpass', freq: 600, gain: 0.6 }),
    ),
  enemyHit: (s) =>
    Math.max(
      s.tone(520 + s.random() * 80, 0.12, { type: 'square', to: 320, gain: 0.12, lowpass: 2000 }),
      s.tone(120, 0.1, { type: 'triangle', to: 80, gain: 0.45 }),
    ),
  hitEffective: (s) => s.tone(760, 0.12, { type: 'triangle', to: 1240, gain: 0.3 }),
  hitResisted: (s) => s.tone(210, 0.12, { type: 'square', to: 150, gain: 0.12, lowpass: 900 }),
  enemyDeath: (s) =>
    Math.max(
      s.tone(620, 0.45, { type: 'sawtooth', to: 140, gain: 0.25, lowpass: 1800, vibrato: { rate: 18, depth: 30 } }),
      s.noise(0.3, { filter: 'lowpass', freq: 500, gain: 0.3, delay: 0.1 }),
    ),
  growl: (s) =>
    s.tone(80 + s.random() * 30, 0.6 + s.random() * 0.3, {
      type: 'sawtooth',
      to: 60,
      gain: 0.2,
      attack: 0.12,
      lowpass: 420,
      vibrato: { rate: 22, depth: 14 },
    }),
  roar: (s) =>
    Math.max(
      s.tone(70, 0.9, { type: 'sawtooth', to: 130, gain: 0.45, attack: 0.08, lowpass: 650, vibrato: { rate: 26, depth: 20 } }),
      s.noise(0.7, { filter: 'lowpass', freq: 380, gain: 0.3, attack: 0.1 }),
    ),
  bark: (s) =>
    Math.max(
      s.tone(420 + s.random() * 60, 0.12, { type: 'sawtooth', to: 260, gain: 0.22, attack: 0.01, lowpass: 1600 }),
      s.tone(400 + s.random() * 60, 0.14, { type: 'sawtooth', to: 240, gain: 0.2, attack: 0.01, lowpass: 1600, delay: 0.2 }),
      s.noise(0.08, { filter: 'bandpass', freq: 900, q: 1.2, gain: 0.2 }),
    ),
  spawnPuff: (s) =>
    Math.max(
      s.noise(0.9, { filter: 'lowpass', freq: 320, gain: 0.7, attack: 0.15 }),
      s.noise(0.6, { filter: 'bandpass', freq: 1700, q: 0.6, gain: 0.18, attack: 0.25, delay: 0.1 }),
      s.tone(55, 0.8, { type: 'triangle', to: 38, gain: 0.35, attack: 0.1 }),
    ),
  bell: (s) =>
    Math.max(
      s.tone(392, 2.6, { gain: 0.5, attack: 0.01 }),
      s.tone(784, 1.8, { gain: 0.22, attack: 0.01 }),
      s.tone(1180, 1.1, { type: 'triangle', gain: 0.12, attack: 0.01 }),
      s.tone(196, 3.2, { gain: 0.25, attack: 0.02 }),
    ),
  // Baja de tono y crece hasta el impacto; cada tramo sigue donde acaba el anterior, porque la envolvente solo sube una vez.
  meteorWhistle: (s) =>
    Math.max(
      s.tone(2600, 3.4, { to: 1300, gain: 0.05, attack: 1.4 }),
      s.tone(1300, 3.1, { to: 320, gain: 0.12, attack: 2.8, delay: 2.9 }),
      s.noise(3.2, { filter: 'lowpass', freq: 500, gain: 0.3, attack: 3, delay: 2.8 }),
    ),
  meteorImpact: (s) =>
    Math.max(
      s.tone(62, 1.7, { type: 'triangle', to: 26, gain: 0.9 }),
      s.noise(1.3, { filter: 'lowpass', freq: 520, gain: 0.9, attack: 0.01 }),
      s.noise(0.5, { filter: 'bandpass', freq: 1500, q: 0.7, gain: 0.5, delay: 0.05 }),
    ),
  smash: (s) =>
    Math.max(
      s.tone(72, 0.7, { type: 'triangle', to: 30, gain: 0.85 }),
      s.noise(0.55, { filter: 'lowpass', freq: 560, gain: 0.75, attack: 0.004 }),
      // El soplo del viento que sale del golpe.
      s.noise(0.5, { filter: 'bandpass', freq: 1100, q: 0.6, gain: 0.32, attack: 0.05, delay: 0.02 }),
      s.noise(0.05, { filter: 'bandpass', freq: 2600, q: 2, gain: 0.28, delay: 0.12 }),
      s.noise(0.05, { filter: 'bandpass', freq: 2200, q: 2, gain: 0.22, delay: 0.24 }),
    ),
  pierce: (s) =>
    Math.max(
      s.noise(0.04, { filter: 'highpass', freq: 3200, gain: 0.5, attack: 0.001 }),
      s.tone(1900, 0.16, { type: 'triangle', to: 520, gain: 0.12 }),
      s.noise(0.22, { filter: 'bandpass', freq: 1500, q: 1.2, gain: 0.35, attack: 0.015 }),
      s.tone(110, 0.12, { type: 'triangle', to: 70, gain: 0.3 }),
    ),
  quake: (s) =>
    Math.max(
      s.tone(55, 1.1, { type: 'triangle', to: 26, gain: 0.95 }),
      s.noise(0.9, { filter: 'lowpass', freq: 420, gain: 0.85, attack: 0.005 }),
      // El suelo que se agrieta: chasquidos sueltos.
      ...[0.04, 0.11, 0.19, 0.3, 0.42].map((delay) => s.noise(0.04, { filter: 'highpass', freq: 2400 + s.random() * 1500, gain: 0.25, delay })),
      // El brillo azul de las grietas.
      s.tone(880, 0.7, { to: 1760, gain: 0.05, attack: 0.05, delay: 0.05 }),
    ),
  rush: (s) =>
    Math.max(
      s.noise(0.7, { filter: 'bandpass', freq: 520, q: 0.8, gain: 0.45, attack: 0.3 }),
      s.noise(0.45, { filter: 'bandpass', freq: 1300, q: 1, gain: 0.22, attack: 0.25, delay: 0.2 }),
      s.tone(85, 0.6, { type: 'sawtooth', to: 120, gain: 0.18, attack: 0.15, lowpass: 320 }),
    ),
  spearHit: (s) =>
    Math.max(
      s.tone(130, 0.28, { type: 'triangle', to: 60, gain: 0.65 }),
      s.noise(0.08, { filter: 'highpass', freq: 3000, gain: 0.4 }),
      s.tone(2400, 0.4, { type: 'triangle', to: 1800, gain: 0.16 }),
      s.tone(3600, 0.3, { gain: 0.07, delay: 0.02 }),
    ),
  rushStop: (s) =>
    Math.max(s.noise(0.35, { filter: 'lowpass', freq: 500, gain: 0.6, attack: 0.005 }), s.tone(80, 0.25, { type: 'triangle', to: 50, gain: 0.5 })),
  arrowShot: (s) =>
    Math.max(
      s.tone(260, 0.18, { type: 'triangle', to: 170, gain: 0.28 }),
      s.noise(0.1, { filter: 'bandpass', freq: 2400, q: 1.5, gain: 0.25, attack: 0.003 }),
      s.tone(1800, 0.14, { to: 2600, gain: 0.06 }),
    ),
  arrowHit: (s) =>
    Math.max(
      s.noise(0.05, { filter: 'bandpass', freq: 1800, q: 2, gain: 0.45 }),
      s.tone(2600, 0.16, { to: 3400, gain: 0.08 }),
      s.tone(160, 0.08, { type: 'triangle', to: 110, gain: 0.3 }),
    ),
  // Dos tonos casi iguales baten entre sí: el pitido tiembla, como cuando zumban los oídos.
  daze: (s) =>
    Math.max(
      s.tone(140, 0.3, { type: 'triangle', to: 90, gain: 0.35 }),
      s.tone(2900, 1.1, { gain: 0.07, attack: 0.03 }),
      s.tone(2945, 1, { gain: 0.05, attack: 0.03 }),
    ),
  lavaSlash: (s) =>
    Math.max(
      s.tone(68, 0.6, { type: 'triangle', to: 30, gain: 0.85 }),
      s.noise(0.5, { filter: 'lowpass', freq: 600, gain: 0.7, attack: 0.004 }),
      // El fuego que sale del golpe.
      s.noise(0.9, { filter: 'bandpass', freq: 900, q: 0.5, gain: 0.42, attack: 0.03, delay: 0.02 }),
      ...crackles(s, [0.08, 0.17, 0.29, 0.4, 0.55, 0.7], 0.22),
    ),
  flameWave: (s) =>
    Math.max(
      s.tone(60, 0.8, { type: 'triangle', to: 32, gain: 0.7 }),
      s.noise(0.5, { filter: 'lowpass', freq: 450, gain: 0.6, attack: 0.005 }),
      // La pared de llamas: un rugido ancho que se aleja.
      s.noise(1.3, { filter: 'bandpass', freq: 650, q: 0.45, gain: 0.55, attack: 0.08 }),
      s.noise(1, { filter: 'bandpass', freq: 1800, q: 0.6, gain: 0.2, attack: 0.15, delay: 0.1 }),
      ...crackles(s, [0.2, 0.33, 0.5, 0.68, 0.9, 1.1], 0.18),
    ),
  lavaHiss: (s) =>
    Math.max(
      s.noise(0.85, { filter: 'highpass', freq: 3500, gain: 0.12, attack: 0.6 }),
      s.noise(0.85, { filter: 'lowpass', freq: 180, gain: 0.35, attack: 0.5 }),
    ),
  lavaIgnite: (s) =>
    Math.max(
      s.noise(0.6, { filter: 'lowpass', freq: 380, gain: 0.8, attack: 0.02 }),
      s.tone(90, 0.4, { type: 'triangle', to: 45, gain: 0.5 }),
      s.noise(0.9, { filter: 'bandpass', freq: 800, q: 0.5, gain: 0.35, attack: 0.05 }),
      // La lava borbotea mientras arde: burbujas cortas que suben de tono, al azar, y un rumor grave.
      ...Array.from({ length: 12 }, (_, i) =>
        s.tone(180 + s.random() * 260, 0.07, { to: 420 + s.random() * 300, gain: 0.12, attack: 0.01, delay: 0.25 + i * 0.2 + s.random() * 0.1 }),
      ),
      s.noise(2.8, { filter: 'lowpass', freq: 220, gain: 0.25, attack: 0.3 }),
    ),
  // Crece hasta el impacto (la envolvente llega arriba al final) y se corta: el estallido es `meteorCrash`.
  meteorFall: (s) =>
    Math.max(
      s.tone(1500, 1, { to: 380, gain: 0.08, attack: 0.55 }),
      s.noise(1, { filter: 'bandpass', freq: 900, q: 0.8, gain: 0.35, attack: 0.8 }),
      s.noise(1, { filter: 'lowpass', freq: 400, gain: 0.3, attack: 0.9 }),
    ),
  meteorCrash: (s) =>
    Math.max(
      s.tone(58, 1.2, { type: 'triangle', to: 26, gain: 0.9 }),
      s.noise(0.9, { filter: 'lowpass', freq: 600, gain: 0.9, attack: 0.005 }),
      s.noise(0.5, { filter: 'bandpass', freq: 1600, q: 0.7, gain: 0.45, delay: 0.03 }),
      // Y queda ardiendo.
      s.noise(1.2, { filter: 'bandpass', freq: 700, q: 0.5, gain: 0.3, attack: 0.1, delay: 0.1 }),
      ...crackles(s, [0.15, 0.3, 0.45, 0.62, 0.8], 0.2),
    ),
  ignite: (s) =>
    Math.max(
      s.noise(0.45, { filter: 'bandpass', freq: 1100, q: 0.6, gain: 0.45, attack: 0.02 }),
      s.noise(0.3, { filter: 'lowpass', freq: 500, gain: 0.35 }),
      ...crackles(s, [0.1, 0.22, 0.35], 0.25),
    ),
  burnTick: (s) =>
    Math.max(
      s.noise(0.12, { filter: 'bandpass', freq: 1400, q: 0.8, gain: 0.2, attack: 0.01 }),
      ...crackles(s, [0.03, 0.08], 0.25),
      s.tone(200, 0.12, { type: 'sawtooth', to: 140, gain: 0.12, lowpass: 900 }),
    ),
  fury: (s) =>
    Math.max(
      s.tone(55, 1.4, { type: 'sawtooth', to: 110, gain: 0.5, attack: 0.1, lowpass: 600, vibrato: { rate: 22, depth: 18 } }),
      s.tone(82, 1.2, { type: 'sawtooth', to: 140, gain: 0.25, attack: 0.15, lowpass: 900 }),
      s.noise(1.4, { filter: 'bandpass', freq: 600, q: 0.5, gain: 0.5, attack: 0.2 }),
      s.noise(0.6, { filter: 'lowpass', freq: 300, gain: 0.6, attack: 0.01 }),
    ),
  step: (s) => s.noise(0.08, { filter: 'lowpass', freq: 450 + s.random() * 250, gain: 1, attack: 0.004 }),
  enemyStep: enemyStepSound,
  stepWater: (s) =>
    Math.max(
      s.noise(0.16, { filter: 'bandpass', freq: 900 + s.random() * 400, q: 0.9, gain: 0.45, attack: 0.02 }),
      s.noise(0.08, { filter: 'highpass', freq: 3000, gain: 0.08, delay: 0.05 }),
    ),
  jump: (s) => s.noise(0.09, { filter: 'lowpass', freq: 600, gain: 0.5, attack: 0.01 }),
  land: (s) => Math.max(s.noise(0.12, { filter: 'lowpass', freq: 320, gain: 0.8 }), s.tone(85, 0.1, { type: 'triangle', to: 55, gain: 0.5 })),
  death: (s) =>
    Math.max(
      s.tone(440, 1.3, { type: 'triangle', to: 110, gain: 0.15, attack: 0.02 }),
      s.tone(330, 1.5, { type: 'triangle', to: 82, gain: 0.11, attack: 0.02, delay: 0.15 }),
      s.tone(55, 1.6, { type: 'sine', gain: 0.18, attack: 0.1 }),
    ),
  uiClick: (s) =>
    Math.max(
      s.tone(880 + s.random() * 60, 0.05, { type: 'triangle', to: 620, gain: 0.16 }),
      s.noise(0.03, { filter: 'bandpass', freq: 1800, q: 1.5, gain: 0.12 }),
    ),
  uiTick: (s) => Math.max(s.tone(740, 0.12, { type: 'triangle', gain: 0.22 }), s.tone(1480, 0.06, { gain: 0.06 })),
}
