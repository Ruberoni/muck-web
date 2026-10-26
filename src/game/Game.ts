import * as THREE from 'three'
import { GameAudio } from '../audio/gameAudio'
import { Sound } from '../audio/sound'
import { createScene, updateSky, type Sky } from '../scene'
import { PropView } from '../view/PropView'
import { EnemyView } from '../view/EnemyView'
import { PickupView } from '../view/PickupView'
import { StructureView } from '../view/StructureView'
import { RemotePlayerView } from '../view/RemotePlayerView'
import type { SimEvent } from '../sim/events'
import { Hud, type OverlayKind } from '../ui/hud'
import { createSettingsPanel } from '../ui/settings'
import { sunDirection } from '../world/daycycle'
import { euclideanModulo } from '../sim/world/daycycle'
import { heightAt, WATER_LEVEL } from '../sim/world/terrain'
import { placeableOf, structureSpot, type StructureKind, type StructureSpot } from '../sim/structures'
import { EYE_HEIGHT, HEALTH_MAX, HUNGER_MAX, MAX_FRAME_DT, MAX_STEPS_PER_FRAME, MOUSE_SENSITIVITY, STAMINA_MAX, STEP } from '../sim/constants'
import { inputButtons, type ActionData } from '../sim/commands'
import { clientCraftWorld, sendableActions } from '../ui/recipes'
import { missingTool } from '../ui/tools'
import { canDamage } from '../sim/tiers'
import { Handheld } from './handheld'
import { Input } from './input'
import { stepActions, type InventoryFocus } from './actions'
import { acceptsKeys, afterLockChange, inGame, showsCrosshair, type GameState } from './states'
import { loadSettings, saveSettings, type Settings } from './settings'
import { interpolate, NO_INPUT, rotatePlayer, type PlayerInput } from '../sim/player'
import type { PlayerSlot, Simulation } from '../sim/Simulation'
import { LocalSession, type Session } from '../net/session'
import type { NetSession } from '../net/netSession'
import type { Notice, RemotePlayer } from '../net/client'
import type { Shown } from '../net/interp'
import { pickNameTags, type PlayerRow } from '../ui/multiplayerHud'
import { playerCss } from '../ui/playerColor'

export type { GameState } from './states'

const overlayFor = (state: GameState): OverlayKind => (inGame(state) ? null : state)

const SHADOW_LOOK_AHEAD = 25
// Distancia a la que deja de oírse una fogata.
const CAMPFIRE_HEARING = 14
/** Lo que dice el aviso al tener una estructura en la mano. */
const PLACE_PROMPT: Record<StructureKind, string> = {
  campfire: 'Clic para colocar la fogata',
  workbench: 'Clic para colocar la mesa de trabajo',
}
/** Segundos que se ve "Necesitas pico de madera" tras golpear algo que no se puede con lo que se lleva. */
const TOOL_WARNING_TIME = 1.5
/** Los nombres flotan algo por encima de la cabeza. */
const NAME_HEIGHT = EYE_HEIGHT + 0.55
/** Por encima del suelo a esta altura (m), otro jugador está en el aire o flotando: sus pasos no suenan. */
const REMOTE_GROUNDED = 0.2
/** Cámara del espectador: por detrás y por encima del jugador al que mira, y lo que tarda en girar con él. */
const SPECTATOR_BACK = 3.5
const SPECTATOR_UP = 0.9
const SPECTATOR_TURN = 5

/**
 * El cliente: convierte la entrada en comandos para la sesión y dibuja, suena y muestra lo que pasa.
 * El estado de la partida vive en `session.sim`; Game solo lo lee (salvo los trucos de debug).
 *
 * Con un jugador (LocalSession) los pasos fijos salen de un acumulador. En red (NetSession) el ritmo lo marca su
 * reloj, `sim` es un espejo y hay más que presentar: los eventos del servidor que tratan del jugador local (al
 * llegar, con sonido) y los de los demás (en el tick de render, con sonido según dónde pasan). Muerto en una sala,
 * mira a los demás (`spectating`, Tab cambia) hasta que el servidor lo hace reaparecer.
 *
 * Con la pantalla de inventario abierta (`inventory`) el ratón está suelto, pero se sigue en partida: el jugador
 * se queda quieto y solo manda lo que genera la pantalla (`move`, `craft`), y la red y la simulación siguen.
 */
