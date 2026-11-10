import { EAT_KEY } from '../sim/constants'

/**
 * Códigos de pulsación única del clic izquierdo y derecho. No son `e.code` reales: los fabrica `Input` al ver un
 * `mousedown`, para que el ratón se asigne igual que cualquier tecla. Viven aquí (y no en `input.ts`) porque este
 * módulo los necesita para los valores por defecto y `input.ts` importa de aquí, no al revés.
 */
export const CLICK = 'Mouse0'
export const RIGHT_CLICK = 'Mouse2'

/**
 * Acciones del núcleo que se pueden reasignar desde los ajustes. El orden decide los empates: si dos acciones
 * acaban con la misma tecla (por un `localStorage` editado a mano), se la queda la que va antes.
 */
export const BINDABLE_ACTIONS = [
  'forward',
  'back',
  'left',
  'right',
  'jump',
  'sprint',
  'attack',
  'block',
  'use',
  'eat',
  'inventory',
  'recipes',
  'drop',
] as const

export type BindableAction = (typeof BINDABLE_ACTIONS)[number]

/**
 * Teclas por acción. Varias teclas para una acción van separadas por `|` (correr vale con cualquiera de los dos
 * Mayús, como siempre); la cadena vacía es "sin asignar" y no se activa nunca.
 */
export type Bindings = Record<BindableAction, string>

export const DEFAULT_BINDINGS: Readonly<Bindings> = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  jump: 'Space',
  sprint: 'ShiftLeft|ShiftRight',
  attack: CLICK,
  block: RIGHT_CLICK,
  use: 'KeyE',
  eat: EAT_KEY,
  inventory: 'Tab',
  recipes: 'KeyC',
  drop: 'KeyQ',
}

export const ACTION_LABELS: Record<BindableAction, string> = {
  forward: 'Avanzar',
  back: 'Retroceder',
  left: 'Izquierda',
  right: 'Derecha',
  jump: 'Saltar',
  sprint: 'Correr',
  attack: 'Golpear',
  block: 'Bloquear',
  use: 'Usar',
  eat: 'Comer',
  inventory: 'Inventario',
  recipes: 'Recetas',
  drop: 'Tirar',
}

const BINDING_SEPARATOR = '|'

/** Los códigos de una asignación. */
export const codesOf = (binding: string): string[] => binding.split(BINDING_SEPARATOR).filter(Boolean)

/** Si alguna de las teclas de `binding` está en `codes` (teclas pulsadas o pulsaciones del paso). */
export function anyOf(codes: ReadonlySet<string>, binding: string): boolean {
  for (const code of codesOf(binding)) if (codes.has(code)) return true
  return false
}

/** Si `code` es una de las teclas de `binding`. */
export const binds = (binding: string, code: string) => codesOf(binding).includes(code)

/**
 * Si esa tecla cierra la pantalla de inventario: la cierran las mismas que la abren, y la abren la del inventario,
 * la de recetas y también la de usar (que sin nada que usar cerca abre la pantalla en vez de actuar).
 */
export const closesInventory = (b: Bindings, code: string) => binds(b.inventory, code) || binds(b.recipes, code) || binds(b.use, code)

/**
 * Asigna `code` a `action` y se lo quita a cualquier otra: dos acciones con la misma tecla se activarían a la vez.
 * La que se queda sin ninguna pasa a "sin asignar" y se ve como `—` en el panel.
 */
export function rebind(bindings: Bindings, action: BindableAction, code: string): Bindings {
  const next = { ...bindings }
  for (const other of BINDABLE_ACTIONS) {
    if (other === action) continue
    const kept = codesOf(next[other]).filter((c) => c !== code)
    if (kept.length !== codesOf(next[other]).length) next[other] = kept.join(BINDING_SEPARATOR)
  }
  next[action] = code
  return next
}

/**
 * Asignaciones válidas desde lo guardado: lo que no sea una cadena se queda con el valor por defecto, y ninguna
 * tecla se repite. Sin esto, un `localStorage` corrupto dejaría acciones mudas o duplicadas.
 */
export function sanitizeBindings(raw: unknown): Bindings {
  const src = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const out = {} as Bindings
  const used = new Set<string>()
  for (const action of BINDABLE_ACTIONS) {
    const stored = src[action]
    const codes = codesOf(typeof stored === 'string' ? stored : DEFAULT_BINDINGS[action])
    const free = codes.filter((code) => !used.has(code))
    for (const code of free) used.add(code)
    out[action] = free.join(BINDING_SEPARATOR)
  }
  return out
}

const NAMED: Record<string, string> = {
  Space: 'Espacio',
  Tab: 'Tab',
  Escape: 'Esc',
  Enter: 'Enter',
  Backspace: 'Retroceso',
  Delete: 'Supr',
  Insert: 'Insert',
  Home: 'Inicio',
  End: 'Fin',
  PageUp: 'Re Pág',
  PageDown: 'Av Pág',
  ShiftLeft: 'Mayús izq.',
  ShiftRight: 'Mayús der.',
  ControlLeft: 'Ctrl izq.',
  ControlRight: 'Ctrl der.',
  AltLeft: 'Alt izq.',
  AltRight: 'Alt der.',
  MetaLeft: 'Cmd izq.',
  MetaRight: 'Cmd der.',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  [CLICK]: 'Clic izq.',
  Mouse1: 'Clic central',
  [RIGHT_CLICK]: 'Clic der.',
}

/** El nombre legible de un `e.code`: "Espacio", "Mayús izq.", "Clic der.", la letra o el número que sea. */
export function keyLabel(code: string): string {
  const named = NAMED[code]
  if (named) return named
  const key = /^Key([A-Z])$/.exec(code)
  if (key) return key[1]!
  const digit = /^Digit(\d)$/.exec(code)
  if (digit) return digit[1]!
  const pad = /^Numpad(\d)$/.exec(code)
  if (pad) return `Num ${pad[1]}`
  if (/^F\d{1,2}$/.test(code)) return code
  return code
}

/** Lo que se lee en el panel y en los avisos: las teclas de la acción, o `—` si no tiene ninguna. */
export function bindingLabel(binding: string): string {
  const codes = codesOf(binding)
  return codes.length ? codes.map(keyLabel).join(' / ') : '—'
}
