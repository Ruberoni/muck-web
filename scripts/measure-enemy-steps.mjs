// Mide los pasos de los mobs frente al paso propio y, con --wav, guarda una muestra para oírlos.
// No corre en CI: necesita Chromium (Playwright) para renderizar con OfflineAudioContext la misma cadena del juego
// (efectos de `src/audio/sound.ts`, bus, master y compresor), con las ganancias que da `GameAudio.enemySteps`.
//
//   node scripts/measure-enemy-steps.mjs                       # tabla con el código de esta carpeta
//   node scripts/measure-enemy-steps.mjs --src ../otra-copia   # la misma tabla con otro checkout (p. ej. main)
//   node scripts/measure-enemy-steps.mjs --wav pasos.wav       # además, una muestra de 2–10 m, perro, Coloso y manada
//   node scripts/measure-enemy-steps.mjs --wav ab.wav --before ../main   # muestra "antes" (de ../main) y "después"
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import { createRequire } from 'node:module'

// Playwright no es dependencia del proyecto: se usa el que haya instalado (require mira también NODE_PATH).
const { chromium } = createRequire(import.meta.url)('playwright')

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  return i < 0 ? null : args[i + 1]
}
const src = resolve(flag('--src') ?? '.')
const before = flag('--before') && resolve(flag('--before'))
const wav = flag('--wav')

