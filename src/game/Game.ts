import * as THREE from 'three'
import { GameAudio } from '../audio/gameAudio'
import { Sound } from '../audio/sound'
import { createScene, updateSky, type Sky } from '../scene'
import type { PropView } from '../view/PropView'
import { EnemyView } from '../view/EnemyView'
import { PickupView } from '../view/PickupView'
import { CampfireView } from '../view/CampfireView'
import { RemotePlayerView } from '../view/RemotePlayerView'
import type { SimEvent } from '../sim/events'
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
import type { PlayerSlot, Simulation } from '../sim/Simulation'
import { LocalSession, type Session } from '../net/session'
import type { NetSession } from '../net/netSession'

export type GameState = 'menu' | 'playing' | 'paused' | 'dead'

const SHADOW_LOOK_AHEAD = 25
// Distancia a la que deja de oírse una fogata.
const CAMPFIRE_HEARING = 14

/**
 * El cliente: convierte la entrada en comandos para la sesión y dibuja, suena y muestra lo que pasa.
 * El estado de la partida vive en `session.sim`; Game solo lo lee (salvo los trucos de debug).
 *
 * Con un jugador (LocalSession) los pasos fijos salen de un acumulador. En red (NetSession) el ritmo lo marca su
 * reloj, `sim` es un espejo y hay más que presentar: los eventos del servidor que tratan del jugador local (al
 * llegar, con sonido) y los de los demás (en el tick de render, sin sonido hasta el audio remoto, PR 13).
 */
export class Game {
  readonly renderer: THREE.WebGLRenderer
  readonly camera: THREE.PerspectiveCamera
  readonly scene: THREE.Scene
  /** Se cambia con setSession (al entrar en una sala o volver a jugar solo). */
  session: Session = new LocalSession()
  readonly propView: PropView
  readonly hud: Hud
  readonly input: Input
  readonly enemyView = new EnemyView()
  readonly pickupView = new PickupView()
  readonly campfireView: CampfireView
  readonly remotePlayers = new RemotePlayerView()
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
  /** Acciones de `__debug` (select, craft) para el siguiente paso, como si fueran teclas. */
  private queued: ActionData[] = []
  /** El `worldVersion` del cliente en red que ya refleja la vista de los props. */
  private worldVersion = -1

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
    scene.add(this.enemyView.group, this.pickupView.group, this.remotePlayers.group)
    this.lookFromPlayer()

    this.hud = new Hud(container, () => this.onOverlayClick())
    this.bindInventory()
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

  /** El jugador de este cliente. */
  get slot(): PlayerSlot {
    return this.session.slot
  }

  /** La sesión en red, si se está jugando en una sala. */
  get net(): NetSession | null {
    return this.session.networked ? (this.session as NetSession) : null
  }

  /** Cambia de partida (entrar en una sala, o volver a jugar solo): la vista se rehace desde la nueva. */
  setSession(session: Session) {
    if (session === this.session) return
    this.net?.close()
    this.session = session
    this.bindInventory()
    this.setCrafting(false)
    this.resetViews()
    this.worldVersion = -1
    this.lookFromPlayer()
    this.acc = 0
    this.snapPlayer = true
    this.placeCamera(this.slot.player.pos)
    // En el menú o en pausa no predice ni envía: al empezar a jugar pide el estado.
    if (this.state !== 'playing') this.net?.suspend()
  }

  setState(state: GameState) {
    if (state === 'playing' && this.state !== 'playing') {
      // Al empezar o reanudar no se interpola desde la posición de antes de la pausa.
      this.snapPlayer = true
      this.acc = 0
      this.net?.wake()
    }
    if (state !== 'playing') {
      this.input.clear()
      // En red la pausa es solo local: el jugador pasa a ausente y la partida sigue.
      this.net?.suspend()
    }
    this.state = state
    this.hud.showOverlay(state === 'playing' ? null : state)
  }

  /** Partida nueva: inventario vacío, isla restaurada y jugador en el punto de aparición. En red no hace nada (la isla es del servidor). */
  restart() {
    if (this.net) return
    this.session.reset()
    this.setCrafting(false)
    this.resetViews()
    this.lookFromPlayer()
    this.acc = 0
    this.placeCamera(this.slot.player.pos)
    if (this.state === 'dead') this.setState('menu')
  }

  /** Una acción para el siguiente paso, como si se hubiera pulsado su tecla (`__debug.select`/`craft`). */
  queueAction(action: ActionData) {
    this.queued.push(action)
  }

