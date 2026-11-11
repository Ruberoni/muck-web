import { ENEMY_DEFS, PROP_DEFS } from '../sim/constants'
import { ITEM_NAMES, SLOT_COUNT, type Inventory, type ItemId } from '../sim/inventory'
import type { Target } from '../sim/interaction'
import { nextFood } from '../sim/playerTick'
import { ICONS } from './icons'
import { InventoryScreen } from './inventoryScreen'
import { Minimap } from './minimap'
import { MultiplayerHud } from './multiplayerHud'
import { CRAFT_MANY } from './recipes'
import { missingTool } from './tools'

export type OverlayKind = 'menu' | 'paused' | 'retry' | 'dead' | 'ready' | null

const OVERLAY_TEXT: Record<Exclude<OverlayKind, null>, string> = {
  menu: 'Haz clic para jugar',
  paused: 'Pausa — haz clic para continuar',
  retry: 'No se pudo capturar el ratón. Haz clic de nuevo',
  dead: 'Haz clic para volver al menú',
  ready: 'La partida ha empezado — haz clic para entrar',
}

/** En una sala la partida no se para: la pausa es solo tuya y morir no reinicia la isla. */
const ONLINE_TEXT: Partial<Record<Exclude<OverlayKind, null>, string>> = {
  menu: 'Sala de espera',
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
    <li><kbd>F</kbd> comer lo que llevas en la mano (si no, una baya)</li>
    <li><kbd>Clic derecho</kbd> mirando a una estación: abrirla; con escudo, mantener para bloquear; si no, comer</li>
    <li><kbd>1–9</kbd> o <kbd>Rueda</kbd> elegir casilla</li>
    <li><kbd>Q</kbd> tirar uno de la mano (<kbd>Ctrl</kbd> + <kbd>Q</kbd>: todos)</li>
    <li><kbd>Tab</kbd> o <kbd>E</kbd> inventario (clic en dos casillas o arrastrar: cambiarlas; <kbd>Mayús</kbd> + clic en un peto o escudo: ponérselo)</li>
    <li><kbd>E</kbd> cerca de una construcción: entregar materiales, cargar aceite o encender el faro</li>
    <li><kbd>C</kbd> inventario con las recetas (clic: fabricar; <kbd>Mayús</kbd> + clic: hasta ${CRAFT_MANY})</li>
    <li><kbd>Clic</kbd> con la fogata o una estación en la mano: colocarla</li>
    <li><kbd>Enter</kbd> chat (en una sala)</li>
    <li><kbd>Esc</kbd> pausa</li>
  </ul>`

/** Lo que piden las licencias de los modelos (el LICENSE.txt de cada carpeta de public/models). */
const CREDITS = `
  <p class="credits">Modelos: Quaternius (CC0); Guardián del meteorito a partir de "Colossus" de Darwin Yamamoto
  (CC-BY 3.0); Coloso de Cristal a partir de LOWPO Golem Pack de Standout 7.</p>`

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
  private healthBar: HTMLElement
  private healthFill: HTMLElement
  private regenLeft: HTMLElement
  private hungerBar: HTMLElement
  private hungerFill: HTMLElement
  private staminaBar: HTMLElement
  private staminaFill: HTMLElement
  private food: HTMLElement
  private effects: HTMLElement
  private prompt: HTMLElement
  private day: HTMLElement
  private biome: HTMLElement
  private tonight: HTMLElement
  private light: HTMLElement
  private banner: HTMLElement
  private boss: HTMLElement
  private bossName: HTMLElement
  private bossFill: HTMLElement
  private slots: { root: HTMLElement; icon: HTMLElement; count: HTMLElement }[] = []
  private held: HTMLElement
  private hurt: HTMLElement
  private crosshair: HTMLElement
  private eating: HTMLElement
  private eatingFill: HTMLElement
  private eatingShown = -1
  private overlay: HTMLElement
  private overlayTitle: HTMLElement
  private results: HTMLElement
  /** Panel del menú y la pausa, donde van los ajustes. */
  readonly panel: HTMLElement
  private last = { health: -1, regen: 0, hunger: -1, stamina: -1, exhausted: false, food: null as ItemId | null, prompt: '', effects: '', clock: '', tonight: '', light: '', boss: '' }

  constructor(container: HTMLElement, onOverlayClick: () => void) {
    const root = el('div', 'hud', container)
    this.hurt = el('div', 'hurt', root)
    this.crosshair = el('div', 'crosshair', root)
    this.eating = el('div', 'eating', root)
    this.eating.hidden = true
    this.eatingFill = el('div', 'eating-fill', this.eating)
    this.prompt = el('div', 'prompt', root)
    this.day = el('div', 'day', root)
    this.biome = el('div', 'biome-notice', root)
    this.tonight = el('div', 'tonight', root)
    this.light = el('div', 'lit', root)
    this.banner = el('div', 'banner', root)
    this.boss = el('div', 'boss', root)
    this.boss.hidden = true
    this.bossName = el('div', 'name', this.boss)
    this.bossFill = el('div', 'fill', el('div', 'bar', this.boss))
    this.minimap = new Minimap(root)
    this.net = new MultiplayerHud(root)

    const bars = el('div', 'bars', root)
    this.healthBar = el('div', 'bar health', bars)
    this.healthFill = el('div', 'fill', this.healthBar)
    this.regenLeft = el('span', 'regen-left', this.healthBar)
    this.hungerBar = el('div', 'bar hunger', bars)
    this.hungerFill = el('div', 'fill', this.hungerBar)
    this.staminaBar = el('div', 'bar stamina', bars)
    this.staminaFill = el('div', 'fill', this.staminaBar)
    this.food = el('div', 'next-food', bars)
    this.effects = el('div', 'effects', bars)
    this.food.hidden = true

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
    this.results = el('div', 'results', panel)
    this.results.hidden = true
    panel.insertAdjacentHTML('beforeend', CONTROLS + CREDITS)
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

  /** La pantalla final, sobre el menú; null la quita. */
  setResults(lines: readonly string[] | null) {
    this.results.hidden = !lines
    this.results.replaceChildren(...(lines ?? []).map((line) => Object.assign(document.createElement('p'), { textContent: line })))
  }

  /** `regenLeft`: segundos de curación poco a poco que quedan (la barra late en verde y los muestra). */
  setHealth(value: number, max: number, regenLeft = 0) {
    const regen = Math.ceil(regenLeft)
    if (regen !== this.last.regen) {
      this.last.regen = regen
      this.healthBar.classList.toggle('regen', regen > 0)
      this.regenLeft.textContent = regen > 0 ? `${regen} s` : ''
    }
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

  /** Lo que lleva comido de lo que está comiendo o bebiendo (0 a 1), en una barrita bajo la mira; null: nada. */
  setEating(progress: number | null) {
    const shown = progress !== null
    if (this.eating.hidden === !shown && (!shown || Math.abs(progress - this.eatingShown) < 0.01)) return
    this.eating.hidden = !shown
    if (shown) {
      this.eatingShown = progress
      this.eatingFill.style.width = `${Math.round(progress * 100)}%`
    }
  }

  /** Los efectos con tiempo que siguen en marcha (aliento, rapidez, piedra), con los segundos que les quedan. */
  setEffects(effects: { breath: number; speed: number; guard: number }) {
    const parts = [
      effects.breath > 0 ? `Aliento ${Math.ceil(effects.breath)} s` : '',
      effects.speed > 0 ? `Rapidez ${Math.ceil(effects.speed)} s` : '',
      effects.guard > 0 ? `Piedra ${Math.ceil(effects.guard)} s` : '',
    ].filter(Boolean)
    const text = parts.join(' · ')
    if (text === this.last.effects) return
    this.last.effects = text
    this.effects.textContent = text
    this.effects.hidden = !text
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
    const harvest = target.kind === 'enemy' ? undefined : PROP_DEFS[target.kind].harvest
    if (target.kind !== 'enemy' && harvest) {
      const { name, verb } = PROP_DEFS[target.kind]
      if (target.hp <= 0) return this.setPrompt(`${name} — ${harvest.empty}`)
      return this.setPrompt(`${name}${target.maxHp > 1 ? ` (${target.hp})` : ''} — clic para ${verb}`)
    }
    const def = target.kind === 'enemy' ? ENEMY_DEFS[target.type] : PROP_DEFS[target.kind]
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

  /** Junto a la barra de hambre, lo que comerá la F. */
  private setFood(item: ItemId | null) {
    if (item === this.last.food) return
    this.last.food = item
    this.food.hidden = !item
    this.food.title = item ? ITEM_NAMES[item] : ''
    this.food.innerHTML = item ? ICONS[item] : ''
  }

  /** Aviso discreto del bioma en el que se acaba de entrar. */
  showBiome(name: string) {
    this.flashText(this.biome, name)
  }

  /** Cartel grande en el centro: un jefe que viene o que llega. */
  showBanner(text: string) {
    this.flashText(this.banner, text)
  }

  /** Bajo el día, lo que viene esta noche; null lo quita. */
  setTonight(text: string | null) {
    if ((text ?? '') === this.last.tonight) return
    this.last.tonight = text ?? ''
    this.tonight.textContent = text ?? ''
  }

  /** Cómo va la noche iluminada; null lo quita. */
  setLight(text: string | null) {
    if ((text ?? '') === this.last.light) return
    this.last.light = text ?? ''
    this.light.textContent = text ?? ''
  }

  /** Arriba, la barra del jefe que haya vivo; null la quita. */
  setBoss(boss: { name: string; hp: number; maxHp: number } | null) {
    const key = boss ? `${boss.name}|${boss.hp}|${boss.maxHp}` : ''
    if (key === this.last.boss) return
    this.last.boss = key
    this.boss.hidden = !boss
    if (!boss) return
    this.bossName.textContent = boss.name
    this.bossFill.style.transform = `scaleX(${boss.hp / boss.maxHp})`
  }

  private flashText(element: HTMLElement, text: string) {
    element.textContent = text
    element.classList.remove('active')
    // Forzar reflow para que la animación vuelva a empezar aunque siga activa.
    void element.offsetWidth
    element.classList.add('active')
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
    this.setFood(nextFood(inventory))
    this.inventory.setInventory(inventory)
  }
  /** El día y, debajo, lo que falta. Con cada segundo cambia el texto: solo se toca el DOM entonces. */
  setClock({ title, countdown }: { title: string; countdown: string }) {
    const text = countdown ? `${title}\n${countdown}` : title
    if (text === this.last.clock) return
    this.last.clock = text
    this.day.textContent = text
  }
}