/** El código que corre en la página: renderiza con OfflineAudioContext. `S` y `G` son sound.ts y gameAudio.ts. */
const page = (S, G) => {
  const RATE = 48000
  const mulberry = (seed) => () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** Renderiza `plays` ({ t, name, options }) con un `Sound` de verdad montado sobre un contexto offline. */
  async function render(plays, seconds) {
    const ctx = new OfflineAudioContext(2, Math.ceil(seconds * RATE), RATE)
    // `play` solo suena con el contexto en marcha; el offline está "suspended" hasta renderizar.
    Object.defineProperty(ctx, 'state', { get: () => 'running' })
    const sound = new S.Sound(mulberry(7))
    sound.ctx = ctx
    sound.build(ctx)
    const sorted = [...plays].sort((a, b) => a.t - b.t)
    const frame = (t) => Math.round((t * RATE) / 128) * 128 / RATE
    const times = [...new Set(sorted.map((p) => frame(p.t)))]
    for (const t of times) {
      const at = sorted.filter((p) => frame(p.t) === t)
      if (t === 0) for (const p of at) sound.play(p.name, p.options)
      else ctx.suspend(t).then(() => {
        for (const p of at) sound.play(p.name, p.options)
        return ctx.resume()
      })
    }
    const out = await ctx.startRendering()
    return [out.getChannelData(0), out.getChannelData(1)]
  }

  /** Paso alto de 2º orden a 300 Hz: lo que deja pasar un altavoz de portátil o de móvil. */
  function highpass(x, f = 300) {
    const w = (2 * Math.PI * f) / RATE
    const alpha = Math.sin(w) / (2 * Math.SQRT1_2)
    const cos = Math.cos(w)
    const a0 = 1 + alpha
    const b0 = (1 + cos) / 2 / a0, b1 = -(1 + cos) / a0, b2 = b0
    const a1 = (-2 * cos) / a0, a2 = (1 - alpha) / a0
    const y = new Float32Array(x.length)
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0
    for (let i = 0; i < x.length; i++) {
      const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
      x2 = x1; x1 = x[i]; y2 = y1; y1 = v
      y[i] = v
    }
    return y
  }
  const mono = ([l, r]) => l.map((v, i) => (v + r[i]) / 2)
  const energy = (x) => x.reduce((a, v) => a + v * v, 0)
  const peak = (x) => x.reduce((a, v) => Math.max(a, Math.abs(v)), 0)
  const db = (v, ref) => (10 * Math.log10(v / ref)).toFixed(1)

  /** Un paso de mob a `d` m con la ganancia que le da GameAudio (el oyente mira a -z, el mob a su derecha). */
  function mobStep(type, d, look = 0) {
    const plays = []
    const audio = new G.GameAudio({ play: (name, options) => plays.push({ name, options }) }, () => 0.5)
    const e = { id: 1, type, pos: { x: d, z: 0 }, alive: true, look }
    const listener = { x: 0, z: 0, yaw: 0 }
    audio.enemySteps([e], listener, () => false)
    while (!plays.length) {
      e.pos.z += 0.05
      e.pos.x = Math.sqrt(Math.max(0, d * d - e.pos.z * e.pos.z))
      audio.enemySteps([e], listener, () => false)
      if (e.pos.z > d + 20) return null
    }
    return plays[0]
  }

  async function table() {
    const own = mono(await render([{ t: 0, name: 'step', options: { gain: 0.9 } }], 0.4))
    const ref = { e: energy(own), p: peak(own) ** 2, h: energy(highpass(own)) }
    const rows = [['paso propio', 0, 'goblin']]
    for (const [label, d, type, look] of [
      ['trasgo pegado', 0.8, 'goblin'], ['trasgo a 5 m', 5, 'goblin'], ['trasgo a 10 m', 10, 'goblin'],
      ['trasgo a 15 m', 15, 'goblin'], ['trasgo a 18 m', 18, 'goblin'], ['trasgo (Noche Eterna) pegado', 0.8, 'goblin', 1],
      ['perro pegado', 0.8, 'dog'], ['espíritu pegado', 0.8, 'spirit'], ['gólem pegado', 0.8, 'golem'],
      ['Coloso pegado', 0.8, 'colossus'], ['Coloso a 10 m', 10, 'colossus'],
    ]) rows.push([label, d, type, look])
    const lines = ['| | energía | pico | con paso alto a 300 Hz |', '|---|---|---|---|']
    for (const [label, d, type, look] of rows) {
      const play = d === 0 ? { name: 'step', options: { gain: 0.9 } } : mobStep(type, d, look)
      if (!play) {
        lines.push(`| ${label} | no suena | | |`)
        continue
      }
      const x = mono(await render([{ t: 0, ...play }], 0.4))
      lines.push(`| ${label} | ${db(energy(x), ref.e)} dB | ${db(peak(x) ** 2, ref.p)} dB | ${db(energy(highpass(x)), ref.h)} dB |`)
    }
    // La manada: 24 mobs pegados que pisan en el mismo paso fijo no deben saturar (suenan dos y hay compresor).
    const herd = []
    const audio = new G.GameAudio({ play: (name, options) => herd.push({ t: 0, name, options }) }, () => 0.5)
    const pack = Array.from({ length: 24 }, (_, i) => ({ id: i, type: 'goblin', pos: { x: 1 + (i % 4), z: Math.floor(i / 4) * 0.3 }, alive: true }))
    audio.enemySteps(pack, { x: 0, z: 0, yaw: 0 }, () => false)
    for (const e of pack) e.pos.z += 2.7
    audio.enemySteps(pack, { x: 0, z: 0, yaw: 0 }, () => false)
    const x = mono(await render(herd, 0.4))
    lines.push(`| 24 trasgos pisando a la vez (suenan ${herd.length}) | ${db(energy(x), ref.e)} dB | ${db(peak(x) ** 2, ref.p)} dB | ${db(energy(highpass(x)), ref.h)} dB |`)
    return lines.join('\n')
  }

  /**
   * Una muestra con pausas: tu paso, trasgo a 2, 5 y 10 m cruzando de izquierda a derecha, perro, Coloso, y una manada
   * de 6 que se acerca mientras andas. Devuelve los `plays` con su tiempo.
   */
  function sample() {
    const plays = []
    let t = 0.4
    const STEP = 1 / 60
    const own = (n, gap = 0.45) => {
      for (let i = 0; i < n; i++) plays.push({ t: t + i * gap, name: 'step', options: { gain: 0.9 } })
      t += n * gap + 0.6
    }
    /** Mobs que andan por GameAudio: `move(e, dt)` los mueve; el oyente quieto mirando a -z. */
    const walk = (mobs, seconds, move, ownSteps = false) => {
      let now = t
      const audio = new G.GameAudio({ play: (name, options) => plays.push({ t: now, name, options }) }, () => 0.5)
      const listener = { x: 0, z: 0, yaw: 0 }
      audio.enemySteps(mobs, listener, () => false)
      let ownStride = 0
      for (let s = 0; s < seconds / STEP; s++) {
        now = t + s * STEP
        for (const e of mobs) move(e, STEP)
        audio.enemySteps(mobs, listener, () => false)
        if (ownSteps && (ownStride += 5 * STEP) >= 2.1) {
          ownStride -= 2.1
          plays.push({ t: now, name: 'step', options: { gain: 0.9 } })
        }
      }
      t += seconds + 0.8
    }
    // Cruza por delante de izquierda a derecha a `d` m, a `speed` m/s.
    const cross = (type, d, speed) =>
      walk([{ id: 1, type, pos: { x: -6, z: -d }, alive: true }], 12 / speed, (e, dt) => void (e.pos.x += speed * dt))
    own(3)
    cross('goblin', 2, 4.5)
    cross('goblin', 5, 4.5)
    cross('goblin', 10, 4.5)
    own(2)
    cross('dog', 3, 6)
    cross('colossus', 4, 3.5)
    // Seis trasgos desde 18 m hasta 2 m, mientras tú andas.
    const six = Array.from({ length: 6 }, (_, i) => ({ id: i, type: 'goblin', pos: { x: (i - 2.5) * 1.6, z: -18 - (i % 2) }, alive: true }))
    walk(six, 4, (e, dt) => void (e.pos.z = Math.min(-2, e.pos.z + 4 * dt)), true)
    return { plays, seconds: t + 0.5 }
  }

  return { render, table, sample, RATE }
}