  /** Orienta la cámara (y lo que se manda en cada `Move`). */
  setLook(yaw: number, pitch: number) {
    this.look.yaw = yaw
    this.look.pitch = pitch
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

  /** Truco de debug: mueve al jugador y la cámara. En red lo hace el servidor: se cumple cuando la predicción lo recoge. */
  teleport(x: number, z: number, yaw = this.look.yaw, pitch = this.look.pitch): Promise<void> | void {
    const { net } = this
    if (net) {
      this.setLook(yaw, pitch)
      return net.dev({ op: 'teleport', x, z, yaw, pitch }).then(() => this.audio.reset())
    }
    this.sim.teleport(this.session.me, x, z, yaw, pitch)
    this.lookFromPlayer()
    this.acc = 0
    this.audio.reset()
    this.placeCamera(this.slot.player.pos)
  }

  /** Ejecuta pasos fijos de forma síncrona y renderiza un frame (debug y pruebas). */
  advance(seconds: number) {
    if (this.net) throw new Error('advance solo con un jugador: en red el ritmo es del servidor')
    const steps = Math.round(seconds / STEP)
    for (let i = 0; i < steps && this.state !== 'dead'; i++) this.step()
    this.acc = 0
    this.render(1, seconds, performance.now())
  }

  private async onOverlayClick() {
    if (this.state === 'playing') return
    // El clic es el gesto que permite al navegador empezar a sonar.
    this.sound.unlock()
    if (this.state === 'dead') {
      // En red el muerto espera (reaparecer y espectador llegan en el PR 14).
      if (this.net) return
      this.restart()
    }
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

    const { net } = this
    if (net) {
      // El reloj de red dice cuántos ticks predecir (0 en pausa: está suspendida).
      for (let i = 0, n = net.advance(); i < n && this.state === 'playing'; i++) this.step()
      net.flush()
      const { own, remote } = net.render()
      if (own.some((e) => e.type === 'worldReset')) this.resetViews()
      this.present(own)
      this.present(remote, false)
      this.render(net.alpha, dt, time)
      return
    }

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
    const actions = this.queued.splice(0)
    const { inventory } = this.slot
    // La casilla que quedará elegida tras las acciones de este paso.
    let selected = inventory.selected
    for (const action of actions) if (action.kind === 'select') selected = action.slot
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
    const { sim, slot } = this
    // Una vez por tick real (en red, por tick predicho; nunca al re-simular).
    this.audio.step(STEP, slot.player, sim.enemies.list)
    this.present(events)
  }

  /**
   * Efectos de unos eventos: HUD, mano, vistas y, con `sound`, sonido. La simulación no los llama directamente.
   * Los del jugador local tocan el HUD y la mano; los de los demás, sus avatares.
   */
  private present(events: readonly SimEvent[], sound = true) {
    if (!events.length) return
    const { sim, slot } = this
    if (sound) this.audio.events(events, slot.id, (id) => sim.world.props[id].kind)
    this.propView.present(events)
    this.enemyView.present(events)
    this.remotePlayers.present(events)
    for (const e of events) {
      switch (e.type) {
        case 'playerHurt':
          if (e.id === slot.id) this.hud.flashHurt()
          break
        case 'playerSwing':
          if (e.id === slot.id) this.handheld.play('swing')
          break
        case 'playerPlaced':
          if (e.id === slot.id) this.handheld.play('place', 'campfire')
          break
        case 'playerAte':
          // Se come aunque se tenga otra cosa en la mano: la animación se hace con una baya.
          if (e.id === slot.id) this.handheld.play('eat', 'berry')
          break
        case 'playerDied':
          if (e.id === slot.id) this.die()
          break
      }
    }
  }

  /** El HUD sigue el inventario del jugador de la sesión actual. */
  private bindInventory() {
    const { inventory } = this.slot
    this.hud.setInventory(inventory)
    inventory.onChange(() => {
      if (inventory === this.slot.inventory) this.hud.setInventory(inventory)
    })
  }

  /** Vistas como la isla recién generada, sin enemigos, objetos, fogatas ni otros jugadores. */
  private resetViews() {
    this.propView.reset()
    this.enemyView.reset()
    this.pickupView.reset()
    this.campfireView.reset()
    this.remotePlayers.reset()
    this.audio.reset()
  }

  private die() {
    this.setState('dead')
    // Con el estado ya en 'dead', perder el ratón no lo cambia a pausa.
    if (this.input.locked) document.exitPointerLock()
  }

  /** La cámara mira hacia donde mira el jugador (al empezar, al reiniciar o tras un teletransporte). */
  private lookFromPlayer() {
    const { yaw, pitch } = this.slot.player
    this.look.yaw = yaw
    this.look.pitch = pitch
  }

  private placeCamera(pos: { x: number; y: number; z: number }) {
    this.camera.position.set(pos.x, pos.y + EYE_HEIGHT, pos.z)
    this.camera.rotation.set(this.look.pitch, this.look.yaw, 0)
  }

  private render(alpha: number, dt: number, time: number) {
    const { sim, look, slot, net } = this
    const { campfires, enemies } = sim
    const p = slot.player
    interpolate(p, this.snapPlayer ? 1 : alpha, this.renderPos)
    if (net) {
      // La corrección de la última reconciliación se desvanece al dibujar, sin tocar la predicción.
      this.renderPos.x += net.offset.x
      this.renderPos.y += net.offset.y
      this.renderPos.z += net.offset.z
      // Un estado completo (al entrar, al volver de la pausa): los props se dibujan como dice.
      if (net.client.worldVersion !== this.worldVersion) {
        this.worldVersion = net.client.worldVersion
        this.propView.sync(sim.world.props)
      }
    }
    this.placeCamera(this.renderPos)
    this.enemyView.update(dt, enemies.list, alpha)
    this.pickupView.update(sim.pickups.list, alpha)
    this.propView.update(dt)
    this.remotePlayers.update(dt, net ? net.client.shownPlayers : [])

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
    if (net?.closed) this.hud.setPrompt('Sin conexión con el servidor')
    else if (spot) this.hud.setPrompt(spot.valid ? 'Clic para colocar la fogata' : 'No se puede colocar aquí')
    else if (slot.hotbarFull && !slot.target) this.hud.setPrompt('Hotbar llena')
    else this.hud.setTarget(slot.target)
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
