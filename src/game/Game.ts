import * as THREE from 'three'
import { GameAudio } from '../audio/gameAudio'
import { Sound } from '../audio/sound'
import { createScene, updateSky, type Sky } from '../scene'
import { growBerries, type PropWorld } from '../sim/props'
import type { PropView } from '../view/PropView'
import { EnemyView } from '../view/EnemyView'
import { PickupView } from '../view/PickupView'
import { CampfireView } from '../view/CampfireView'
import { EventLog, LOCAL_PLAYER, type SimEvent } from '../sim/events'
import { Hud } from '../ui/hud'
import { createSettingsPanel } from '../ui/settings'
import { DayClock } from '../sim/world/daycycle'
import { sunDirection } from '../world/daycycle'
import { mulberry32 } from '../sim/random'
import { heightAt, SAND_LEVEL, ROCK_LEVEL, WATER_LEVEL } from '../sim/world/terrain'
import { Campfires, campfireSpot, type CampfireSpot } from '../sim/campfires'
import { resolveCircle } from '../sim/collision'
import {
  BERRY_FOOD,
  EAT_KEY,
  EYE_HEIGHT,
  HEALTH_MAX,
  HUNGER_MAX,
  MAX_FRAME_DT,
  MAX_STEPS_PER_FRAME,
  MOUSE_SENSITIVITY,
  PLAYER_RADIUS,
  STAMINA_MAX,
  STEP,
} from '../sim/constants'
import { craft, RECIPES } from '../sim/crafting'
import { Enemies } from '../sim/enemies'
import { Handheld } from './handheld'
import { attackRequested, CLICK, Input, RIGHT_CLICK } from './input'
import { Interaction } from '../sim/interaction'
import { Inventory, SLOT_COUNT } from '../sim/inventory'
import { Pickups } from '../sim/pickups'
import { loadSettings, saveSettings, type Settings } from './settings'
import {
  createPlayer,
  interpolate,
  NO_INPUT,
  resetInterpolation,
  rotatePlayer,
  stepPlayer,
  teleportPlayer,
  type Player,
  type PlayerEnv,
  type PlayerInput,
} from '../sim/player'
import { eat, isDead, stepSurvival } from '../sim/survival'

export type GameState = 'menu' | 'playing' | 'paused' | 'dead'

const SHADOW_LOOK_AHEAD = 25
const SPAWN_CLEARANCE = 3
// Distancia a la que deja de oírse una fogata.
const CAMPFIRE_HEARING = 14

/** Semilla nueva para cada partida: la isla es fija, pero enemigos y objetos que caen varían. */
const randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0]

export class Game {
  readonly renderer: THREE.WebGLRenderer
  readonly camera: THREE.PerspectiveCamera
  readonly scene: THREE.Scene
  readonly world: PropWorld
  readonly propView: PropView
  readonly inventory = new Inventory()
  readonly interaction: Interaction
  readonly enemies: Enemies
  readonly pickups: Pickups
  readonly player: Player
  readonly env: PlayerEnv
  readonly hud: Hud
  readonly input: Input
  readonly clock = new DayClock()
  readonly campfires: Campfires
  readonly enemyView = new EnemyView()
  readonly pickupView = new PickupView()
  readonly campfireView: CampfireView
  readonly settings: Settings = loadSettings()
  readonly sound = new Sound()
  private audio = new GameAudio(this.sound)
  /** Azar de la simulación (enemigos, objetos que caen), con semilla nueva en cada sesión. */
  private rng = mulberry32(randomSeed())
  /** Lo que pasa en cada paso; se presenta (HUD, mano, sonido) al terminar el paso. */
  private events = new EventLog()
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
  private shadowCenter = new THREE.Vector3()
  private spawn: { x: number; z: number }
  private spot: CampfireSpot = { x: 0, y: 0, z: 0, valid: false }
  private sun = new THREE.Vector3()
  /** El jugador está encima de algo que no cabe en la hotbar. */
  private hotbarFull = false

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

    const { scene, sky, water, world, propView } = createScene()
    this.scene = scene
    this.sky = sky
    this.water = water
    this.world = world
    this.propView = propView
    const { emit } = this.events
    this.campfires = new Campfires(emit)
    this.campfireView = new CampfireView(scene)
    this.enemies = new Enemies([world.grid, this.campfires.grid], this.rng, emit)
    this.pickups = new Pickups([world.grid, this.campfires.grid], this.rng, emit)
    scene.add(this.enemyView.group, this.pickupView.group)
    this.interaction = new Interaction(world, this.inventory, this.pickups, this.enemies, emit)

    this.env = {
      heightAt,
      collide: (pos) => {
        const props = resolveCircle(pos, PLAYER_RADIUS, world.grid)
        return resolveCircle(pos, PLAYER_RADIUS, this.campfires.grid) || props
      },
    }
    this.spawn = this.findSpawn()
    this.player = createPlayer(this.env, this.spawn.x, this.spawn.z)

