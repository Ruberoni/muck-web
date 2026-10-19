import { SETTING_RANGES, type Settings } from '../game/settings'

const ROWS: { key: keyof Settings; label: string; format: (v: number) => string }[] = [
  { key: 'sensitivity', label: 'Sensibilidad del ratón', format: (v) => `${v.toFixed(2)}×` },
  { key: 'fov', label: 'Campo de visión', format: (v) => `${Math.round(v)}°` },
  { key: 'volume', label: 'Volumen', format: (v) => `${Math.round(v * 100)} %` },
]

/**
 * Deslizadores de ajustes dentro del panel del menú y la pausa. `onInput` llega en cada movimiento;
 * `onCommit` al soltar (para guardar y, con el volumen, sonar de prueba).
 */
export function createSettingsPanel(
  parent: HTMLElement,
  settings: Settings,
  onInput: (settings: Settings) => void,
  onCommit: (settings: Settings, key: keyof Settings) => void,
) {
  const root = document.createElement('div')
  root.className = 'settings'
  // El clic en el resto del overlay empieza la partida; aquí solo se ajusta.
  for (const type of ['click', 'mousedown', 'pointerdown'] as const) root.addEventListener(type, (e) => e.stopPropagation())

  const title = document.createElement('h2')
  title.textContent = 'Ajustes'
  root.appendChild(title)

  for (const { key, label, format } of ROWS) {
    const row = document.createElement('label')
    row.className = 'setting'
    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = label
    const value = document.createElement('span')
    value.className = 'value'
    const input = document.createElement('input')
    input.type = 'range'
    const { min, max, step } = SETTING_RANGES[key]
    input.min = String(min)
    input.max = String(max)
    input.step = String(step)
    input.value = String(settings[key])
    input.dataset.setting = key
    value.textContent = format(settings[key])
    input.addEventListener('input', () => {
      settings[key] = Number(input.value)
      value.textContent = format(settings[key])
      onInput(settings)
    })
    input.addEventListener('change', () => onCommit(settings, key))
    row.append(name, input, value)
    root.appendChild(row)
  }
  parent.appendChild(root)
  return root
}
