import * as THREE from 'three'
import { createScene, updateSky, type Sky } from '../scene'
import { Hud } from '../ui/hud'
import { DayClock } from '../world/daycycle'
import { heightAt, SAND_LEVEL, ROCK_LEVEL, WATER_LEVEL } from '../world/terrain'
import { Campfires, campfireSpot, type CampfireSpot } from './campfire'
import { resolveCircle } from './collision'
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
} from './constants'
import { craft, RECIPES } from './crafting'
import { Enemies } from './enemies'
import { CLICK, Input, RIGHT_CLICK } from './input'
import { Interaction } from './interaction'
import { Inventory, SLOT_COUNT } from './inventory'
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
} from './player'
import { eat, isDead, stepSurvival } from './survival'

export type GameState = 'menu' | 'playing' | 'paused' | 'dead'

const SHADOW_LOOK_AHEAD = 25
const SPAWN_CLEARANCE = 3

export class Game {
  readonly renderer: THREE.WebGLRenderer
  readonly camera: THREE.PerspectiveCamera
  readonly scene: THREE.Scene
  readonly world: ReturnType<typeof createScene>['world']
  readonly inventory = new Inventory()
  readonly interaction: Interaction
  readonly enemies: Enemies
  readonly player: Player
  readonly env: PlayerEnv
  readonly hud: Hud
  readonly input: Input
  readonly clock = new DayClock()
  readonly campfires: Campfires

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

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    container.appendChild(this.renderer.domElement)

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 600)
    this.camera.rotation.order = 'YXZ'

    const { scene, sky, water, world } = createScene()
    this.scene = scene
    this.sky = sky
    this.water = water
    this.world = world
    this.campfires = new Campfires(scene)
    this.enemies = new Enemies([world.grid, this.campfires.grid])
    scene.add(this.enemies.group)
    this.interaction = new Interaction(world, this.inventory, this.enemies)

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
    this.enemies.reset()
    this.campfires.clear()
    this.clock.reset()
    Object.assign(this.player, createPlayer(this.env, this.spawn.x, this.spawn.z))
    this.acc = 0
    this.placeCamera(this.player.pos)
    if (this.state === 'dead') this.setState('menu')
  }

  setCrafting(open: boolean) {
    this.craftingOpen = open
    this.hud.setCrafting(open)
  }

  /** Fabrica la receta por índice (el de su tecla menos 1). */
  craft(index: number): boolean {
    const recipe = RECIPES[index]
    return recipe ? craft(this.inventory, recipe) : false
  }

  teleport(x: number, z: number, yaw = this.player.yaw, pitch = this.player.pitch) {
    teleportPlayer(this.player, this.env, x, z, yaw)
    this.player.pitch = pitch
    this.acc = 0
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
    if (this.state === 'dead') this.restart()
    const ok = await this.input.requestLock()
    if (!ok) this.hud.showOverlay('retry')
  }

  private frame(time: number) {
    const dt = this.lastTime === null ? 0 : Math.min((time - this.lastTime) / 1000, MAX_FRAME_DT)
    this.lastTime = time

    // El ratón se aplica por frame (a la frecuencia del monitor), no por paso fijo.
    const { dx, dy } = this.input.consumeMouse()
    if (this.state === 'playing') rotatePlayer(this.player, -dx * MOUSE_SENSITIVITY, -dy * MOUSE_SENSITIVITY)

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

  /** C abre o cierra el crafteo; los números eligen casilla o, con el crafteo abierto, fabrican. */
  private handlePresses(presses: ReadonlySet<string>) {
    if (presses.has('KeyC')) this.setCrafting(!this.craftingOpen)
    for (let i = 0; i < SLOT_COUNT; i++) {
      if (!presses.has(`Digit${i + 1}`)) continue
      if (this.craftingOpen) this.craft(i)
      else this.inventory.select(i)
    }
  }

  private step() {
    const input = this.inputOverride ? { ...NO_INPUT, ...this.inputOverride } : this.input.state()
    const presses = this.input.takePresses()
    this.handlePresses(presses)
    stepPlayer(this.player, input, this.env, STEP)
    this.clock.step(STEP)
    const damage = this.enemies.step(STEP, this.player.pos, this.clock.phase, this.clock.day)
    if (damage > 0) {
      this.player.health = Math.max(0, this.player.health - damage)
      this.hud.flashHurt()
    }
    // Raycast desde la posición simulada (no interpolada): golpear no depende del framerate.
    this.placeCamera(this.player.pos)
    this.camera.updateMatrixWorld()
    this.interaction.updateTarget(this.camera)
    // Con la fogata en la mano el clic la coloca en vez de golpear.
    const placing = this.holdingCampfire
    this.interaction.step(STEP, !placing && (this.attackOverride ?? this.input.attackHeld))
    if (placing && presses.has(CLICK)) this.placeCampfire()

    if (presses.has(EAT_KEY) || presses.has(RIGHT_CLICK)) this.eatBerry()
    stepSurvival(this.player, STEP)
    if (isDead(this.player)) this.die()
  }

  private get holdingCampfire() {
    return this.inventory.selectedItem === 'campfire'
  }

  private placeCampfire() {
    const spot = campfireSpot(this.player.pos, this.player.yaw, [this.world.grid, this.campfires.grid], this.spot)
    if (this.campfires.place(spot)) this.inventory.remove('campfire', 1)
  }

  private eatBerry() {
    if (this.inventory.count('berry') > 0 && eat(this.player, BERRY_FOOD)) this.inventory.remove('berry', 1)
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
    this.enemies.place(alpha)
    this.interaction.updateAnimations(dt)

    this.water.position.y = WATER_LEVEL + Math.sin(time * 0.0008) * 0.08

    // Las sombras se centran por delante del jugador según el yaw (no depende del pitch).
    this.shadowCenter.set(
      this.renderPos.x - Math.sin(p.yaw) * SHADOW_LOOK_AHEAD,
      this.renderPos.y,
      this.renderPos.z - Math.cos(p.yaw) * SHADOW_LOOK_AHEAD,
    )
    updateSky(this.sky, this.clock.phase, this.shadowCenter)
    this.campfires.update(time, this.clock.phase, this.renderPos)
    const placing = this.state === 'playing' && this.holdingCampfire
    const spot = placing ? campfireSpot(this.renderPos, p.yaw, [this.world.grid, this.campfires.grid], this.spot) : null
    this.campfires.setGhost(spot)

    this.hud.setHealth(p.health, HEALTH_MAX)
    this.hud.setHunger(p.hunger, HUNGER_MAX)
    this.hud.setStamina(p.stamina, STAMINA_MAX, p.exhausted)
    if (spot) this.hud.setPrompt(spot.valid ? 'Clic para colocar la fogata' : 'No se puede colocar aquí')
    else this.hud.setTarget(this.interaction.target)
    this.hud.setDay(this.clock.day)

    this.renderer.render(this.scene, this.camera)
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
