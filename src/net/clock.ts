import { STEP } from '../sim/constants'

export const TICK_MS = STEP * 1000
/** Intervalo de envío de `cmds` mientras el jugador hace algo (20 Hz) y quieto (4 Hz). */
export const SEND_MS = 50
export const QUIET_SEND_MS = 250
/** Lo que se dibuja a los demás por detrás de lo último que ha llegado del servidor. */
export const INTERP_MS = 100
export const INTERP_TICKS = INTERP_MS / TICK_MS
/** Ticks de margen sobre la latencia y el envío, para que un `Move` no llegue justo. */
const SAFETY_TICKS = 2
/**
 * La sala avanza a saltos de 3 ticks (una vuelta de su bucle, LOOP_MS = 50 ms): el margen que mide al llegar un
 * `Move` varía hasta en eso, así que el objetivo lleva la mitad de más.
 */
const LOOP_TICKS = 3
/** Ajuste de ritmo para volver al margen objetivo sin saltos (±5 %). */
const NUDGE = 0.05
/** Fuera del margen por más de tanto, el reloj salta (o espera) en vez de acelerar o frenar. */
const HARD_ERROR = 15
/** Ticks que se simulan como mucho de una vez: si se deben más, los demás se saltan. */
export const MAX_CATCHUP = 30
/** Suavizado de RTT y desviación (como TCP) y de los demás estimadores. */
const RTT_ALPHA = 1 / 8
const DEV_ALPHA = 1 / 4
const SLACK_ALPHA = 0.1
const OFFSET_ALPHA = 0.1
/** Un salto mayor que este en lo que llega del servidor es un cambio de reloj (bucle reanudado), no ruido. */
const RESYNC_TICKS = 30

/**
 * El reloj del cliente en red. El servidor tiene el tick autoritativo; el cliente simula por delante, hasta el tick
 * en que sus `Move` llegan justo a tiempo, y dibuja a los demás un poco por detrás de lo que le llega.
 *
 * - RTT con el sello `t` que vuelve en `welcome`/`snap`: `RTT = ahora − t − held`, suavizado con su desviación.
 * - Tick del cliente: al sincronizar (`welcome`, `state`), el del servidor estimado más el `lead`
 *   (RTT/2 + intervalo de envío + media vuelta del bucle de la sala + 2 ticks + jitter). Después corre con el tiempo local a ritmo ±5 % según el
 *   `slack` que devuelve el servidor (ticks que le faltaban al más nuevo de los `Move` del último `cmds`).
 *   Lo que se controla es el `margin`, el del `Move` más viejo de ese envío (`slack` menos los ticks que abarca):
 *   tiene que llegar antes de su tick con 2 ticks, media vuelta del bucle y el jitter de sobra. Solo cuentan los `cmds` enviados a 20 Hz
 *   y después del último salto (`sent`).
 * - Tick de render (`renderTick`): lo último que llega del servidor, suavizado, menos INTERP_MS.
 *
 * Todos los tiempos en ms del reloj local (el del servidor no se usa: solo vuelven los sellos del cliente).
 */
export class TickClock {
  /** RTT suavizado y su desviación media, ms. */
  rtt = 0
  rttDev = 0
  /** Margen suavizado con el que llega el `Move` más viejo de cada envío (ticks). */
  margin = 0
  /** Ajuste de ritmo actual: −NUDGE, 0 o +NUDGE. */
  nudge = 0
  private synced = false
  /** Tick del cliente, continuo, y cuándo se avanzó por última vez. */
  private clientTick = 0
  private lastNow = 0
  /** Último tick entero devuelto por `advance`. */
  private simulated = 0
  /** Ticks que esperar sin avanzar (el cliente iba demasiado adelantado). */
  private hold = 0
  /** Tick que llega del servidor ≈ now / TICK_MS + receiveOffset. */
  private receiveOffset = 0
  /** Envíos a 20 Hz por sello `t`, con los ticks que abarcan sus `Move` nuevos (los de 4 Hz no cuentan). */
  private sends = new Map<number, number | null>()
  /** Los `slack` de envíos anteriores a este sello no cuentan (son de antes del último salto). */
  private trustFrom = -Infinity
  private lastSlackT = NaN

  /** Ticks que el cliente va por delante del servidor, según la latencia. */
  get lead(): number {
    return (this.rtt / 2 + SEND_MS) / TICK_MS + LOOP_TICKS / 2 + this.jitter + SAFETY_TICKS
  }

  /** Margen con el que debería llegar el `Move` más viejo de cada envío (llegar en su tick ya es tarde: +1). */
  get targetMargin(): number {
    return 1 + LOOP_TICKS / 2 + SAFETY_TICKS + this.jitter
  }

  /** Lo que puede variar la latencia de un sentido, en ticks. */
  private get jitter(): number {
    return (2 * this.rttDev) / TICK_MS
  }

  /** Último tick que el cliente debe tener simulado. */
  get tick(): number {
    return this.simulated
  }

  /** Fracción del tick siguiente ya transcurrida (para interpolar al dibujar). */
  get alpha(): number {
    return Math.min(1, Math.max(0, this.clientTick - this.simulated))
  }

