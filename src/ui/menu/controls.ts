import { bindingLabel, type Bindings } from '../../game/bindings'
import { CRAFT_MANY } from '../recipes'

export interface ControlRow {
  /** La tecla (o teclas), como se lee en la tecla dibujada. */
  key: string
  text: string
}

export interface ControlGroup {
  title: string
  rows: ControlRow[]
}

/** Las cuatro teclas de andar: "WASD" si son letras sueltas; si no, separadas. */
function moveKeys(bindings: Bindings): string {
  const labels = [bindings.forward, bindings.left, bindings.back, bindings.right].map(bindingLabel)
  return labels.every((label) => /^[A-Z]$/.test(label)) ? labels.join('') : labels.join(' ')
}

/** "Mayús izq. / Mayús der." se lee "Mayús": son las dos de siempre. */
const shortLabel = (binding: string) => {
  const label = bindingLabel(binding)
  return label === 'Mayús izq. / Mayús der.' ? 'Mayús' : label
}

/** La pantalla de controles, por grupos y con las teclas asignadas ahora. */
export function controlGroups(bindings: Bindings): ControlGroup[] {
  const k = (action: keyof Bindings) => shortLabel(bindings[action])
  return [
    {
      title: 'Moverse',
      rows: [
        { key: moveKeys(bindings), text: 'moverse' },
        { key: 'Ratón', text: 'mirar' },
        { key: k('jump'), text: 'saltar' },
        { key: k('sprint'), text: 'correr' },
      ],
    },
    {
      title: 'Combate y comida',
      rows: [
        { key: k('attack'), text: 'golpear (mantener para repetir)' },
        { key: k('block'), text: 'con escudo: mantener para bloquear; si no, comer' },
        { key: k('eat'), text: 'comer lo que llevas en la mano (si no, una baya)' },
      ],
    },
    {
      title: 'Inventario y crafteo',
      rows: [
        { key: '1–9 / Rueda', text: 'elegir casilla' },
        { key: `${k('inventory')} / ${k('use')}`, text: 'inventario (Mayús + clic: ponerse peto o escudo)' },
        { key: k('recipes'), text: `recetas (clic: fabricar; Mayús + clic: hasta ${CRAFT_MANY})` },
        { key: k('drop'), text: 'tirar uno de la mano (Ctrl + tecla: todos)' },
      ],
    },
    {
      title: 'Construir y estaciones',
      rows: [
        { key: k('attack'), text: 'con fogata o estación en la mano: colocarla' },
        { key: k('block'), text: 'mirando a una estación: abrirla' },
        { key: k('use'), text: 'cerca de una construcción o fogata: entregar, cargar, cocinar' },
      ],
    },
    {
      title: 'Partida',
      rows: [
        { key: 'Enter', text: 'chat (en una sala)' },
        { key: 'Esc', text: 'pausa' },
      ],
    },
  ]
}