export class Game {
  readonly renderer: THREE.WebGLRenderer
  readonly camera: THREE.PerspectiveCamera
  readonly scene: THREE.Scene
  /** Se cambia con setSession (al entrar en una sala o volver a jugar solo). */
  session: Session = new LocalSession()
  /** Se rehace con las colocaciones de cada sesión (ver buildPropView). */
  propView: PropView
  readonly hud: Hud
  readonly input: Input
  readonly enemyView = new EnemyView()
  readonly pickupView = new PickupView()
  readonly structureView: StructureView
  readonly remotePlayers = new RemotePlayerView()
  readonly settings: Settings = loadSettings()
  readonly sound = new Sound()
  private audio = new GameAudio(this.sound)
  /** El aviso de "Necesitas …" tras un golpe que no hace nada, y los segundos que le quedan. */
  private toolWarning = { text: '', left: 0 }
  readonly handheld = new Handheld(window.innerWidth / window.innerHeight)

  state: GameState = 'menu'
  /** Con reloj manual, la simulación solo avanza con advance() (debug y pruebas). */
  manualClock = false
  inputOverride: Partial<PlayerInput> | null = null
  attackOverride: boolean | null = null
  /** Si un clic en el fondo del menú empieza a jugar. Con el lobby, no: se elige con sus botones. */
  menuClickStarts = true
  /** Al cambiar de estado o de partida (el lobby se rehace). */
  onchange: (() => void) | null = null

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
  private spot: StructureSpot = { x: 0, y: 0, z: 0, valid: false }
  private sun = new THREE.Vector3()
  /** Acciones de `__debug` y de la pantalla de inventario (select, move, craft) para el siguiente paso. */
  private queued: ActionData[] = []
  /** Las estaciones al fabricar, como las ve el cliente (con margen): para el filtro de envío y la pantalla. */
  private craftWorld = clientCraftWorld(() => this.sim.structures.list)
  /** El `worldVersion` del cliente en red que ya refleja la vista de los props. */
  private worldVersion = -1
  /** No se pudo capturar el ratón: el siguiente clic en el fondo lo vuelve a intentar, también en el menú. */
  private retrying = false
  private projected = new THREE.Vector3()
  /** El `generation` de la sesión en red que ya refleja la vista (sube al reconectar). */
  private netGeneration = 0
  /** Espectador: a quién mira y hacia dónde mira la cámara (sigue su yaw con retraso). */
  private spectated: number | null = null
  private spectatorYaw = 0
  private snapSpectator = true
  /** Todos muertos en la sala: el día al que se llegó, hasta que se reinicia la isla. */
  private gameOverDay: number | null = null

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

    const { scene, sky, water } = createScene()
    this.scene = scene
    this.sky = sky
    this.water = water
    this.propView = this.buildPropView(null)
    this.structureView = new StructureView(scene)
    scene.add(this.enemyView.group, this.pickupView.group, this.remotePlayers.group)
    this.lookFromPlayer()

