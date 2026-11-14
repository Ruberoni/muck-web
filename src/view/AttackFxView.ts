import * as THREE from 'three'
import { STEP } from '../sim/constants'
import type { Projectile, ProjectileKind } from '../sim/projectiles'
import { mulberry32 } from '../sim/random'
import { DEFAULT_ISLAND, type Island } from '../sim/world/island'
import { WATER_LEVEL } from '../sim/world/terrain'

// Cada jefe tiene su color. El Lanzarrocas: viento blanco y luz crema, con polvo de tierra.
const WIND = '#dff4ff'
const PIERCE = '#fff0c8'
const DUST_COLOR = '#9a8a70'
const PEBBLE_COLOR = '#7d786c'
/** El trasgo gigante: azul brillante, con el centro blanco. */
export const GIANT_BLUE = '#4fb8ff'
const WHITE = '#ffffff'

// El golpe al suelo del Lanzarrocas (`smash`): viento cortante que sale del golpe, una onda, polvo y piedritas.
/** Medias lunas de viento que salen del golpe, casi planas, girando hacia afuera. */
const SLASHES = 3
const SLASH_TIME = 0.42
const SLASH_FROM = 0.7
const SLASH_TO = 3.4
/** El tajo de los puños al bajar: un arco vertical que acaba en el suelo, delante. */
const SWING_TIME = 0.3
const SWING_RADIUS = 2.2
/** La onda en el suelo. */
const WAVE_TIME = 0.5
const WAVE_TO = 3.8
const DUST = 10
const DUST_TIME = 0.9
const PEBBLES = 7
const PEBBLE_TIME = 0.95
/** Las piedritas caen con algo más de peso que el jugador, para que no floten. */
const PEBBLE_GRAVITY = 22

// La roca rápida (`fastRock`): un pincho de luz al salir, una estela y aros de viento por todo el camino, y polvo al caer.
const SPIKE_TIME = 0.22
const SPIKE_LENGTH = 2.6
const RING_TIME = 0.4

// El pisotón del trasgo gigante (`stomp`): grietas azules que brillan, un destello y polvo; la onda levanta polvo.
const CRACKS = 7
const CRACK_TIME = 1.5
/** Lo que tardan las grietas en abrirse, en fracción de su vida. */
const CRACK_OPEN = 0.08
/** Cada cuánto suelta polvo y chispas la onda por donde pasa (s), y cuántas bolas cada vez. */
const WAVE_EVERY = 0.05
const WAVE_PUFFS = 3

// La embestida (`charge`): polvo a cada paso, rayas de viento a los lados y la punta de la lanza encendida; al
// acabar, un destello de la lanza si pega y una nube de polvo si no.
/** Metros entre dos pisadas con polvo, y entre dos tandas de rayas de viento. */
const RUSH_STEP = 1.1
const STREAK_STEP = 0.5
const STREAK_TIME = 0.28
/** Altura de la punta de la lanza y lo que sale por delante del cuerpo, en metros (el gigante mide unos 4 m). */
const SPEAR_HEIGHT = 2
const SPEAR_AHEAD = 1.7
/** Lo que se echa atrás la luz del golpe de la lanza (m), hacia el cuerpo. */
const HIT_BACK = 0.9

// Las flechas del gigante: estela fina azul con chispas, la punta encendida, y chispas al clavarse.
const SPARK_TIME = 0.4

const easeOut = (t: number) => 1 - (1 - t) ** 3

/**
 * Una cinta en forma de media luna en el plano XY, de `start` a `end` (radianes desde +x hacia +y), de radio 1 por fuera
 * y que engorda hasta `width` por dentro. El color de los vértices hace de brillo (con mezcla aditiva, negro es
 * transparente): `both` se apaga en las dos puntas; `tail` crece hacia el final, como la estela de un golpe.
 */
function arcGeometry(start: number, end: number, width: number, fade: 'both' | 'tail') {
  const segments = 24
  const positions: number[] = []
  const colors: number[] = []
  const index: number[] = []
  for (let i = 0; i <= segments; i++) {
    const k = i / segments
    const a = start + (end - start) * k
    const body = Math.sin(Math.PI * k)
    const thick = fade === 'both' ? body : Math.sin((Math.PI / 2) * Math.min(1, k * 1.15)) * (1 - k * 0.35)
    const glow = fade === 'both' ? body ** 0.6 : k ** 1.4
    const inner = 1 - width * thick
    positions.push(Math.cos(a), Math.sin(a), 0, Math.cos(a) * inner, Math.sin(a) * inner, 0)
    // El borde de fuera brilla más: así se lee como el filo del viento.
    colors.push(glow, glow, glow, glow * 0.35, glow * 0.35, glow * 0.35)
    if (i < segments) {
      const o = i * 2
      index.push(o, o + 1, o + 2, o + 1, o + 3, o + 2)
    }
  }
  return indexed(positions, colors, index)
}

