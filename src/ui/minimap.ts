import { heightAt, ROCK_LEVEL, SAND_LEVEL, WATER_LEVEL, WORLD_SIZE } from '../sim/world/terrain'

/** Radio del mundo (en unidades) que cabe entre el centro y el borde del minimapa. */
export const VIEW_RADIUS = 75
// Píxeles de la textura de la isla por unidad del mundo.
const TEXELS_PER_UNIT = 1.5
// Hueco entre el borde del círculo y las marcas fijadas en él (fogatas lejanas, N).
const RIM_INSET = 9

export interface MinimapView {
  x: number
  z: number
  yaw: number
  campfires: readonly { x: number; z: number }[]
  enemies: readonly { pos: { x: number; z: number } }[]
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

    // Fogatas: las lejanas se quedan en el borde, apuntando hacia dónde están.
    const rim = (c - RIM_INSET) / scale
    for (const fire of view.campfires) {
      toMinimap(fire.x - view.x, fire.z - view.z, view.yaw, p)
      const far = clampToRim(p, rim)
      ctx.fillStyle = far ? '#ffb347' : '#ff8636'
      this.dot(c + p.x * scale, c + p.y * scale, far ? 3.5 : 4.5)
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
    ctx.beginPath()
    ctx.moveTo(c, c - 7)
    ctx.lineTo(c + 5, c + 5)
    ctx.lineTo(c, c + 2.5)
    ctx.lineTo(c - 5, c + 5)
    ctx.closePath()
    ctx.fillStyle = '#fff'
    ctx.strokeStyle = 'rgb(0 0 0 / 0.7)'
    ctx.lineWidth = 1.5
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
