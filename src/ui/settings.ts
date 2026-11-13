import { ACTION_LABELS, BINDABLE_ACTIONS, bindingLabel, CLICK, DEFAULT_BINDINGS, rebind, RIGHT_CLICK, type BindableAction } from '../game/bindings'
import { SETTING_RANGES, type NumericSetting, type Settings } from '../game/settings'

type Row = { key: NumericSetting; label: string; format: (v: number) => string }

const SECTIONS: { title: string; rows: Row[] }[] = [
  {
    title: 'Control',
    rows: [
      { key: 'sensitivity', label: 'Sensibilidad del ratón', format: (v) => `${v.toFixed(2)}×` },
      { key: 'fov', label: 'Campo de visión', format: (v) => `${Math.round(v)}°` },
    ],
  },
  { title: 'Sonido', rows: [{ key: 'volume', label: 'Volumen', format: (v) => `${Math.round(v * 100)} %` }] },
]

/** Interruptores, en su sección. `note` aclara lo que no se ve al momento. */
const TOGGLES: { key: 'antialias'; label: string; note: string }[] = [
  { key: 'antialias', label: 'Suavizado (MSAA)', note: 'se aplica al recargar' },
]

/** Lo que piden las licencias de los modelos (el LICENSE.txt de cada carpeta de public/models). */
export const CREDITS =
  'Modelos: Quaternius (CC0); Guardián del meteorito a partir de "Colossus" de Darwin Yamamoto (CC-BY 3.0); ' +
  'Coloso de Cristal a partir de LOWPO Golem Pack de Standout 7.'

const TABS = ['General', 'Teclas', 'Créditos'] as const

/** El pseudo-código de un botón del ratón, o null si no es de los que se pueden asignar. */
const mouseCode = (button: number) => (button === 0 ? CLICK : button === 2 ? RIGHT_CLICK : button === 1 ? 'Mouse1' : null)

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  parent?.appendChild(node)
  return node
}

function section(parent: HTMLElement, title: string) {
  const root = make('section', 'menu-section', parent)
  make('h2', '', root).textContent = title
  return root
}

/**
 * La pantalla de ajustes, con pestañas: General (deslizadores e interruptor), Teclas y Créditos. `onInput` llega en
 * cada movimiento de un deslizador; `onCommit` al soltarlo, al cambiar el interruptor y al reasignar una tecla (para
 * guardar y, con el volumen, sonar de prueba). `dispose` corta la escucha de una tecla si se cierra a medias.
 */
export function createSettingsPanel(
  parent: HTMLElement,
  settings: Settings,
  onInput: (settings: Settings) => void,
  onCommit: (settings: Settings, key: keyof Settings) => void,
) {
  const tabList = make('div', 'menu-tabs', parent)
  tabList.setAttribute('role', 'tablist')
  tabList.setAttribute('aria-label', 'Ajustes')
  const panels = TABS.map(() => {
    const panel = make('div', 'menu-tabpanel', parent)
    panel.setAttribute('role', 'tabpanel')
    return panel
  })
  const tabs = TABS.map((name, i) => {
    const tab = make('button', 'menu-tab', tabList)
    tab.type = 'button'
    tab.textContent = name
    tab.id = `settings-tab-${i}`
    tab.setAttribute('role', 'tab')
    tab.setAttribute('aria-controls', `settings-panel-${i}`)
    panels[i]!.id = `settings-panel-${i}`
    panels[i]!.setAttribute('aria-labelledby', tab.id)
    tab.addEventListener('click', () => select(i))
    return tab
  })
  const select = (index: number, focus = false) => {
    tabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === index))
      tab.tabIndex = i === index ? 0 : -1
      panels[i]!.hidden = i !== index
    })
    if (focus) tabs[index]!.focus()
    stopListening?.()
  }
  // Flechas entre pestañas, como en cualquier lista de pestañas.
  tabList.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const current = tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true')
    select((current + step + tabs.length) % tabs.length, true)
  })

  // --- General ---
  const [general, keys, credits] = panels as unknown as [HTMLElement, HTMLElement, HTMLElement]
  for (const { title, rows } of SECTIONS) {
    const box = section(general, title)
    for (const { key, label, format } of rows) {
      const row = make('label', 'setting', box)
      make('span', 'name', row).textContent = label
      const input = make('input', '', row)
      const value = make('span', 'value', row)
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
    }
  }
  const graphics = section(general, 'Gráficos')
  for (const { key, label, note } of TOGGLES) {
    const row = make('label', 'setting toggle', graphics)
    const input = make('input', '', row)
    input.type = 'checkbox'
    input.checked = settings[key]
    input.dataset.setting = key
    row.append(label)
    make('small', '', row).textContent = note
    input.addEventListener('change', () => {
      settings[key] = input.checked
      onCommit(settings, key)
    })
  }

  // --- Teclas ---
  const keysBox = make('div', 'keys-grid', keys)
  const buttons = new Map<BindableAction, HTMLButtonElement>()
  // Reasignar puede dejar otra acción sin tecla: se repintan todas.
  const refresh = () => {
    for (const [action, button] of buttons) button.textContent = bindingLabel(settings.bindings[action])
  }
  /** Termina la escucha en curso, si la hay (se está esperando otra tecla o se cierra la pantalla). */
  let stopListening: (() => void) | null = null

  for (const action of BINDABLE_ACTIONS) {
    const row = make('div', 'setting keys', keysBox)
    make('span', 'name', row).textContent = ACTION_LABELS[action]
    const button = make('button', 'keybind', row)
    button.type = 'button'
    button.dataset.action = action
    button.textContent = bindingLabel(settings.bindings[action])
    button.title = 'Clic y pulsa la tecla nueva. Esc la deja sin asignar'
    button.addEventListener('click', () => listen(action, button))
    buttons.set(action, button)
  }

  const reset = make('button', 'keybind reset', keys)
  reset.type = 'button'
  reset.textContent = 'Restaurar las teclas'
  reset.addEventListener('click', () => {
    stopListening?.()
    settings.bindings = { ...DEFAULT_BINDINGS }
    refresh()
    onCommit(settings, 'bindings')
  })

  // --- Créditos ---
  make('p', 'credits', credits).textContent = CREDITS

  /**
   * Espera la siguiente tecla o botón del ratón para `action`. Los listeners van en fase de captura y paran la
   * propagación: si no, `Input` se quedaría con la pulsación y el juego la vería al reanudar, y Esc (que deja la
   * acción sin tecla) cerraría también la pantalla.
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

  select(0)
  return { dispose: () => stopListening?.() }
}