/** Un cono abierto a lo largo de -z, ancho en el origen (lo que vuela) y que se apaga hacia la punta (z = -1). */
function trailGeometry(radius: number) {
  const geometry = new THREE.CylinderGeometry(radius, radius * 0.08, 1, 8, 4, true).rotateX(Math.PI / 2).translate(0, 0, -0.5)
  return shade(geometry, (_x, _y, z) => Math.max(0, 1 + z) ** 1.6)
}

/** Un brillo redondo en el plano XY (de cara a +z): blanco en el centro y que se apaga hacia el borde. Mira a la cámara. */
function glowGeometry() {
  const segments = 24
  const positions = [0, 0, 0]
  const colors = [1, 1, 1]
  const index: number[] = []
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2
    positions.push(Math.cos(a) * 0.3, Math.sin(a) * 0.3, 0, Math.cos(a), Math.sin(a), 0)
    colors.push(0.55, 0.55, 0.55, 0, 0, 0)
    const o = 1 + i * 2
    const n = 1 + ((i + 1) % segments) * 2
    index.push(0, o, n, o, o + 1, n, n, o + 1, n + 1)
  }
  return indexed(positions, colors, index)
}

/** Un aro suave en el plano XY: se apaga hacia dentro y hacia fuera, y brilla en medio. */
function softRingGeometry() {
  const segments = 40
  const radii = [0.72, 0.87, 1]
  const glow = [0, 1, 0]
  const positions: number[] = []
  const colors: number[] = []
  const index: number[] = []
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2
    for (let r = 0; r < 3; r++) {
      positions.push(Math.cos(a) * radii[r], Math.sin(a) * radii[r], 0)
      colors.push(glow[r], glow[r], glow[r])
    }
    const o = i * 3
    const n = ((i + 1) % segments) * 3
    for (let r = 0; r < 2; r++) index.push(o + r, o + r + 1, n + r, n + r, o + r + 1, n + r + 1)
  }
  return indexed(positions, colors, index)
}

/** Una estrella de luz en el plano XY: ocho puntas finas (largas y cortas), blancas en el centro. Mira a la cámara. */
function starGeometry() {
  const positions: number[] = []
  const colors: number[] = []
  const index: number[] = []
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.2
    const length = k % 2 ? 0.55 : 1
    const side = 0.07
    const o = positions.length / 3
    positions.push(-Math.sin(a) * side, Math.cos(a) * side, 0, Math.sin(a) * side, -Math.cos(a) * side, 0, Math.cos(a) * length, Math.sin(a) * length, 0)
    colors.push(1, 1, 1, 1, 1, 1, 0.15, 0.15, 0.15)
    index.push(o, o + 1, o + 2)
  }
  return indexed(positions, colors, index)
}

/** Una grieta en el suelo a lo largo de +x (de 0,12 a 1), quebrada, más ancha y más brillante cerca del centro. */
function crackGeometry(seed: number) {
  const rng = mulberry32(seed)
  const segments = 8
  const positions: number[] = []
  const colors: number[] = []
  const index: number[] = []
  let z = 0
  for (let i = 0; i <= segments; i++) {
    const k = i / segments
    if (i > 0) z += (rng() - 0.5) * 0.24
    const half = (0.09 * (1 - k) + 0.012) / 2
    const glow = 1 - k * 0.65
    positions.push(0.12 + 0.88 * k, 0, z - half, 0.12 + 0.88 * k, 0, z + half)
    colors.push(glow, glow, glow, glow, glow, glow)
    if (i < segments) {
      const o = i * 2
      index.push(o, o + 1, o + 2, o + 1, o + 3, o + 2)
    }
  }
  return indexed(positions, colors, index)
}

/** Una raya de viento a lo largo de z (de -0,5 a 0,5), que se apaga en las dos puntas. */
function streakGeometry() {
  const geometry = new THREE.CylinderGeometry(0.035, 0.035, 1, 5, 6, true).rotateX(Math.PI / 2)
  return shade(geometry, (_x, _y, z) => Math.sin(Math.PI * (z + 0.5)))
}

function indexed(positions: number[], colors: number[], index: number[]) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setIndex(index)
  return geometry
}

