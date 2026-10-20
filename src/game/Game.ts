import * as THREE from 'three'
import { GameAudio } from '../audio/gameAudio'
import { Sound } from '../audio/sound'
import { createScene, updateSky, type Sky } from '../scene'
import type { PropView } from '../view/PropView'
import { EnemyView } from '../view/EnemyView'
import { PickupView } from '../view/PickupView'
import { CampfireView } from '../view/CampfireView'
import { LOCAL_PLAYER, type SimEvent } from '../sim/events'
import { Hud } from '../ui/hud'
import { createSettingsPanel } from '../ui/settings'
import { sunDirection } from '../world/daycycle'
import { WATER_LEVEL } from '../sim/world/terrain'
import { campfireSpot, type CampfireSpot } from '../sim/campfires'
import { EAT_KEY, EYE_HEIGHT, HEALTH_MAX, HUNGER_MAX, MAX_FRAME_DT, MAX_STEPS_PER_FRAME, MOUSE_SENSITIVITY, STAMINA_MAX, STEP } from '../sim/constants'
import { inputButtons, type ActionData } from '../sim/commands'
import { Handheld } from './handheld'
import { CLICK, Input, RIGHT_CLICK } from './input'
import { cycleSlot, SLOT_COUNT } from '../sim/inventory'
import { loadSettings, saveSettings, type Settings } from './settings'
import { interpolate, NO_INPUT, rotatePlayer, type PlayerInput } from '../sim/player'
import type { Simulation } from '../sim/Simulation'
import { LocalSession, type Session } from '../net/session'

export type GameState = 'menu' | 'playing' | 'paused' | 'dead'

const SHADOW_LOOK_AHEAD = 25
// Distancia a la que deja de oírse una fogata.
const CAMPFIRE_HEARING = 14

/**
 * El cliente: convierte la entrada en comandos para la sesión y dibuja, suena y muestra lo que pasa.
 * El estado de la partida vive en `session.sim`; Game solo lo lee (salvo los trucos de debug).
 */
export class Game {
  readonly renderer: THREE.WebGLRenderer
  readonly camera: THREE.PerspectiveCamera
  readonly scene: THREE.Scene
  readonly session: Session = new LocalSession()
  readonly propView: PropView
  readonly hud: Hud
  readonly input: Input
  readonly enemyView = new EnemyView()
  readonly pickupView = new PickupView()
  readonly campfireView: CampfireView
  readonly settings: Settings = loadSettings()
  readonly sound = new Sound()
  private audio = new GameAudio(this.sound)
  readonly handheld = new Handheld(window.innerWidth / window.innerHeight)

  state: GameState = 'menu'
  craftingOpen = false
  /** Con reloj manual, la simulación solo avanza con advance() (debug y pruebas). */
  manualClock = false
  inputOverride: Partial<PlayerInput> | null = null
  attackOverride: boolean | null = null

  private sky: Sky
  private water: THREE.Mesh
  private acc = 0
  private lastTime: number | null = null
  private renderPos = { x: 0, y: 0, z: 0 }
  /**
   * Hacia donde mira la cámara. El ratón la gira por frame (a la frecuencia del monitor, no por paso fijo)
   * y cada paso se manda en el `Move`.
   */
  private look = { yaw: 0, pitch: 0 }
  /** Tras empezar o reanudar, el jugador se dibuja donde está, sin interpolar desde antes de la pausa. */
  private snapPlayer = true
  private shadowCenter = new THREE.Vector3()
  private spot: CampfireSpot = { x: 0, y: 0, z: 0, valid: false }
  private sun = new THREE.Vector3()

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    // Se borra a mano en render(): la mano se dibuja encima del mundo sin borrar el color.
    this.renderer.autoClear = false
    container.appendChild(this.renderer.domElement)

    this.camera = new THREE.PerspectiveCamera(this.settings.fov, window.innerWidth / window.innerHeight, 0.1, 600)
    this.camera.rotation.order = 'YXZ'

    const { scene, sky, water, propView } = createScene(this.sim.world.placements)
    this.scene = scene
    this.sky = sky
    this.water = water
    this.propView = propView
    this.campfireView = new CampfireView(scene)
    scene.add(this.enemyView.group, this.pickupView.group)
    this.lookFromPlayer()

    this.hud = new Hud(container, () => this.onOverlayClick())
    const { inventory } = this.sim.slot
    this.hud.setInventory(inventory)
    inventory.onChange(() => this.hud.setInventory(inventory))
    this.sound.setVolume(this.settings.volume)
    createSettingsPanel(
      this.hud.panel,
      this.settings,
      () => this.applySettings(),
      (settings, key) => {
        saveSettings(settings)
        if (key === 'volume') this.sound.play('pickup')
      },
    )