    this.hud = new Hud(container, () => this.onOverlayClick())
    this.hud.net.onsay = (text) => this.net?.client.say(text)
    this.hud.inventory.onmove = (from, to) => this.queueAction({ kind: 'move', from, to })
    this.hud.inventory.oncraft = (recipe, times) => {
      for (let i = 0; i < times; i++) this.queueAction({ kind: 'craft', recipe })
    }
    this.hud.inventory.onclose = () => this.closeInventory()
    // Esc no es un gesto que permita recapturar el ratón: se queda en pausa.
    this.hud.inventory.onescape = () => this.setState('paused')
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
      acceptsKeys: () => acceptsKeys(this.state),
      onLockChange: (locked) => {
        const next = afterLockChange(this.state, locked)
        if (next) this.setState(next)
        // Muerto con un jugador el overlay necesita el ratón suelto para su clic.
        else if (locked) document.exitPointerLock()
      },
    })
    // Con el inventario abierto el ratón ya está suelto: ocultar la pestaña o cambiar de ventana no cambiaría el
    // estado, y en red se seguiría en partida y al volver se re-simularían de golpe todos los ticks perdidos.
    const leave = () => {
      if (this.state === 'inventory') this.setState('paused')
    }
    window.addEventListener('blur', leave)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) leave()
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
    this.propView = this.buildPropView(this.propView)
    this.resetViews()
    this.worldVersion = -1
    // El espectador es de la sala que se deja: en la nueva se vuelve a decidir con su `you`.
    if (this.state === 'spectating') this.state = 'playing'
    this.hud.setCrosshair(showsCrosshair(this.state))
    this.netGeneration = this.net?.generation ?? 0
    this.gameOverDay = null
    this.lookFromPlayer()
    this.acc = 0
    this.snapPlayer = true
    this.placeCamera(this.slot.player.pos)
    // En el menú o en pausa no predice ni envía: al empezar a jugar pide el estado.
    if (!inGame(this.state)) this.net?.suspend()
    this.hud.net.setVisible(this.net !== null)
    if (this.state !== 'playing') this.hud.showOverlay(overlayFor(this.state), this.net !== null)
    this.onchange?.()
  }

  setState(state: GameState) {
    if (state === 'playing' && this.state !== 'playing' && this.state !== 'inventory') {
      // Al empezar, reanudar o reaparecer no se interpola desde la posición de antes (al cerrar el inventario sí:
      // la simulación no se ha parado).
      this.snapPlayer = true
      this.acc = 0
      this.retrying = false
    }
    // El espectador registra teclas que solo consume con ticks: las que queden no se aplican al reaparecer.
    if (state === 'playing' && this.state === 'spectating') this.input.takePresses()
    if (state === 'spectating') this.snapSpectator = true
    // Lo que se pidió en la pantalla justo antes de pausar (Esc, otra pestaña) no se manda al volver, minutos después.
    if (this.state === 'inventory' && state === 'paused') this.queued.length = 0
    if (state !== 'playing') this.input.clear()
    if (!inGame(state)) this.hud.net.closeChat()
    this.hud.setCrosshair(showsCrosshair(state))
    // En red la pausa es solo local: el jugador pasa a ausente y la partida sigue. El espectador y el inventario
    // siguen conectados.
    if (inGame(state)) this.net?.wake()
    else this.net?.suspend()
    this.state = state
    this.hud.inventory.setOpen(state === 'inventory')
    this.hud.showOverlay(overlayFor(state), this.net !== null)
    this.onchange?.()
  }

  /** Empieza o reanuda: captura el ratón (hace falta un gesto del usuario, como un clic). */
  async play() {
    // El clic es el gesto que permite al navegador empezar a sonar.
    this.sound.unlock()
    const ok = await this.input.requestLock()
    if (ok) return
    this.retrying = true
    this.hud.showOverlay('retry')
  }

  /** Partida nueva: inventario vacío, isla restaurada y jugador en el punto de aparición. En red no hace nada (la isla es del servidor). */
  restart() {
    if (this.net) return
    this.session.reset()
    this.resetViews()
    this.lookFromPlayer()
    this.acc = 0
    this.placeCamera(this.slot.player.pos)
    if (this.state === 'dead') this.setState('menu')
  }

  /**
   * Una acción para el siguiente paso, como si se hubiera pulsado su tecla (`__debug.select`/`craft`/`move` y la
   * pantalla de inventario). Los `craft` que la predicción da por fallidos no se llegan a mandar (`sendableActions`).
   */
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

  /**
   * Abre la pantalla de inventario con las casillas o las recetas a la vista y suelta el ratón; jugando, y con un
   * jugador o en una sala.
   */
  openInventory(focus: InventoryFocus = 'slots') {
    if (this.state !== 'playing') return
    // Con el estado ya en `inventory`, soltar el ratón no pasa a pausa.
    this.setState('inventory')
    this.hud.inventory.focus(focus)
    if (this.input.locked) document.exitPointerLock()
  }

  /**
   * Cierra la pantalla de inventario recapturando el ratón: se llama desde el propio evento de teclado, que cuenta
   * como gesto del usuario. Se vuelve a jugar al capturarlo (`afterLockChange`), no antes: la misma tecla llegaría
   * a `Input` y volvería a abrir la pantalla. Si no se puede (el navegador lo rechaza si se soltó hace poco), pausa.
   * Sin guardia contra pulsaciones repetidas: pedirlo otra vez es inocuo, y donde `requestPointerLock` no devuelve
   * promesa un fallo no avisa y la pantalla debe seguir respondiendo.
   */
  closeInventory() {
    if (this.state !== 'inventory') return
    this.sound.unlock()
    void this.input.requestLock().then((ok) => {
      if (ok || this.state !== 'inventory') return
      this.setState('paused')
      this.retrying = true
      this.hud.showOverlay('retry', this.net !== null)
    })
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
    if (this.state === 'menu' && !this.menuClickStarts && !this.retrying) return
    // En red no se llega a `dead` (el muerto es espectador); por si acaso, la isla no se reinicia desde aquí.
    if (this.state === 'dead') {
      if (this.net) return
      this.restart()
    }
    await this.play()
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
      if (net.generation !== this.netGeneration) this.reconnected(net)
      // El reloj de red dice cuántos ticks predecir (0 en pausa: está suspendida).
      for (let i = 0, n = net.advance(); i < n && inGame(this.state); i++) this.step()
      net.flush()
      const { own, remote } = net.render()
      if (own.some((e) => e.type === 'worldReset')) {
        this.resetViews()
        this.gameOverDay = null
      }
      this.present(own)
      this.present(remote, false)
      this.presentRemote(net, remote)
      for (const notice of net.client.takeNotices()) {
        if (notice.type === 'chat') this.hud.net.chat(notice.id, notice.name, notice.text)
        else this.hud.net.notice(noticeText(notice))
      }
      // Muerto, mira a los demás hasta que el servidor dice (en `you`) que ha reaparecido.
      if (this.state === 'playing' && !this.slot.alive) this.setState('spectating')
      else if (this.state === 'spectating' && this.slot.alive) this.setState('playing')
      // Muerto con el inventario abierto: a pausa, para no quedarse de espectador sin ratón ni overlay. El clic en el
      // overlay lo recaptura, pasa a jugar y el frame siguiente a espectador.
      else if (this.state === 'inventory' && !this.slot.alive) this.setState('paused')
      this.render(net.alpha, dt, time)
      return
    }

    // Con el inventario abierto la isla sigue: solo se para en el menú, en pausa o muerto.
    if (inGame(this.state) && !this.manualClock) {
      this.acc += dt
      let steps = 0
      while (this.acc >= STEP && steps < MAX_STEPS_PER_FRAME && inGame(this.state)) {
        this.step()
        this.acc -= STEP
        steps++
      }
      if (steps === MAX_STEPS_PER_FRAME) this.acc = Math.min(this.acc, STEP)
    }

    this.render(inGame(this.state) && !this.manualClock ? this.acc / STEP : 1, dt, time)
  }

  /** Un paso fijo: manda el movimiento y las acciones a la sesión y presenta lo que ha pasado. */
  private step() {
    if (this.state === 'spectating') return this.spectatorStep()
    const { yaw, pitch } = this.look
    const { inventory, player } = this.slot
    // Solo se mandan los `craft` que la predicción da por buenos, con la posición con la que se aplicarán y las
    // estaciones a algo menos de alcance que en la simulación.
    const sendable = (actions: readonly ActionData[]) => sendableActions(actions, inventory, this.craftWorld, player.pos)
    let events: readonly SimEvent[]
    if (this.state === 'inventory') {
      // Quieto (el `Move` sirve de keepalive) y solo con lo que manda la pantalla (o `__debug`).
      events = this.session.step({ buttons: 0, yaw, pitch }, sendable(this.queued.splice(0)))
    } else {
      const input = this.inputOverride ? { ...NO_INPUT, ...this.inputOverride } : this.input.state()
      const presses = this.input.takePresses()
      const { actions, inventory: openInventory } = stepActions(this.queued.splice(0), {
        presses,
        wheel: this.input.takeWheel(),
        selected: inventory.selected,
        slots: inventory.slots,
        clickSwings: this.attackOverride === null,
      })
      // El chat no se abre a la vez que el inventario.
      if (!openInventory) this.chatKey(presses)
      const attack = this.attackOverride ?? this.input.attackHeld
      events = this.session.step({ buttons: inputButtons(input, attack), yaw, pitch }, sendable(actions))
      if (openInventory) this.openInventory(openInventory)
    }
    this.snapPlayer = false
    const { sim, slot } = this
    // Una vez por tick real (en red, por tick predicho; nunca al re-simular).
    this.audio.step(STEP, slot.player, sim.enemies.list)
    this.present(events)
  }

  /** Muerto en una sala: quieto y sin acciones (el `Move` sirve de keepalive); Tab cambia a quién se mira. */
  private spectatorStep() {
    const presses = this.input.takePresses()
    this.input.takeWheel()
    this.queued.length = 0
    this.chatKey(presses)
    if (presses.has('Tab')) this.spectateNext()
    const { yaw, pitch } = this.look
    this.session.step({ buttons: 0, yaw, pitch }, [])
  }

  /** En una sala, Enter abre el chat: lo que se teclee no llega al juego hasta cerrarlo (Enter o Esc). */
  private chatKey(presses: ReadonlySet<string>) {
    if (!this.net || !(presses.has('Enter') || presses.has('NumpadEnter'))) return
    this.input.clear()
    this.hud.net.openChat()
  }

  /** Los compañeros vivos a los que se puede mirar, por id. */
  private watchable(net: NetSession): Shown<RemotePlayer>[] {
    return net.client.shownPlayers.filter((p) => p.data.alive).sort((a, b) => a.id - b.id)
  }

  /** A quién mira el espectador: el mismo mientras siga vivo y, si no, el primero. */
  private watched(net: NetSession): Shown<RemotePlayer> | null {
    const alive = this.watchable(net)
    const target = alive.find((p) => p.id === this.spectated) ?? alive[0] ?? null
    if (target?.id !== this.spectated) this.snapSpectator = true
    this.spectated = target?.id ?? null
    return target
  }

  private spectateNext() {
    const { net } = this
    if (!net) return
    const alive = this.watchable(net)
    if (alive.length < 2) return
    const i = alive.findIndex((p) => p.id === this.spectated)
    this.spectated = alive[(i + 1) % alive.length].id
    this.snapSpectator = true
  }

  /** Se cortó y se ha vuelto a entrar: otro cliente, otro jugador predicho y la isla como la cuenta el servidor. */
  private reconnected(net: NetSession) {
    this.netGeneration = net.generation
    this.bindInventory()
    this.propView = this.buildPropView(this.propView)
    this.resetViews()
    this.worldVersion = -1
    this.snapPlayer = true
    this.gameOverDay = null
    this.hud.net.notice('Conexión recuperada')
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
          this.swingAtProp(e)
          break
        case 'playerPlaced':
          if (e.id === slot.id) this.handheld.play('place', e.item)
          break
        case 'playerAte':
          // Se come aunque se tenga otra cosa en la mano: la animación se hace con una baya.
          if (e.id === slot.id) this.handheld.play('eat', 'berry')
          break
        case 'playerDied':
          // En una sala el muerto pasa a espectador cuando lo dice su `you` (ver frame).
          if (e.id === slot.id && !this.net) this.die()
          break
        case 'gameOver':
          this.gameOverDay = e.day
          break
        case 'gameOverCancelled':
          this.gameOverDay = null
          break
      }
    }
  }

  /**
   * Un golpe a un prop que no le hace nada (sin la herramienta que pide) no tiene evento propio: el cliente lo
   * decide con el objeto del golpe y el tipo del prop. Tiembla igual y, si es propio, se avisa de qué hace falta.
   */
  private swingAtProp(e: Extract<SimEvent, { type: 'playerSwing' }>) {
    if (e.target?.kind !== 'prop') return
    const prop = this.sim.world.props[e.target.id]
    if (!prop?.alive || canDamage(e.item, prop.kind)) return
    this.propView.wobble(prop.id)
    const need = e.id === this.slot.id && missingTool(e.item, prop.kind)
    if (need) this.toolWarning = { text: `Necesitas ${need}`, left: TOOL_WARNING_TIME }
  }

  /** Lo que hacen los demás, ya en el tick de render: suena donde pasa, y su muerte se avisa. */
  private presentRemote(net: NetSession, events: readonly SimEvent[]) {
    if (!events.length) return
    const { sim } = this
    const shown = net.client.shownPlayers
    const playerAt = (id: number) => shown.find((p) => p.id === id)?.pose ?? null
    const locate = (e: SimEvent): { x: number; z: number } | null => {
      switch (e.type) {
        case 'propDestroyed':
          return sim.world.props[e.id]
        case 'structurePlaced':
          return e
        case 'enemyDied':
          return sim.enemies.list.find((en) => en.id === e.id)?.pos ?? playerAt(e.by)
        case 'playerSwing':
        case 'playerHurt':
        case 'playerDied':
        case 'playerAte':
        case 'playerCrafted':
          return playerAt(e.id)
        default:
          return null
      }
    }
    this.audio.remote(events, this.listener(), locate, (id) => sim.world.props[id].kind)
    for (const e of events) if (e.type === 'playerDied' && e.id !== net.me) this.hud.net.notice(`${this.nameOf(net, e.id)} ha muerto`)
  }

  private listener() {
    return { x: this.renderPos.x, z: this.renderPos.z, yaw: this.look.yaw }
  }

  private nameOf(net: NetSession, id: number): string {
    return net.client.names.get(id) || `Jugador ${id + 1}`
  }

  /** En una sala: conexión, lista de jugadores, nombres sobre los demás y sus pasos. */
  private renderNet(net: NetSession) {
    const { hud, slot } = this
    const shown = net.client.shownPlayers
    const rtt = Math.round(net.client.clock.rtt)
    if (net.closed) hud.net.setStatus('lost', net.closeReason ?? 'Sin conexión con el servidor.')
    else if (net.status === 'reconnecting') hud.net.setStatus('connecting', `Sala ${net.room} · ${net.waitReason ?? 'reconectando…'}`)
    else hud.net.setStatus('online', `Sala ${net.room}${rtt > 0 ? ` · ${rtt} ms` : ''}`)
    hud.net.setBanner(this.banner(net))

    const rows: PlayerRow[] = [
      {
        id: net.me,
        name: net.name || 'Jugador',
        health: slot.player.health,
        maxHealth: HEALTH_MAX,
        ping: rtt,
        absent: !inGame(this.state) && slot.alive,
        alive: slot.alive,
        me: true,
      },
    ]
    for (const { id, data } of [...shown].sort((a, b) => a.id - b.id)) {
      rows.push({ id, name: this.nameOf(net, id), health: data.health, maxHealth: HEALTH_MAX, ping: data.ping, absent: data.connection === 'absent', alive: data.alive, me: false })
    }
    hud.net.setPlayers(rows)

    const { camera, projected } = this
    camera.updateMatrixWorld()
    const tags = pickNameTags(
      shown.map(({ id, pose }) => ({ id, name: this.nameOf(net, id), x: pose.x, y: pose.y + NAME_HEIGHT, z: pose.z })),
      camera.position,
      (x, y, z) => projected.set(x, y, z).project(camera),
      window.innerWidth,
      window.innerHeight,
    )
    hud.net.setNames(inGame(this.state) ? tags : [])

    this.audio.remoteSteps(
      shown.map(({ id, pose, data }) => {
        const ground = heightAt(pose.x, pose.z)
        return { id, x: pose.x, z: pose.z, grounded: pose.y - ground < REMOTE_GROUNDED, inWater: ground < WATER_LEVEL, alive: data.alive }
      }),
      this.listener(),
    )
  }

  /** "Has muerto" con la cuenta atrás y a quién se mira, o "Game over" con todos muertos. */
  private banner(net: NetSession): { title: string; detail: string } | null {
    if (this.gameOverDay !== null) return { title: 'Game over', detail: `Habéis llegado al día ${this.gameOverDay}. La isla se reinicia…` }
    if (this.state !== 'spectating') return null
    const { respawnAt } = this.slot
    const left = respawnAt === null ? 0 : Math.max(0, Math.ceil((respawnAt - net.client.clock.serverTick(performance.now())) * STEP))
    const parts = [left > 0 ? `Reapareces en ${left} s` : 'Reapareciendo…']
    const watched = this.spectated === null ? null : this.nameOf(net, this.spectated)
    if (watched) parts.push(this.watchable(net).length > 1 ? `Viendo a ${watched} (Tab: cambiar)` : `Viendo a ${watched}`)
    else parts.push('No queda nadie en pie')
    return { title: 'Has muerto', detail: parts.join(' · ') }
  }

  /** El HUD sigue el inventario del jugador de la sesión actual. */
  private bindInventory() {
    const { inventory } = this.slot
    this.hud.setInventory(inventory)
    inventory.onChange(() => {
      if (inventory === this.slot.inventory) this.hud.setInventory(inventory)
    })
  }

  /**
   * Una vista de los props nueva, con las colocaciones de la sesión actual, en lugar de la anterior. En red son las
   * del servidor: las locales no valen, porque `heightAt` difiere en los últimos bits entre motores (la `y` siempre, y
   * con props cerca de un umbral, hasta qué prop lleva cada id). Por eso no se compara: se rehace siempre.
   */
  private buildPropView(old: PropView | null): PropView {
    const view = new PropView(this.sim.world.placements)
    if (old) {
      this.scene.remove(old.group)
      old.dispose()
    }
    this.scene.add(view.group)
    return view
  }

  /** Vistas como la isla recién generada, sin enemigos, objetos, estructuras ni otros jugadores. */
  private resetViews() {
    this.propView.reset()
    this.enemyView.reset()
    this.pickupView.reset()
    this.structureView.reset()
    this.remotePlayers.reset()
    this.audio.reset()
    this.toolWarning.left = 0
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
    const { sim, slot, net } = this
    const { structures, enemies } = sim
    const p = slot.player
    // Espectador: la cámara (y el minimapa, las sombras y el oído) siguen al compañero al que mira.
    const watched = net && this.state === 'spectating' ? this.watched(net) : null
    const look = watched ? { yaw: this.spectatorYaw, pitch: 0 } : this.look
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
    if (watched) this.placeSpectatorCamera(watched.pose, dt)
    else this.placeCamera(this.renderPos)
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
    this.structureView.update(time, sim.clock.phase, this.renderPos, structures.list)
    const placing = this.state === 'playing' ? placeableOf(slot.inventory.selectedItem) : null
    const spot = placing ? structureSpot(this.renderPos, look.yaw, placing.radius, [sim.world.grid, structures.grid], this.spot) : null
    this.structureView.setGhost(placing && spot && { kind: placing.kind, spot, yaw: look.yaw })

    this.hud.setHealth(p.health, HEALTH_MAX)
    this.hud.setHunger(p.hunger, HUNGER_MAX)
    this.hud.setStamina(p.stamina, STAMINA_MAX, p.exhausted)
    this.toolWarning.left = Math.max(0, this.toolWarning.left - dt)
    if (net?.closed) this.hud.setPrompt('Sin conexión con el servidor')
    else if (net?.status === 'reconnecting') this.hud.setPrompt(net.waitReason ?? 'Reconectando…')
    else if (this.state === 'spectating' || this.state === 'inventory') this.hud.setPrompt('')
    else if (this.toolWarning.left > 0) this.hud.setPrompt(this.toolWarning.text)
    else if (placing && spot) this.hud.setPrompt(spot.valid ? PLACE_PROMPT[placing.kind] : 'No se puede colocar aquí')
    else if (slot.inventoryFull && !slot.target) this.hud.setPrompt('Inventario lleno')
    else this.hud.setTarget(slot.target, slot.inventory.selectedItem)
    if (this.state === 'inventory') this.hud.inventory.updateRecipes(this.craftWorld, p.pos)
    this.hud.setDay(sim.clock.day)
    this.hud.minimap.draw({
      x: this.renderPos.x,
      z: this.renderPos.z,
      yaw: look.yaw,
      structures: structures.list,
      enemies: enemies.list,
      players: net?.client.shownPlayers.map(({ id, pose, data }) => ({ x: pose.x, z: pose.z, yaw: pose.yaw, color: playerCss(id), alive: data.alive })),
    })
    if (net) this.renderNet(net)
    this.updateAmbient(dt)

    this.handheld.setItem(slot.inventory.selectedItem)
    this.handheld.update(dt, Math.hypot(p.vel.x, p.vel.z), p.grounded, this.sky)
    this.renderer.clear()
    this.renderer.render(this.scene, this.camera)
    // La mano no se dibuja muerto ni bajo la pantalla de inventario.
    if (this.state !== 'dead' && this.state !== 'spectating' && this.state !== 'inventory') this.handheld.render(this.renderer)
  }

  /** Detrás y por encima del compañero, girando con él poco a poco; nunca bajo el suelo ni bajo el agua. */
  private placeSpectatorCamera(pose: { x: number; y: number; z: number; yaw: number }, dt: number) {
    if (this.snapSpectator) this.spectatorYaw = pose.yaw
    else this.spectatorYaw += (euclideanModulo(pose.yaw - this.spectatorYaw + Math.PI, 2 * Math.PI) - Math.PI) * (1 - Math.exp(-dt * SPECTATOR_TURN))
    this.snapSpectator = false
    const yaw = this.spectatorYaw
    const x = pose.x + Math.sin(yaw) * SPECTATOR_BACK
    const z = pose.z + Math.cos(yaw) * SPECTATOR_BACK
    const y = Math.max(pose.y + EYE_HEIGHT + SPECTATOR_UP, heightAt(x, z) + 0.6, WATER_LEVEL + 0.6)
    this.renderPos.x = pose.x
    this.renderPos.y = pose.y
    this.renderPos.z = pose.z
    this.camera.position.set(x, y, z)
    this.camera.lookAt(pose.x, pose.y + EYE_HEIGHT, pose.z)
  }

  private updateAmbient(dt: number) {
    const { sim } = this
    let nearest = Infinity
    for (const s of sim.structures.list) {
      if (s.kind === 'campfire') nearest = Math.min(nearest, Math.hypot(s.x - this.renderPos.x, s.z - this.renderPos.z))
    }
    // En una sala el mundo sigue en pausa, y su ambiente también. Con el inventario abierto también sigue.
    const online = this.net !== null && !this.net.closed
    this.sound.update(dt, {
      active: inGame(this.state) || online,
      night: 1 - THREE.MathUtils.smoothstep(sunDirection(sim.clock.phase, this.sun).y, -0.1, 0.25),
      campfire: Math.max(0, 1 - nearest / CAMPFIRE_HEARING),
    })
  }
}

function noticeText(notice: Exclude<Notice, { type: 'chat' }>): string {
  switch (notice.type) {
    case 'join':
      return `${notice.name} se ha unido`
    case 'leave':
      return `${notice.name} se ha ido`
    case 'islandReset':
      return 'La isla se ha reiniciado por una actualización'
  }
}
