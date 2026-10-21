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
import { Hud, type OverlayKind } from '../ui/hud'
import { createSettingsPanel } from '../ui/settings'
import { sunDirection } from '../world/daycycle'
import { euclideanModulo } from '../sim/world/daycycle'
import { heightAt, WATER_LEVEL } from '../sim/world/terrain'
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
import type { Notice, RemotePlayer } from '../net/client'
import type { Shown } from '../net/interp'
import { pickNameTags, type PlayerRow } from '../ui/multiplayerHud'
import { playerCss } from '../ui/playerColor'

/** `spectating`: muerto en una sala, mirando a los demás hasta reaparecer (con un jugador, morir es `dead`). */
export type GameState = 'menu' | 'playing' | 'paused' | 'dead' | 'spectating'

/** Se juega (con el ratón capturado): vivo o, en una sala, muerto mirando a los demás. */
const isActive = (state: GameState) => state === 'playing' || state === 'spectating'
const overlayFor = (state: GameState): OverlayKind => (state === 'playing' || state === 'spectating' ? null : state)

const SHADOW_LOOK_AHEAD = 25
// Distancia a la que deja de oírse una fogata.
const CAMPFIRE_HEARING = 14
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
  private spot: CampfireSpot = { x: 0, y: 0, z: 0, valid: false }
  private sun = new THREE.Vector3()
  /** Acciones de `__debug` (select, craft) para el siguiente paso, como si fueran teclas. */
  private queued: ActionData[] = []
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

    const { scene, sky, water, propView } = createScene(this.sim.world.placements)
    this.scene = scene
    this.sky = sky
    this.water = water
    this.propView = propView
    this.campfireView = new CampfireView(scene)
    scene.add(this.enemyView.group, this.pickupView.group, this.remotePlayers.group)
    this.lookFromPlayer()

    this.hud = new Hud(container, () => this.onOverlayClick())
    this.hud.net.onsay = (text) => this.net?.client.say(text)
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
        else if (isActive(this.state)) this.setState('paused')
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
    // El espectador es de la sala que se deja: en la nueva se vuelve a decidir con su `you`.
    if (this.state === 'spectating') this.state = 'playing'
    this.hud.setCrosshair(true)
    this.netGeneration = this.net?.generation ?? 0
    this.gameOverDay = null
    this.lookFromPlayer()
    this.acc = 0
    this.snapPlayer = true
    this.placeCamera(this.slot.player.pos)
    // En el menú o en pausa no predice ni envía: al empezar a jugar pide el estado.
    if (!isActive(this.state)) this.net?.suspend()
    this.hud.net.setVisible(this.net !== null)
    if (this.state !== 'playing') this.hud.showOverlay(overlayFor(this.state), this.net !== null)
    this.onchange?.()
  }

  setState(state: GameState) {
    if (state === 'playing' && this.state !== 'playing') {
      // Al empezar, reanudar o reaparecer no se interpola desde la posición de antes.
      this.snapPlayer = true
      this.acc = 0
      this.retrying = false
    }
    if (state === 'spectating') {
      this.snapSpectator = true
      this.setCrafting(false)
    }
    if (state !== 'playing') this.input.clear()
    if (!isActive(state)) this.hud.net.closeChat()
    this.hud.setCrosshair(state !== 'spectating')
    // En red la pausa es solo local: el jugador pasa a ausente y la partida sigue. El espectador sigue conectado.
    if (isActive(state)) this.net?.wake()
    else this.net?.suspend()
    this.state = state
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
      for (let i = 0, n = net.advance(); i < n && isActive(this.state); i++) this.step()
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
    if (this.state === 'spectating') return this.spectatorStep()
    const input = this.inputOverride ? { ...NO_INPUT, ...this.inputOverride } : this.input.state()
    const presses = this.input.takePresses()
    this.chatKey(presses)
    const actions = this.actions(presses, this.input.takeWheel())
    const attack = this.attackOverride ?? this.input.attackHeld
    const { yaw, pitch } = this.look
    const events = this.session.step({ buttons: inputButtons(input, attack), yaw, pitch }, actions)
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
          break
        case 'playerPlaced':
          if (e.id === slot.id) this.handheld.play('place', 'campfire')
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
        case 'campfirePlaced':
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
    else if (net.status === 'reconnecting') hud.net.setStatus('connecting', `Sala ${net.room} · reconectando…`)
    else hud.net.setStatus('online', `Sala ${net.room}${rtt > 0 ? ` · ${rtt} ms` : ''}`)
    hud.net.setBanner(this.banner(net))

    const rows: PlayerRow[] = [
      {
        id: net.me,
        name: net.name || 'Jugador',
        health: slot.player.health,
        maxHealth: HEALTH_MAX,
        ping: rtt,
        absent: !isActive(this.state) && slot.alive,
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
    hud.net.setNames(isActive(this.state) ? tags : [])

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
    const { sim, slot, net } = this
    const { campfires, enemies } = sim
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
    this.campfireView.update(time, sim.clock.phase, this.renderPos, campfires.list)
    const placing = this.state === 'playing' && slot.inventory.selectedItem === 'campfire'
    const spot = placing ? campfireSpot(this.renderPos, look.yaw, [sim.world.grid, campfires.grid], this.spot) : null
    this.campfireView.setGhost(spot)

    this.hud.setHealth(p.health, HEALTH_MAX)
    this.hud.setHunger(p.hunger, HUNGER_MAX)
    this.hud.setStamina(p.stamina, STAMINA_MAX, p.exhausted)
    if (net?.closed) this.hud.setPrompt('Sin conexión con el servidor')
    else if (net?.status === 'reconnecting') this.hud.setPrompt('Reconectando…')
    else if (this.state === 'spectating') this.hud.setPrompt('')
    else if (spot) this.hud.setPrompt(spot.valid ? 'Clic para colocar la fogata' : 'No se puede colocar aquí')
    else if (slot.hotbarFull && !slot.target) this.hud.setPrompt('Hotbar llena')
    else this.hud.setTarget(slot.target)
    this.hud.setDay(sim.clock.day)
    this.hud.minimap.draw({
      x: this.renderPos.x,
      z: this.renderPos.z,
      yaw: look.yaw,
      campfires: campfires.list,
      enemies: enemies.list,
      players: net?.client.shownPlayers.map(({ id, pose, data }) => ({ x: pose.x, z: pose.z, yaw: pose.yaw, color: playerCss(id), alive: data.alive })),
    })
    if (net) this.renderNet(net)
    this.updateAmbient(dt)

    this.handheld.setItem(slot.inventory.selectedItem)
    this.handheld.update(dt, Math.hypot(p.vel.x, p.vel.z), p.grounded, this.sky)
    this.renderer.clear()
    this.renderer.render(this.scene, this.camera)
    if (this.state !== 'dead' && this.state !== 'spectating') this.handheld.render(this.renderer)
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
    for (const fire of sim.campfires.list) nearest = Math.min(nearest, Math.hypot(fire.x - this.renderPos.x, fire.z - this.renderPos.z))
    // En una sala el mundo sigue en pausa, y su ambiente también.
    const online = this.net !== null && !this.net.closed
    this.sound.update(dt, {
      active: this.state === 'playing' || online,
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
