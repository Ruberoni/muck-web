import { EYE_HEIGHT, REACH } from './constants'
import type { Collider, SpatialGrid } from './collision'
import {
  BUSH_LIFT,
  BUSH_RADIUS,
  BUSH_SQUASH,
  FOLIAGE_BASE,
  FOLIAGE_HEIGHT,
  FOLIAGE_RADIUS,
  FOLIAGE_SIDES,
  ROCK_RADIUS,
  TRUNK_BOTTOM_RADIUS,
  TRUNK_HEIGHT,
  TRUNK_SIDES,
  TRUNK_TOP_RADIUS,
  type PropKind,
  type PropPlacement,
} from './props'
import { heightAt } from './world/terrain'

// Cuerpo del enemigo: un icosaedro estirado sobre el suelo, y el modelo entero escalado.
// Los cuernos, los pies y los ojos son detalles de la vista y no cuentan para apuntar.
export const ENEMY_BODY_RADIUS = 0.5
export const ENEMY_BODY_SCALE = { x: 1, y: 1.25, z: 0.9 }
export const ENEMY_BODY_LIFT = 0.75
// El modelo mide unos 1,4 sin escalar: escalado, los ojos quedan algo por debajo de los del jugador.
export const ENEMY_MODEL_SCALE = 1.25

/** Rayo de puntería: desde los ojos, con dirección unitaria. */
export interface AimRay {
  ox: number
  oy: number
  oz: number
  dx: number
  dy: number
  dz: number
}

/** Rayo desde los ojos del jugador hacia donde mira: el centro de la pantalla, sin necesitar la cámara. */
export function aimRay(
  player: { pos: { x: number; y: number; z: number }; yaw: number; pitch: number },
  out: AimRay = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0 },
): AimRay {
  const { pos, yaw, pitch } = player
  const cosPitch = Math.cos(pitch)
  out.ox = pos.x
  out.oy = pos.y + EYE_HEIGHT
  out.oz = pos.z
  out.dx = -Math.sin(yaw) * cosPitch
  out.dy = Math.sin(pitch)
  out.dz = -Math.cos(yaw) * cosPitch
  return out
}

type Vec = [number, number, number]

/** Poliedro convexo como intersección de semiespacios n·p ≤ d: [nx, ny, nz, d] por cara. */
type Convex = Float64Array

/**
 * Hitbox de un prop o un enemigo: sus piezas convexas en espacio local y la transformación del modelo
 * (posición, giro Euler XYZ sin Z y escala, como un Object3D). Son las mismas caras que los meshes,
 * así que apuntar no cambia respecto al raycast contra la vista; solo se ignoran el wobble y los detalles.
 */
export interface Hitbox {
  x: number
  y: number
  z: number
  cosX: number
  sinX: number
  cosY: number
  sinY: number
  sx: number
  sy: number
  sz: number
  parts: readonly Convex[]
}

export interface PropHitboxes {
  /** Por id de prop. */
  boxes: Hitbox[]
  /** Distancia horizontal máxima desde el centro de un prop hasta el borde de su hitbox. */
  reach: number
}

/** Caras de un convexo dado por sus vértices y triángulos, con las normales hacia fuera. */
function convex(vertices: readonly Vec[], faces: readonly Vec[]): Convex {
  const c = [0, 1, 2].map((k) => vertices.reduce((sum, v) => sum + v[k], 0) / vertices.length)
  const planes = new Float64Array(faces.length * 4)
  faces.forEach(([ia, ib, ic], i) => {
    const [a, b, cc] = [vertices[ia], vertices[ib], vertices[ic]]
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const v = [cc[0] - a[0], cc[1] - a[1], cc[2] - a[2]]
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    const len = Math.hypot(n[0], n[1], n[2])
    n = n.map((x) => x / len)
    if (n[0] * (a[0] - c[0]) + n[1] * (a[1] - c[1]) + n[2] * (a[2] - c[2]) < 0) n = n.map((x) => -x)
    planes.set([n[0], n[1], n[2], n[0] * a[0] + n[1] * a[1] + n[2] * a[2]], i * 4)
  })
  return planes
}

