export interface Settings {
  /** Multiplicador sobre MOUSE_SENSITIVITY. */
  sensitivity: number
  /** Campo de visión vertical, en grados. */
  fov: number
  /** Volumen general, de 0 a 1. */
  volume: number
}

export const DEFAULT_SETTINGS: Readonly<Settings> = { sensitivity: 1, fov: 70, volume: 0.7 }

export const SETTING_RANGES: Record<keyof Settings, { min: number; max: number; step: number }> = {
  sensitivity: { min: 0.2, max: 3, step: 0.05 },
  fov: { min: 50, max: 110, step: 1 },
  volume: { min: 0, max: 1, step: 0.05 },
}

export const SETTINGS_KEY = 'muck-web:settings'

/** Recorta cada valor a su rango; lo que no es un número se queda con el valor por defecto. */
export function sanitizeSettings(raw: unknown): Settings {
  const src = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const out = { ...DEFAULT_SETTINGS }
  for (const key of Object.keys(SETTING_RANGES) as (keyof Settings)[]) {
    const value = src[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    const { min, max } = SETTING_RANGES[key]
    out[key] = Math.min(max, Math.max(min, value))
  }
  return out
}

/** Sin localStorage (modo privado, bloqueado) o con datos corruptos, valen los de por defecto. */
export function loadSettings(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): Settings {
  try {
    const text = storage?.getItem(SETTINGS_KEY)
    return sanitizeSettings(text ? JSON.parse(text) : null)
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings: Settings, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage) {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // Cuota llena o almacenamiento bloqueado: los ajustes duran solo esta sesión.
  }
}
