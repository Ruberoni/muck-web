import { heightAt, ROCK_LEVEL, SAND_LEVEL, WATER_LEVEL, WORLD_SIZE } from '../sim/world/terrain'
import type { StructureKind } from '../sim/structures'

/** Radio del mundo (en unidades) que cabe entre el centro y el borde del minimapa. */
export const VIEW_RADIUS = 75
// Píxeles de la textura de la isla por unidad del mundo.
const TEXELS_PER_UNIT = 1.5
// Hueco entre el borde del círculo y las marcas fijadas en él (estructuras lejanas, N).
const RIM_INSET = 9

/** Cómo se marca cada tipo de estructura: forma y color de cerca y de lejos (en el borde). */
export const STRUCTURE_MARKS: Record<StructureKind, { shape: 'dot' | 'square'; near: string; far: string }> = {
  campfire: { shape: 'dot', near: '#ff8636', far: '#ffb347' },
  workbench: { shape: 'square', near: '#d9a86a', far: '#ecc896' },
  furnace: { shape: 'square', near: '#cfc8bd', far: '#e6e1d8' },
  anvil: { shape: 'square', near: '#7f9cc4', far: '#b3c6e2' },
}

/** Un compañero en el minimapa. */
export interface MinimapPlayer {
  x: number
  z: number
  yaw: number
  /** CSS. */
  color: string
  alive: boolean
}

export interface MinimapView {
  x: number
  z: number
  yaw: number
  structures: readonly { kind: StructureKind; x: number; z: number }[]
  enemies: readonly { pos: { x: number; z: number } }[]
  /** Los demás jugadores (solo en red). */
  players?: readonly MinimapPlayer[]
}

/**
 * Proyecta un punto del mundo al minimapa: el jugador en el centro y su vista hacia arriba.
 * Devuelve el desplazamiento desde el centro en unidades del mundo (antes de escalar).
 * Mirando a `yaw` el frente es (-sin, -cos) y la derecha (cos, -sin), como la cámara.
 */
export function toMinimap(dx: number, dz: number, yaw: number, out = { x: 0, y: 0 }) {
  const sin = Math.sin(yaw)
  const cos = Math.cos(yaw)
  out.x = dx * cos - dz * sin
  out.y = dx * sin + dz * cos
  return out
}

/** Si el punto cae fuera del círculo de radio `radius`, lo lleva a su borde. Devuelve si estaba fuera. */
export function clampToRim(p: { x: number; y: number }, radius: number): boolean {
  const d = Math.hypot(p.x, p.y)
  if (d <= radius) return false
  p.x *= radius / d
  p.y *= radius / d
  return true
}

/**
 * Dónde y hacia dónde va la flecha de un compañero (en unidades del mundo desde el centro, antes de escalar).
 * Cerca, en su sitio y apuntando hacia donde mira; lejos, fijada al borde de radio `rim` y apuntando hacia él.
 * `angle` es el giro de la flecha respecto a "arriba", en el sentido de las agujas del reloj (como `ctx.rotate`).
 */
export function teammateMark(dx: number, dz: number, yaw: number, viewYaw: number, rim: number) {
  const p = toMinimap(dx, dz, viewYaw)
  const far = clampToRim(p, rim)
  const angle = far ? Math.atan2(p.x, -p.y) : viewYaw - yaw
  return { x: p.x, y: p.y, angle, far }
}

type Rgb = [number, number, number]
const DEEP: Rgb = [38, 98, 150]
const SHALLOW: Rgb = [92, 170, 205]
const SAND: Rgb = [227, 207, 142]
const GRASS_LOW: Rgb = [111, 174, 69]
const GRASS_HIGH: Rgb = [74, 138, 53]
const ROCK: Rgb = [139, 136, 120]
const SHALLOW_DEPTH = 3

const mix = (a: Rgb, b: Rgb, t: number): Rgb => {
  const k = Math.min(1, Math.max(0, t))
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
}

/** Color del minimapa para una altura de terreno, con los mismos tramos que la malla de la isla. */
export function terrainColor(h: number, steep: boolean): Rgb {
  if (h < WATER_LEVEL) return mix(SHALLOW, DEEP, (WATER_LEVEL - h) / SHALLOW_DEPTH)
  if (h < SAND_LEVEL) return SAND
  if (steep || h > ROCK_LEVEL) return ROCK
  return mix(GRASS_LOW, GRASS_HIGH, (h - SAND_LEVEL) / (ROCK_LEVEL - SAND_LEVEL))
}