// Los vértices y caras del IcosahedronGeometry de three (detalle 0), en una esfera de radio 1.
const PHI = (1 + Math.sqrt(5)) / 2
const ICOSAHEDRON_VERTICES: Vec[] = (
  [
    [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
    [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
    [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
  ] as Vec[]
).map((v) => v.map((x) => x / Math.hypot(1, PHI)) as Vec)
const ICOSAHEDRON_FACES: Vec[] = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
  [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
  [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
]

/** Icosaedro de radio `r`, escalado y subido como su geometría en la vista. */
function icosahedron(r: number, scale: { x: number; y: number; z: number }, lift: number): Convex {
  const vertices = ICOSAHEDRON_VERTICES.map(([x, y, z]): Vec => [x * r * scale.x, y * r * scale.y + lift, z * r * scale.z])
  return convex(vertices, ICOSAHEDRON_FACES)
}

/** Prisma o pirámide (rTop = 0) truncada de `sides` lados con la base en y0, como el CylinderGeometry de three. */
function frustum(sides: number, rBottom: number, rTop: number, y0: number, h: number): Convex {
  const ring = (r: number, y: number) =>
    Array.from({ length: sides }, (_, i): Vec => [r * Math.sin((i / sides) * Math.PI * 2), y, r * Math.cos((i / sides) * Math.PI * 2)])
  const bottom = ring(rBottom, y0)
  const top = rTop > 0 ? ring(rTop, y0 + h) : [[0, y0 + h, 0] as Vec]
  const vertices = [...bottom, ...top]
  const faces: Vec[] = []
  for (let i = 0; i < sides; i++) faces.push([i, (i + 1) % sides, sides + (rTop > 0 ? i : 0)])
  // Tapas: tres vértices de cada anillo bastan para el plano.
  faces.push([0, 1, 2])
  if (rTop > 0) faces.push([sides, sides + 1, sides + 2])
  return convex(vertices, faces)
}

const SHAPES: Record<PropKind, readonly Convex[]> = {
  tree: [
    frustum(TRUNK_SIDES, TRUNK_BOTTOM_RADIUS, TRUNK_TOP_RADIUS, 0, TRUNK_HEIGHT),
    frustum(FOLIAGE_SIDES, FOLIAGE_RADIUS, 0, FOLIAGE_BASE, FOLIAGE_HEIGHT),
  ],
  rock: [icosahedron(ROCK_RADIUS, { x: 1, y: 1, z: 1 }, 0)],
  bush: [icosahedron(BUSH_RADIUS, { x: 1, y: BUSH_SQUASH, z: 1 }, BUSH_LIFT)],
}
// Radio horizontal de cada forma sin escalar (la inclinación de las rocas es pequeña: se cubre con la escala mayor).
const SHAPE_REACH: Record<PropKind, number> = { tree: FOLIAGE_RADIUS, rock: ROCK_RADIUS, bush: BUSH_RADIUS }
const ENEMY_SHAPE = [icosahedron(ENEMY_BODY_RADIUS, ENEMY_BODY_SCALE, ENEMY_BODY_LIFT)]

/** Hitboxes de los props a partir de sus colocaciones (no cambian durante la partida). */
export function createPropHitboxes(placements: readonly PropPlacement[]): PropHitboxes {
  let reach = 0
  const boxes = placements.map((p): Hitbox => {
    reach = Math.max(reach, SHAPE_REACH[p.kind] * Math.max(p.scaleX, p.scaleY, p.scaleZ))
    return {
      x: p.x,
      y: p.y,
      z: p.z,
      cosX: Math.cos(p.rotX),
      sinX: Math.sin(p.rotX),
      cosY: Math.cos(p.rotY),
      sinY: Math.sin(p.rotY),
      sx: p.scaleX,
      sy: p.scaleY,
      sz: p.scaleZ,
      parts: SHAPES[p.kind],
    }
  })
  return { boxes, reach }
}

/** Hitbox de un enemigo en (x, z) mirando a `yaw`, sobre el suelo: sin el bote al andar ni la embestida. */
export function enemyHitbox(x: number, z: number, yaw: number, out?: Hitbox): Hitbox {
  const s = ENEMY_MODEL_SCALE
  const box = out ?? { x, y: 0, z, cosX: 1, sinX: 0, cosY: 1, sinY: 0, sx: s, sy: s, sz: s, parts: ENEMY_SHAPE }
  box.x = x
  box.y = heightAt(x, z)
  box.z = z
  box.cosY = Math.cos(yaw)
  box.sinY = Math.sin(yaw)
  return box
}

/** Distancia a la que el rayo entra en la hitbox, o Infinity. Desde dentro no la toca (como las caras traseras en three). */
export function rayDistance(ray: AimRay, box: Hitbox): number {
  // Al espacio local: deshacer la posición, el giro (primero X, luego Y) y la escala.
  // El parámetro t del rayo es el mismo en los dos espacios: sigue siendo la distancia en el mundo.
  const o = toLocal(box, ray.ox - box.x, ray.oy - box.y, ray.oz - box.z, LOCAL_O)
  const d = toLocal(box, ray.dx, ray.dy, ray.dz, LOCAL_D)
  let best = Infinity
  for (const planes of box.parts) best = Math.min(best, rayConvex(o, d, planes))
  return best
}

const LOCAL_O: Vec = [0, 0, 0]
const LOCAL_D: Vec = [0, 0, 0]

function toLocal(box: Hitbox, x: number, y: number, z: number, out: Vec): Vec {
  const y1 = y * box.cosX + z * box.sinX
  const z1 = -y * box.sinX + z * box.cosX
  out[0] = (x * box.cosY - z1 * box.sinY) / box.sx
  out[1] = y1 / box.sy
  out[2] = (x * box.sinY + z1 * box.cosY) / box.sz
  return out
}

/** Recorta el rayo con cada semiespacio: entra en el último plano que cruza hacia dentro. */
function rayConvex(o: Vec, d: Vec, planes: Convex): number {
  let enter = 0
  let exit = Infinity
  let entered = false
  for (let i = 0; i < planes.length; i += 4) {
    const nx = planes[i]
    const ny = planes[i + 1]
    const nz = planes[i + 2]
    const gap = planes[i + 3] - (nx * o[0] + ny * o[1] + nz * o[2])
    const along = nx * d[0] + ny * d[1] + nz * d[2]
    if (Math.abs(along) < 1e-12) {
      if (gap < 0) return Infinity
      continue
    }
    const t = gap / along
    if (along < 0) {
      // Fuera de este plano y acercándose: entra en t.
      if (gap < 0) entered = true
      if (t > enter) enter = t
    } else if (t < exit) {
      exit = t
    }
    if (enter > exit) return Infinity
  }
  return entered ? enter : Infinity
}

/**
 * Lo primero que toca el rayo a como mucho `far` metros: un prop vivo o un enemigo vivo.
 * Los muertos no tapan lo que hay detrás.
 */
export function pickTarget<P extends Collider & { id: number }, E extends { alive: boolean; pos: { x: number; z: number }; yaw: number }>(
  ray: AimRay,
  grid: SpatialGrid<P>,
  hitboxes: PropHitboxes,
  enemies: Iterable<E>,
  far = REACH,
): P | E | null {
  let best: P | E | null = null
  let bestDistance = far
  for (const prop of grid.query(ray.ox, ray.oz, far + hitboxes.reach)) {
    if (!prop.alive) continue
    const d = rayDistance(ray, hitboxes.boxes[prop.id])
    if (d <= bestDistance) {
      best = prop
      bestDistance = d
    }
  }
  for (const enemy of enemies) {
    if (!enemy.alive) continue
    const d = rayDistance(ray, enemyHitbox(enemy.pos.x, enemy.pos.z, enemy.yaw, ENEMY_BOX))
    if (d <= bestDistance) {
      best = enemy
      bestDistance = d
    }
  }
  return best
}

const ENEMY_BOX = enemyHitbox(0, 0, 0)
