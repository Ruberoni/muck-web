/** Cómo va la carga de los modelos: cuántos hay, cuántos han llegado y cuántos han fallado. */
export interface LoadProgress {
  total: number
  done: number
  failed: number
}

/** Lo que falta por cargar (0: nada, ya sea porque ha llegado o porque ha fallado). */
export const pendingOf = ({ total, done, failed }: LoadProgress) => total - done - failed

/** De 0 a 1: lo terminado (bien o mal) entre lo pedido. Sin nada pedido, 1. */
export const loadFraction = (p: LoadProgress) => (p.total ? (p.done + p.failed) / p.total : 1)

/** Ha fallado todo lo que se pidió: sin modelos, la isla se ve con las formas hechas en código. */
export const allFailed = (p: LoadProgress) => p.total > 0 && p.failed === p.total

/**
 * Cuenta las descargas de modelos que se esperan al abrir el juego (naturaleza, armas, personaje y trasgos). No mira
 * bytes (`onProgress`): solo cuántas han terminado. Un fallo cuenta como terminado: ya hay formas de respaldo.
 */
export class LoadTracker {
  private progress: LoadProgress = { total: 0, done: 0, failed: 0 }
  onChange: (() => void) | null = null

  get state(): Readonly<LoadProgress> {
    return this.progress
  }

  get pending(): number {
    return pendingOf(this.progress)
  }

  /** Cuenta una descarga más. Devuelve la misma promesa, para seguir usándola. */
  track<T>(load: Promise<T>): Promise<T> {
    this.progress = { ...this.progress, total: this.progress.total + 1 }
    load.then(
      () => this.settle('done'),
      () => this.settle('failed'),
    )
    this.onChange?.()
    return load
  }

  private settle(how: 'done' | 'failed') {
    this.progress = { ...this.progress, [how]: this.progress[how] + 1 }
    this.onChange?.()
  }
}
