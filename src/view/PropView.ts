import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { BERRIES_PER_BUSH, PROP_DEFS, WOBBLE_DURATION } from '../sim/constants'
import type { SimEventData } from '../sim/events'
import {
  BUSH_LIFT,
  BUSH_RADIUS,
  BUSH_SQUASH,
  FOLIAGE_BASE,
  FOLIAGE_HEIGHT,
  FOLIAGE_RADIUS,
  FOLIAGE_SIDES,
  HERB_LIFT,
  HERB_RADIUS,
  HERB_SQUASH,
  ROCK_RADIUS,
  TRUNK_BOTTOM_RADIUS,
  TRUNK_HEIGHT,
  TRUNK_SIDES,
  TRUNK_TOP_RADIUS,
  type PropData,
  type PropKind,
  type PropPlacement,
} from '../sim/props'
import type { NatureModels } from './nature'

// Las geometrías son por familia (abedul y pino oscuro tienen la forma del árbol y las menas la de la roca) y los
// materiales por tipo. sim/aim.ts construye las hitboxes de cada familia con las mismas caras (salvo las bayas, la flor
// de la hierba y los cristales de las menas, que son adorno): una geometría nueva tiene que llevarse también allí.
const trunkGeometry = new THREE.CylinderGeometry(TRUNK_TOP_RADIUS, TRUNK_BOTTOM_RADIUS, TRUNK_HEIGHT, TRUNK_SIDES).translate(0, TRUNK_HEIGHT / 2, 0)
const foliageGeometry = new THREE.ConeGeometry(FOLIAGE_RADIUS, FOLIAGE_HEIGHT, FOLIAGE_SIDES).translate(0, FOLIAGE_BASE + FOLIAGE_HEIGHT / 2, 0)
const rockGeometry = new THREE.IcosahedronGeometry(ROCK_RADIUS, 0)
const bushGeometry = new THREE.IcosahedronGeometry(BUSH_RADIUS, 0).scale(1, BUSH_SQUASH, 1).translate(0, BUSH_LIFT, 0)
// Bayas repartidas por la mitad superior del arbusto. Una geometría (y un InstancedMesh) por posición:
// así cada baya se oculta por separado y comparte la matriz del arbusto (el wobble las mueve juntas).
const berryGeometries = [
  [0.55, 0.75, 0.15],
  [-0.4, 0.8, 0.4],
  [0.1, 0.95, -0.5],
  [-0.5, 0.6, -0.25],
  [0.3, 0.55, 0.6],
  [0.05, 1.0, 0.1],
].map(([x, y, z]) => new THREE.IcosahedronGeometry(0.09, 0).translate(x, y, z))
if (berryGeometries.length !== BERRIES_PER_BUSH) throw new Error('Una posición por baya')

const herbGeometry = new THREE.IcosahedronGeometry(HERB_RADIUS, 0).scale(1, HERB_SQUASH, 1).translate(0, HERB_LIFT, 0)
const flowerGeometry = mergeGeometries(
  [
    [0, 0.37, 0],
    [0.11, 0.3, 0.05],
    [-0.09, 0.31, -0.07],
  ].map(([x, y, z]) => new THREE.IcosahedronGeometry(0.075, 0).translate(x, y, z)),
)

const BIRCH_ROWS = 12
/**
 * El tronco del árbol partido en franjas de altura (la misma superficie: cada cara es un trapecio plano) y con las
 * marcas oscuras del abedul en los colores de los vértices.
 */
