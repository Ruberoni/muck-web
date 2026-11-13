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
/** Hasta este ancho el tablón ocupa la pantalla y no queda sitio para el personaje (`max-width: 900px` en menu.css). */
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
 * se ve el mar al girar), sin árboles, rocas ni estructuras en el círculo de la cámara. Sin ningún sitio así, el propio spawn.
 */
export function stageSpot(terrain: Pick<Terrain, 'heightAt' | 'slopeAt'>, obstacles: readonly SpatialGrid<Collider>[], spawn: { x: number; z: number }): StageSpot {
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
      if (obstacles.some((grid) => blocked(grid, x, z, CLEAR_RADIUS))) continue
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
  if (width <= NARROW_WIDTH) return 0
  return (PANEL_RIGHT + width) / width - 1
}

/**
 * La cámara del menú: gira alrededor del personaje (`angle`) a una distancia (`radius`) y altura fijas, nunca bajo el suelo ni
 * bajo el agua, y se tuerce lo justo para que el personaje caiga en `screenX` de la pantalla.
 */
export function orbitCamera(
  spot: StageSpot,
  angle: number,
  heightAt: (x: number, z: number) => number,
  fov: number,
  aspect: number,
  screenX: number,
  radius = ORBIT_RADIUS,
): { x: number; y: number; z: number; yaw: number; pitch: number } {
  const x = spot.x + Math.sin(angle) * radius
  const z = spot.z + Math.cos(angle) * radius
  const y = Math.max(spot.y + ORBIT_HEIGHT, heightAt(x, z) + CAMERA_CLEARANCE, WATER_LEVEL + CAMERA_CLEARANCE)
  const halfWidth = Math.tan(THREE.MathUtils.degToRad(fov) / 2) * aspect
  // Girar a la izquierda (más yaw) lleva el personaje a la derecha de la pantalla.
  const yaw = yawTowards(x, z, spot.x, spot.z) + Math.atan(screenX * halfWidth)
  const pitch = Math.atan2(spot.y + FOCUS_HEIGHT - y, radius)
  return { x, y, z, yaw, pitch }
}

/** El yaw del personaje: tres cuartos hacia la cámara, girado hacia el lado del mar. */
export function poseYaw(spot: StageSpot, cameraX: number, cameraZ: number): number {
  const toCamera = yawTowards(spot.x, spot.z, cameraX, cameraZ)
  const sea = Math.sin(spot.seaYaw - toCamera) >= 0 ? 1 : -1
  return toCamera + sea * POSE_TURN
}

/** Quien sale en la fila de la sala: su id, su nombre (en la etiqueta) y su skin. */
export interface StageMember {
  id: number
  name: string
  skin: number
}

/** La etiqueta con el nombre de uno de la fila, en píxeles CSS (el pie de la etiqueta sobre su cabeza). */
export interface StageTag {
  id: number
  name: string
  left: number
  top: number
}

/** Lo que `stageSpot` deja libre alrededor del personaje: la cámara de la fila no se aleja más. */
const CLEAR_RADIUS = ORBIT_RADIUS + 1.5
/** Metros entre los personajes de la fila. */
export const ROW_SPACING = 1.15
/** Lo más juntos que se ponen en una ventana poco ancha. */
const MIN_SPACING = 0.75
/** Medio hombro: lo que asoma el de cada punta más allá de su centro. */
const ROW_MARGIN = 0.5
/** Lo que se balancea la cámara delante de la fila (rad) y cada cuánto (rad/s de la fase). */
const SWAY = 0.12
const SWAY_SPEED = 0.12
/** Dónde va la etiqueta del nombre: algo por encima de la cabeza. */
const TAG_HEIGHT = 2.05
/** El personaje del menú fuera de una sala. */
const SOLO = -1

/**
 * Dónde va cada uno de la fila respecto al centro (x, z), de izquierda a derecha vistos desde una cámara con ese
 * `yaw`: en una línea perpendicular a su mirada, a `spacing` metros uno de otro.
 */
export function rowOffsets(count: number, yaw: number, spacing = ROW_SPACING): { x: number; z: number }[] {
  // Adelante es (-sin, -cos) y la derecha (cos, -sin).
  const right = { x: Math.cos(yaw), z: -Math.sin(yaw) }
  return Array.from({ length: count }, (_, i) => {
    const along = (i - (count - 1) / 2) * spacing
    return { x: right.x * along, z: right.z * along }
  })
}

