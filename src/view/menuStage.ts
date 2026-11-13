import * as THREE from 'three'
import type { Collider, SpatialGrid } from '../sim/collision'
import type { Terrain } from '../sim/world/terrain'
import { MAX_SLOPE, WATER_LEVEL } from '../sim/world/terrain'
import type { CharacterRig } from './CharacterRig'
import type { LoadCharacter } from './characters'

/** Distancia de la cámara al personaje, en metros. */
export const ORBIT_RADIUS = 4.6
/** Altura de la cámara sobre los pies del personaje. */
const ORBIT_HEIGHT = 1.9
/** Adónde mira la cámara: un poco por debajo del pecho, para que se vea entero con algo de cielo. */
const FOCUS_HEIGHT = 1.05
/** Radianes por segundo: una vuelta cada dos minutos. */
export const ORBIT_SPEED = 0.05
/** El personaje no mira de frente a la cámara: tres cuartos, girado hacia el mar. */
const POSE_TURN = 0.45
/** Lo mínimo que la cámara queda sobre el suelo y sobre el agua. */
const CAMERA_CLEARANCE = 1.1
/** Por debajo de este ancho el tablón ocupa la pantalla y no queda sitio para el personaje (como en menu.css). */
export const NARROW_WIDTH = 900
/** El tablón del menú: a 56 px del borde y 440 de ancho (menu.css). El personaje va en el centro de lo que queda. */
const PANEL_RIGHT = 56 + 440
/** Tras un fallo al descargar el personaje, cuándo se vuelve a intentar. */
const RETRY_MS = 10_000
const DIRECTIONS = 24
const MAX_REACH = 160
/** Tierra cerca de la orilla: ni en el agua ni en la ladera de un monte. */
const MIN_HEIGHT = WATER_LEVEL + 0.5
const MAX_HEIGHT = WATER_LEVEL + 6

export interface StageSpot {
  x: number
  y: number
  z: number
  /** Hacia dónde queda el mar desde el personaje (yaw: adelante es (-sin, -cos)). */
  seaYaw: number
}

/** El yaw que mira de (fromX, fromZ) a (toX, toZ), con adelante (-sin(yaw), -cos(yaw)). */
export const yawTowards = (fromX: number, fromZ: number, toX: number, toZ: number) => Math.atan2(-(toX - fromX), -(toZ - fromZ))

/**
 * Dónde se pone el personaje del menú: en tierra, cerca de la orilla más próxima al punto de aparición (así detrás
 * se ve el mar al girar), sin árboles ni rocas en el círculo de la cámara. Sin ningún sitio así, el propio spawn.
 */
export function stageSpot(terrain: Pick<Terrain, 'heightAt' | 'slopeAt'>, props: SpatialGrid<Collider> | null, spawn: { x: number; z: number }): StageSpot {
  let best: (StageSpot & { score: number }) | null = null
  for (let i = 0; i < DIRECTIONS; i++) {
    const angle = (i / DIRECTIONS) * Math.PI * 2
    const dx = Math.cos(angle)
    const dz = Math.sin(angle)
    let coast = -1
    for (let r = 0; r <= MAX_REACH; r++) {
      if (terrain.heightAt(spawn.x + dx * r, spawn.z + dz * r) < WATER_LEVEL) {
        coast = r
        break
      }
    }
    if (coast < 0) continue
    for (let back = 4; back <= 16; back += 2) {
      const r = coast - back
      if (r < 0) break
      const x = spawn.x + dx * r
      const z = spawn.z + dz * r
      const y = terrain.heightAt(x, z)
      if (y < MIN_HEIGHT || y > MAX_HEIGHT || terrain.slopeAt(x, z) > MAX_SLOPE * 0.6) continue
      if (props && blocked(props, x, z, ORBIT_RADIUS + 1.5)) continue
      // Lo más cerca posible del spawn (es la isla que se va a jugar), y mejor sin alejarse mucho de la orilla.
      const score = r + back * 0.5
      if (!best || score < best.score) best = { x, y, z, seaYaw: yawTowards(x, z, x + dx, z + dz), score }
      break
    }
  }
  if (best) return { x: best.x, y: best.y, z: best.z, seaYaw: best.seaYaw }
  return { x: spawn.x, y: Math.max(terrain.heightAt(spawn.x, spawn.z), WATER_LEVEL), z: spawn.z, seaYaw: 0 }
}

function blocked(props: SpatialGrid<Collider>, x: number, z: number, radius: number) {
  for (const prop of props.query(x, z, radius + props.maxRadius)) {
    if (prop.alive && Math.hypot(prop.x - x, prop.z - z) - prop.radius < radius) return true
  }
  return false
}

/** Dónde cae el personaje en la pantalla, de -1 (izquierda) a 1 (derecha): en el centro de lo que deja el tablón. */
export function stageScreenX(width: number): number {
  if (width < NARROW_WIDTH) return 0
  return (PANEL_RIGHT + width) / width - 1
}