function birchTrunkGeometry() {
  const geometry = new THREE.CylinderGeometry(TRUNK_TOP_RADIUS, TRUNK_BOTTOM_RADIUS, TRUNK_HEIGHT, TRUNK_SIDES, BIRCH_ROWS)
    .translate(0, TRUNK_HEIGHT / 2, 0)
    .toNonIndexed()
  const position = geometry.getAttribute('position')
  const colors = new Float32Array(position.count * 3)
  const bark = new THREE.Color('#ece8dc')
  const mark = new THREE.Color('#2f2c28')
  for (let v = 0; v < position.count; v += 3) {
    let cx = 0
    let cy = 0
    let cz = 0
    for (let k = 0; k < 3; k++) {
      cx += position.getX(v + k) / 3
      cy += position.getY(v + k) / 3
      cz += position.getZ(v + k) / 3
    }
    const row = Math.floor((cy / TRUNK_HEIGHT) * BIRCH_ROWS)
    // CylinderGeometry pone el ángulo θ en x = sin θ, z = cos θ: así las dos mitades de cada cara caen en el mismo lado.
    const theta = (Math.atan2(cx, cz) + Math.PI * 2) % (Math.PI * 2)
    const side = Math.floor((theta / (Math.PI * 2)) * TRUNK_SIDES)
    // Las tapas (sus tres vértices a la misma altura) quedan claras; en el resto, unas pocas caras oscuras sin patrón a la vista.
    const y0 = position.getY(v)
    const isCap = Math.abs(position.getY(v + 1) - y0) < 1e-6 && Math.abs(position.getY(v + 2) - y0) < 1e-6
    const color = !isCap && (row * 5 + side * 2) % 7 === 0 ? mark : bark
    for (let k = 0; k < 3; k++) color.toArray(colors, (v + k) * 3)
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geometry
}

/** Cristales que asoman de la mena (sobre el icosaedro de radio 1, en la mitad de arriba). Adorno: sin hitbox. */
function crystalGeometry() {
  const spots = [
    [0.55, 0.62, 0.2],
    [-0.5, 0.55, 0.45],
    [0.05, 0.85, -0.45],
    [-0.35, 0.4, -0.75],
    [0.7, 0.3, -0.45],
  ]
  return mergeGeometries(
    spots.map(([x, y, z]) => {
      const d = new THREE.Vector3(x, y, z).normalize()
      return new THREE.OctahedronGeometry(0.16, 0).scale(0.8, 1.4, 0.8).translate(d.x * 0.92, d.y * 0.92, d.z * 0.92)
    }),
  )
}

const crystals = crystalGeometry()

const material = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, ...extra })

const berryMaterial = material('#c2304a')

interface Part {
  geometry: THREE.BufferGeometry
  material: THREE.Material
}

/** Piezas de cada tipo: un InstancedMesh por pieza y tipo. */
const PARTS: Record<PropKind, Part[]> = {
  tree: [
    { geometry: trunkGeometry, material: material('#7a5230') },
    { geometry: foliageGeometry, material: material('#2f6f2e') },
  ],
  birch: [
    { geometry: birchTrunkGeometry(), material: material('#ffffff', { vertexColors: true }) },
    { geometry: foliageGeometry, material: material('#7fae45') },
  ],
  darkpine: [
    { geometry: trunkGeometry, material: material('#4a3626') },
    { geometry: foliageGeometry, material: material('#1b3a24') },
  ],
  rock: [{ geometry: rockGeometry, material: material('#9a978a') }],
  iron_ore: [
    { geometry: rockGeometry, material: material('#7b7268') },
    { geometry: crystals, material: material('#c8743a', { metalness: 0.4, roughness: 0.5 }) },
  ],
  mithril_ore: [
    { geometry: rockGeometry, material: material('#6c7080') },
    { geometry: crystals, material: material('#4fb3f0', { metalness: 0.4, roughness: 0.4, emissive: '#123c5c' }) },
  ],
  coal_ore: [
    { geometry: rockGeometry, material: material('#6f6c68') },
    { geometry: crystals, material: material('#1c1b1a', { roughness: 0.35 }) },
  ],
  crystal_ore: [
    { geometry: rockGeometry, material: material('#6c7080') },
    { geometry: crystals, material: material('#7ff0ff', { roughness: 0.15, emissive: '#2a9fb0' }) },
  ],
  bush: [{ geometry: bushGeometry, material: material('#3d7d35') }, ...berryGeometries.map((geometry) => ({ geometry, material: berryMaterial }))],
  healing_herb: [{ geometry: herbGeometry, material: material('#57a85a') }, { geometry: flowerGeometry, material: material('#f2a6d8', { emissive: '#5c2450' }) }],
}