/** Brillo de cada vértice según su posición (con mezcla aditiva, 0 es transparente). */
function shade(geometry: THREE.BufferGeometry, glow: (x: number, y: number, z: number) => number) {
  const position = geometry.getAttribute('position')
  const colors: number[] = []
  for (let i = 0; i < position.count; i++) {
    const g = Math.max(0, glow(position.getX(i), position.getY(i), position.getZ(i)))
    colors.push(g, g, g)
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  return geometry
}

/** Las piezas de los efectos, por tipo: la geometría, su color de siempre y si suma luz (aditiva) o tapa. */
const KINDS = {
  /** Planas (en el plano XZ), para salir del golpe girando. */
  slash: { geometry: arcGeometry(-1.25, 1.25, 0.24, 'both').rotateX(-Math.PI / 2), color: WIND, additive: true },
  /** Vertical: x es hacia delante e y hacia arriba; acaba abajo y delante. */
  swing: { geometry: arcGeometry(1.45, -0.95, 0.3, 'tail'), color: WIND, additive: true },
  wave: { geometry: new THREE.RingGeometry(0.86, 1, 40).rotateX(-Math.PI / 2), color: WIND, additive: true },
  /** Un aro de cara a +z: se orienta hacia donde va lo que vuela. */
  ring: { geometry: new THREE.RingGeometry(0.72, 1, 24), color: WIND, additive: true },
  /** Un pincho de luz con la base en el origen y la punta en +z. */
  spike: { geometry: new THREE.ConeGeometry(0.22, 1, 6).rotateX(Math.PI / 2).translate(0, 0, 0.5), color: PIERCE, additive: true },
  trail: { geometry: trailGeometry(0.3), color: PIERCE, additive: true },
  core: { geometry: trailGeometry(0.11), color: WHITE, additive: true },
  thinTrail: { geometry: trailGeometry(0.1), color: GIANT_BLUE, additive: true },
  thinCore: { geometry: trailGeometry(0.035), color: WHITE, additive: true },
  dust: { geometry: new THREE.IcosahedronGeometry(1, 1), color: DUST_COLOR, additive: false },
  pebble: { geometry: new THREE.IcosahedronGeometry(0.13, 0), color: PEBBLE_COLOR, additive: false },
  /** Mira a la cámara. */
  glow: { geometry: glowGeometry(), color: GIANT_BLUE, additive: true },
  star: { geometry: starGeometry(), color: GIANT_BLUE, additive: true },
  softRing: { geometry: softRingGeometry(), color: GIANT_BLUE, additive: true },
  groundRing: { geometry: softRingGeometry().rotateX(-Math.PI / 2), color: GIANT_BLUE, additive: true },
  spark: { geometry: new THREE.OctahedronGeometry(0.07, 0).scale(1, 1, 2.2), color: GIANT_BLUE, additive: true },
  streak: { geometry: streakGeometry(), color: GIANT_BLUE, additive: true },
  crack0: { geometry: crackGeometry(11), color: GIANT_BLUE, additive: true },
  crack1: { geometry: crackGeometry(23), color: GIANT_BLUE, additive: true },
  crack2: { geometry: crackGeometry(37), color: GIANT_BLUE, additive: true },
} as const
type Kind = keyof typeof KINDS
const CRACK_KINDS = ['crack0', 'crack1', 'crack2'] as const
/** Las que miran siempre a la cámara. */
const FACING: ReadonlySet<Kind> = new Set<Kind>(['glow', 'star'])

/** Una pieza en marcha: `move` la coloca en cada frame con `t` de 0 a 1 a lo largo de su vida. */
interface Piece {
  kind: Kind
  mesh: THREE.Mesh
  material: THREE.MeshBasicMaterial
  age: number
  life: number
  move: (piece: Piece, t: number, dt: number) => void
  velocity: THREE.Vector3
  spin: THREE.Vector3
  size: number
}

/** Cómo se ve cada cosa que vuela con efecto: su estela, cada cuánto deja una marca en el camino y la luz de la punta. */
interface FlightLook {
  trail: Kind
  core: Kind
  /** La estela mide lo que recorre en este tiempo. */
  trailSeconds: number
  /** Metros de camino entre dos marcas (aros de viento o chispas). */
  spacing: number
  /** Un brillo en la punta, de este tamaño. */
  head?: number
}

const FLIGHTS: Partial<Record<ProjectileKind, FlightLook>> = {
  rock: { trail: 'trail', core: 'core', trailSeconds: 0.08, spacing: 1.5 },
  arrow: { trail: 'thinTrail', core: 'thinCore', trailSeconds: 0.06, spacing: 0.45, head: 0.6 },
}

/** Algo en el aire: sus piezas fijas (estela, punta), de dónde salió, dónde estaba y cuánto falta para la siguiente marca. */
interface Flight {
  kind: ProjectileKind
  look: FlightLook
  pieces: Piece[]
  from: THREE.Vector3
  last: THREE.Vector3
  toMark: number
}

/** Una onda que avanza por el suelo (la del pisotón): cuánto lleva y cuándo suelta el siguiente polvo. */
interface Wave {
  x: number
  z: number
  speed: number
  radius: number
  age: number
  toEmit: number
}

/** Un gigante embistiendo: la luz de la lanza, por dónde iba y cuánto le falta para la siguiente pisada y raya. */
interface Rush {
  id: number
  spear: Piece
  last: THREE.Vector3 | null
  toStep: number
  toStreak: number
  foot: number
}

/** Lo justo de un enemigo para seguirlo: dónde estaba, dónde está y hacia dónde mira. */
export interface FxEnemy {
  id: number
  pos: { x: number; z: number }
  prev: { x: number; z: number }
  yaw: number
}

const ahead = new THREE.Vector3()
const velocity = new THREE.Vector3()
const point = new THREE.Vector3()
const spot = new THREE.Vector3()

/**
 * Los efectos de los ataques de los jefes, cada jefe con su color: el viento del golpe al suelo y la roca que perfora
 * el aire del Lanzarrocas; las grietas del pisotón, la embestida y las flechas azules del trasgo gigante. Solo vista, sin
 * colisión. No dependen de la luz ni de la niebla, para que se vean igual de noche. Las piezas se guardan al acabar y
 * se reutilizan. Lo que vuela sale de la lista de proyectiles, que en red es la del cliente: se ve igual en los dos casos.
 */
export class AttackFxView {
  readonly group = new THREE.Group()
  island: Island = DEFAULT_ISLAND
  private active: Piece[] = []
  private free = new Map<Kind, Piece[]>()
  private flights = new Map<number, Flight>()
  private seen = new Set<number>()
  private waves: Wave[] = []
  private rushes = new Map<number, Rush>()

  constructor(private rng: () => number = Math.random) {}

  /** Cuántas piezas se ven ahora (para las pruebas). */
  get live() {
    return this.active.length
  }

  /**
   * El golpe al suelo en (x, z). `from` es quien golpea: el tajo vertical baja desde él hacia el golpe (sin él, solo
   * sale el viento de alrededor).
   */
  smash(x: number, z: number, from?: { x: number; z: number }) {
    const y = this.ground(x, z)
    const rng = this.rng
    const turn = rng() * Math.PI * 2
    for (let i = 0; i < SLASHES; i++) {
      const piece = this.take('slash', SLASH_TIME * (0.9 + i * 0.08), (p, t, dt) => {
        const r = SLASH_FROM + (SLASH_TO - SLASH_FROM) * easeOut(t)
        p.mesh.scale.setScalar(r)
        p.mesh.rotation.y += dt * p.spin.y
        p.mesh.position.y = y + p.size + t * 0.5
        p.material.opacity = 0.95 * (1 - t) ** 1.5
      })
      piece.size = 0.25 + i * 0.18
      piece.spin.y = 3 + i
      piece.mesh.position.set(x, y + piece.size, z)
      piece.mesh.rotation.set((rng() - 0.5) * 0.7, turn + (i * Math.PI * 2) / SLASHES, (rng() - 0.5) * 0.7, 'YXZ')
    }
    if (from) {
      const dx = x - from.x
      const dz = z - from.z
      const length = Math.hypot(dx, dz) || 1
      const fx = dx / length
      const fz = dz / length
      // La punta del arco (a -0,95 rad) toca el suelo justo en el golpe.
      const cx = x - fx * SWING_RADIUS * Math.cos(-0.95)
      const cz = z - fz * SWING_RADIUS * Math.cos(-0.95)
      const piece = this.take('swing', SWING_TIME, (p, t) => {
        p.mesh.scale.setScalar(SWING_RADIUS * (1 + t * 0.12))
        p.material.opacity = (1 - t) ** 2
      })
      piece.mesh.position.set(cx, y - SWING_RADIUS * Math.sin(-0.95), cz)
      piece.mesh.rotation.set(0, Math.atan2(-fz, fx), 0)
      piece.mesh.scale.setScalar(SWING_RADIUS)
    }
    const wave = this.take('wave', WAVE_TIME, (p, t) => {
      p.mesh.scale.setScalar(0.5 + (WAVE_TO - 0.5) * easeOut(t))
      p.material.opacity = 0.85 * (1 - t)
    })
    wave.mesh.position.set(x, y + 0.06, z)
    this.dust(x, y, z, DUST, 3, DUST_TIME)
    this.pebbles(x, y, z, PEBBLES, 1)
  }

  /**
   * El pisotón del gigante en (x, z): grietas azules que se abren y brillan, un destello, chispas y polvo; y la onda que
   * sale a `speed` m/s hasta `radius` levanta polvo, piedritas y chispas por donde pasa.
   */
  stomp(x: number, z: number, radius: number, speed: number) {
    const y = this.ground(x, z)
    const rng = this.rng
    this.flash(x, y + 0.7, z, 4.2, 0.4)
    const turn = rng() * Math.PI * 2
    for (let i = 0; i < CRACKS; i++) {
      const kind = CRACK_KINDS[i % CRACK_KINDS.length]
      const angle = turn + (i / CRACKS) * Math.PI * 2 + (rng() - 0.5) * 0.5
      const length = 3.2 + rng() * 2
      // Cada grieta, dos veces: el halo azul y el centro blanco, más fino. Anchas: se miran casi de lado, entre la hierba.
      for (const [color, width] of [[GIANT_BLUE, 4], [WHITE, 1.4]] as const) {
        const piece = this.take(
          kind,
          CRACK_TIME,
          (p, t) => {
            p.mesh.scale.set(p.size * easeOut(Math.min(1, t / CRACK_OPEN)), 1, width)
            p.material.opacity = t < 0.35 ? 1 : (1 - (t - 0.35) / 0.65) ** 1.5
          },
          color,
        )
        piece.size = length
        piece.mesh.position.set(x, y + 0.05, z)
        piece.mesh.rotation.set(0, angle, 0)
        piece.mesh.scale.set(0.01, 1, width)
      }
    }
    const ring = this.take('groundRing', 0.45, (p, t) => {
      p.mesh.scale.setScalar(0.6 + 2.6 * easeOut(t))
      p.material.opacity = 1 - t
    })
    ring.mesh.position.set(x, y + 0.08, z)
    this.sparks(x, y + 0.4, z, 16, 6, GIANT_BLUE)
    // Polvo bajo y claro: lo que se tiene que ver son las grietas.
    this.dust(x, y, z, 8, 2.6, 0.9, 0.55, 0.45)
    this.pebbles(x, y, z, 8, 1.1)
    this.waves.push({ x, z, speed, radius, age: 0, toEmit: 0 })
  }

  /** Un gigante (`id`) empieza a embestir: la punta de la lanza se enciende y le sigue hasta `rushEnd`. */
  rushStart(id: number) {
    if (this.rushes.has(id)) return
    // Pequeña: un punto de luz en la lanza, sin tapar al gigante que viene de frente.
    const spear = this.take('glow', Infinity, () => {})
    spear.mesh.scale.setScalar(0.6)
    this.rushes.set(id, { id, spear, last: null, toStep: 0, toStreak: 0, foot: 1 })
  }

  /** Se acaba la embestida de `id`: si ha pegado, un destello de la lanza; si no, se para en seco levantando polvo. */
  rushEnd(id: number, hit: boolean) {
    const rush = this.rushes.get(id)
    if (!rush) return
    this.rushes.delete(id)
    const at = rush.spear.mesh.position.clone()
    this.give(rush.spear)
    if (!rush.last) return
    // Al pegar, la punta de la lanza está casi en la cámara: la luz sale un poco más atrás, para no cegar.
    const back = Math.hypot(at.x - rush.last.x, at.z - rush.last.z) || 1
    at.x -= ((at.x - rush.last.x) / back) * HIT_BACK
    at.z -= ((at.z - rush.last.z) / back) * HIT_BACK
    const y = this.ground(at.x, at.z)
    if (hit) {
      this.flash(at.x, at.y, at.z, 1.4, 0.28)
      const star = this.take('star', 0.32, (p, t) => {
        p.mesh.scale.setScalar(p.size * (0.6 + 0.6 * easeOut(Math.min(1, t * 3))))
        p.material.opacity = 0.9 * (1 - t) ** 1.3
      })
      star.size = 1.8
      star.spin.z = 1.5
      star.mesh.position.copy(at)
      const ring = this.take('softRing', 0.35, (p, t) => {
        p.mesh.scale.setScalar(0.4 + 1.8 * easeOut(t))
        p.material.opacity = 1 - t
      })
      ring.mesh.position.copy(at)
      // De cara a donde iba: del cuerpo a la punta de la lanza.
      ring.mesh.lookAt(ahead.set(at.x * 2 - rush.last.x, at.y, at.z * 2 - rush.last.z))
      this.sparks(at.x, at.y, at.z, 18, 7, GIANT_BLUE)
    } else {
      this.flash(at.x, at.y, at.z, 1.6, 0.2)
      this.sparks(at.x, at.y, at.z, 6, 4, GIANT_BLUE)
    }
    this.dust(at.x, y, at.z, 7, 2.2, 0.9, 0.7, 0.5)
    this.pebbles(at.x, y, at.z, 5, 0.8)
  }

  /**
   * Por frame: lo que vuela (estela y marcas por el camino), las ondas, las embestidas (`enemies`, para seguirlas) y las
   * piezas en marcha. Con `camera`, los brillos y las estrellas la miran.
   */
  update(dt: number, projectiles: readonly Projectile[], alpha: number, enemies: readonly FxEnemy[] = [], camera?: THREE.Camera) {
    this.seen.clear()
    for (const p of projectiles) {
      const look = FLIGHTS[p.kind]
      if (!look) continue
      this.seen.add(p.id)
      point.set(p.prev.x + (p.pos.x - p.prev.x) * alpha, p.prev.y + (p.pos.y - p.prev.y) * alpha, p.prev.z + (p.pos.z - p.prev.z) * alpha)
      velocity.set(p.pos.x - p.prev.x, p.pos.y - p.prev.y, p.pos.z - p.prev.z).divideScalar(STEP)
      // Recién lanzado aún no se ha movido: va como sale.
      if (velocity.lengthSq() < 1e-6) velocity.set(p.vel.x, p.vel.y, p.vel.z)
      let flight = this.flights.get(p.id)
      if (!flight) {
        flight = this.launch(p.kind, look, point, velocity)
        this.flights.set(p.id, flight)
      }
      this.fly(flight, point, velocity)
    }
    for (const [id, flight] of this.flights) {
      if (this.seen.has(id)) continue
      this.land(flight)
      this.flights.delete(id)
    }
    for (const wave of [...this.waves]) this.spread(wave, dt)
    for (const rush of [...this.rushes.values()]) {
      const e = enemies.find((en) => en.id === rush.id)
      if (e) this.charge(rush, e, alpha)
      // Ya no está (muerto, o la partida ha cambiado): se apaga la lanza sin más.
      else this.rushEnd(rush.id, false)
    }
    for (const piece of [...this.active]) {
      piece.age += dt
      const t = piece.age / piece.life
      if (t >= 1) {
        this.give(piece)
        continue
      }
      piece.move(piece, t, dt)
      if (camera && FACING.has(piece.kind)) {
        piece.mesh.quaternion.copy(camera.quaternion)
        if (piece.spin.z) piece.mesh.rotateZ(piece.spin.z * piece.age)
      }
    }
  }

  /** Al cambiar de partida o de isla: todo fuera (las piezas se guardan). */
  reset() {
    for (const piece of [...this.active]) this.give(piece)
    this.flights.clear()
    this.waves.length = 0
    this.rushes.clear()
  }

  /**
   * Sale algo que vuela. La roca: un pincho de luz hacia donde va y un estampido. La flecha: un destello azul y unas
   * chispas. Su estela (y la luz de la punta) le siguen hasta que cae.
   */
  private launch(kind: ProjectileKind, look: FlightLook, at: THREE.Vector3, vel: THREE.Vector3): Flight {
    ahead.copy(at).add(vel)
    if (kind === 'rock') {
      const spike = this.take('spike', SPIKE_TIME, (p, t) => {
        p.mesh.scale.set(1 - t * 0.5, 1 - t * 0.5, SPIKE_LENGTH * easeOut(Math.min(1, t * 2.5)))
        p.material.opacity = (1 - t) ** 1.2
      })
      spike.mesh.position.copy(at)
      spike.mesh.lookAt(ahead)
      spike.mesh.scale.set(1, 1, 0.01)
      this.ring(at, vel, 1.9, SPIKE_TIME * 1.4)
    } else {
      this.flash(at.x, at.y, at.z, 1.4, 0.2)
      this.sparks(at.x, at.y, at.z, 5, 3, GIANT_BLUE)
    }
    const pieces = [this.take(look.trail, Infinity, () => {}), this.take(look.core, Infinity, () => {})]
    pieces[0].material.opacity = 0.75
    if (look.head) {
      const head = this.take('glow', Infinity, () => {})
      head.mesh.scale.setScalar(look.head)
      pieces.push(head)
    }
    return { kind, look, pieces, from: at.clone(), last: at.clone(), toMark: look.spacing * 0.5 }
  }

  /** La estela detrás, la luz en la punta y una marca cada `spacing` metros del camino recorrido desde el frame anterior. */
  private fly(flight: Flight, at: THREE.Vector3, vel: THREE.Vector3) {
    const speed = vel.length()
    const { look } = flight
    // Al salir no asoma por detrás de quien lo lanza.
    const length = Math.max(0.01, Math.min(speed * look.trailSeconds, at.distanceTo(flight.from)))
    ahead.copy(at).add(vel)
    const [trail, core, head] = flight.pieces
    for (const piece of [trail, core]) {
      piece.mesh.position.copy(at)
      piece.mesh.lookAt(ahead)
      piece.mesh.scale.set(1, 1, length)
    }
    head?.mesh.position.copy(at)
    const moved = at.distanceTo(flight.last)
    let along = flight.toMark
    while (along <= moved) {
      spot.copy(flight.last).lerp(at, along / moved)
      if (flight.kind === 'rock') this.ring(spot, vel, 0.85, RING_TIME)
      else this.sparks(spot.x, spot.y, spot.z, 1, 1.2, this.rng() < 0.4 ? WHITE : GIANT_BLUE, SPARK_TIME * 0.8)
      along += look.spacing
    }
    flight.toMark = along - moved
    flight.last.copy(at)
  }

  /** Cae (al suelo, a algo o a alguien): fuera la estela. La roca levanta polvo y piedritas; la flecha, chispas azules. */
  private land(flight: Flight) {
    for (const piece of flight.pieces) this.give(piece)
    const { x, z } = flight.last
    const y = Math.max(this.ground(x, z), flight.last.y - 1)
    if (flight.kind !== 'rock') {
      this.flash(x, flight.last.y, z, 1.5, 0.22)
      this.sparks(x, flight.last.y, z, 10, 4, GIANT_BLUE)
      this.dust(x, y, z, 3, 0.8, 0.6)
      return
    }
    const wave = this.take('wave', WAVE_TIME * 0.7, (p, t) => {
      p.mesh.scale.setScalar(0.3 + 1.6 * easeOut(t))
      p.material.opacity = 0.7 * (1 - t)
    })
    wave.mesh.position.set(x, y + 0.06, z)
    this.dust(x, y, z, 6, 1.6, DUST_TIME * 0.8)
    this.pebbles(x, y, z, 5, 0.7)
  }

  /** La onda del pisotón avanza: suelta polvo, chispas y alguna piedrita donde está ahora, hasta llegar a su radio. */
  private spread(wave: Wave, dt: number) {
    wave.age += dt
    const r = wave.age * wave.speed
    if (r > wave.radius) {
      this.waves.splice(this.waves.indexOf(wave), 1)
      return
    }
    wave.toEmit -= dt
    if (wave.toEmit > 0) return
    wave.toEmit += WAVE_EVERY
    const rng = this.rng
    for (let i = 0; i < WAVE_PUFFS; i++) {
      const angle = rng() * Math.PI * 2
      const x = wave.x + Math.cos(angle) * r
      const z = wave.z + Math.sin(angle) * r
      const y = this.ground(x, z)
      this.dust(x, y, z, 1, 0.6, 0.6, 0.45, 0.4)
      if (i === 0) this.sparks(x, y + 0.2, z, 2, 3, GIANT_BLUE)
      if (i === 1 && rng() < 0.5) this.pebbles(x, y, z, 1, 0.6)
    }
  }

  /** Sigue a un gigante que embiste: la lanza encendida delante, polvo a cada paso y rayas de viento a los lados. */
  private charge(rush: Rush, e: FxEnemy, alpha: number) {
    const x = e.prev.x + (e.pos.x - e.prev.x) * alpha
    const z = e.prev.z + (e.pos.z - e.prev.z) * alpha
    const y = this.ground(x, z)
    const fx = Math.sin(e.yaw)
    const fz = Math.cos(e.yaw)
    rush.spear.mesh.position.set(x + fx * SPEAR_AHEAD, y + SPEAR_HEIGHT, z + fz * SPEAR_AHEAD)
    if (!rush.last) {
      rush.last = new THREE.Vector3(x, y, z)
      return
    }
    const moved = Math.hypot(x - rush.last.x, z - rush.last.z)
    rush.last.set(x, y, z)
    rush.toStep -= moved
    rush.toStreak -= moved
    const rng = this.rng
    if (rush.toStep <= 0) {
      rush.toStep += RUSH_STEP
      rush.foot = -rush.foot
      // Una pisada a cada lado, alternando.
      const sx = x + fz * 0.55 * rush.foot
      const sz = z - fx * 0.55 * rush.foot
      this.dust(sx, this.ground(sx, sz), sz, 3, 1, 0.7, 0.6, 0.5)
      if (rng() < 0.5) this.pebbles(sx, this.ground(sx, sz), sz, 1, 0.6)
    }
    while (rush.toStreak <= 0) {
      rush.toStreak += STREAK_STEP
      const side = rng() < 0.5 ? -1 : 1
      const off = (1 + rng() * 0.6) * side
      const height = 0.6 + rng() * 2.6
      const streak = this.take(
        'streak',
        STREAK_TIME,
        (p, t) => {
          p.mesh.scale.set(1, 1, p.size * (0.6 + 0.4 * easeOut(t)))
          p.material.opacity = (1 - t) ** 1.2
        },
        rng() < 0.3 ? WHITE : GIANT_BLUE,
      )
      streak.size = 2 + rng() * 1.5
      // Un poco por detrás: lo que el gigante va dejando al pasar.
      streak.mesh.position.set(x + fz * off - fx * 0.8, y + height, z - fx * off - fz * 0.8)
      streak.mesh.lookAt(ahead.set(streak.mesh.position.x + fx, streak.mesh.position.y, streak.mesh.position.z + fz))
    }
  }

  /** Un brillo redondo que crece un poco y se apaga en `life` segundos. */
  private flash(x: number, y: number, z: number, size: number, life: number, color: string = GIANT_BLUE) {
    const piece = this.take(
      'glow',
      life,
      (p, t) => {
        p.mesh.scale.setScalar(p.size * (0.7 + 0.5 * easeOut(t)))
        p.material.opacity = (1 - t) ** 1.4
      },
      color,
    )
    piece.size = size
    piece.mesh.position.set(x, y, z)
    piece.mesh.scale.setScalar(size * 0.7)
  }

  /** `count` chispas que saltan a hasta `speed` m/s, caen un poco y se apagan. */
  private sparks(x: number, y: number, z: number, count: number, speed: number, color: string, life = SPARK_TIME) {
    const rng = this.rng
    for (let i = 0; i < count; i++) {
      const piece = this.take(
        'spark',
        life * (0.7 + rng() * 0.6),
        (p, t, dt) => {
          p.velocity.y -= 6 * dt
          p.mesh.position.addScaledVector(p.velocity, dt)
          ahead.copy(p.mesh.position).add(p.velocity)
          p.mesh.lookAt(ahead)
          p.mesh.scale.setScalar(p.size * (1 - t))
          p.material.opacity = 1 - t * t
        },
        i % 3 === 0 ? WHITE : color,
      )
      const a = rng() * Math.PI * 2
      const up = rng()
      const s = speed * (0.4 + rng() * 0.6)
      piece.velocity.set(Math.cos(a) * s * (1 - up * 0.5), s * (0.3 + up), Math.sin(a) * s * (1 - up * 0.5))
      piece.size = 0.8 + rng() * 0.8
      piece.mesh.position.set(x, y, z)
    }
  }

  /** Un aro de viento en `at`, de cara a `vel`, que crece hasta `size` y se apaga en `life` segundos. */
  private ring(at: THREE.Vector3, vel: THREE.Vector3, size: number, life: number) {
    const piece = this.take('ring', life, (p, t) => {
      p.mesh.scale.setScalar(p.size * (0.3 + 0.7 * easeOut(t)))
      p.material.opacity = 0.7 * (1 - t) ** 1.3
    })
    piece.size = size
    piece.mesh.position.copy(at)
    piece.mesh.lookAt(ahead.copy(at).add(vel))
    piece.mesh.scale.setScalar(size * 0.3)
  }

  /**
   * `count` bolas de polvo que se abren hasta `reach` metros a ras del suelo y se deshacen. `size` y `opacity` las hacen
   * más pequeñas y más claras (el polvo del gigante no debe tapar sus grietas azules).
   */
  private dust(x: number, y: number, z: number, count: number, reach: number, life: number, size = 1, opacity = 0.75) {
    const rng = this.rng
    for (let i = 0; i < count; i++) {
      const angle = ((i + rng() * 0.6) / count) * Math.PI * 2
      const out = reach * (0.6 + rng() * 0.4)
      const piece = this.take('dust', life * (0.8 + rng() * 0.3), (p, t) => {
        const k = easeOut(t)
        p.mesh.position.set(x + p.velocity.x * k, y + 0.2 + p.velocity.y * k, z + p.velocity.z * k)
        p.mesh.scale.setScalar(p.size * (0.35 + 0.75 * k))
        p.material.opacity = opacity * (1 - t) ** 1.4
      })
      piece.velocity.set(Math.cos(angle) * out, 0.3 + rng() * 0.6, Math.sin(angle) * out)
      piece.size = (0.6 + rng() * 0.5) * size
      piece.mesh.position.set(x, y + 0.2, z)
      piece.mesh.scale.setScalar(piece.size * 0.35)
    }
  }

  /** `count` piedritas que saltan, caen con gravedad, se quedan en el suelo y menguan al final. */
  private pebbles(x: number, y: number, z: number, count: number, strength: number) {
    const rng = this.rng
    for (let i = 0; i < count; i++) {
      const angle = rng() * Math.PI * 2
      const out = (2 + rng() * 2.5) * strength
      const piece = this.take('pebble', PEBBLE_TIME * (0.8 + rng() * 0.4), (p, t, dt) => {
        const floor = this.ground(p.mesh.position.x, p.mesh.position.z) + 0.06
        p.velocity.y -= PEBBLE_GRAVITY * dt
        p.mesh.position.addScaledVector(p.velocity, dt)
        if (p.mesh.position.y <= floor) {
          p.mesh.position.y = floor
          p.velocity.set(p.velocity.x * 0.4, Math.abs(p.velocity.y) * 0.25, p.velocity.z * 0.4)
        }
        p.mesh.rotation.x += p.spin.x * dt
        p.mesh.rotation.z += p.spin.z * dt
        p.mesh.scale.setScalar(p.size * Math.min(1, (1 - t) * 4))
      })
      piece.velocity.set(Math.cos(angle) * out, (4 + rng() * 3.5) * strength, Math.sin(angle) * out)
      piece.spin.set(rng() * 12 - 6, 0, rng() * 12 - 6)
      piece.size = 0.7 + rng() * 0.8
      piece.mesh.position.set(x + Math.cos(angle) * 0.4, y + 0.15, z + Math.sin(angle) * 0.4)
      piece.mesh.scale.setScalar(piece.size)
    }
  }

  /** Una pieza de `kind`, guardada o nueva, puesta en marcha con su vida, su movimiento y su color. */
  private take(kind: Kind, life: number, move: Piece['move'], color: string = KINDS[kind].color): Piece {
    let piece = this.free.get(kind)?.pop()
    if (!piece) {
      const { geometry, additive } = KINDS[kind]
      const material = new THREE.MeshBasicMaterial({
        transparent: true,
        depthWrite: false,
        fog: false,
        side: THREE.DoubleSide,
        vertexColors: geometry.hasAttribute('color'),
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      })
      // Las piedritas son macizas: menguan en vez de transparentarse.
      if (kind === 'pebble') Object.assign(material, { transparent: false, depthWrite: true, side: THREE.FrontSide })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.renderOrder = 2
      mesh.frustumCulled = false
      piece = { kind, mesh, material, age: 0, life, move, velocity: new THREE.Vector3(), spin: new THREE.Vector3(), size: 1 }
    }
    piece.material.color.set(color)
    piece.age = 0
    piece.life = life
    piece.move = move
    piece.size = 1
    piece.velocity.set(0, 0, 0)
    piece.spin.set(0, 0, 0)
    piece.material.opacity = 1
    piece.mesh.position.set(0, 0, 0)
    piece.mesh.rotation.set(0, 0, 0)
    piece.mesh.scale.setScalar(1)
    this.active.push(piece)
    this.group.add(piece.mesh)
    return piece
  }

  private give(piece: Piece) {
    const at = this.active.indexOf(piece)
    if (at < 0) return
    this.active.splice(at, 1)
    this.group.remove(piece.mesh)
    let list = this.free.get(piece.kind)
    if (!list) this.free.set(piece.kind, (list = []))
    list.push(piece)
  }

  private ground(x: number, z: number) {
    return Math.max(this.island.heightAt(x, z), WATER_LEVEL)
  }
}
