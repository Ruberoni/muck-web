import { DEFAULT_BINDINGS, sanitizeBindings, type Bindings } from './bindings'

export interface Settings {
  /** Multiplicador sobre MOUSE_SENSITIVITY. */
  sensitivity: number
  /** Campo de visión vertical, en grados. */
  fov: number
  /** Volumen general, de 0 a 1. */
  volume: number
  /**
   * Zoom del minimapa: radio del mundo, en metros, que cabe entre el centro y el borde. Se cambia con + y −
   * (`Minimap.setViewRadius`); menor radio, más cerca. 75 es el de siempre (`VIEW_RADIUS`).
   */
  mapRadius: number
  /**
   * MSAA del contexto WebGL. Es un atributo del contexto y no se puede cambiar con él ya creado: se guarda y se
   * aplica al recargar la página.
   */
  antialias: boolean
  /** Teclas de cada acción del núcleo; se reasignan desde el panel de ajustes (`bindings.ts`). */
  bindings: Bindings
}

/** Los ajustes de un deslizador; el resto son el interruptor y las teclas. */
export const NUMERIC_SETTINGS = ['sensitivity', 'fov', 'volume', 'mapRadius'] as const satisfies readonly (keyof Settings)[]
export type NumericSetting = (typeof NUMERIC_SETTINGS)[number]

/** Los ajustes de interruptor. */
export const BOOLEAN_SETTINGS = ['antialias'] as const satisfies readonly (keyof Settings)[]
export type BooleanSetting = (typeof BOOLEAN_SETTINGS)[number]

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  sensitivity: 1,
  fov: 70,
  volume: 0.7,
  mapRadius: 75,
  antialias: true,
  bindings: { ...DEFAULT_BINDINGS },
}

export const SETTING_RANGES: Record<NumericSetting, { min: number; max: number; step: number }> = {
  sensitivity: { min: 0.2, max: 3, step: 0.05 },
  fov: { min: 50, max: 110, step: 1 },
  volume: { min: 0, max: 1, step: 0.05 },
  mapRadius: { min: 25, max: 200, step: 25 },
}

export const SETTINGS_KEY = 'muck-web:settings'

/**
 * Ajustes válidos desde lo guardado: cada número se recorta a su rango, y lo que no es del tipo que toca se queda
 * con el valor por defecto. Devuelve siempre objetos nuevos, nunca los de `DEFAULT_SETTINGS`.
 */
export function sanitizeSettings(raw: unknown): Settings {
  const src = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const out: Settings = { ...DEFAULT_SETTINGS, bindings: sanitizeBindings(src.bindings) }
  for (const key of NUMERIC_SETTINGS) {
    const value = src[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    const { min, max } = SETTING_RANGES[key]
    out[key] = Math.min(max, Math.max(min, value))
  }
  for (const key of BOOLEAN_SETTINGS) {
    if (typeof src[key] === 'boolean') out[key] = src[key] as boolean
  }
  return out
}

/** Sin localStorage (modo privado, bloqueado) o con datos corruptos, valen los de por defecto. */
export function loadSettings(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): Settings {
  try {
    const text = storage?.getItem(SETTINGS_KEY)
    return sanitizeSettings(text ? JSON.parse(text) : null)
  } catch {
    return sanitizeSettings(null)
  }
}

export function saveSettings(settings: Settings, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage) {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // Cuota llena o almacenamiento bloqueado: los ajustes duran solo esta sesión.
  }
}
