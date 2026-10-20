import { TICK_MS } from './clock'

/** Lo que se extrapola como mucho más allá de la última muestra; después la entidad se queda quieta. */
export const MAX_EXTRAPOLATE_MS = 250
const MAX_EXTRAPOLATE_TICKS = MAX_EXTRAPOLATE_MS / TICK_MS

/** Lo que se interpola de una entidad remota. El resto (objeto en la mano, vida…) va en `data`, sin interpolar. */
export interface Pose {
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
}

export interface Sample<D> {
  tick: number
  pose: Pose
  data: D
}

/** Una entidad dibujada en un tick: su pose interpolada y los datos de la muestra más reciente que no la pasa. */
export interface Shown<D> {
  id: number
  pose: Pose
  data: D
}

/** Diferencia de ángulos por el camino corto, en (−π, π]. */
export function angleDelta(from: number, to: number): number {
  const d = (to - from) % (2 * Math.PI)
  if (d > Math.PI) return d - 2 * Math.PI
  if (d <= -Math.PI) return d + 2 * Math.PI
  return d
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/**
 * Las muestras de una entidad remota, por tick. `at(tick)` interpola entre las dos que lo rodean
 * (el yaw por el camino corto); más allá de la última extrapola con su velocidad hasta MAX_EXTRAPOLATE_MS y
 * después se queda quieta. Antes de la primera no hay nada que dibujar.
 */
export class InterpBuffer<D> {
  private samples: Sample<D>[] = []

  get last(): Sample<D> | undefined {
    return this.samples.at(-1)
  }

  /** Una muestra nueva; las de ticks que no avanzan se ignoran (llegan en orden). */
  push(tick: number, pose: Pose, data: D) {
    const last = this.last
    if (last && tick <= last.tick) return
    this.samples.push({ tick, pose: { ...pose }, data })
  }

  /** La pose en `tick` (fraccionario), o null si es anterior a la primera muestra. `extrapolate: false` la para en la última. */
  at(tick: number, out: Pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }, extrapolate = true): Sample<D> | null {
    const { samples } = this
    if (samples.length === 0 || tick < samples[0].tick) return null
    // La primera muestra posterior a `tick` (casi siempre de las últimas: se busca desde el final).
    let i = samples.length
    while (i > 0 && samples[i - 1].tick > tick) i--
    const a = samples[i - 1]
    const b = samples[i]
    if (b) {
      blend(a.pose, b.pose, (tick - a.tick) / (b.tick - a.tick), out)
    } else {
      const before = samples[i - 2]
      const ahead = extrapolate && before ? Math.min(tick - a.tick, MAX_EXTRAPOLATE_TICKS) : 0
      if (ahead > 0) blend(before!.pose, a.pose, 1 + ahead / (a.tick - before!.tick), out, false)
      else Object.assign(out, a.pose)
    }
    return { tick, pose: out, data: a.data }
  }

  /** Olvida las muestras que ya no hacen falta para dibujar en `tick` o después (deja la anterior a `tick`). */
  trim(tick: number) {
    let drop = 0
    while (drop + 1 < this.samples.length && this.samples[drop + 1].tick <= tick) drop++
    if (drop > 0) this.samples.splice(0, drop)
  }
}

/** Interpola posición y ángulos; extrapolando (`t > 1`), el yaw y el pitch se quedan en los de `b`. */
function blend(a: Pose, b: Pose, t: number, out: Pose, angles = true) {
  out.x = lerp(a.x, b.x, t)
  out.y = lerp(a.y, b.y, t)
  out.z = lerp(a.z, b.z, t)
  out.yaw = angles ? a.yaw + angleDelta(a.yaw, b.yaw) * t : b.yaw
  out.pitch = angles ? lerp(a.pitch, b.pitch, t) : b.pitch
}

/**
 * Las entidades remotas de un tipo (jugadores, enemigos), dibujadas en el tick de render.
 * Cada `snap` trae la lista completa: la que falta se ha ido en ese tick y se deja de dibujar cuando el render
 * llega a él (hasta entonces, quieta en su última pose). La que aparece se dibuja desde su primera muestra.
 */
export class Interpolator<D> {
  private entities = new Map<number, { buffer: InterpBuffer<D>; goneAt: number | null }>()

  /** Un snapshot completo en `tick`: las que no vienen se marcan idas en ese tick. */
  push(tick: number, list: Iterable<{ id: number; pose: Pose; data: D }>) {
    const seen = new Set<number>()
    for (const { id, pose, data } of list) {
      seen.add(id)
      let entity = this.entities.get(id)
      // Vuelve (un jugador que reconecta) o es nueva: empieza de cero.
      if (!entity || entity.goneAt !== null) this.entities.set(id, (entity = { buffer: new InterpBuffer(), goneAt: null }))
      entity.buffer.push(tick, pose, data)
    }
    for (const [id, entity] of this.entities) if (!seen.has(id) && entity.goneAt === null) entity.goneAt = tick
  }

  /** Lo que se dibuja en `tick`, por id; olvida lo que ya no hace falta. */
  sample(tick: number): Shown<D>[] {
    const shown: Shown<D>[] = []
    for (const [id, { buffer, goneAt }] of [...this.entities].sort((a, b) => a[0] - b[0])) {
      if (goneAt !== null && tick >= goneAt) {
        this.entities.delete(id)
        continue
      }
      const at = buffer.at(tick, undefined, goneAt === null)
      if (at) shown.push({ id, pose: at.pose, data: at.data })
      buffer.trim(tick)
    }
    return shown
  }

  has(id: number): boolean {
    return this.entities.has(id)
  }

  clear() {
    this.entities.clear()
  }
}

/**
 * Cola de presentación: los eventos de las entidades remotas se reproducen cuando el render llega a su tick,
 * para que el sonido y la animación coincidan con lo que se ve.
 */
export class PresentationQueue<E extends { tick: number }> {
  private queue: E[] = []

  push(list: readonly E[]) {
    this.queue.push(...list)
  }

  /** Los que ya tocan en `tick`, en orden de llegada. */
  take(tick: number): E[] {
    const ready = this.queue.findIndex((e) => e.tick > tick)
    return this.queue.splice(0, ready === -1 ? this.queue.length : ready)
  }

  get size(): number {
    return this.queue.length
  }

  clear() {
    this.queue.length = 0
  }
}
