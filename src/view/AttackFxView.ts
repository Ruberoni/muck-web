import * as THREE from 'three'
import { STEP, type EnemyType, type HitEfficacy, type SpecialId, type WeaponClass } from '../sim/constants'
import { furious } from '../sim/enemies'
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

// Los golpes del jugador: un blanco cálido, distinto del color de cada jefe; en oro si es eficaz, gris si lo resiste.
const PLAYER_HIT = '#fff3d6'
const EFFECTIVE_HIT = '#ffd36b'
const RESISTED_HIT = '#b8c0c8'

// Las flechas del gigante: estela fina azul con chispas, la punta encendida, y chispas al clavarse.
const SPARK_TIME = 0.4

// El Guardián del meteorito: lava naranja con el centro blanco amarillento, brasas que suben y humo oscuro, que es lo
// que se lee de día (sale de día y de noche). Lo que quema deja el suelo negro un rato.
export const MAGMA = '#ff6a1f'
const EMBER = '#ffb347'
const HOT = '#fff1c4'
const SMOKE_COLOR = '#2e2622'
const SCORCH_COLOR = '#140e0b'
/** Lo que mide el Guardián (m): de dónde le salen las brasas y a qué altura alza el espadón. */
const GUARDIAN_HEIGHT = 3.6
/** Cada cuánto le sale una brasa del cuerpo (s): tranquilo y enfurecido. */
const BODY_EMBER_EVERY = 0.09
const FURY_EMBER_EVERY = 0.025
/** El anillo de fuego: lenguas repartidas por el aro, y cada cuánto deja brasas, humo y fuego por donde pasa (s). */
const RING_FLAMES = 44
const RING_EVERY = 0.04
/** Lo que tarda en irse el suelo quemado (s). */
const SCORCH_TIME = 4
/**
 * El meteorito pequeño viene del cielo por detrás de quien lo llama, bajo, para que se le vea venir mirándolo:
 * DROP_SLOPE metros de lado por cada uno de alto (unos 30°). Sin quien lo llame, de DROP_FROM.
 */
const DROP_SLOPE = 1.8
const DROP_FROM = new THREE.Vector3(0.45, 1, -0.55).normalize()
const DROP_DISTANCE = 42
const DROP_ROCK = 0.75
/** La estela de fuego del meteorito, como mucho (m). Cerca de la cámara se desvanece (no la atraviesa). */
const DROP_TRAIL = 9
const DROP_FADE = 5
/** Los charcos de lava: cada cuánto sueltan una burbuja, una llama o una brasa mientras arden, y lo que tardan en enfriarse. */
const POOL_EVERY = 0.05
const POOL_COOL = 0.8

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

/** El tajo de una espada al dar: un rombo muy fino a lo largo de x (de -1 a 1), blanco en medio. Mira a la cámara. */
function cutGeometry() {
  const positions = [-1, 0, 0, 0, 0.07, 0, 1, 0, 0, 0, -0.07, 0, 0, 0, 0]
  const colors = [0, 0, 0, 0.6, 0.6, 0.6, 0, 0, 0, 0.6, 0.6, 0.6, 1, 1, 1]
  return indexed(positions, colors, [0, 4, 1, 1, 4, 2, 2, 4, 3, 3, 4, 0])
}

/** Una hoja: un rombo plano, algo curvado por el nervio. */
function leafGeometry() {
  const positions = [0, 0, -0.07, 0.035, 0.01, 0, 0, 0, 0.07, -0.035, 0.01, 0, 0, 0.012, 0]
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex([0, 4, 1, 1, 4, 2, 2, 4, 3, 3, 4, 0])
  geometry.computeVertexNormals()
  return geometry
}

/** Una raya de viento a lo largo de z (de -0,5 a 0,5), que se apaga en las dos puntas. */
function streakGeometry() {
  const geometry = new THREE.CylinderGeometry(0.035, 0.035, 1, 5, 6, true).rotateX(Math.PI / 2)
  return shade(geometry, (_x, _y, z) => Math.sin(Math.PI * (z + 0.5)))
}

/**
 * Una lengua de fuego en el plano XY, de pie: base redonda en y = 0 y punta en y = 1. Maciza (se mezcla sin sumar
 * luz, para que de día siga naranja): el color y la transparencia van en los vértices. Por el eje, blanco amarillento
 * abajo que se vuelve naranja y rojo hacia la punta; a los lados, naranja más transparente, y el borde se desvanece.
 */
function flameGeometry() {
  const rows = 10
  const positions: number[] = []
  const colors: number[] = []
  const index: number[] = []
  for (let k = 0; k <= rows; k++) {
    const t = k / rows
    const half = 0.42 * Math.sin(Math.PI * (0.14 + 0.86 * t ** 0.6))
    const hot = Math.max(0, 1 - t * 1.8)
    const core = [1, 0.3 + 0.62 * hot, 0.06 + 0.6 * hot, 0.95 * (1 - t ** 2.2)]
    const side = [1, 0.36 * (1 - t * 0.5), 0.06, 0.7 * (1 - t) ** 1.2]
    positions.push(-half, t, 0, -half * 0.5, t, 0, 0, t, 0, half * 0.5, t, 0, half, t, 0)
    colors.push(side[0], side[1], side[2], 0, ...side, ...core, ...side, side[0], side[1], side[2], 0)
    if (k < rows) {
      const o = k * 5
      for (let c = 0; c < 4; c++) index.push(o + c, o + c + 1, o + c + 5, o + c + 1, o + c + 6, o + c + 5)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4))
  geometry.setIndex(index)
  return geometry
}

/** Una mancha en el suelo (plano XZ), de radio 1: opaca en el centro, irregular y que se desvanece hacia el borde. */
function scorchGeometry() {
  const rng = mulberry32(7)
  const segments = 20
  const positions = [0, 0, 0]
  const colors = [1, 1, 1, 1]
  const index: number[] = []
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2
    const inner = 0.55 * (0.85 + rng() * 0.3)
    const outer = 0.85 + rng() * 0.3
    positions.push(Math.cos(a) * inner, 0, Math.sin(a) * inner, Math.cos(a) * outer, 0, Math.sin(a) * outer)
    colors.push(1, 1, 1, 0.85, 1, 1, 1, 0)
    const o = 1 + i * 2
    const n = 1 + ((i + 1) % segments) * 2
    index.push(0, o, n, o, o + 1, n, n, o + 1, n + 1)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4))
  geometry.setIndex(index)
  return geometry
}