/**
 * La cámara del menú: gira alrededor del personaje (`angle`) a una distancia y altura fijas, nunca bajo el suelo ni
 * bajo el agua, y se tuerce lo justo para que el personaje caiga en `screenX` de la pantalla.
 */
export function orbitCamera(
  spot: StageSpot,
  angle: number,
  heightAt: (x: number, z: number) => number,
  fov: number,
  aspect: number,
  screenX: number,
): { x: number; y: number; z: number; yaw: number; pitch: number } {
  const x = spot.x + Math.sin(angle) * ORBIT_RADIUS
  const z = spot.z + Math.cos(angle) * ORBIT_RADIUS
  const y = Math.max(spot.y + ORBIT_HEIGHT, heightAt(x, z) + CAMERA_CLEARANCE, WATER_LEVEL + CAMERA_CLEARANCE)
  const halfWidth = Math.tan(THREE.MathUtils.degToRad(fov) / 2) * aspect
  // Girar a la izquierda (más yaw) lleva el personaje a la derecha de la pantalla.
  const yaw = yawTowards(x, z, spot.x, spot.z) + Math.atan(screenX * halfWidth)
  const pitch = Math.atan2(spot.y + FOCUS_HEIGHT - y, ORBIT_RADIUS)
  return { x, y, z, yaw, pitch }
}

/** El yaw del personaje: tres cuartos hacia la cámara, girado hacia el lado del mar. */
export function poseYaw(spot: StageSpot, cameraX: number, cameraZ: number): number {
  const toCamera = yawTowards(spot.x, spot.z, cameraX, cameraZ)
  const sea = Math.sin(spot.seaYaw - toCamera) >= 0 ? 1 : -1
  return toCamera + sea * POSE_TURN
}

/**
 * El fondo del menú (§3.3 del plan del menú): el personaje de pie en la isla, cerca de la orilla, y la cámara que
 * gira despacio a su alrededor. Vive en la escena principal: sin un segundo WebGLRenderer. El personaje se anima con
 * su propio `dt`, sin la simulación, y solo se descarga la primera vez que se ve el menú.
 */
export class MenuStage {
  readonly group = new THREE.Group()
  private spot: StageSpot | null = null
  private terrain: Pick<Terrain, 'heightAt' | 'slopeAt'> | null = null
  private angle = 0
  private rig: CharacterRig | null = null
  private loading: number | null = null
  private reducedMotion: MediaQueryList | null = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null

  constructor(
    private load: LoadCharacter,
    private skin: () => number,
  ) {
    this.group.visible = false
  }

  /** Dónde está el personaje: cambia con la isla (al entrar en una sala o empezar otra partida). */
  setIsland(terrain: Pick<Terrain, 'heightAt' | 'slopeAt'>, props: SpatialGrid<Collider> | null, spawn: { x: number; z: number }) {
    if (terrain === this.terrain && this.spot) return
    this.terrain = terrain
    this.spot = stageSpot(terrain, props, spawn)
    // Empieza con el mar a la espalda del personaje, de cara a la cámara.
    this.angle = this.spot.seaYaw + Math.PI + 0.6
    this.group.position.set(this.spot.x, this.spot.y, this.spot.z)
  }

  /** El punto en el que se centran las sombras. */
  get center(): StageSpot | null {
    return this.spot
  }

  /** Coloca la cámara y anima al personaje. `false`: aún no hay sitio (no se ha llamado a `setIsland`). */
  place(camera: THREE.PerspectiveCamera, dt: number, width: number): boolean {
    const { spot, terrain } = this
    if (!spot || !terrain) return false
    this.ensureRig()
    // Con el movimiento reducido el encuadre se queda fijo.
    if (!this.reducedMotion?.matches) this.angle += ORBIT_SPEED * dt
    const view = orbitCamera(spot, this.angle, terrain.heightAt, camera.fov, camera.aspect, stageScreenX(width))
    camera.position.set(view.x, view.y, view.z)
    camera.rotation.set(view.pitch, view.yaw, 0)
    // En una ventana estrecha el tablón tapa el centro: el personaje quedaría detrás.
    this.group.visible = width >= NARROW_WIDTH
    if (this.rig) {
      this.rig.object.rotation.y = poseYaw(spot, view.x, view.z)
      this.rig.update(dt, 0, 0, 0, true)
    }
    return true
  }

  /** Fuera del menú no se ve (ni se anima). */
  hide() {
    this.group.visible = false
  }

  private ensureRig() {
    const skin = this.skin()
    if (this.loading === skin) return
    this.loading = skin
    this.load(skin).then(
      (rig) => {
        if (this.loading !== skin) return
        if (this.rig) this.group.remove(this.rig.object)
        this.rig = rig
        this.group.add(rig.object)
      },
      (error) => {
        // Se vuelve a intentar al rato (puede haber sido la conexión); mientras, la isla sola.
        setTimeout(() => {
          if (this.loading === skin) this.loading = null
        }, RETRY_MS)
        console.warn('No se ha podido cargar el personaje del menú', error)
      },
    )
  }
}
