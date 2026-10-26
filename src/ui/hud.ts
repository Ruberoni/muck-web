import { ENEMY_DEF, PROP_DEFS } from '../sim/constants'
import { ITEM_NAMES, SLOT_COUNT, type Inventory, type ItemId } from '../sim/inventory'
import type { Target } from '../sim/interaction'
import { ICONS } from './icons'
import { InventoryScreen } from './inventoryScreen'
import { Minimap } from './minimap'
import { MultiplayerHud } from './multiplayerHud'
import { CRAFT_MANY } from './recipes'
import { missingTool } from './tools'

export type OverlayKind = 'menu' | 'paused' | 'retry' | 'dead' | null

const OVERLAY_TEXT: Record<Exclude<OverlayKind, null>, string> = {
  menu: 'Haz clic para jugar',
  paused: 'Pausa — haz clic para continuar',
  retry: 'No se pudo capturar el ratón. Haz clic de nuevo',
  dead: 'Has muerto — haz clic para empezar de nuevo',
}

/** En una sala la partida no se para: la pausa es solo tuya y morir no reinicia la isla. */
const ONLINE_TEXT: Partial<Record<Exclude<OverlayKind, null>, string>> = {
  menu: 'Haz clic para entrar en la partida',
  paused: 'Pausa (la partida sigue) — haz clic para continuar',
  dead: 'Has muerto',
}

const CONTROLS = `
  <ul class="controls">
    <li><kbd>WASD</kbd> moverse</li>
    <li><kbd>Ratón</kbd> mirar</li>
    <li><kbd>Espacio</kbd> saltar</li>
    <li><kbd>Shift</kbd> correr</li>
    <li><kbd>Clic</kbd> golpear (mantener para repetir)</li>
    <li><kbd>Clic derecho</kbd> o <kbd>F</kbd> comer bayas</li>
    <li><kbd>1–9</kbd> o <kbd>Rueda</kbd> elegir casilla</li>
    <li><kbd>Tab</kbd> o <kbd>E</kbd> inventario (clic en dos casillas: cambiarlas)</li>
    <li><kbd>C</kbd> inventario con las recetas (clic: fabricar; <kbd>Mayús</kbd> + clic: hasta ${CRAFT_MANY})</li>
    <li><kbd>Clic</kbd> con la fogata o la mesa de trabajo en la mano: colocarla</li>
    <li><kbd>Enter</kbd> chat (en una sala)</li>
    <li><kbd>Esc</kbd> pausa</li>
  </ul>`

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent: HTMLElement) => {
  const node = document.createElement(tag)
  node.className = className
  parent.appendChild(node)
  return node
}

/** HUD en DOM. Solo toca el DOM cuando cambia un valor visible. */
export class Hud {
  readonly minimap: Minimap
  /** Lo que solo se ve en una sala: conexión, jugadores, avisos y nombres. */
  readonly net: MultiplayerHud
  /** La pantalla de inventario y crafteo (Tab, E o C), encima del resto del HUD. */
  readonly inventory: InventoryScreen
  /** El texto del menú cuando hay lobby (los botones del panel deciden cómo jugar). */
  menuText: string | null = null
  private healthFill: HTMLElement
  private hungerBar: HTMLElement
  private hungerFill: HTMLElement
  private staminaBar: HTMLElement
  private staminaFill: HTMLElement
  private prompt: HTMLElement
  private day: HTMLElement
  private slots: { root: HTMLElement; icon: HTMLElement; count: HTMLElement }[] = []
  private held: HTMLElement
  private hurt: HTMLElement
  private crosshair: HTMLElement
  private overlay: HTMLElement
  private overlayTitle: HTMLElement
  /** Panel del menú y la pausa, donde van los ajustes. */
  readonly panel: HTMLElement
  private last = { health: -1, hunger: -1, stamina: -1, exhausted: false, prompt: '', day: 0 }

  constructor(container: HTMLElement, onOverlayClick: () => void) {
    const root = el('div', 'hud', container)
    this.hurt = el('div', 'hurt', root)
    this.crosshair = el('div', 'crosshair', root)
    this.prompt = el('div', 'prompt', root)
    this.day = el('div', 'day', root)
    this.minimap = new Minimap(root)
    this.net = new MultiplayerHud(root)

    const bars = el('div', 'bars', root)
    this.healthFill = el('div', 'fill', el('div', 'bar health', bars))
    this.hungerBar = el('div', 'bar hunger', bars)
    this.hungerFill = el('div', 'fill', this.hungerBar)
    this.staminaBar = el('div', 'bar stamina', bars)
    this.staminaFill = el('div', 'fill', this.staminaBar)

    const dock = el('div', 'dock', root)
    this.held = el('div', 'held', dock)
    const hotbar = el('div', 'hotbar', dock)
    for (let i = 0; i < SLOT_COUNT; i++) {
      const slot = el('div', 'slot', hotbar)
      el('span', 'key', slot).textContent = String(i + 1)
      this.slots.push({ root: slot, icon: el('div', 'icon', slot), count: el('span', 'count', slot) })
    }

    this.inventory = new InventoryScreen(root)

    this.overlay = el('div', 'overlay', container)
    const panel = (this.panel = el('div', 'panel', this.overlay))
    el('h1', 'title', panel).textContent = 'muck-web'
    this.overlayTitle = el('p', 'action', panel)
    panel.insertAdjacentHTML('beforeend', CONTROLS)
    if (!matchMedia('(any-pointer: fine)').matches) {
      el('p', 'warning', panel).textContent = 'Necesitas teclado y ratón para jugar.'
    }
    this.overlay.addEventListener('click', onOverlayClick)
    this.showOverlay('menu')
  }