async function bundle(dir) {
  const out = await build({
    stdin: {
      contents: `export * as S from ${JSON.stringify(join(dir, 'src/audio/sound.ts'))}; export * as G from ${JSON.stringify(join(dir, 'src/audio/gameAudio.ts'))}`,
      resolveDir: dir,
      loader: 'ts',
    },
    bundle: true,
    format: 'iife',
    globalName: 'M',
    write: false,
  })
  return out.outputFiles[0].text
}

function writeWav(path, channels, rate) {
  const n = channels[0].length
  const buf = Buffer.alloc(44 + n * 4)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + n * 4, 4)
  buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(2, 22)
  buf.writeUInt32LE(rate, 24)
  buf.writeUInt32LE(rate * 4, 28)
  buf.writeUInt16LE(4, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(n * 4, 40)
  for (let i = 0; i < n; i++)
    for (let c = 0; c < 2; c++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, channels[c][i])) * 32767), 44 + i * 4 + c * 2)
  writeFileSync(path, buf)
}

const browser = await chromium.launch()
async function run(dir, fn) {
  const tab = await browser.newPage()
  await tab.addScriptTag({ content: await bundle(dir) })
  await tab.addScriptTag({ content: `window.P = (${page.toString()})(M.S, M.G)` })
  const result = await tab.evaluate(fn)
  await tab.close()
  return result
}

console.log(`Pasos de mob frente a un paso propio (${src}):\n`)
console.log(await run(src, () => window.P.table()))
if (wav) {
  const clip = async () => {
    const { plays, seconds } = window.P.sample()
    const [l, r] = await window.P.render(plays, seconds)
    return { l: Array.from(l), r: Array.from(r), rate: window.P.RATE }
  }
  const parts = []
  if (before) parts.push(await run(before, clip))
  parts.push(await run(src, clip))
  // Antes y después, con un silencio de 1,5 s en medio.
  const gap = new Array(Math.round(parts[0].rate * 1.5)).fill(0)
  const l = parts.flatMap((p, i) => (i ? [...gap, ...p.l] : p.l))
  const r = parts.flatMap((p, i) => (i ? [...gap, ...p.r] : p.r))
  writeWav(wav, [l, r], parts[0].rate)
  console.log(`\nMuestra en ${wav} (${(l.length / parts[0].rate).toFixed(1)} s${before ? ': antes y, tras una pausa, después' : ''})`)
}
await browser.close()