/**
 * Cómo cabe una fila de `count` en el hueco de la pantalla: la distancia de la cámara (nunca menos que la órbita ni
 * más que el círculo libre de árboles y rocas de `stageSpot`) y, si ni así cabe, la fila más apretada.
 */
export function rowLayout(count: number, fov: number, aspect: number, screenX: number): { radius: number; spacing: number } {
  const halfWidth = Math.tan(THREE.MathUtils.degToRad(fov) / 2) * aspect
  // Lo que queda de pantalla entre el centro de la fila y el borde más cercano, con un poco de aire.
  const room = (1 - Math.abs(screenX)) * 0.6 * halfWidth
  const half = ((count - 1) / 2) * ROW_SPACING + ROW_MARGIN
  const radius = Math.min(CLEAR_RADIUS, Math.max(ORBIT_RADIUS, half / room))
  if (count < 2 || half <= room * radius) return { radius, spacing: ROW_SPACING }
  return { radius, spacing: Math.max(MIN_SPACING, ((room * radius - ROW_MARGIN) * 2) / (count - 1)) }
}

interface Actor {
  member: StageMember
  rig: CharacterRig | null
  state: 'idle' | 'loading' | 'failed'
}

/**
 * El fondo del menú (§3.3 del plan del menú): el personaje de pie en la isla, cerca de la orilla, y la cámara que
 * gira despacio a su alrededor. En la sala (`setCast`), todos los de la sala en fila, de cara a la cámara, que se
 * balancea un poco delante de ellos en lugar de girar. Vive en la escena principal: sin un segundo WebGLRenderer.
 * Los personajes se animan con su propio `dt`, sin la simulación, y solo se descargan la primera vez que se ven.
 */
export class MenuStage {
  readonly group = new THREE.Group()
  private spot: StageSpot | null = null
  private terrain: Pick<Terrain, 'heightAt' | 'slopeAt'> | null = null
  private angle = 0
  private actors = new Map<number, Actor>()
  private cast: readonly StageMember[] | null = null
  /** En la sala: el ángulo de la cámara al entrar (la fila se pone de cara a él) y la fase del balanceo. */
  private rowAngle: number | null = null
  private swayTime = 0

  constructor(
    private load: LoadCharacter,
    private skin: () => number,
    /** Con el movimiento reducido (`prefers-reduced-motion`) la cámara no gira. */
    private reducedMotion: () => boolean = systemReducedMotion(),
  ) {
    this.group.visible = false
  }

  /** Dónde está el personaje: cambia con la isla (al entrar en una sala o empezar otra partida). */
  setIsland(terrain: Pick<Terrain, 'heightAt' | 'slopeAt'>, obstacles: readonly SpatialGrid<Collider>[], spawn: { x: number; z: number }) {
    if (terrain === this.terrain && this.spot) return
    this.terrain = terrain
    this.spot = stageSpot(terrain, obstacles, spawn)
    // Empieza con el mar a la espalda del personaje, de cara a la cámara.
    this.angle = this.spot.seaYaw + Math.PI + 0.6
    this.rowAngle = null
    this.group.position.set(this.spot.x, this.spot.y, this.spot.z)
  }

  /** Los de la sala, en fila (null: fuera de una sala, solo el personaje propio). */
  setCast(cast: readonly StageMember[] | null) {
    this.cast = cast
  }

  /** El punto en el que se centran las sombras. */
  get center(): StageSpot | null {
    return this.spot
  }