/** La roca del meteorito pequeño, de radio 1: caras oscuras y algunas al rojo, que se ven aunque sea de día. */
function meteorRockGeometry() {
  const geometry = new THREE.IcosahedronGeometry(1, 0).toNonIndexed()
  const rng = mulberry32(5)
  const colors: number[] = []
  for (let f = 0; f < geometry.getAttribute('position').count / 3; f++) {
    const color = rng() < 0.35 ? [1, 0.42, 0.1] : [0.24, 0.19, 0.16]
    colors.push(...color, ...color, ...color)
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  return geometry
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
  // Lo que salta de los golpes del jugador (impact): astillas, lascas de piedra, cristales, hojas y el tajo de la espada.
  chip: { geometry: new THREE.BoxGeometry(0.08, 0.02, 0.04), color: WHITE, additive: false },
  shard: { geometry: new THREE.TetrahedronGeometry(0.045, 0), color: WHITE, additive: false },
  glassShard: { geometry: new THREE.OctahedronGeometry(0.04, 0).scale(0.6, 1.8, 0.6), color: WHITE, additive: true },
  leaf: { geometry: leafGeometry(), color: WHITE, additive: false },
  cut: { geometry: cutGeometry(), color: WHITE, additive: true },
  /** De pie: gira hacia la cámara sin inclinarse (`UPRIGHT`). El color va en sus vértices. */
  flame: { geometry: flameGeometry(), color: WHITE, additive: false },
  /** Las brasas y chispas del Guardián: sin sumar luz, para que de día sigan naranjas (las aditivas se vuelven blancas). */
  ember: { geometry: new THREE.OctahedronGeometry(0.06, 0).scale(1, 1, 2), color: MAGMA, additive: false },
  scorch: { geometry: scorchGeometry(), color: SCORCH_COLOR, additive: false },
  groundGlow: { geometry: glowGeometry().rotateX(-Math.PI / 2), color: MAGMA, additive: true },
  bubble: { geometry: new THREE.IcosahedronGeometry(1, 1), color: EMBER, additive: true },
  meteorRock: { geometry: meteorRockGeometry(), color: WHITE, additive: false },
  fireTrail: { geometry: trailGeometry(0.75), color: MAGMA, additive: true },
  fireCore: { geometry: trailGeometry(0.28), color: HOT, additive: true },
} as const
type Kind = keyof typeof KINDS
const CRACK_KINDS = ['crack0', 'crack1', 'crack2'] as const
/** Las que miran siempre a la cámara. */
const FACING: ReadonlySet<Kind> = new Set<Kind>(['glow', 'star', 'cut'])
/** Las que giran hacia la cámara pero siguen de pie. */
const UPRIGHT: ReadonlySet<Kind> = new Set<Kind>(['flame'])
/** Las macizas: tapan en vez de sumar luz, y menguan en vez de transparentarse. */
const SOLID: ReadonlySet<Kind> = new Set<Kind>(['pebble', 'chip', 'shard', 'leaf', 'meteorRock'])

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
  /** Las que miran a la cámara, giradas este ángulo en la pantalla (el tajo de la espada). */
  roll: number
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

/** Algo que va soltando piezas un rato: cada `every` segundos llama a `emit` con lo que lleva de vida (0 a 1). */
interface Emitter {
  age: number
  life: number
  every: number
  toEmit: number
  emit: (k: number) => void
}

/** Un anillo de fuego del Guardián: sus llamas van con el aro hasta su radio. `age` empieza negativo si sale más tarde. */
interface FlameRing {
  x: number
  z: number
  speed: number
  radius: number
  age: number
  flames: Piece[]
  toEmit: number
}

/** Un charco de lava: avisa `warn` segundos, arde `burn` y se enfría; `glow` es la luz del suelo. */
interface Pool {
  x: number
  y: number
  z: number
  radius: number
  age: number
  warn: number
  burn: number
  glow: Piece
  lit: boolean
  toEmit: number
}

/** Un meteorito pequeño que baja hacia (x, y, z) y llega en `fall` segundos: la roca, sus luces y su estela. */
interface Drop {
  x: number
  y: number
  z: number
  /** Hacia dónde queda el cielo del que viene. */
  dir: THREE.Vector3
  age: number
  fall: number
  pieces: Piece[]
  toEmit: number
}

/**
 * Lo justo de un enemigo para seguirlo: dónde estaba, dónde está y hacia dónde mira. Con su tipo, si está vivo y su
 * vida, al Guardián le salen brasas del cuerpo (más enfurecido).
 */
export interface FxEnemy {
  id: number
  pos: { x: number; z: number }
  prev: { x: number; z: number }
  yaw: number
  type?: EnemyType
  alive?: boolean
  hp?: number
  maxHp?: number
}

/** De qué es lo que golpea el jugador: decide qué salta (astillas, lascas, chispas, hojas…). */
export type ImpactMaterial =
  | 'wood'
  | 'birch'
  | 'darkwood'
  | 'deadwood'
  | 'leaves'
  | 'stone'
  | 'coal'
  | 'iron'
  | 'mithril'
  | 'crystal'
  | 'creature'
  | 'rockCreature'
  | 'woodCreature'

/** Un golpe del jugador que da en algo: dónde, hacia dónde mira la cara golpeada (hacia quien golpea) y con qué. */
export interface Impact {
  x: number
  y: number
  z: number
  /** Hacia quien golpea, en horizontal (unitario): por ahí salta lo que salta. */
  nx: number
  nz: number
  material: ImpactMaterial
  tool: WeaponClass
  /** Cuánto daño le hace a un enemigo por su debilidad: lo eficaz brilla en oro, lo resistido apenas. */
  efficacy?: HitEfficacy
  /** No le hace nada (falta la herramienta que pide): solo un golpe seco, sin que salte nada. */
  blocked?: boolean
  /** A qué altura empieza la copa (árboles): de ahí caen unas hojas. */
  canopy?: number
  /** El tajo de la espada en la pantalla (radianes desde la horizontal): el corte se dibuja así. */
  slash?: number
}

/** Lo que salta de cada material: los trozos (y sus colores), las chispas, el polvo y si brilla. */
interface ImpactLook {
  debris: 'chip' | 'shard' | 'glassShard' | 'leaf' | null
  colors: readonly string[]
  pieces: number
  sparks: number
  sparkColors: readonly string[]
  dust: string | null
  /** Una estrella de luz pequeña: el destello del metal o del cristal. */
  glint?: string
  /** Hojas de la copa (árboles con hojas), de este color. */
  leaves?: string
}

const IMPACTS: Record<ImpactMaterial, ImpactLook> = {
  wood: { debris: 'chip', colors: ['#d8a468', '#8a5a32', '#e8c08a'], pieces: 7, sparks: 0, sparkColors: [], dust: '#b89a72', leaves: '#3d7d35' },
  birch: { debris: 'chip', colors: ['#f2eee4', '#d8c8a8', '#2f2c28'], pieces: 7, sparks: 0, sparkColors: [], dust: '#cfc6b0', leaves: '#5f9e3a' },
  darkwood: { debris: 'chip', colors: ['#6b4a32', '#3e2c20', '#a07850'], pieces: 7, sparks: 0, sparkColors: [], dust: '#7a6450', leaves: '#24502e' },
  deadwood: { debris: 'chip', colors: ['#b8a68f', '#8d7b68', '#5e5040'], pieces: 7, sparks: 0, sparkColors: [], dust: '#a89880' },
  leaves: { debris: 'leaf', colors: ['#3d7d35', '#57a85a', '#2f6a2a'], pieces: 6, sparks: 0, sparkColors: [], dust: null },
  stone: { debris: 'shard', colors: ['#9a978a', '#7d786c', '#b5b2a6'], pieces: 7, sparks: 3, sparkColors: ['#fff1c8'], dust: '#a8a294' },
  coal: { debris: 'shard', colors: ['#2a2826', '#1c1b1a', '#4a4642'], pieces: 7, sparks: 2, sparkColors: ['#ffd9a0'], dust: '#5a554e' },
  iron: { debris: 'shard', colors: ['#7b7268', '#9a978a', '#c8743a'], pieces: 6, sparks: 7, sparkColors: ['#ffb347', '#ffe2a0'], dust: '#9a9286', glint: '#ffd08a' },
  mithril: { debris: 'shard', colors: ['#6c7080', '#4fb3f0', '#8a8e9c'], pieces: 6, sparks: 6, sparkColors: ['#7fd8ff', '#e8fbff'], dust: '#8a8e9c', glint: '#9fe6ff' },
  crystal: { debris: 'glassShard', colors: ['#7ff0ff', '#c8fbff', '#4fd8f0'], pieces: 7, sparks: 4, sparkColors: ['#9ff4ff'], dust: null, glint: '#bff8ff' },
  creature: { debris: null, colors: [], pieces: 0, sparks: 6, sparkColors: [PLAYER_HIT], dust: null },
  rockCreature: { debris: 'shard', colors: ['#8a8578', '#6e6a60', '#a8a294'], pieces: 5, sparks: 5, sparkColors: ['#fff1c8'], dust: '#a8a294' },
  woodCreature: { debris: 'chip', colors: ['#8a6a48', '#5e4630', '#b08a5e'], pieces: 5, sparks: 3, sparkColors: [PLAYER_HIT], dust: '#9a8466' },
}
/** Cuánto salta según con qué se golpea: lo pesado, más y más lejos; la espada y la mano contra un prop, poco. */
const IMPACT_FORCE: Record<WeaponClass, number> = { axe: 1.15, pickaxe: 1.15, sword: 0.75, hand: 0.55 }
/** Las chispas de los golpes del jugador, más finas que las de los jefes. */
const PLAYER_SPARK = 0.22
const DEBRIS_TIME = 0.7
const DEBRIS_GRAVITY = 16
const LEAF_TIME = 1.5
const CUT_TIME = 0.18

const ahead = new THREE.Vector3()
const velocity = new THREE.Vector3()
const point = new THREE.Vector3()
const spot = new THREE.Vector3()

/**
 * Los efectos de los ataques de los jefes, cada jefe con su color: el viento del golpe al suelo y la roca que perfora
 * el aire del Lanzarrocas; las grietas del pisotón, la embestida y las flechas azules del trasgo gigante; el fuego, la
 * lava y el meteorito pequeño del Guardián, que echa brasas siempre (muchas más enfurecido). Solo vista, sin
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
  private emitters: Emitter[] = []
  private rings: FlameRing[] = []
  private pools: Pool[] = []
  private drops: Drop[] = []
  /** Lo que le falta a cada Guardián para soltar la siguiente brasa del cuerpo (s). */
  private embers = new Map<number, number>()
  /** Cae un meteorito pequeño en (x, z): para que tiemble la pantalla. */
  onImpact?: (x: number, z: number) => void
  /** Dónde está la cámara (la del último `update`): lo que se le acerca mucho se desvanece. */
  private eye = new THREE.Vector3(0, 1e6, 0)

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
  /**
   * Un golpe del jugador que da en algo, en el punto exacto del impacto: lo que salta depende del material (astillas de
   * madera, lascas y chispas de la piedra y el mineral, cristales, hojas) y de con qué se golpea. A un enemigo, la espada
   * le deja un tajo y un destello; el hacha y el pico, un golpe más sordo. Sin daño, solo un golpe seco. Todo con algo de
   * azar (cuántos, hacia dónde, de qué tamaño) para que no haya dos iguales, y poco: se va en menos de un segundo.
   */
  impact(hit: Impact) {
    const rng = this.rng
    const look = IMPACTS[hit.material]
    const { x, y, z } = hit
    const toward = { x: hit.nx, z: hit.nz }
    const creature = hit.material === 'creature' || hit.material === 'rockCreature' || hit.material === 'woodCreature'
    if (hit.blocked) {
      // Un golpe seco: la herramienta rebota. En la piedra, unas chispas; en la madera, un poco de polvo.
      if (look.sparks > 0) this.sparks(x, y, z, 4, 2.6, WHITE, SPARK_TIME * 0.7, toward, PLAYER_SPARK)
      this.flash(x, y, z, 0.35, 0.1, PLAYER_HIT)
      if (look.dust) this.dust(x, y - 0.2, z, 2, 0.25, 0.35, 0.16, 0.4, look.dust)
      return
    }
    const force = IMPACT_FORCE[hit.tool]
    const tint = hit.efficacy === 'effective' ? EFFECTIVE_HIT : hit.efficacy === 'resisted' ? RESISTED_HIT : PLAYER_HIT
    if (creature) {
      const resisted = hit.efficacy === 'resisted'
      if (hit.tool === 'sword') {
        // El tajo: una raya de luz que se abre a lo largo del corte, y una estrella en medio.
        const cut = this.take(
          'cut',
          CUT_TIME,
          (p, t) => {
            p.mesh.scale.set(p.size * (0.35 + 0.65 * easeOut(Math.min(1, t * 3))), p.size * (1 - t * 0.6), 1)
            p.material.opacity = (1 - t) ** 1.5
          },
          tint,
        )
        cut.size = resisted ? 0.28 : 0.42
        cut.roll = hit.slash ?? (rng() - 0.5) * 1.2
        cut.mesh.position.set(x, y, z)
        cut.mesh.scale.set(cut.size * 0.35, cut.size, 1)
        this.star(x, y, z, resisted ? 0.18 : 0.3, 0.12, tint)
      } else {
        // Lo pesado (y la mano): un golpe sordo, un destello redondo y algo de polvo.
        this.flash(x, y, z, hit.tool === 'hand' ? 0.3 : 0.5, 0.14, tint)
        if (hit.tool !== 'hand') this.star(x, y, z, resisted ? 0.18 : 0.28, 0.12, tint)
        this.dust(x, y - 0.2, z, hit.tool === 'hand' ? 2 : 3, 0.35, 0.4, 0.2, 0.4, look.dust ?? '#c8c0b0')
      }
      const sparks = Math.round((resisted ? 0.5 : 1) * (look.sparks * 0.7 + (hit.tool === 'sword' ? 1 : 0)) * (0.8 + rng() * 0.4))
      this.sparks(x, y, z, sparks, 3.2, hit.efficacy === 'effective' ? EFFECTIVE_HIT : look.sparkColors[0] ?? tint, SPARK_TIME * 0.8, toward, PLAYER_SPARK)
      if (look.debris) this.debris(look, x, y, z, toward, Math.round(look.pieces * (0.5 + rng() * 0.4)), 0.9)
      return
    }
    // Un prop: lo que salta, hacia quien golpea.
    const count = Math.max(1, Math.round(look.pieces * force * (0.75 + rng() * 0.5)))
    if (look.debris) this.debris(look, x, y, z, toward, count, force)
    for (let i = 0; i < look.sparks; i++) {
      if (rng() > force) continue
      this.sparks(x, y, z, 1, 3.6 * force, look.sparkColors[i % look.sparkColors.length], SPARK_TIME * 0.8, toward, PLAYER_SPARK)
    }
    if (look.dust) this.dust(x, y - 0.2, z, 2 + Math.round(rng()), 0.3 * force, 0.45, 0.18, 0.4, look.dust)
    if (look.glint) this.star(x, y, z, 0.35 + rng() * 0.15, 0.12, look.glint)
    this.flash(x, y, z, 0.3 * force, 0.09, PLAYER_HIT)
    // Unas hojas que caen de la copa, como si el golpe la sacudiera.
    if (look.leaves && hit.canopy !== undefined && hit.tool !== 'hand') {
      const leaves = 2 + Math.floor(rng() * 2)
      for (let i = 0; i < leaves; i++) this.leaf(x - hit.nx * 0.2 + (rng() - 0.5) * 1.6, hit.canopy + rng() * 0.8, z - hit.nz * 0.2 + (rng() - 0.5) * 1.6, look.leaves)
    }
  }

  /**
   * El Guardián (en x, z, mirando a `yaw`) prepara `attack`, que tarda `windup` segundos: el suelo se calienta bajo él,
   * le suben brasas y se enciende lo que prepara. El anillo de fuego abre grietas de lava a sus pies; el tajo, el
   * espadón en alto; el meteorito, una bola de fuego encima que lo llama; los charcos, el fuego de su mano izquierda.
   */
  guardianWindup(x: number, z: number, yaw: number, attack: SpecialId, windup: number) {
    const y = this.ground(x, z)
    const rng = this.rng
    const fx = Math.sin(yaw)
    const fz = Math.cos(yaw)
    // Su derecha (mirando a +z, la mano derecha queda en -x).
    const rx = -fz
    const rz = fx
    const heat = this.take('groundGlow', windup + 0.25, (p, t) => {
      p.mesh.scale.setScalar(1.2 + 2.6 * easeOut(Math.min(1, t * 1.2)))
      p.material.opacity = Math.min(1, t * 1.6) * (t > 0.8 ? (1 - t) / 0.2 : 1) * (0.55 + 0.15 * Math.sin(p.age * 30))
    })
    heat.mesh.position.set(x, y + 0.07, z)
    this.emitters.push({
      age: 0,
      life: windup,
      every: 0.03,
      toEmit: 0,
      emit: (k) => {
        const a = rng() * Math.PI * 2
        const r = 0.5 + rng() * 1.2
        this.ember(x + Math.cos(a) * r, y + 0.2 + rng() * 0.8, z + Math.sin(a) * r, 1.6 + k * 2.5, 1.2)
      },
    })
    switch (attack) {
      case 'fireRing':
        this.cracks(x, y, z, 7, 2.2, 1.6, windup + 0.9, windup)
        break
      case 'lavaSlash':
        this.charging(x + rx * 0.9 - fx * 0.4, y + GUARDIAN_HEIGHT * 1.05, z + rz * 0.9 - fz * 0.4, windup, 1.2)
        break
      case 'meteorDrop': {
        const top = y + GUARDIAN_HEIGHT + 2.2
        this.charging(x, top, z, windup, 1.6)
        // Chispas que suben deprisa al cielo: de ahí bajará.
        this.emitters.push({ age: 0, life: windup, every: 0.04, toEmit: 0, emit: () => this.ember(x + (rng() - 0.5) * 0.6, top, z + (rng() - 0.5) * 0.6, 14, 0.5, HOT) })
        break
      }
      case 'burningGround':
        this.charging(x - rx * 0.8 + fx * 0.3, y + GUARDIAN_HEIGHT * 0.6, z - rz * 0.8 + fz * 0.3, windup, 1.4)
        break
    }
  }

  /**
   * El tajo de lava en (x, z): un destello, el arco del espadón desde `from` (quien golpea), grietas al rojo, una onda,
   * llamas, chispas, humo y el suelo quemado.
   */
  lavaSlash(x: number, z: number, from?: { x: number; z: number }) {
    const y = this.ground(x, z)
    const rng = this.rng
    this.flash(x, y + 0.8, z, 2, 0.3, MAGMA)
    this.flash(x, y + 0.6, z, 0.9, 0.2, HOT)
    if (from) {
      const dx = x - from.x
      const dz = z - from.z
      const length = Math.hypot(dx, dz) || 1
      const fx = dx / length
      const fz = dz / length
      const radius = SWING_RADIUS * 1.25
      const cx = x - fx * radius * Math.cos(-0.95)
      const cz = z - fz * radius * Math.cos(-0.95)
      for (const [color, k] of [[MAGMA, 1], [HOT, 0.93]] as const) {
        const piece = this.take(
          'swing',
          SWING_TIME * 1.4,
          (p, t) => {
            p.mesh.scale.setScalar(p.size * (1 + t * 0.12))
            p.material.opacity = (1 - t) ** 2
          },
          color,
        )
        piece.size = radius * k
        piece.mesh.position.set(cx, y - radius * Math.sin(-0.95), cz)
        piece.mesh.rotation.set(0, Math.atan2(-fz, fx), 0)
        piece.mesh.scale.setScalar(piece.size)
      }
    }
    this.cracks(x, y, z, 6, 1.8, 1.4, 1.8)
    const wave = this.take(
      'wave',
      WAVE_TIME,
      (p, t) => {
        p.mesh.scale.setScalar(0.5 + 3 * easeOut(t))
        p.material.opacity = 0.9 * (1 - t)
      },
      MAGMA,
    )
    wave.mesh.position.set(x, y + 0.06, z)
    this.sparks(x, y + 0.4, z, 18, 6.5, MAGMA, SPARK_TIME, 'ember')
    for (let i = 0; i < 7; i++) {
      const a = rng() * Math.PI * 2
      const r = 0.4 + rng() * 1.6
      this.flame(x + Math.cos(a) * r, y, z + Math.sin(a) * r, 1 + rng() * 0.9, 0.55 + rng() * 0.4, 0.9)
    }
    for (let i = 0; i < 12; i++) this.ember(x + (rng() - 0.5) * 2, y + 0.3, z + (rng() - 0.5) * 2, 2.2, 1.3)
    this.smoke(x, y + 0.3, z, 4, 1.4, 2.5, 1.5, 0.75, 0.45)
    this.pebbles(x, y, z, 6, 1)
    this.scorch(x, z, 2.6)
  }

  /**
   * El anillo de fuego que sale de (x, z) a `speed` m/s hasta `radius`, dentro de `delay` segundos: una pared de llamas
   * que corre por el suelo y deja brasas, humo y fuego por donde pasa.
   */
  flameRing(x: number, z: number, radius: number, speed: number, delay = 0) {
    this.rings.push({ x, z, speed, radius, age: -delay, flames: [], toEmit: 0 })
  }

  /**
   * Un charco de lava en (x, z), de `radius` metros: avisa `warn` segundos (el suelo humea y se agrieta), arde `burn`
   * (burbujas, llamas y brasas) y se enfría dejando el suelo negro.
   */
  lavaPool(x: number, z: number, radius: number, warn: number, burn: number) {
    const y = this.ground(x, z)
    const glow = this.take('groundGlow', Infinity, () => {})
    glow.mesh.position.set(x, y + 0.09, z)
    glow.material.opacity = 0
    this.pools.push({ x, y, z, radius, age: 0, warn, burn, glow, lit: false, toEmit: 0 })
    this.cracks(x, y, z, 4, radius * 0.6, radius * 0.4, warn + burn + POOL_COOL, warn, 0.6)
  }

  /**
   * Un meteorito pequeño que cae del cielo en (x, z) dentro de `fall` segundos, con su estela de fuego. `from`: quien lo
   * llama; viene por detrás de él.
   */
  meteorDrop(x: number, z: number, fall: number, from?: { x: number; z: number }) {
    const rng = this.rng
    const rock = this.take('meteorRock', Infinity, () => {})
    rock.mesh.scale.setScalar(DROP_ROCK)
    rock.spin.set(rng() * 6 - 3, rng() * 6 - 3, rng() * 6 - 3)
    const glow = this.take('glow', Infinity, () => {}, MAGMA)
    glow.mesh.scale.setScalar(2)
    const hot = this.take('glow', Infinity, () => {}, HOT)
    hot.mesh.scale.setScalar(0.9)
    const trail = this.take('fireTrail', Infinity, () => {})
    trail.material.opacity = 0.85
    const core = this.take('fireCore', Infinity, () => {})
    const dir = DROP_FROM.clone()
    if (from && Math.hypot(from.x - x, from.z - z) > 0.5) dir.set(from.x - x, 0, from.z - z).setLength(DROP_SLOPE).setY(1).normalize()
    const drop = { x, y: this.ground(x, z), z, dir, age: 0, fall: Math.max(0.05, fall), pieces: [rock, glow, hot, trail, core], toEmit: 0 }
    this.drops.push(drop)
    this.fall(drop, 0)
  }

  /** El Guardián se enfurece en (x, z): un estallido de fuego a su alrededor. Luego le salen más brasas (`update`). */
  fury(x: number, z: number) {
    const y = this.ground(x, z)
    const rng = this.rng
    this.flash(x, y + 1.8, z, 3.2, 0.45, MAGMA)
    this.flash(x, y + 1.6, z, 1.4, 0.3, HOT)
    const ring = this.take(
      'groundRing',
      0.6,
      (p, t) => {
        p.mesh.scale.setScalar(1 + 5 * easeOut(t))
        p.material.opacity = 1 - t
      },
      MAGMA,
    )
    ring.mesh.position.set(x, y + 0.08, z)
    this.sparks(x, y + 1.5, z, 30, 8, MAGMA, SPARK_TIME * 1.3, 'ember')
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + rng() * 0.3
      const r = 1.6 + rng() * 1.2
      this.flame(x + Math.cos(a) * r, y, z + Math.sin(a) * r, 1.5 + rng(), 0.7 + rng() * 0.4, 1.1)
    }
    this.smoke(x, y + 0.5, z, 7, 2.5, 4, 2, 1, 0.5)
    this.scorch(x, z, 3.5)
  }

  /**
   * Por frame: lo que vuela (estela y marcas por el camino), las ondas, las embestidas (`enemies`, para seguirlas) y las
   * piezas en marcha. Con `camera`, los brillos y las estrellas la miran.
   */
  update(dt: number, projectiles: readonly Projectile[], alpha: number, enemies: readonly FxEnemy[] = [], camera?: THREE.Camera) {
    this.seen.clear()
    if (camera) this.eye.copy(camera.position)
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
    for (const ring of [...this.rings]) this.burnRing(ring, dt)
    for (const pool of [...this.pools]) this.burnPool(pool, dt)
    for (const drop of [...this.drops]) this.fall(drop, dt)
    for (const emitter of [...this.emitters]) {
      emitter.age += dt
      emitter.toEmit -= dt
      while (emitter.toEmit <= 1e-9) {
        emitter.emit(Math.min(1, emitter.age / emitter.life))
        emitter.toEmit += emitter.every
      }
      if (emitter.age >= emitter.life) this.emitters.splice(this.emitters.indexOf(emitter), 1)
    }
    this.bodyEmbers(enemies, alpha, dt)
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
        if (piece.spin.z || piece.roll) piece.mesh.rotateZ(piece.roll + piece.spin.z * piece.age)
      }
      if (camera && UPRIGHT.has(piece.kind)) {
        const { position } = piece.mesh
        piece.mesh.rotation.set(0, Math.atan2(camera.position.x - position.x, camera.position.z - position.z), 0)
      }
    }
  }

  /** Al cambiar de partida o de isla: todo fuera (las piezas se guardan). */
  reset() {
    for (const piece of [...this.active]) this.give(piece)
    this.flights.clear()
    this.waves.length = 0
    this.rushes.clear()
    this.emitters.length = 0
    this.rings.length = 0
    this.pools.length = 0
    this.drops.length = 0
    this.embers.clear()
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

  /** Un anillo de fuego avanza: al salir, un estallido; luego sus llamas van con el aro y dejan fuego por donde pasa. */
  private burnRing(ring: FlameRing, dt: number) {
    const started = ring.age >= 0
    ring.age += dt
    if (ring.age < 0) return
    const rng = this.rng
    const { x, z } = ring
    if (!started || ring.flames.length === 0) {
      const y = this.ground(x, z)
      this.flash(x, y + 0.8, z, 2.4, 0.35, MAGMA)
      const burst = this.take(
        'groundRing',
        0.45,
        (p, t) => {
          p.mesh.scale.setScalar(0.6 + 3 * easeOut(t))
          p.material.opacity = 1 - t
        },
        MAGMA,
      )
      burst.mesh.position.set(x, y + 0.08, z)
      this.sparks(x, y + 0.4, z, 20, 6, MAGMA, SPARK_TIME, 'ember')
      this.smoke(x, y + 0.2, z, 5, 2, 2.5, 1.6, 0.75, 0.45)
      this.scorch(x, z, 3.2)
      for (let i = 0; i < RING_FLAMES; i++) {
        const flame = this.take('flame', Infinity, () => {})
        flame.spin.set(rng() * 10, (i / RING_FLAMES) * Math.PI * 2 + (rng() - 0.5) * 0.08, 0)
        flame.size = 0.85 + rng() * 0.45
        ring.flames.push(flame)
      }
    }
    const r = ring.age * ring.speed
    if (r > ring.radius + 0.6) {
      for (const flame of ring.flames) this.give(flame)
      this.rings.splice(this.rings.indexOf(ring), 1)
      return
    }
    // Más anchas cuanto más grande el aro, para que la pared no tenga huecos; se apagan al llegar al final.
    const width = Math.min(1.9, Math.max(0.35, ((Math.PI * 2 * r) / RING_FLAMES) * 1.5))
    const k = r / ring.radius
    const fade = k > 0.8 ? Math.max(0, (1 - k) / 0.2) : 1
    const grow = Math.min(1, 0.45 + r / 2.5)
    for (const flame of ring.flames) {
      const a = flame.spin.y
      const fx = x + Math.cos(a) * r
      const fz = z + Math.sin(a) * r
      const flicker = 1 + 0.2 * Math.sin(ring.age * 24 + flame.spin.x) + 0.1 * Math.sin(ring.age * 39 + flame.spin.x * 2)
      flame.mesh.position.set(fx, this.ground(fx, fz), fz)
      flame.mesh.scale.set(width, flame.size * grow * flicker, 1)
      flame.material.opacity = fade * this.clear(flame.mesh.position, 0.8, 2)
    }
    ring.toEmit -= dt
    while (ring.toEmit <= 0) {
      ring.toEmit += RING_EVERY
      for (let i = 0; i < 3; i++) {
        const a = rng() * Math.PI * 2
        const ex = x + Math.cos(a) * r
        const ez = z + Math.sin(a) * r
        const ey = this.ground(ex, ez)
        if (i === 0) this.ember(ex, ey + 0.4, ez, 2, 1.1)
        if (i === 1 && rng() < 0.6) this.smoke(ex, ey + 0.3, ez, 1, 0.3, 1.8, 1.3, 0.8, 0.45)
        // Lo que queda ardiendo detrás del aro, un momento.
        if (i === 2) this.flame(ex, ey, ez, 0.45 + rng() * 0.3, 0.4, 0.7)
      }
    }
  }

  /** Un charco de lava por frame: su luz, el estallido al prender y lo que suelta mientras avisa, arde y se enfría. */
  private burnPool(pool: Pool, dt: number) {
    pool.age += dt
    const { x, y, z, radius, glow } = pool
    const rng = this.rng
    const end = pool.warn + pool.burn
    if (pool.age >= end + POOL_COOL) {
      this.give(glow)
      this.pools.splice(this.pools.indexOf(pool), 1)
      return
    }
    if (pool.age < pool.warn) {
      const k = pool.age / pool.warn
      glow.mesh.scale.setScalar(radius * (0.6 + 0.4 * k))
      glow.material.opacity = (0.15 + 0.35 * k) * (0.7 + 0.3 * Math.sin(pool.age * 20))
    } else if (pool.age < end) {
      glow.mesh.scale.setScalar(radius * 1.25)
      glow.material.opacity = 0.8 + 0.12 * Math.sin(pool.age * 9) + 0.08 * Math.sin(pool.age * 23)
    } else {
      glow.material.opacity = 0.8 * (1 - (pool.age - end) / POOL_COOL)
    }
    if (!pool.lit && pool.age >= pool.warn) {
      pool.lit = true
      this.flash(x, y + 0.6, z, radius * 1.1, 0.35, MAGMA)
      this.sparks(x, y + 0.3, z, 12, 5, MAGMA, SPARK_TIME, 'ember')
      for (let i = 0; i < 8; i++) {
        const a = rng() * Math.PI * 2
        const r = radius * 0.8 * Math.sqrt(rng())
        this.flame(x + Math.cos(a) * r, y, z + Math.sin(a) * r, 0.8 + rng() * 0.6, 0.6 + rng() * 0.3)
      }
    }
    if (pool.age >= end && pool.age - dt < end) {
      // Se apaga: queda negro y echa humo.
      this.scorch(x, z, radius * 1.15, 3)
      this.smoke(x, y + 0.2, z, 6, radius * 0.7, 2.5, 1.8, 1, 0.5)
    }
    pool.toEmit -= dt
    while (pool.toEmit <= 0) {
      pool.toEmit += POOL_EVERY
      const a = rng() * Math.PI * 2
      const r = radius * 0.85 * Math.sqrt(rng())
      const px = x + Math.cos(a) * r
      const pz = z + Math.sin(a) * r
      if (pool.age < pool.warn) {
        if (rng() < 0.4) this.smoke(px, y + 0.05, pz, 1, 0.2, 0.9, 0.9, 0.28, 0.3)
      } else if (pool.age < end) {
        const roll = rng()
        if (roll < 0.35) this.bubble(px, y, pz)
        else if (roll < 0.7) this.flame(px, y, pz, 0.35 + rng() * 0.55, 0.45 + rng() * 0.3, 0.6)
        else this.ember(px, y + 0.2, pz, 1.5, 1.1)
        if (rng() < 0.08) this.smoke(px, y + 0.3, pz, 1, 0.3, 2.2, 1.6, 0.5, 0.35)
      }
    }
  }

  /** El meteorito pequeño baja: la roca girando, sus luces y la estela, brasas y humo detrás; al llegar, `crash`. */
  private fall(drop: Drop, dt: number) {
    drop.age += dt
    if (drop.age >= drop.fall) {
      this.drops.splice(this.drops.indexOf(drop), 1)
      this.crash(drop)
      return
    }
    const left = 1 - drop.age / drop.fall
    point.set(drop.x, drop.y + DROP_ROCK * 0.6, drop.z).addScaledVector(drop.dir, DROP_DISTANCE * left)
    velocity.copy(drop.dir).multiplyScalar(-DROP_DISTANCE / drop.fall)
    // Si cae encima de la cámara, la estela y las luces no la atraviesan: se desvanecen al llegar.
    const near = Math.min(1, Math.max(0, (point.distanceTo(this.eye) - 1.5) / DROP_FADE))
    ahead.copy(point).add(velocity)
    const [rock, glow, hot, trail, core] = drop.pieces
    rock.mesh.position.copy(point)
    rock.mesh.scale.setScalar(DROP_ROCK * Math.min(1, near * 3))
    rock.mesh.rotation.x += rock.spin.x * dt
    rock.mesh.rotation.y += rock.spin.y * dt
    rock.mesh.rotation.z += rock.spin.z * dt
    glow.mesh.position.copy(point)
    glow.mesh.scale.setScalar(2 * (1 + 0.1 * Math.sin(drop.age * 33)))
    glow.material.opacity = near
    hot.mesh.position.copy(point)
    hot.material.opacity = near
    trail.material.opacity = 0.85 * near
    core.material.opacity = near
    const length = Math.max(0.01, Math.min(DROP_TRAIL, DROP_DISTANCE * (1 - left)))
    for (const piece of [trail, core]) {
      piece.mesh.position.copy(point)
      piece.mesh.lookAt(ahead)
      piece.mesh.scale.set(1, 1, length)
    }
    drop.toEmit -= dt
    const rng = this.rng
    while (drop.toEmit <= 0) {
      drop.toEmit += 0.025
      this.ember(point.x + (rng() - 0.5) * 0.8, point.y + (rng() - 0.5) * 0.8, point.z + (rng() - 0.5) * 0.8, 0.6, 0.6)
      if (rng() < 0.5) this.smoke(point.x, point.y, point.z, 1, 0.3, 0.6, 1.1, 0.9, 0.45)
    }
  }

  /** El meteorito pequeño llega al suelo: estalla en fuego, salta tierra, se agrieta y queda ardiendo y quemado. */
  private crash(drop: Drop) {
    for (const piece of drop.pieces) this.give(piece)
    const { x, y, z } = drop
    const rng = this.rng
    this.flash(x, y + 1, z, 3, 0.4, MAGMA)
    this.flash(x, y + 0.8, z, 1.2, 0.25, HOT)
    const star = this.take(
      'star',
      0.35,
      (p, t) => {
        p.mesh.scale.setScalar(p.size * (0.6 + 0.6 * easeOut(Math.min(1, t * 3))))
        p.material.opacity = 0.9 * (1 - t) ** 1.3
      },
      HOT,
    )
    star.size = 2.8
    star.spin.z = 1.2
    star.mesh.position.set(x, y + 1, z)
    const ring = this.take(
      'groundRing',
      0.5,
      (p, t) => {
        p.mesh.scale.setScalar(0.6 + 4 * easeOut(t))
        p.material.opacity = 1 - t
      },
      MAGMA,
    )
    ring.mesh.position.set(x, y + 0.08, z)
    this.cracks(x, y, z, 6, 1.6, 1.2, 2)
    this.sparks(x, y + 0.5, z, 26, 9, MAGMA, SPARK_TIME * 1.3, 'ember')
    this.pebbles(x, y, z, 10, 1.4)
    this.smoke(x, y + 0.3, z, 6, 2, 4, 2, 0.9, 0.5)
    for (let i = 0; i < 10; i++) {
      const a = rng() * Math.PI * 2
      const r = rng() * 1.6
      this.flame(x + Math.cos(a) * r, y, z + Math.sin(a) * r, 1 + rng(), 0.7 + rng() * 0.4)
    }
    for (let i = 0; i < 16; i++) this.ember(x + (rng() - 0.5) * 2.5, y + 0.3, z + (rng() - 0.5) * 2.5, 2.5, 1.4)
    this.scorch(x, z, 3, 5)
    this.onImpact?.(x, z)
  }

  /** Brasas que le suben del cuerpo a cada Guardián vivo, muchas más enfurecido. */
  private bodyEmbers(enemies: readonly FxEnemy[], alpha: number, dt: number) {
    const rng = this.rng
    for (const e of enemies) {
      if (e.type !== 'guardian' || e.alive === false) continue
      const angry = e.hp !== undefined && e.maxHp !== undefined && furious({ type: e.type, hp: e.hp, maxHp: e.maxHp })
      const every = angry ? FURY_EMBER_EVERY : BODY_EMBER_EVERY
      const x = e.prev.x + (e.pos.x - e.prev.x) * alpha
      const z = e.prev.z + (e.pos.z - e.prev.z) * alpha
      const y = this.ground(x, z)
      let left = (this.embers.get(e.id) ?? rng() * every) - dt
      for (let n = 0; left <= 0 && n < 40; n++) {
        left += every
        const a = rng() * Math.PI * 2
        const r = 0.3 + rng() * 0.6
        this.ember(x + Math.cos(a) * r, y + 0.6 + rng() * GUARDIAN_HEIGHT * 0.85, z + Math.sin(a) * r, 1.2 + rng(), 1.2)
        // Enfurecido arde: llamitas a los pies y humo.
        if (angry && rng() < 0.18) this.flame(x + Math.cos(a) * (r + 0.4), y, z + Math.sin(a) * (r + 0.4), 0.7 + rng() * 0.6, 0.45, 0.8)
        if (angry && rng() < 0.08) this.smoke(x, y + GUARDIAN_HEIGHT * 0.7, z, 1, 0.6, 2, 1.6, 0.9, 0.4)
      }
      this.embers.set(e.id, left)
    }
    for (const id of this.embers.keys()) if (!enemies.some((e) => e.id === id && e.type === 'guardian' && e.alive !== false)) this.embers.delete(id)
  }

  /** Luz que crece donde un ataque se prepara durante `life` segundos: naranja por fuera y blanca por dentro. */
  private charging(x: number, y: number, z: number, life: number, size: number) {
    for (const [color, k] of [[MAGMA, 1], [HOT, 0.45]] as const) {
      const piece = this.take(
        'glow',
        life + 0.1,
        (p, t) => {
          p.mesh.scale.setScalar(p.size * (0.3 + 0.7 * easeOut(t)) * (1 + 0.08 * Math.sin(p.age * 40)))
          p.material.opacity = Math.min(1, t * 3)
        },
        color,
      )
      piece.size = size * k
      piece.mesh.position.set(x, y, z)
      piece.mesh.scale.setScalar(piece.size * 0.3)
    }
  }

  /**
   * `count` grietas de lava desde (x, z), de `length` a `length + extra` metros, que se abren en `open` segundos y se
   * apagan al final de `life`; `glow` las atenúa (las de los charcos, más tenues).
   */
  private cracks(x: number, y: number, z: number, count: number, length: number, extra: number, life: number, open = life * CRACK_OPEN, glow = 1) {
    const rng = this.rng
    const turn = rng() * Math.PI * 2
    for (let i = 0; i < count; i++) {
      const kind = CRACK_KINDS[i % CRACK_KINDS.length]
      const angle = turn + (i / count) * Math.PI * 2 + (rng() - 0.5) * 0.5
      const size = length + rng() * extra
      for (const [color, width] of [[MAGMA, 4.5], [HOT, 1.5]] as const) {
        const piece = this.take(
          kind,
          life,
          (p) => {
            const opened = Math.min(1, p.age / Math.max(1e-3, open))
            p.mesh.scale.set(p.size * (0.1 + 0.9 * easeOut(opened)), 1, width)
            const after = Math.max(0, (p.age - open) / Math.max(1e-3, p.life - open))
            p.material.opacity = glow * (p.age < open ? 0.4 + 0.6 * opened : after < 0.4 ? 1 : (1 - (after - 0.4) / 0.6) ** 1.5)
          },
          color,
        )
        piece.size = size
        piece.mesh.position.set(x, y + 0.05, z)
        piece.mesh.rotation.set(0, angle, 0)
        piece.mesh.scale.set(0.01, 1, width)
      }
    }
  }

  /** Una lengua de fuego de `height` metros en (x, y, z): crece, tiembla y se apaga en unos `life` segundos. */
  private flame(x: number, y: number, z: number, height: number, life: number, width = 1) {
    const rng = this.rng
    const piece = this.take('flame', life * (0.8 + rng() * 0.4), (p, t) => {
      const grow = easeOut(Math.min(1, t * 4))
      const flicker = 1 + 0.18 * Math.sin(p.age * 26 + p.spin.x) + 0.1 * Math.sin(p.age * 41 + p.spin.x * 2)
      // `velocity` guarda su ancho (x) y la altura del suelo (y).
      p.mesh.scale.set(p.velocity.x * (1 - t * 0.4), p.size * grow * flicker * (1 - t * 0.5), 1)
      p.mesh.position.y = p.velocity.y + t * 0.4
      p.material.opacity = (1 - t) ** 0.7 * this.clear(p.mesh.position, 0.8, 2)
    })
    piece.size = height
    piece.velocity.set(width * (0.8 + rng() * 0.4), y, 0)
    piece.spin.x = rng() * 10
    piece.mesh.position.set(x, y, z)
    piece.mesh.scale.set(width, 0.01, 1)
  }

  /** Una brasa que sube a unos `rise` m/s meciéndose y se apaga en unos `life` segundos. */
  private ember(x: number, y: number, z: number, rise: number, life: number, color?: string) {
    const rng = this.rng
    const piece = this.take(
      'ember',
      life * (0.7 + rng() * 0.6),
      (p, t, dt) => {
        p.velocity.y = Math.max(0.3, p.velocity.y - 0.8 * dt)
        p.mesh.position.x += (p.velocity.x + Math.sin(p.age * 7 + p.spin.x) * 0.6) * dt
        p.mesh.position.y += p.velocity.y * dt
        p.mesh.position.z += (p.velocity.z + Math.cos(p.age * 6 + p.spin.x) * 0.6) * dt
        ahead.copy(p.mesh.position).add(p.velocity)
        p.mesh.lookAt(ahead)
        p.mesh.scale.setScalar(p.size * (1 - t * 0.6))
        p.material.opacity = (t < 0.15 ? t / 0.15 : (1 - t) ** 0.8) * this.clear(p.mesh.position, 0.5, 1.2)
      },
      color ?? (rng() < 0.35 ? EMBER : rng() < 0.2 ? HOT : MAGMA),
    )
    piece.velocity.set((rng() - 0.5) * 0.8, rise * (0.7 + rng() * 0.6), (rng() - 0.5) * 0.8)
    piece.spin.x = rng() * 10
    piece.size = 0.8 + rng() * 0.6
    piece.mesh.position.set(x, y, z)
  }

  /** Una burbuja de lava que crece y revienta en chispas. */
  private bubble(x: number, y: number, z: number) {
    const rng = this.rng
    const life = 0.35 + rng() * 0.25
    const piece = this.take(
      'bubble',
      life,
      (p, t) => {
        p.mesh.scale.setScalar(p.size * (0.3 + 0.7 * t))
        p.mesh.position.y = p.velocity.y + p.size * 0.3 * t
        p.material.opacity = 0.9 * (1 - t * 0.3) * this.clear(p.mesh.position, 0.6, 1.5)
      },
      rng() < 0.5 ? EMBER : HOT,
    )
    piece.size = 0.18 + rng() * 0.2
    piece.velocity.y = y + 0.05
    piece.mesh.position.set(x, y + 0.05, z)
    this.emitters.push({ age: 0, life, every: Infinity, toEmit: life, emit: () => this.sparks(x, y + 0.2, z, 3, 2.5, MAGMA, 0.3, 'ember') })
  }

  /** `count` bocanadas de humo oscuro que suben unos `rise` metros abriéndose y se deshacen en `life` segundos. */
  private smoke(x: number, y: number, z: number, count: number, spread: number, rise: number, life: number, size = 1, opacity = 0.55) {
    const rng = this.rng
    for (let i = 0; i < count; i++) {
      const a = rng() * Math.PI * 2
      const out = spread * rng()
      const piece = this.take(
        'dust',
        life * (0.8 + rng() * 0.4),
        (p, t) => {
          const k = easeOut(t)
          // `spin` guarda de dónde sale.
          p.mesh.position.set(p.spin.x + p.velocity.x * k, p.spin.y + p.velocity.y * k, p.spin.z + p.velocity.z * k)
          p.mesh.scale.setScalar(p.size * (0.4 + 0.9 * k))
          p.material.opacity = opacity * Math.min(1, t * 5) * (1 - t) ** 1.2 * this.clear(p.mesh.position, 1, 3)
        },
        SMOKE_COLOR,
      )
      piece.spin.set(x + Math.cos(a) * out, y, z + Math.sin(a) * out)
      piece.velocity.set(Math.cos(a) * out * 0.5, rise * (0.7 + rng() * 0.6), Math.sin(a) * out * 0.5)
      piece.size = (0.5 + rng() * 0.5) * size
      piece.mesh.position.copy(piece.spin)
      piece.mesh.scale.setScalar(piece.size * 0.4)
      piece.material.opacity = 0
    }
  }

  /** El suelo quemado en (x, z), de `radius` metros: negro, se va en `life` segundos. */
  private scorch(x: number, z: number, radius: number, life = SCORCH_TIME) {
    const piece = this.take('scorch', life, (p, t) => {
      p.material.opacity = 0.75 * Math.min(1, t * 12) * (t > 0.6 ? (1 - t) / 0.4 : 1)
    })
    piece.mesh.position.set(x, this.ground(x, z) + 0.04, z)
    piece.mesh.rotation.y = this.rng() * Math.PI * 2
    piece.mesh.scale.set(radius, 1, radius)
    piece.material.opacity = 0
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

  /** Una estrella de luz que mira a la cámara, crece un poco y se apaga en `life` segundos. */
  private star(x: number, y: number, z: number, size: number, life: number, color: string) {
    const piece = this.take(
      'star',
      life,
      (p, t) => {
        p.mesh.scale.setScalar(p.size * (0.6 + 0.6 * easeOut(t)))
        p.material.opacity = (1 - t) ** 1.2
      },
      color,
    )
    piece.size = size
    piece.roll = this.rng() * Math.PI
    piece.mesh.position.set(x, y, z)
    piece.mesh.scale.setScalar(size * 0.6)
  }

  /**
   * `count` trozos de `look` (astillas, lascas, cristales u hojas) que saltan hacia `toward` y algo hacia arriba, giran,
   * caen y menguan. Rebotan un poco en el suelo.
   */
  private debris(look: ImpactLook, x: number, y: number, z: number, toward: { x: number; z: number }, count: number, force: number) {
    const rng = this.rng
    const kind = look.debris!
    const light = kind === 'leaf' || kind === 'glassShard'
    for (let i = 0; i < count; i++) {
      const piece = this.take(
        kind,
        DEBRIS_TIME * (0.7 + rng() * 0.6) * (kind === 'leaf' ? 1.6 : 1),
        (p, t, dt) => {
          const floor = this.ground(p.mesh.position.x, p.mesh.position.z) + 0.03
          p.velocity.y -= DEBRIS_GRAVITY * dt * (kind === 'leaf' ? 0.25 : 1)
          if (kind === 'leaf') p.velocity.multiplyScalar(1 - Math.min(1, dt * 3))
          p.mesh.position.addScaledVector(p.velocity, dt)
          if (p.mesh.position.y <= floor) {
            p.mesh.position.y = floor
            p.velocity.set(p.velocity.x * 0.3, Math.abs(p.velocity.y) * 0.2, p.velocity.z * 0.3)
          }
          p.mesh.rotation.x += p.spin.x * dt
          p.mesh.rotation.y += p.spin.y * dt
          p.mesh.rotation.z += p.spin.z * dt
          p.mesh.scale.setScalar(p.size * Math.min(1, (1 - t) * 4))
          if (light) p.material.opacity = 1 - t * t
        },
        look.colors[Math.floor(rng() * look.colors.length)],
      )
      // Sobre todo a los lados de la cara golpeada y hacia arriba; hacia quien golpea, poco (no salta a la cara).
      const side = (rng() < 0.5 ? -1 : 1) * (0.5 + rng() * 0.7)
      const out = (1.2 + rng() * 1.6) * force
      piece.velocity.set((toward.x * 0.45 - toward.z * side) * out, (1.4 + rng() * 2.4) * force, (toward.z * 0.45 + toward.x * side) * out)
      piece.spin.set(rng() * 20 - 10, rng() * 20 - 10, rng() * 20 - 10)
      piece.size = (0.6 + rng() * 0.8) * (kind === 'leaf' ? 1.4 : 1)
      piece.mesh.position.set(x + toward.x * 0.05, y, z + toward.z * 0.05)
      piece.mesh.rotation.set(rng() * 6, rng() * 6, rng() * 6)
      piece.mesh.scale.setScalar(piece.size)
    }
  }

  /** Una hoja que cae de la copa meciéndose, gira despacio y se queda un momento en el suelo. */
  private leaf(x: number, y: number, z: number, color: string) {
    const rng = this.rng
    const phase = rng() * Math.PI * 2
    const sway = 0.25 + rng() * 0.2
    const piece = this.take(
      'leaf',
      LEAF_TIME * (0.8 + rng() * 0.4),
      (p, t, dt) => {
        const floor = this.ground(p.mesh.position.x, p.mesh.position.z) + 0.02
        const fall = Math.max(floor, p.mesh.position.y - dt * 1.2)
        p.mesh.position.set(p.velocity.x + Math.sin(phase + p.age * 4) * sway, fall, p.velocity.z + Math.cos(phase + p.age * 3) * sway * 0.6)
        p.mesh.rotation.z = Math.sin(phase + p.age * 4) * 0.8
        p.mesh.rotation.y += dt * p.spin.y
        p.mesh.scale.setScalar(p.size * Math.min(1, (1 - t) * 5))
      },
      color,
    )
    // La velocidad guarda aquí el centro del vaivén.
    piece.velocity.set(x, 0, z)
    piece.spin.y = rng() * 4 - 2
    piece.size = 1.3 + rng() * 0.5
    piece.mesh.position.set(x, y, z)
  }

  /** `count` chispas que saltan a hasta `speed` m/s, caen un poco y se apagan. */
  private sparks(
    x: number, y: number, z: number, count: number, speed: number, color: string,
    life = SPARK_TIME,
    towardOrKind?: { x: number; z: number } | 'spark' | 'ember',
    sizeOrKind: number | 'spark' | 'ember' = 1,
  ) {
    const toward = typeof towardOrKind === 'object' ? towardOrKind : undefined
    const kind = typeof towardOrKind === 'string' ? towardOrKind : typeof sizeOrKind === 'string' ? sizeOrKind : 'spark'
    const size = typeof sizeOrKind === 'number' ? sizeOrKind : 1
    const rng = this.rng
    for (let i = 0; i < count; i++) {
      const piece = this.take(
        kind,
        life * (0.7 + rng() * 0.6),
        (p, t, dt) => {
          p.velocity.y -= 6 * dt
          p.mesh.position.addScaledVector(p.velocity, dt)
          ahead.copy(p.mesh.position).add(p.velocity)
          p.mesh.lookAt(ahead)
          p.mesh.scale.setScalar(p.size * (1 - t))
          // Las brasas del Guardián caen a tus pies: pegadas a la cámara se desvanecen.
          p.material.opacity = (1 - t * t) * (kind === 'ember' ? this.clear(p.mesh.position, 0.5, 1.2) : 1)
        },
        i % 3 === 0 ? (kind === 'ember' ? HOT : WHITE) : color,
      )
      const a = rng() * Math.PI * 2
      const up = rng()
      const s = speed * (0.4 + rng() * 0.6)
      piece.velocity.set(Math.cos(a) * s * (1 - up * 0.5), s * (0.3 + up), Math.sin(a) * s * (1 - up * 0.5))
      // Con `toward`, saltan algo más hacia ese lado (hacia quien golpea), pero sobre todo a los lados: no a la cara.
      if (toward) piece.velocity.x += toward.x * s * 0.35
      if (toward) piece.velocity.z += toward.z * s * 0.35
      piece.size = (0.8 + rng() * 0.8) * size
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
  private dust(x: number, y: number, z: number, count: number, reach: number, life: number, size = 1, opacity = 0.75, color: string = DUST_COLOR) {
    const rng = this.rng
    for (let i = 0; i < count; i++) {
      const angle = ((i + rng() * 0.6) / count) * Math.PI * 2
      const out = reach * (0.6 + rng() * 0.4)
      const piece = this.take(
        'dust',
        life * (0.8 + rng() * 0.3),
        (p, t) => {
          const k = easeOut(t)
          p.mesh.position.set(x + p.velocity.x * k, y + 0.2 + p.velocity.y * k, z + p.velocity.z * k)
          p.mesh.scale.setScalar(p.size * (0.35 + 0.75 * k))
          p.material.opacity = opacity * (1 - t) ** 1.4
        },
        color,
      )
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
      // Las piedritas, astillas, lascas, hojas y la roca del meteorito son macizas: menguan en vez de transparentarse.
      if (SOLID.has(kind)) Object.assign(material, { transparent: false, depthWrite: true, side: kind === 'leaf' ? THREE.DoubleSide : THREE.FrontSide })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.renderOrder = 2
      mesh.frustumCulled = false
      piece = { kind, mesh, material, age: 0, life, move, velocity: new THREE.Vector3(), spin: new THREE.Vector3(), size: 1, roll: 0 }
    }
    piece.material.color.set(color)
    piece.age = 0
    piece.life = life
    piece.move = move
    piece.size = 1
    piece.roll = 0
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

  /**
   * Lo que se ve de algo en `at` según lo cerca que está de la cámara: nada a menos de `near` metros, todo a `near +
   * span` o más. El humo y las llamas que caen a tus pies no tapan la pantalla.
   */
  private clear(at: THREE.Vector3, near: number, span: number) {
    return Math.min(1, Math.max(0, (at.distanceTo(this.eye) - near) / span))
  }

  private ground(x: number, z: number) {
    return Math.max(this.island.heightAt(x, z), WATER_LEVEL)
  }
}