    this.input = new Input(this.renderer.domElement, {
      isPlaying: () => this.state === 'playing',
      onLockChange: (locked) => {
        if (locked) this.setState('playing')
        else if (this.state === 'playing') this.setState('paused')
      },
    })

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight
      this.camera.updateProjectionMatrix()
      this.handheld.setAspect(this.camera.aspect)
      this.renderer.setSize(window.innerWidth, window.innerHeight)
    })

    this.renderer.setAnimationLoop((time) => this.frame(time))
  }

  /** El estado de la partida, para leerlo. Se cambia con comandos a través de `session`. */
  get sim(): Simulation {
    return this.session.sim
  }

  setState(state: GameState) {
    if (state === 'playing' && this.state !== 'playing') {
      // Al empezar o reanudar no se interpola desde la posición de antes de la pausa.
      this.snapPlayer = true
      this.acc = 0
    }
    if (state !== 'playing') this.input.clear()
    this.state = state
    this.hud.showOverlay(state === 'playing' ? null : state)
  }

  /** Partida nueva: inventario vacío, isla restaurada y jugador en el punto de aparición. */
  restart() {
    this.session.reset()
    this.setCrafting(false)
    this.propView.reset()
    this.enemyView.reset()
    this.pickupView.reset()
    this.campfireView.reset()
    this.audio.reset()
    this.lookFromPlayer()
    this.acc = 0
    this.placeCamera(this.sim.slot.player.pos)
    if (this.state === 'dead') this.setState('menu')
  }

  /** Aplica los ajustes actuales (al mover un deslizador). */
  applySettings() {
    this.camera.fov = this.settings.fov
    this.camera.updateProjectionMatrix()
    // Mover un deslizador es un gesto del usuario: basta para poder sonar.
    this.sound.unlock()
    this.sound.setVolume(this.settings.volume)
  }

  setCrafting(open: boolean) {
    this.craftingOpen = open
    this.hud.setCrafting(open)
  }

  /** Truco de debug: mueve al jugador y la cámara. */
  teleport(x: number, z: number, yaw = this.look.yaw, pitch = this.look.pitch) {
    this.sim.teleport(x, z, yaw, pitch)
    this.lookFromPlayer()
    this.acc = 0
    this.audio.reset()
    this.placeCamera(this.sim.slot.player.pos)
  }

  /** Ejecuta pasos fijos de forma síncrona y renderiza un frame (debug y pruebas). */
  advance(seconds: number) {
    const steps = Math.round(seconds / STEP)
    for (let i = 0; i < steps && this.state !== 'dead'; i++) this.step()
    this.acc = 0
    this.render(1, seconds, performance.now())
  }

  private async onOverlayClick() {
    if (this.state === 'playing') return
    // El clic es el gesto que permite al navegador empezar a sonar.
    this.sound.unlock()
    if (this.state === 'dead') this.restart()
    const ok = await this.input.requestLock()
    if (!ok) this.hud.showOverlay('retry')
  }

  private frame(time: number) {
    const dt = this.lastTime === null ? 0 : Math.min((time - this.lastTime) / 1000, MAX_FRAME_DT)
    this.lastTime = time

    // El ratón se aplica por frame (a la frecuencia del monitor), no por paso fijo.
    const { dx, dy } = this.input.consumeMouse()
    const sensitivity = MOUSE_SENSITIVITY * this.settings.sensitivity
    if (this.state === 'playing') rotatePlayer(this.look, -dx * sensitivity, -dy * sensitivity)

    if (this.state === 'playing' && !this.manualClock) {
      this.acc += dt
      let steps = 0
      while (this.acc >= STEP && steps < MAX_STEPS_PER_FRAME && this.state === 'playing') {
        this.step()
        this.acc -= STEP
        steps++
      }
      if (steps === MAX_STEPS_PER_FRAME) this.acc = Math.min(this.acc, STEP)
    }

    this.render(this.state === 'playing' && !this.manualClock ? this.acc / STEP : 1, dt, time)
  }

  /**
   * Acciones de las pulsaciones de un paso. C abre o cierra el crafteo; los números eligen casilla o,
   * con el crafteo abierto, fabrican. La rueda mueve la casilla elegida salvo con el crafteo abierto,
   * donde se ignora. El clic coloca la fogata si es lo que queda en la mano y, si no, golpea.
   */
  private actions(presses: ReadonlySet<string>, wheel: number): ActionData[] {
    const actions: ActionData[] = []
    const { inventory } = this.sim.slot
    // La casilla que quedará elegida tras las acciones de este paso.
    let selected = inventory.selected
    if (presses.has('KeyC')) this.setCrafting(!this.craftingOpen)
    for (let i = 0; i < SLOT_COUNT; i++) {
      if (!presses.has(`Digit${i + 1}`)) continue
      if (this.craftingOpen) {
        actions.push({ kind: 'craft', recipe: i })
      } else {
        actions.push({ kind: 'select', slot: i })
        selected = i
      }
    }
    if (wheel && !this.craftingOpen) {
      selected = cycleSlot(selected, wheel)
      actions.push({ kind: 'select', slot: selected })
    }
    if (presses.has(CLICK)) {
      if (inventory.slots[selected] === 'campfire') actions.push({ kind: 'place' })
      else if (this.attackOverride === null) actions.push({ kind: 'swing' })
    }
    if (presses.has(EAT_KEY) || presses.has(RIGHT_CLICK)) actions.push({ kind: 'eat' })
    return actions
  }

  /** Un paso fijo: manda el movimiento y las acciones a la sesión y presenta lo que ha pasado. */
  private step() {
    const input = this.inputOverride ? { ...NO_INPUT, ...this.inputOverride } : this.input.state()
    const actions = this.actions(this.input.takePresses(), this.input.takeWheel())
    const attack = this.attackOverride ?? this.input.attackHeld
    const { yaw, pitch } = this.look
    const events = this.session.step({ buttons: inputButtons(input, attack), yaw, pitch }, actions)
    this.snapPlayer = false
    this.present(events)
  }

  /** Efectos de los eventos de un paso: HUD, mano y sonido. La simulación no los llama directamente. */
  private present(events: readonly SimEvent[]) {
    const { sim } = this
    this.audio.step(STEP, sim.slot.player, sim.enemies.list)
    this.audio.events(events, LOCAL_PLAYER, (id) => sim.world.props[id].kind)
    this.propView.present(events)
    this.enemyView.present(events)
    for (const e of events) {
      switch (e.type) {
        case 'playerHurt':
          this.hud.flashHurt()
          break
        case 'playerSwing':
          this.handheld.play('swing')
          break
        case 'playerPlaced':
          this.handheld.play('place', 'campfire')
          break
        case 'playerAte':
          // Se come aunque se tenga otra cosa en la mano: la animación se hace con una baya.
          this.handheld.play('eat', 'berry')
          break
        case 'playerDied':
          this.die()
          break
      }
    }
  }

  private die() {
    this.setState('dead')
    // Con el estado ya en 'dead', perder el ratón no lo cambia a pausa.
    if (this.input.locked) document.exitPointerLock()
  }

  /** La cámara mira hacia donde mira el jugador (al empezar, al reiniciar o tras un teletransporte). */
  private lookFromPlayer() {
    const { yaw, pitch } = this.sim.slot.player
    this.look.yaw = yaw
    this.look.pitch = pitch
  }

  private placeCamera(pos: { x: number; y: number; z: number }) {
    this.camera.position.set(pos.x, pos.y + EYE_HEIGHT, pos.z)
    this.camera.rotation.set(this.look.pitch, this.look.yaw, 0)
  }

  private render(alpha: number, dt: number, time: number) {
    const { sim, look } = this
    const { slot, campfires, enemies } = sim
    const p = slot.player
    this.placeCamera(interpolate(p, this.snapPlayer ? 1 : alpha, this.renderPos))
    this.enemyView.update(dt, enemies.list, alpha)
    this.pickupView.update(sim.pickups.list, alpha)
    this.propView.update(dt)

    this.water.position.y = WATER_LEVEL + Math.sin(time * 0.0008) * 0.08

    // Las sombras se centran por delante del jugador según el yaw (no depende del pitch).
    this.shadowCenter.set(
      this.renderPos.x - Math.sin(look.yaw) * SHADOW_LOOK_AHEAD,
      this.renderPos.y,
      this.renderPos.z - Math.cos(look.yaw) * SHADOW_LOOK_AHEAD,
    )
    updateSky(this.sky, sim.clock.phase, this.shadowCenter)
    this.campfireView.update(time, sim.clock.phase, this.renderPos, campfires.list)
    const placing = this.state === 'playing' && slot.inventory.selectedItem === 'campfire'
    const spot = placing ? campfireSpot(this.renderPos, look.yaw, [sim.world.grid, campfires.grid], this.spot) : null
    this.campfireView.setGhost(spot)

    this.hud.setHealth(p.health, HEALTH_MAX)
    this.hud.setHunger(p.hunger, HUNGER_MAX)
    this.hud.setStamina(p.stamina, STAMINA_MAX, p.exhausted)
    if (spot) this.hud.setPrompt(spot.valid ? 'Clic para colocar la fogata' : 'No se puede colocar aquí')
    else if (slot.hotbarFull && !sim.interaction.target) this.hud.setPrompt('Hotbar llena')
    else this.hud.setTarget(sim.interaction.target)
    this.hud.setDay(sim.clock.day)
    this.hud.minimap.draw({ x: this.renderPos.x, z: this.renderPos.z, yaw: look.yaw, campfires: campfires.list, enemies: enemies.list })
    this.updateAmbient(dt)

    this.handheld.setItem(slot.inventory.selectedItem)
    this.handheld.update(dt, Math.hypot(p.vel.x, p.vel.z), p.grounded, this.sky)
    this.renderer.clear()
    this.renderer.render(this.scene, this.camera)
    if (this.state !== 'dead') this.handheld.render(this.renderer)
  }

  private updateAmbient(dt: number) {
    const { sim } = this
    let nearest = Infinity
    for (const fire of sim.campfires.list) nearest = Math.min(nearest, Math.hypot(fire.x - this.renderPos.x, fire.z - this.renderPos.z))
    this.sound.update(dt, {
      active: this.state === 'playing',
      night: 1 - THREE.MathUtils.smoothstep(sunDirection(sim.clock.phase, this.sun).y, -0.1, 0.25),
      campfire: Math.max(0, 1 - nearest / CAMPFIRE_HEARING),
    })
  }
}
