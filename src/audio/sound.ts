/** Efectos que suenan una vez. Todos se generan con Web Audio: no hay archivos de audio. */
export type SoundName =
  | 'swing'
  | 'hitWood'
  | 'hitStone'
  | 'hitBush'
  | 'breakWood'
  | 'breakStone'
  | 'pickup'
  | 'eat'
  | 'craft'
  | 'place'
  | 'hurt'
  | 'enemyHit'
  | 'enemyDeath'
  | 'growl'
  | 'step'
  | 'stepWater'
  | 'jump'
  | 'land'
  | 'death'

export interface PlayOptions {
  /** Multiplica el volumen del efecto (0..1). */
  gain?: number
  /** Estéreo: -1 izquierda, 1 derecha. */
  pan?: number
}

export interface SoundOut {
  play(name: SoundName, options?: PlayOptions): void
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

  play(name: SoundName, { gain = 1, pan = 0 }: PlayOptions = {}) {
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
    const length = EFFECTS[name](this)
    this.out = null
    // Desconectar al acabar para que el grafo no crezca.
    setTimeout(() => node.disconnect(), (length + 0.2) * 1000)
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
    const start = ctx.currentTime + (o.delay ?? 0)
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
    return (o.delay ?? 0) + duration
  }

  /** Ráfaga de ruido filtrado. Devuelve cuándo acaba. */
  noise(duration: number, o: NoiseOptions = {}): number {
    const ctx = this.ctx!
    const start = ctx.currentTime + (o.delay ?? 0)
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
    return (o.delay ?? 0) + duration
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

// Cada efecto suena por el bus del momento y devuelve su duración en segundos.
const EFFECTS: Record<SoundName, (s: Sound) => number> = {
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
  step: (s) => s.noise(0.08, { filter: 'lowpass', freq: 450 + s.random() * 250, gain: 1, attack: 0.004 }),
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
}