/** Textura de la isla vista desde arriba, con -Z (norte) hacia arriba. Se genera una vez. */
function renderIsland(): HTMLCanvasElement {
  const size = Math.round(WORLD_SIZE * TEXELS_PER_UNIT)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const image = ctx.createImageData(size, size)
  const unit = WORLD_SIZE / size
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = -WORLD_SIZE / 2 + (i + 0.5) * unit
      const z = -WORLD_SIZE / 2 + (j + 0.5) * unit
      const h = heightAt(x, z)
      // Pendiente aproximada: mismo umbral que la malla (normal.y < 0.8 ⇔ pendiente > 0.75).
      const slope = Math.hypot(heightAt(x + unit, z) - h, heightAt(x, z + unit) - h) / unit
      const [r, g, b] = terrainColor(h, slope > 0.75)
      const k = (j * size + i) * 4
      image.data[k] = r
      image.data[k + 1] = g
      image.data[k + 2] = b
      image.data[k + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}

/** Minimapa circular: la isla gira con el jugador, que queda en el centro mirando hacia arriba. */
export class Minimap {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private island: HTMLCanvasElement
  /** Lado del canvas en píxeles CSS; se actualiza al cambiar el tamaño de la ventana. */
  private size = 0
  private dpr = 1
  private p = { x: 0, y: 0 }

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'minimap'
    parent.appendChild(this.canvas)
    this.ctx = this.canvas.getContext('2d')!
    this.island = renderIsland()
    this.resize()
    window.addEventListener('resize', () => this.resize())
  }

  private resize() {
    // El tamaño lo decide el CSS (encoge en ventanas pequeñas); el canvas lo sigue con la densidad de pantalla.
    this.size = this.canvas.clientWidth
    this.dpr = Math.min(window.devicePixelRatio, 2)
    this.canvas.width = this.canvas.height = Math.round(this.size * this.dpr)
  }

  draw(view: MinimapView) {
    const { ctx, size, p } = this
    if (!size) return
    const c = size / 2
    const scale = c / VIEW_RADIUS
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, size, size)

    // Isla recortada al círculo y girada según el yaw.
    ctx.save()
    ctx.beginPath()
    ctx.arc(c, c, c, 0, Math.PI * 2)
    ctx.clip()
    ctx.fillStyle = `rgb(${DEEP.join(',')})`
    ctx.fillRect(0, 0, size, size)
    ctx.translate(c, c)
    ctx.rotate(view.yaw)
    ctx.scale(scale, scale)
    ctx.translate(-view.x, -view.z)
    ctx.drawImage(this.island, -WORLD_SIZE / 2, -WORLD_SIZE / 2, WORLD_SIZE, WORLD_SIZE)
    ctx.restore()

    // Enemigos: solo los que caben en el mapa.
    ctx.fillStyle = '#ff3b2f'
    ctx.strokeStyle = 'rgb(0 0 0 / 0.6)'
    ctx.lineWidth = 1
    for (const e of view.enemies) {
      toMinimap(e.pos.x - view.x, e.pos.z - view.z, view.yaw, p)
      if (Math.hypot(p.x, p.y) > VIEW_RADIUS) continue
      this.dot(c + p.x * scale, c + p.y * scale, 3.5)
    }

    // Estructuras: las lejanas se quedan en el borde, apuntando hacia dónde están.
    const rim = (c - RIM_INSET) / scale
    for (const s of view.structures) {
      toMinimap(s.x - view.x, s.z - view.z, view.yaw, p)
      const far = clampToRim(p, rim)
      const mark = STRUCTURE_MARKS[s.kind]
      ctx.fillStyle = far ? mark.far : mark.near
      const r = far ? 3.5 : 4.5
      if (mark.shape === 'dot') this.dot(c + p.x * scale, c + p.y * scale, r)
      else this.square(c + p.x * scale, c + p.y * scale, r)
    }

    // Compañeros: flechas de su color; los lejanos, en el borde apuntando hacia ellos.
    for (const other of view.players ?? []) {
      const mark = teammateMark(other.x - view.x, other.z - view.z, other.yaw, view.yaw, rim)
      this.arrow(c + mark.x * scale, c + mark.y * scale, mark.angle, other.color, mark.far ? 0.75 : 1, other.alive)
    }

    // Norte (-Z) en el borde.
    toMinimap(0, -1, view.yaw, p)
    ctx.font = '600 11px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineWidth = 3
    ctx.strokeStyle = 'rgb(0 0 0 / 0.6)'
    ctx.strokeText('N', c + p.x * (c - RIM_INSET), c + p.y * (c - RIM_INSET))
    ctx.fillStyle = '#fff'
    ctx.fillText('N', c + p.x * (c - RIM_INSET), c + p.y * (c - RIM_INSET))

    // Jugador: flecha fija hacia arriba (el mapa es el que gira).
    this.arrow(c, c, 0, '#fff', 1, true)
  }

  /** Flecha centrada en (x, y) que apunta hacia arriba girada `angle`. Un muerto, hueca. */
  private arrow(x: number, y: number, angle: number, color: string, size: number, filled: boolean) {
    const { ctx } = this
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(angle)
    ctx.scale(size, size)
    ctx.beginPath()
    ctx.moveTo(0, -7)
    ctx.lineTo(5, 5)
    ctx.lineTo(0, 2.5)
    ctx.lineTo(-5, 5)
    ctx.closePath()
    ctx.lineWidth = 1.5
    if (filled) {
      ctx.fillStyle = color
      ctx.strokeStyle = 'rgb(0 0 0 / 0.7)'
      ctx.stroke()
      ctx.fill()
    } else {
      ctx.strokeStyle = color
      ctx.stroke()
    }
    ctx.restore()
  }

  /** Un cuadrado de lado 2r (las estaciones), con el mismo borde que los puntos. */
  private square(x: number, y: number, r: number) {
    const { ctx } = this
    ctx.beginPath()
    ctx.rect(x - r, y - r, 2 * r, 2 * r)
    ctx.lineWidth = 1
    ctx.strokeStyle = 'rgb(0 0 0 / 0.6)'
    ctx.stroke()
    ctx.fill()
  }

  private dot(x: number, y: number, r: number) {
    const { ctx } = this
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.lineWidth = 1
    ctx.strokeStyle = 'rgb(0 0 0 / 0.6)'
    ctx.stroke()
    ctx.fill()
  }
}
