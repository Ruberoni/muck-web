import { ACTION_LABELS, BINDABLE_ACTIONS, bindingLabel, CLICK, DEFAULT_BINDINGS, rebind, RIGHT_CLICK, type BindableAction } from '../game/bindings'
import { SETTING_RANGES, type NumericSetting, type Settings } from '../game/settings'

const ROWS: { key: NumericSetting; label: string; format: (v: number) => string }[] = [
  { key: 'sensitivity', label: 'Sensibilidad del ratón', format: (v) => `${v.toFixed(2)}×` },
  { key: 'fov', label: 'Campo de visión', format: (v) => `${Math.round(v)}°` },
  { key: 'volume', label: 'Volumen', format: (v) => `${Math.round(v * 100)} %` },
]

/** Interruptores, debajo de los deslizadores. `note` aclara lo que no se ve al momento. */
const TOGGLES: { key: 'antialias'; label: string; note: string }[] = [
  { key: 'antialias', label: 'Suavizado (MSAA)', note: 'se aplica al recargar' },
]

/** El pseudo-código de un botón del ratón, o null si no es de los que se pueden asignar. */
const mouseCode = (button: number) => (button === 0 ? CLICK : button === 2 ? RIGHT_CLICK : button === 1 ? 'Mouse1' : null)

/**
 * Ajustes dentro del panel del menú y la pausa: deslizadores, un interruptor y las teclas de cada acción.
 * `onInput` llega en cada movimiento de un deslizador; `onCommit` al soltarlo, al cambiar el interruptor y al
 * reasignar una tecla (para guardar y, con el volumen, sonar de prueba).
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

  for (const { key, label, note } of TOGGLES) {
    const row = document.createElement('label')
    row.className = 'setting toggle'
    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = label
    const hint = document.createElement('small')
    hint.textContent = note
    name.appendChild(hint)
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = settings[key]
    input.dataset.setting = key
    input.addEventListener('change', () => {
      settings[key] = input.checked
      onCommit(settings, key)
    })
    row.append(name, input)
    root.appendChild(row)
  }

  // --- Teclas ---

  const keysTitle = document.createElement('h2')
  keysTitle.textContent = 'Teclas'
  root.appendChild(keysTitle)

  const buttons = new Map<BindableAction, HTMLButtonElement>()
  // Reasignar puede dejar otra acción sin tecla: se repintan todas.
  const refresh = () => {
    for (const [action, button] of buttons) button.textContent = bindingLabel(settings.bindings[action])
  }
  /** Termina la escucha en curso, si la hay (se está esperando otra tecla o se cierra el panel). */
  let stopListening: (() => void) | null = null

  for (const action of BINDABLE_ACTIONS) {
    const row = document.createElement('div')
    row.className = 'setting keys'
    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = ACTION_LABELS[action]
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'keybind'
    button.dataset.action = action
    button.textContent = bindingLabel(settings.bindings[action])
    button.title = 'Clic y pulsa la tecla nueva. Esc la deja sin asignar'
    button.addEventListener('click', (e) => {
      e.stopPropagation()
      listen(action, button)
    })
    buttons.set(action, button)
    row.append(name, button)
    root.appendChild(row)
  }

  const reset = document.createElement('button')
  reset.type = 'button'
  reset.className = 'keybind reset'
  reset.textContent = 'Restaurar las teclas'
  reset.addEventListener('click', (e) => {
    e.stopPropagation()
    stopListening?.()
    settings.bindings = { ...DEFAULT_BINDINGS }
    refresh()
    onCommit(settings, 'bindings')
  })
  root.appendChild(reset)

  /**
   * Espera la siguiente tecla o botón del ratón para `action`. Los listeners van en fase de captura y paran la
   * propagación: si no, `Input` se quedaría con la pulsación y el juego la vería al reanudar.
   */
  function listen(action: BindableAction, button: HTMLButtonElement) {
    stopListening?.()
    button.classList.add('waiting')
    button.textContent = 'Pulsa una tecla…'
    const done = () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', onMouse, true)
      button.classList.remove('waiting')
      button.textContent = bindingLabel(settings.bindings[action])
      stopListening = null
    }
    const assign = (code: string | null) => {
      if (code === null) return
      settings.bindings = rebind(settings.bindings, action, code)
      refresh()
      onCommit(settings, 'bindings')
      done()
    }
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.repeat) return
      // Esc no se asigna (cierra la pausa y el inventario): deja la acción sin tecla.
      assign(e.code === 'Escape' ? '' : e.code)
    }
    const onMouse = (e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      assign(mouseCode(e.button))
    }
    stopListening = done
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mousedown', onMouse, true)
  }

  parent.appendChild(root)
  return root
}
