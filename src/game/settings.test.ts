import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, loadSettings, sanitizeSettings, saveSettings, SETTING_RANGES, SETTINGS_KEY } from './settings'

const memory = () => {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  }
}

describe('ajustes', () => {
  it('sin nada guardado valen los de por defecto', () => {
    expect(loadSettings(memory())).toEqual(DEFAULT_SETTINGS)
    expect(loadSettings(undefined)).toEqual(DEFAULT_SETTINGS)
  })

  it('se guardan y se vuelven a leer igual', () => {
    const storage = memory()
    saveSettings({ sensitivity: 1.5, fov: 90, volume: 0.25 }, storage)
    expect(loadSettings(storage)).toEqual({ sensitivity: 1.5, fov: 90, volume: 0.25 })
  })

  it('recorta valores fuera de rango y descarta los que no son números', () => {
    const s = sanitizeSettings({ sensitivity: 99, fov: 'mucho', volume: -1 })
    expect(s.sensitivity).toBe(SETTING_RANGES.sensitivity.max)
    expect(s.fov).toBe(DEFAULT_SETTINGS.fov)
    expect(s.volume).toBe(0)
    expect(sanitizeSettings({ fov: NaN }).fov).toBe(DEFAULT_SETTINGS.fov)
  })

  it('con datos corruptos o un almacenamiento que falla no rompe', () => {
    const storage = memory()
    storage.data.set(SETTINGS_KEY, '{no es json')
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS)
    const broken = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    expect(loadSettings(broken)).toEqual(DEFAULT_SETTINGS)
    expect(() => saveSettings(DEFAULT_SETTINGS, broken)).not.toThrow()
  })

  it('los valores por defecto están dentro de su rango', () => {
    for (const key of Object.keys(SETTING_RANGES) as (keyof typeof SETTING_RANGES)[]) {
      expect(DEFAULT_SETTINGS[key]).toBeGreaterThanOrEqual(SETTING_RANGES[key].min)
      expect(DEFAULT_SETTINGS[key]).toBeLessThanOrEqual(SETTING_RANGES[key].max)
    }
  })
})
