import * as THREE from 'three'
import { createScene, updateSky, type Sky } from '../scene'
import { Hud } from '../ui/hud'
import { DayClock } from '../world/daycycle'
import { heightAt, SAND_LEVEL, ROCK_LEVEL, WATER_LEVEL } from '../world/terrain'
import { resolveCircle } from './collision'
import {
  EYE_HEIGHT,
  HEALTH_MAX,
  MAX_FRAME_DT,
  MAX_STEPS_PER_FRAME,
  MOUSE_SENSITIVITY,
  PLAYER_RADIUS,
  STAMINA_MAX,
  STEP,
} from './constants'
import { Input } from './input'
import { Interaction } from './interaction'
import { Inventory } from './inventory'
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

export type GameState = 'menu' | 'playing' | 'paused'

const SHADOW_LOOK_AHEAD = 25
const SPAWN_CLEARANCE = 3

export class Game {
  readonly renderer: THREE.WebGLRenderer
  readonly camera: THREE.PerspectiveCamera
  readonly scene: THREE.Scene
  readonly world: ReturnType<typeof createScene>['world']
  readonly inventory = new Inventory()
  readonly interaction: Interaction
  readonly player: Player
  readonly env: PlayerEnv
  readonly hud: Hud
  readonly input: Input
  readonly clock = new DayClock()

  state: GameState = 'menu'
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
    this.interaction = new Interaction(world, this.inventory)

    this.env = {
      heightAt,
      collide: (pos) => resolveCircle(pos, PLAYER_RADIUS, world.grid),
    }
    const spawn = this.findSpawn()
    this.player = createPlayer(this.env, spawn.x, spawn.z)

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

  teleport(x: number, z: number, yaw = this.player.yaw, pitch = this.player.pitch) {
    teleportPlayer(this.player, this.env, x, z, yaw)
    this.player.pitch = pitch
    this.acc = 0
    this.placeCamera(this.player.pos)
  }

  /** Ejecuta pasos fijos de forma síncrona y renderiza un frame (debug y pruebas). */
  advance(seconds: number) {
    const steps = Math.round(seconds / STEP)
    for (let i = 0; i < steps; i++) this.step()
    this.acc = 0
    this.render(1, seconds, performance.now())
  }

  private async onOverlayClick() {
    if (this.state === 'playing') return
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
      while (this.acc >= STEP && steps < MAX_STEPS_PER_FRAME) {
        this.step()
        this.acc -= STEP
        steps++
      }
      if (steps === MAX_STEPS_PER_FRAME) this.acc = Math.min(this.acc, STEP)
    }

    this.render(this.state === 'playing' && !this.manualClock ? this.acc / STEP : 1, dt, time)
  }

  private step() {
    const input = this.inputOverride ? { ...NO_INPUT, ...this.inputOverride } : this.input.state()
    stepPlayer(this.player, input, this.env, STEP)
    this.clock.step(STEP)
    // Raycast desde la posición simulada (no interpolada): golpear no depende del framerate.
    this.placeCamera(this.player.pos)
    this.camera.updateMatrixWorld()
    this.interaction.updateTarget(this.camera)
    this.interaction.step(STEP, this.attackOverride ?? this.input.attackHeld)
  }

  private placeCamera(pos: { x: number; y: number; z: number }) {
    this.camera.position.set(pos.x, pos.y + EYE_HEIGHT, pos.z)
    this.camera.rotation.set(this.player.pitch, this.player.yaw, 0)
  }

  private render(alpha: number, dt: number, time: number) {
    const p = this.player
    this.placeCamera(interpolate(p, alpha, this.renderPos))
    this.interaction.updateAnimations(dt)

    this.water.position.y = WATER_LEVEL + Math.sin(time * 0.0008) * 0.08

    // Las sombras se centran por delante del jugador según el yaw (no depende del pitch).
    this.shadowCenter.set(
      this.renderPos.x - Math.sin(p.yaw) * SHADOW_LOOK_AHEAD,
      this.renderPos.y,
      this.renderPos.z - Math.cos(p.yaw) * SHADOW_LOOK_AHEAD,
    )
    updateSky(this.sky, this.clock.phase, this.shadowCenter)

    this.hud.setHealth(HEALTH_MAX, HEALTH_MAX)
    this.hud.setStamina(p.stamina, STAMINA_MAX, p.exhausted)
    this.hud.setTarget(this.interaction.target)
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