  /** `online`: en una sala (overlay translúcido y textos de red). */
  showOverlay(kind: OverlayKind, online = false) {
    this.overlay.hidden = kind === null
    this.overlay.classList.toggle('dead', kind === 'dead')
    this.overlay.classList.toggle('online', online)
    if (!kind) return
    const text = (online && ONLINE_TEXT[kind]) || (kind === 'menu' && this.menuText) || OVERLAY_TEXT[kind]
    this.overlayTitle.textContent = text
  }

  setHealth(value: number, max: number) {
    const v = Math.ceil(value)
    if (v === this.last.health) return
    this.last.health = v
    this.healthFill.style.transform = `scaleX(${v / max})`
  }

  setHunger(value: number, max: number) {
    // ceil, como la vida: la barra no se vacía hasta que el hambre llega de verdad a 0.
    const v = Math.ceil(value)
    if (v === this.last.hunger) return
    this.last.hunger = v
    this.hungerFill.style.transform = `scaleX(${v / max})`
    this.hungerBar.classList.toggle('starving', v === 0)
  }

  setStamina(value: number, max: number, exhausted: boolean) {
    const v = Math.round(value)
    if (v !== this.last.stamina) {
      this.last.stamina = v
      this.staminaFill.style.transform = `scaleX(${v / max})`
    }
    if (exhausted !== this.last.exhausted) {
      this.last.exhausted = exhausted
      this.staminaBar.classList.toggle('exhausted', exhausted)
    }
  }

  /**
   * Lo que se tiene delante, con `held` en la mano: nombre, barra de vida (proporcional, de ancho fijo) y qué hacer,
   * o en gris la herramienta que pide si con `held` no se le puede hacer nada ("Roca · necesita pico de madera").
   */
  setTarget(target: Target | null, held: ItemId | null) {
    if (!target) return this.setPrompt('')
    if (target.kind !== 'enemy' && PROP_DEFS[target.kind].family === 'bush') {
      const { name, verb } = PROP_DEFS[target.kind]
      return this.setPrompt(target.hp > 0 ? `${name} (${target.hp}) — clic para ${verb}` : `${name} — sin bayas`)
    }
    const def = target.kind === 'enemy' ? ENEMY_DEF : PROP_DEFS[target.kind]
    const need = target.kind === 'enemy' ? null : missingTool(held, target.kind)
    // Empieza por \0 para no confundirse nunca con un texto de setPrompt.
    const key = `\0${def.name}|${target.hp}|${target.maxHp}|${need}`
    if (key === this.last.prompt) return
    this.last.prompt = key
    this.prompt.replaceChildren(def.name)
    if (target.maxHp > 1) {
      const fill = el('span', 'fill', el('span', 'hp', this.prompt))
      fill.style.transform = `scaleX(${target.hp / target.maxHp})`
    }
    if (need) el('span', 'need', this.prompt).textContent = ` · necesita ${need}`
    else this.prompt.append(` — clic para ${def.verb}`)
    this.prompt.hidden = false
  }

  /** Texto bajo la mira; vacío lo oculta. */
  setPrompt(text: string) {
    if (text === this.last.prompt) return
    this.last.prompt = text
    this.prompt.textContent = text
    this.prompt.hidden = !text
  }

  /** La mira (el espectador no apunta a nada). */
  setCrosshair(visible: boolean) {
    this.crosshair.hidden = !visible
  }

  /** Destello rojo en los bordes al recibir daño. */
  flashHurt() {
    this.hurt.classList.remove('active')
    // Forzar reflow para que la animación vuelva a empezar aunque siga activa.
    void this.hurt.offsetWidth
    this.hurt.classList.add('active')
  }

  setInventory(inventory: Inventory) {
    this.slots.forEach((slot, i) => {
      const item = inventory.slots[i]
      slot.root.classList.toggle('filled', !!item)
      slot.root.classList.toggle('selected', i === inventory.selected)
      slot.root.title = item ? ITEM_NAMES[item] : ''
      slot.icon.innerHTML = item ? ICONS[item] : ''
      slot.count.textContent = item ? String(inventory.count(item)) : ''
    })
    const held = inventory.selectedItem
    this.held.textContent = held ? ITEM_NAMES[held] : ''
    this.inventory.setInventory(inventory)
  }
  setDay(day: number) {
    if (day === this.last.day) return
    this.last.day = day
    this.day.textContent = `Día ${day}`
  }
}