  /** Tick del servidor estimado ahora (continuo). */
  serverTick(now: number): number {
    return this.receivedTick(now) + this.rtt / 2 / TICK_MS
  }

  /** El tick de lo que está llegando ahora del servidor (continuo). */
  receivedTick(now: number): number {
    return now / TICK_MS + this.receiveOffset
  }

  /** Tick en el que se dibuja a los demás y se presentan sus eventos. */
  renderTick(now: number): number {
    return this.receivedTick(now) - INTERP_TICKS
  }

  /** Una muestra de RTT: el sello `t` de un envío nuestro que ha vuelto tras `held` ms retenido en el servidor. */
  private sampleRtt(now: number, t: number, held: number) {
    const sample = Math.max(0, now - t - held)
    if (!this.synced) {
      this.rtt = sample
      this.rttDev = sample / 4
      return
    }
    this.rttDev += (Math.abs(sample - this.rtt) - this.rttDev) * DEV_ALPHA
    this.rtt += (sample - this.rtt) * RTT_ALPHA
  }

  private sampleReceived(now: number, tick: number, force: boolean) {
    const offset = tick - now / TICK_MS
    if (force || !this.synced || Math.abs(offset - this.receiveOffset) > RESYNC_TICKS) this.receiveOffset = offset
    else this.receiveOffset += (offset - this.receiveOffset) * OFFSET_ALPHA
  }

  /**
   * Sincroniza con un estado completo del servidor (`welcome`, o `state` tras un resync o al reanudarse el bucle):
   * `tick` es el del servidor al enviarlo; `t`/`held`, el sello si lo trae. Pone el tick del cliente en el del
   * servidor más el `lead`: hacia delante salta (los ticks que faltan los da `advance`); hacia atrás, espera.
   */
  sync(now: number, tick: number, echo?: { t: number; held: number }) {
    if (echo) this.sampleRtt(now, echo.t, echo.held)
    this.sampleReceived(now, tick, true)
    const target = this.serverTick(now) + this.lead
    if (!this.synced) {
      this.simulated = tick
      this.clientTick = target
    } else {
      this.jumpTo(target)
    }
    this.synced = true
    this.lastNow = now
    this.margin = this.targetMargin
    this.nudge = 0
    this.trustFrom = now
  }

  /** Un `snap`: RTT, lo que llega del servidor y, si vale, el `slack` para ajustar el ritmo. */
  onSnap(now: number, snap: { tick: number; t: number; held: number; slack: number }) {
    this.sampleRtt(now, snap.t, snap.held)
    this.sampleReceived(now, snap.tick, false)
    // Cada envío cuenta una vez, y solo los de 20 Hz posteriores al último salto.
    const span = this.sends.get(snap.t)
    if (snap.t === this.lastSlackT || snap.t < this.trustFrom || span == null) return
    this.lastSlackT = snap.t
    for (const t of this.sends.keys()) if (t <= snap.t) this.sends.delete(t)
    const margin = snap.slack - span
    this.margin += (margin - this.margin) * SLACK_ALPHA
    const target = this.targetMargin
    const error = margin - target
    // Muy lejos del objetivo (una muestra basta): salta o espera en vez de tardar segundos en llegar.
    if (Math.abs(error) > HARD_ERROR) {
      this.jumpTo(this.clientTick - error)
      this.margin = target
      this.nudge = 0
      this.trustFrom = now
      return
    }
    if (this.margin < target - 1) this.nudge = NUDGE
    else if (this.margin > target + 1) this.nudge = -NUDGE
    else if ((this.nudge > 0 && this.margin >= target) || (this.nudge < 0 && this.margin <= target)) this.nudge = 0
  }

  /**
   * Apunta un envío de `cmds` con su sello: a 20 Hz, con los ticks que abarcan sus `Move` nuevos (del más viejo
   * al más nuevo); a 4 Hz, `null` (no ajusta el ritmo: que lleguen tarde los `Move` de un jugador quieto no importa).
   */
  sent(t: number, span: number | null) {
    this.sends.set(t, span)
    // Sin muestras que valgan, seguir acelerando o frenando desajustaría el margen.
    if (span === null) this.nudge = 0
  }

  /** Avanza el reloj hasta `now`; devuelve cuántos ticks hay que simular (como mucho MAX_CATCHUP, el resto se salta). */
  advance(now: number): number {
    if (!this.synced) return 0
    let ticks = ((now - this.lastNow) / TICK_MS) * (1 + this.nudge)
    this.lastNow = now
    if (this.hold > 0) {
      const waited = Math.min(this.hold, ticks)
      this.hold -= waited
      ticks -= waited
    }
    this.clientTick += ticks
    const due = Math.floor(this.clientTick + 1e-9) - this.simulated
    if (due <= 0) return 0
    this.simulated += due
    return Math.min(due, MAX_CATCHUP)
  }

  /** Lleva el tick del cliente a `target`: hacia delante en el acto; hacia atrás, esperando sin avanzar. */
  private jumpTo(target: number) {
    if (target >= this.clientTick) {
      this.clientTick = target
      this.hold = 0
    } else {
      this.hold = this.clientTick - target
    }
  }
}