/**
 * Las piezas de los modelos (`nature.ts`) que sustituyen a las de cada tipo, por variante: `{v}` es su número. Van en el
 * orden de PARTS y con sus materiales; lo que se recoge (las bayas) sigue siendo lo de siempre. Lo que no está aquí (la
 * hierba curativa) no cambia.
 */
const MODELS: Partial<Record<PropKind, { pieces: string[]; variants: number }>> = {
  tree: { pieces: ['tree_trunk_{v}', 'tree_leaves_{v}'], variants: 2 },
  birch: { pieces: ['birch_trunk_{v}', 'tree_leaves_{v}'], variants: 2 },
  darkpine: { pieces: ['pine_trunk_{v}', 'pine_leaves_{v}'], variants: 2 },
  rock: { pieces: ['rock_{v}'], variants: 3 },
  iron_ore: { pieces: ['rock_{v}', 'crystals_{v}'], variants: 3 },
  mithril_ore: { pieces: ['rock_{v}', 'crystals_{v}'], variants: 3 },
  coal_ore: { pieces: ['rock_{v}', 'crystals_{v}'], variants: 3 },
  crystal_ore: { pieces: ['rock_{v}', 'crystals_{v}'], variants: 3 },
  bush: { pieces: ['bush_{v}'], variants: 3 },
}
/** Las piezas de los modelos que usan los props, de todas sus variantes (scripts/nature.test.ts mira que estén). */
export const MODEL_PIECES: readonly string[] = Object.values(MODELS).flatMap(({ pieces, variants }) =>
  pieces.flatMap((piece) => [...Array(variants).keys()].map((v) => piece.replace('{v}', String(v)))),
)

/** A partir de aquí (en metros, en horizontal) se dibuja la versión simplificada, sin sombra; con margen para no parpadear. */
export const LOD_DISTANCE = 55
const LOD_MARGIN = 4
/** Cuánto tiene que moverse la cámara para volver a mirar qué se ve de cerca. */
const LOD_STEP = 3

/** La variante de un prop: la misma en todos los clientes, repartida sin seguir el orden de los ids. */
const variantOf = (id: number, variants: number) => ((Math.imul(id, 2654435761) >>> 0) % variants)

/** Desde qué pieza es lo que se recoge (se oculta al recogerlo): las bayas del arbusto y la flor de la hierba. */
const FIRST_FRUIT: Partial<Record<PropKind, number>> = { bush: 1, healing_herb: 1 }

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0)
const WOBBLE_AMOUNT = 0.12

export interface PropInstance {
  mesh: THREE.InstancedMesh
  index: number
  base: THREE.Matrix4
  /** Solo en lo que se recoge: número de baya. Se ve mientras sea menor que las bayas que le quedan. */
  berry?: number
  /** Solo en los modelos: 0 de cerca y 1 de lejos. Se ve el que toca por la distancia (`updateLod`). */
  lod?: 0 | 1
}