    this.hud = new Hud(container, () => this.onOverlayClick())
    this.hud.setInventory(this.inventory)
    this.inventory.onChange(() => this.hud.setInventory(this.inventory))
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

  setState(state: GameState) {
    if (state === 'playing' && this.state !== 'playing') {
      // Al empezar o reanudar no se interpola desde la posición de antes de la pausa.
      resetInterpolation(this.player)
      this.acc = 0
    }
    if (state !== 'playing') this.input.clear()
    this.state = state
    this.hud.showOverlay(state === 'playing' ? null : state)
  }

  /** Partida nueva: inventario vacío, isla restaurada y jugador en el punto de aparición. */
  restart() {
    this.inventory.clear()
    this.setCrafting(false)
    this.interaction.reset()
    this.propView.reset()
    this.enemies.reset()
    this.enemyView.reset()
    this.pickups.clear()
    this.pickupView.reset()
    this.hotbarFull = false
    this.campfires.clear()
    this.campfireView.reset()
    this.clock.reset()
    this.audio.reset()
    // Lo que quedara por presentar es de la partida anterior.
    this.events.drain()
    Object.assign(this.player, createPlayer(this.env, this.spawn.x, this.spawn.z))
    this.acc = 0
    this.placeCamera(this.player.pos)
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

  /** Fabrica la receta por índice (el de su tecla menos 1). */
  craft(index: number): boolean {
    const recipe = RECIPES[index]
    const ok = recipe ? craft(this.inventory, recipe) : false
    if (ok) this.events.emit({ type: 'playerCrafted', id: LOCAL_PLAYER, recipe: index })
    return ok
  }

  teleport(x: number, z: number, yaw = this.player.yaw, pitch = this.player.pitch) {
    teleportPlayer(this.player, this.env, x, z, yaw)
    this.player.pitch = pitch
    this.acc = 0
    this.audio.reset()
    this.placeCamera(this.player.pos)
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
    if (this.state === 'playing') rotatePlayer(this.player, -dx * sensitivity, -dy * sensitivity)

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
   * C abre o cierra el crafteo; los números eligen casilla o, con el crafteo abierto, fabrican.
   * La rueda mueve la casilla elegida salvo con el crafteo abierto, donde se ignora.
   */
  private handlePresses(presses: ReadonlySet<string>, wheel: number) {
    if (presses.has('KeyC')) this.setCrafting(!this.craftingOpen)
    for (let i = 0; i < SLOT_COUNT; i++) {
      if (!presses.has(`Digit${i + 1}`)) continue
      if (this.craftingOpen) this.craft(i)
      else this.inventory.select(i)
    }
    if (wheel && !this.craftingOpen) this.inventory.cycle(wheel)
  }

  /** Un paso fijo: simula y después presenta lo que ha pasado en él. */
  private step() {
    this.events.tick++
    this.simulate()
    this.present(this.events.drain())
  }

  private simulate() {
    const input = this.inputOverride ? { ...NO_INPUT, ...this.inputOverride } : this.input.state()
    const presses = this.input.takePresses()
    this.handlePresses(presses, this.input.takeWheel())
    stepPlayer(this.player, input, this.env, STEP)
    this.clock.step(STEP)
    const damage = this.enemies.step(STEP, this.player.pos, this.clock.phase, this.clock.day)
    if (damage > 0) {
      this.player.health = Math.max(0, this.player.health - damage)
      this.events.emit({ type: 'playerHurt', id: LOCAL_PLAYER, dmg: damage })
    }
    // Desde la posición simulada (no interpolada): golpear no depende del framerate.
    this.interaction.updateTarget(this.player)
    // Con la fogata en la mano el clic la coloca en vez de golpear.
    const placing = this.holdingCampfire
    growBerries(this.world.props, STEP, this.events.emit)
    this.interaction.step(STEP, !placing && (this.attackOverride ?? attackRequested(this.input.attackHeld, presses)))
    if (placing && presses.has(CLICK)) this.placeCampfire()
    this.hotbarFull = this.pickups.step(STEP, this.player.pos, this.inventory).full

    if (presses.has(EAT_KEY) || presses.has(RIGHT_CLICK)) this.eatBerry()
    stepSurvival(this.player, STEP)
    if (isDead(this.player)) this.events.emit({ type: 'playerDied', id: LOCAL_PLAYER })
  }

  /** Efectos de los eventos de un paso: HUD, mano y sonido. La simulación no los llama directamente. */
  private present(events: readonly SimEvent[]) {
    this.audio.step(STEP, this.player, this.enemies.list)
    this.audio.events(events, LOCAL_PLAYER, (id) => this.world.props[id].kind)
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

  private get holdingCampfire() {
    return this.inventory.selectedItem === 'campfire'
  }

  private placeCampfire() {
    const spot = campfireSpot(this.player.pos, this.player.yaw, [this.world.grid, this.campfires.grid], this.spot)
    if (!this.campfires.place(spot, LOCAL_PLAYER)) return
    this.events.emit({ type: 'playerPlaced', id: LOCAL_PLAYER })
    this.inventory.remove('campfire', 1)
  }

  private eatBerry() {
    if (this.inventory.count('berry') === 0 || !eat(this.player, BERRY_FOOD)) return
    this.inventory.remove('berry', 1)
    this.events.emit({ type: 'playerAte', id: LOCAL_PLAYER })
  }

  private die() {
    this.setState('dead')
    // Con el estado ya en 'dead', perder el ratón no lo cambia a pausa.
    if (this.input.locked) document.exitPointerLock()
  }

  private placeCamera(pos: { x: number; y: number; z: number }) {
    this.camera.position.set(pos.x, pos.y + EYE_HEIGHT, pos.z)
    this.camera.rotation.set(this.player.pitch, this.player.yaw, 0)
  }

  private render(alpha: number, dt: number, time: number) {
    const p = this.player
    this.placeCamera(interpolate(p, alpha, this.renderPos))
    this.enemyView.update(dt, this.enemies.list, alpha)
    this.pickupView.update(this.pickups.list, alpha)
    this.propView.update(dt)

    this.water.position.y = WATER_LEVEL + Math.sin(time * 0.0008) * 0.08

    // Las sombras se centran por delante del jugador según el yaw (no depende del pitch).
    this.shadowCenter.set(
      this.renderPos.x - Math.sin(p.yaw) * SHADOW_LOOK_AHEAD,
      this.renderPos.y,
      this.renderPos.z - Math.cos(p.yaw) * SHADOW_LOOK_AHEAD,
    )
    updateSky(this.sky, this.clock.phase, this.shadowCenter)
    this.campfireView.update(time, this.clock.phase, this.renderPos, this.campfires.list)
    const placing = this.state === 'playing' && this.holdingCampfire
    const spot = placing ? campfireSpot(this.renderPos, p.yaw, [this.world.grid, this.campfires.grid], this.spot) : null
    this.campfireView.setGhost(spot)

    this.hud.setHealth(p.health, HEALTH_MAX)
    this.hud.setHunger(p.hunger, HUNGER_MAX)
    this.hud.setStamina(p.stamina, STAMINA_MAX, p.exhausted)
    if (spot) this.hud.setPrompt(spot.valid ? 'Clic para colocar la fogata' : 'No se puede colocar aquí')
    else if (this.hotbarFull && !this.interaction.target) this.hud.setPrompt('Hotbar llena')
    else this.hud.setTarget(this.interaction.target)
    this.hud.setDay(this.clock.day)
    this.hud.minimap.draw({ x: this.renderPos.x, z: this.renderPos.z, yaw: p.yaw, campfires: this.campfires.list, enemies: this.enemies.list })
    this.updateAmbient(dt)

    this.handheld.setItem(this.inventory.selectedItem)
    this.handheld.update(dt, Math.hypot(p.vel.x, p.vel.z), p.grounded, this.sky)
    this.renderer.clear()
    this.renderer.render(this.scene, this.camera)
    if (this.state !== 'dead') this.handheld.render(this.renderer)
  }

  private updateAmbient(dt: number) {
    let nearest = Infinity
    for (const fire of this.campfires.list) nearest = Math.min(nearest, Math.hypot(fire.x - this.renderPos.x, fire.z - this.renderPos.z))
    this.sound.update(dt, {
      active: this.state === 'playing',
      night: 1 - THREE.MathUtils.smoothstep(sunDirection(this.clock.phase, this.sun).y, -0.1, 0.25),
      campfire: Math.max(0, 1 - nearest / CAMPFIRE_HEARING),
    })
  }

  /** Espiral desde el centro hasta el primer punto con hierba y sin props cerca. */
  private findSpawn() {
    const { grid } = this.world
    const isClear = (x: number, z: number) => {
      for (const prop of grid.query(x, z, SPAWN_CLEARANCE + grid.maxRadius)) {
        if (Math.hypot(prop.x - x, prop.z - z) - prop.radius < SPAWN_CLEARANCE) return false
      }
      return true
    }
    for (let i = 0; i < 4000; i++) {
      const angle = i * 0.5
      const r = angle * 0.4
      const x = Math.cos(angle) * r
      const z = Math.sin(angle) * r
      const h = heightAt(x, z)
      if (h > SAND_LEVEL + 0.3 && h < ROCK_LEVEL && isClear(x, z)) return { x, z }
    }
    return { x: 0, z: 0 }
  }
}