  /**
   * Coloca la cámara y anima a los personajes. `false`: aún no hay sitio (no se ha llamado a `setIsland`). Sin
   * `showCharacter` (un tablón más ancho, una tarjeta centrada) la cámara sigue moviéndose pero no se ven.
   */
  place(camera: THREE.PerspectiveCamera, dt: number, width: number, showCharacter = true): boolean {
    const { spot, terrain } = this
    if (!spot || !terrain) return false
    const members = this.cast ?? [{ id: SOLO, name: '', skin: this.skin() }]
    this.syncActors(members)
    const still = this.reducedMotion()
    const screenX = stageScreenX(width)
    let angle: number
    let radius = ORBIT_RADIUS
    let spacing = ROW_SPACING
    if (this.cast) {
      this.rowAngle ??= this.angle
      if (!still) this.swayTime += dt
      // Con el movimiento reducido el encuadre se queda fijo.
      angle = this.rowAngle + (still ? 0 : SWAY * Math.sin(this.swayTime * SWAY_SPEED))
      ;({ radius, spacing } = rowLayout(members.length, camera.fov, camera.aspect, screenX))
    } else {
      // Al salir de la sala la órbita sigue desde donde se quedó la fila.
      if (this.rowAngle !== null) this.angle = this.rowAngle
      this.rowAngle = null
      this.swayTime = 0
      if (!still) this.angle += ORBIT_SPEED * dt
      angle = this.angle
    }
    const view = orbitCamera(spot, angle, terrain.heightAt, camera.fov, camera.aspect, screenX, radius)
    camera.position.set(view.x, view.y, view.z)
    camera.rotation.set(view.pitch, view.yaw, 0)
    // En una ventana estrecha el tablón tapa el centro: los personajes quedarían detrás.
    this.group.visible = showCharacter && width > NARROW_WIDTH
    if (!this.group.visible) return true
    // La fila, perpendicular a la mirada de la cámara sin balanceo: así todos quedan a la misma distancia.
    const offsets = this.cast
      ? rowOffsets(members.length, orbitCamera(spot, this.rowAngle!, terrain.heightAt, camera.fov, camera.aspect, screenX, radius).yaw, spacing)
      : [{ x: 0, z: 0 }]
    members.forEach((member, i) => {
      const rig = this.actors.get(member.id)?.rig
      if (!rig) return
      const { x, z } = offsets[i]!
      rig.object.position.set(x, terrain.heightAt(spot.x + x, spot.z + z) - spot.y, z)
      // En la fila, de frente a la cámara; solo, a tres cuartos y hacia el mar.
      rig.object.rotation.y = this.cast ? yawTowards(spot.x + x, spot.z + z, view.x, view.z) : poseYaw(spot, view.x, view.z)
      rig.update(dt, 0, 0, 0, true)
    })
    return true
  }

  /** Las etiquetas con los nombres de la fila tal como los ve `camera` (vacío fuera de la sala o si no se ve). */
  tags(camera: THREE.Camera, width: number, height: number): StageTag[] {
    if (!this.cast || !this.group.visible) return []
    camera.updateMatrixWorld()
    const tags: StageTag[] = []
    const point = new THREE.Vector3()
    for (const member of this.cast) {
      const rig = this.actors.get(member.id)?.rig
      if (!rig) continue
      point.copy(rig.object.position).add(this.group.position)
      point.y += TAG_HEIGHT
      point.project(camera)
      if (point.z < -1 || point.z > 1) continue
      tags.push({ id: member.id, name: member.name, left: ((point.x + 1) / 2) * width, top: ((1 - point.y) / 2) * height })
    }
    return tags
  }

  /** Fuera del menú no se ve (ni se anima). */
  hide() {
    this.group.visible = false
  }

  /** Descarga a quien falte (o cambie de skin) y quita a quien ya no esté. */
  private syncActors(members: readonly StageMember[]) {
    const wanted = new Set<number>()
    for (const member of members) {
      wanted.add(member.id)
      let actor = this.actors.get(member.id)
      if (actor && actor.member.skin !== member.skin) {
        this.drop(member.id)
        actor = undefined
      }
      if (!actor) {
        actor = { member, rig: null, state: 'idle' }
        this.actors.set(member.id, actor)
      }
      actor.member = member
      if (actor.state === 'idle') this.loadActor(actor)
    }
    for (const id of [...this.actors.keys()]) if (!wanted.has(id)) this.drop(id)
  }

  private drop(id: number) {
    const actor = this.actors.get(id)
    if (actor?.rig) this.group.remove(actor.rig.object)
    this.actors.delete(id)
  }

  private loadActor(actor: Actor) {
    actor.state = 'loading'
    const current = () => this.actors.get(actor.member.id) === actor
    this.load(actor.member.skin).then(
      (rig) => {
        if (!current()) return
        actor.rig = rig
        this.group.add(rig.object)
      },
      (error) => {
        // Se vuelve a intentar al rato (puede haber sido la conexión); mientras, la isla sola.
        actor.state = 'failed'
        setTimeout(() => {
          if (current() && actor.state === 'failed') actor.state = 'idle'
        }, RETRY_MS)
        console.warn('No se ha podido cargar el personaje del menú', error)
      },
    )
  }
}

function systemReducedMotion(): () => boolean {
  const query = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null
  return () => query?.matches ?? false
}