function createInstanced(geometry: THREE.BufferGeometry, material: THREE.Material, count: number) {
  const mesh = new THREE.InstancedMesh(geometry, material, count)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

/**
 * Los props dibujados: un InstancedMesh por tipo y pieza (tronco y copa, roca, mena y sus cristales, arbusto y cada
 * baya), construido desde las colocaciones. Sigue a la simulación por sus eventos: wobble al golpear, ocultar al
 * romper y bayas que se quitan y vuelven.
 */
export class PropView {
  readonly group = new THREE.Group()
  /** Los meshes de los tipos de la isla original, con nombre (islandMeshes, tests). */
  readonly meshes
  /** Los meshes de cada tipo, en el orden de sus piezas (PARTS). */
  readonly byKind: Readonly<Record<PropKind, readonly THREE.InstancedMesh[]>>
  /** Todos los meshes. */
  readonly allMeshes: THREE.InstancedMesh[]
  /** Instancias de cada prop, por id. */
  private instances: PropInstance[][] = []
  private instanceToProp: Map<THREE.InstancedMesh, Int32Array>
  /** Segundos de wobble de cada prop que se está animando, por id. */
  private wobbles = new Map<number, number>()
  /** Bayas visibles de cada arbusto, por id (los demás props no las usan). */
  private berries: Int8Array
  private destroyed: Uint8Array
  private scratch = new THREE.Matrix4()
  /** Las colocaciones de las que sale (Game la rehace si la isla cambia). */
  readonly placements: readonly PropPlacement[]
  /** Con los modelos: los meshes que se han añadido, qué versión se ve de cada prop y desde dónde se miró. */
  private modelMeshes: THREE.InstancedMesh[] = []
  private modelMaterials: THREE.Material[] = []
  private band: Uint8Array
  private modelled: number[] = []
  private lodFrom: { x: number; z: number } | null = null

  constructor(placements: readonly PropPlacement[]) {
    this.placements = placements
    this.band = new Uint8Array(placements.length)
    const count = (kind: PropKind) => placements.filter((p) => p.kind === kind).length
    const kinds = Object.keys(PARTS) as PropKind[]
    const meshesOf = Object.fromEntries(
      kinds.map((kind) => {
        const n = count(kind)
        return [kind, PARTS[kind].map(({ geometry, material }) => createInstanced(geometry, material, n))]
      }),
    ) as Record<PropKind, THREE.InstancedMesh[]>
    const [bushes, ...berries] = meshesOf.bush
    this.byKind = meshesOf
    this.meshes = { trunks: meshesOf.tree[0], foliage: meshesOf.tree[1], rocks: meshesOf.rock[0], bushes, berries }
    this.allMeshes = kinds.flatMap((kind) => meshesOf[kind])

    const dummy = new THREE.Object3D()
    const next = Object.fromEntries(kinds.map((kind) => [kind, 0])) as Record<PropKind, number>
    for (const p of placements) {
      dummy.position.set(p.x, p.y, p.z)
      dummy.rotation.set(p.rotX, p.rotY, 0)
      dummy.scale.set(p.scaleX, p.scaleY, p.scaleZ)
      dummy.updateMatrix()
      const index = next[p.kind]++
      const firstFruit = FIRST_FRUIT[p.kind]
      this.instances[p.id] = meshesOf[p.kind].map((mesh, part): PropInstance => {
        mesh.setMatrixAt(index, dummy.matrix)
        // La base se lee de vuelta (Float32) para que restaurarla tras un wobble sea exacto.
        const base = new THREE.Matrix4()
        mesh.getMatrixAt(index, base)
        return firstFruit === undefined || part < firstFruit ? { mesh, index, base } : { mesh, index, base, berry: part - firstFruit }
      })
    }

    this.instanceToProp = new Map(this.allMeshes.map((mesh) => [mesh, new Int32Array(mesh.count).fill(-1)]))
    for (const p of placements) {
      for (const { mesh, index } of this.instances[p.id]) this.instanceToProp.get(mesh)![index] = p.id
    }
    this.berries = new Int8Array(placements.length).fill(BERRIES_PER_BUSH)
    this.destroyed = new Uint8Array(placements.length)
    this.group.add(...this.allMeshes)
  }

  /**
   * Dibuja los modelos en vez de las formas de siempre, que quedan ocultas (pero siguen ahí: la puntería y las pruebas
   * miran esas, que son las hitboxes). Cada prop lleva dos versiones, cerca y lejos, y se ve la que toca por la distancia
   * (`updateLod`); empieza viéndose la de lejos. Se llama una vez, cuando llegan los modelos.
   */
  useModels(models: NatureModels) {
    if (this.modelMeshes.length) return
    const dummy = new THREE.Object3D()
    for (const [kind, def] of Object.entries(MODELS) as [PropKind, NonNullable<(typeof MODELS)[PropKind]>][]) {
      const props = this.placements.filter((p) => p.kind === kind)
      const geometries = (v: number) => def.pieces.map((piece) => piece.replace('{v}', String(v)))
      // Sin alguna pieza (un modelo que no ha llegado), el tipo se queda como estaba.
      if (![...Array(def.variants).keys()].every((v) => geometries(v).every((name) => models.has(name)))) continue
      // Los materiales de siempre, que tiñen los colores de los vértices.
      const materials = def.pieces.map((_, part) => {
        const material = (PARTS[kind][part].material as THREE.MeshStandardMaterial).clone()
        material.vertexColors = true
        this.modelMaterials.push(material)
        return material
      })
      for (let v = 0; v < def.variants; v++) {
        const ofVariant = props.filter((p) => variantOf(p.id, def.variants) === v)
        if (!ofVariant.length) continue
        geometries(v).forEach((name, part) => {
          const near = createInstanced(models.get(name)!, materials[part], ofVariant.length)
          const far = createInstanced(models.get(`${name}_far`) ?? models.get(name)!, materials[part], ofVariant.length)
          far.castShadow = false
          ofVariant.forEach((p, index) => {
            dummy.position.set(p.x, p.y, p.z)
            dummy.rotation.set(p.rotX, p.rotY, 0)
            dummy.scale.set(p.scaleX, p.scaleY, p.scaleZ)
            dummy.updateMatrix()
            for (const [lod, mesh] of [near, far].entries() as IterableIterator<[0 | 1, THREE.InstancedMesh]>) {
              // Leída de vuelta (Float32), como las de siempre: restaurarla es exacto.
              const base = new THREE.Matrix4()
              mesh.setMatrixAt(index, dummy.matrix)
              mesh.getMatrixAt(index, base)
              mesh.setMatrixAt(index, HIDDEN)
              this.instances[p.id].push({ mesh, index, base, lod })
            }
          })
          this.modelMeshes.push(near, far)
        })
      }
      for (const p of props) this.band[p.id] = 1
      this.modelled.push(...props.map((p) => p.id))
      // Lo de siempre se oculta, salvo lo que se recoge.
      PARTS[kind].forEach((_, part) => {
        const firstFruit = FIRST_FRUIT[kind]
        if (firstFruit === undefined || part < firstFruit) this.byKind[kind][part].visible = false
      })
    }
    for (const id of this.modelled) if (!this.destroyed[id]) this.showBand(id)
    this.group.add(...this.modelMeshes)
  }

  /**
   * Con los modelos, por frame: de cerca de `camera` se ve la versión entera, con sombra, y de lejos la simplificada.
   * Solo mira de nuevo si la cámara se ha movido algo.
   */
  updateLod(camera: { x: number; z: number }) {
    if (!this.modelled.length || (this.lodFrom && Math.hypot(camera.x - this.lodFrom.x, camera.z - this.lodFrom.z) < LOD_STEP)) return
    this.lodFrom = { x: camera.x, z: camera.z }
    for (const id of this.modelled) {
      const p = this.placements[id]
      const distance = Math.hypot(p.x - camera.x, p.z - camera.z)
      const band = this.band[id] === 0 ? (distance > LOD_DISTANCE + LOD_MARGIN ? 1 : 0) : distance < LOD_DISTANCE - LOD_MARGIN ? 0 : 1
      if (band === this.band[id]) continue
      this.band[id] = band
      if (!this.destroyed[id]) this.showBand(id)
    }
  }

  /** Enseña la versión de los modelos que toca y oculta la otra. */
  private showBand(id: number) {
    for (const { mesh, index, base, lod } of this.instances[id]) {
      if (lod === undefined) continue
      mesh.setMatrixAt(index, lod === this.band[id] ? base : HIDDEN)
      mesh.instanceMatrix.needsUpdate = true
    }
  }

  /** Instancias del prop `id` (tronco y copa; roca; mena y cristales; arbusto y sus bayas). */
  instancesOf(id: number): readonly PropInstance[] {
    return this.instances[id] ?? []
  }

  /** Id del prop al que pertenece una instancia (para un raycast contra la vista), o -1. */
  propAt(mesh: THREE.Object3D, instanceId: number | undefined): number {
    if (instanceId === undefined) return -1
    return this.instanceToProp.get(mesh as THREE.InstancedMesh)?.[instanceId] ?? -1
  }

  /** Aplica lo que ha pasado en un paso. */
  present(events: readonly SimEventData[]) {
    for (const e of events) {
      switch (e.type) {
        case 'propHit':
          this.wobble(e.id)
          break
        case 'propDestroyed':
          this.destroy(e.id)
          break
        case 'berryTaken':
          this.setBerries(e.id, e.hp)
          this.wobble(e.id)
          break
        case 'berryGrew':
          this.setBerries(e.id, e.hp)
          break
      }
    }
  }

  /** Por frame: animación de golpe (tronco y copa a la vez). */
  update(dt: number) {
    for (const [id, elapsed] of this.wobbles) {
      const t = elapsed + dt
      const done = t >= WOBBLE_DURATION
      const a = done ? 0 : WOBBLE_AMOUNT * Math.sin((Math.PI * t) / WOBBLE_DURATION)
      for (const instance of this.instances[id]) {
        // Las bayas ya recogidas siguen ocultas durante el wobble, y la versión del modelo que no toca también.
        if (instance.berry !== undefined && instance.berry >= this.berries[id]) continue
        if (instance.lod !== undefined && instance.lod !== this.band[id]) continue
        const { mesh, index, base } = instance
        this.scratch.makeScale(1 + a, 1 - a * 0.5, 1 + a).premultiply(base)
        mesh.setMatrixAt(index, this.scratch)
        mesh.instanceMatrix.needsUpdate = true
      }
      if (done) this.wobbles.delete(id)
      else this.wobbles.set(id, t)
    }
  }

  /** Reinicio de partida: todos los props como al generar la isla. */
  reset() {
    this.wobbles.clear()
    this.berries.fill(BERRIES_PER_BUSH)
    this.destroyed.fill(0)
    this.instances.forEach((instances, id) => {
      for (const { mesh, index, base, lod } of instances) mesh.setMatrixAt(index, lod === undefined || lod === this.band[id] ? base : HIDDEN)
    })
    for (const mesh of [...this.allMeshes, ...this.modelMeshes]) mesh.instanceMatrix.needsUpdate = true
  }

  /** Los props como dice un estado completo (al entrar en una sala o volver de la pausa en red), sin animar. */
  sync(props: readonly Pick<PropData, 'id' | 'kind' | 'hp' | 'alive'>[]) {
    this.reset()
    for (const { id, kind, hp, alive } of props) {
      if (!alive) this.destroy(id)
      else if (PROP_DEFS[kind].harvest && hp !== this.berries[id]) this.setBerries(id, hp)
    }
  }

  /** Libera las instancias (las geometrías y los materiales son compartidos y se quedan). */
  dispose() {
    for (const mesh of [...this.allMeshes, ...this.modelMeshes]) mesh.dispose()
    for (const material of this.modelMaterials) material.dispose()
  }

  /**
   * Hace temblar el prop `id`. Los golpes que le quitan vida llegan por `propHit`; Game lo llama además con los
   * que no le hacen nada (sin la herramienta que pide), que no tienen evento propio.
   */
  wobble(id: number) {
    if (!this.destroyed[id]) this.wobbles.set(id, 0)
  }

  private destroy(id: number) {
    // Cancelar la animación antes de ocultar: si no, restauraría la escala y el prop "reviviría".
    this.wobbles.delete(id)
    this.destroyed[id] = 1
    for (const { mesh, index } of this.instances[id]) {
      mesh.setMatrixAt(index, HIDDEN)
      mesh.instanceMatrix.needsUpdate = true
    }
  }

  /** Deja `count` bayas visibles; solo toca las que cambian. */
  private setBerries(id: number, count: number) {
    const before = this.berries[id]
    this.berries[id] = count
    for (const instance of this.instances[id]) {
      const { berry, mesh, index, base } = instance
      if (berry === undefined || berry < Math.min(before, count) || berry >= Math.max(before, count)) continue
      mesh.setMatrixAt(index, berry < count ? base : HIDDEN)
      mesh.instanceMatrix.needsUpdate = true
    }
  }
}

/** Meshes que definen la isla original para computeWorldHash (los arbustos van aparte). */
export const islandMeshes = ({ meshes }: PropView) => [meshes.trunks, meshes.foliage, meshes.rocks]
