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
  ROCK_RADIUS,
  TRUNK_BOTTOM_RADIUS,
  TRUNK_HEIGHT,
  TRUNK_SIDES,
  TRUNK_TOP_RADIUS,
  type PropData,
  type PropKind,
  type PropPlacement,
} from '../sim/props'

// Las geometrías son por familia (el abedul tiene la forma del árbol y la mena la de la roca) y los materiales por
// tipo. sim/aim.ts construye las hitboxes de cada familia con las mismas caras (salvo las bayas y los cristales de
// las menas, que son adorno): una geometría nueva tiene que llevarse también allí.
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

const material = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, ...extra })

const berryMaterial = material('#c2304a')

interface Part {
  geometry: THREE.BufferGeometry
  material: THREE.Material
}

/** Piezas de cada tipo: un InstancedMesh por pieza y tipo. En el arbusto, de la segunda en adelante son las bayas. */
const PARTS: Record<PropKind, Part[]> = {
  tree: [
    { geometry: trunkGeometry, material: material('#7a5230') },
    { geometry: foliageGeometry, material: material('#2f6f2e') },
  ],
  birch: [
    { geometry: birchTrunkGeometry(), material: material('#ffffff', { vertexColors: true }) },
    { geometry: foliageGeometry, material: material('#7fae45') },
  ],
  rock: [{ geometry: rockGeometry, material: material('#9a978a') }],
  iron_ore: [
    { geometry: rockGeometry, material: material('#7b7268') },
    { geometry: crystalGeometry(), material: material('#c8743a', { metalness: 0.4, roughness: 0.5 }) },
  ],
  bush: [{ geometry: bushGeometry, material: material('#3d7d35') }, ...berryGeometries.map((geometry) => ({ geometry, material: berryMaterial }))],
}

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0)
const WOBBLE_AMOUNT = 0.12

export interface PropInstance {
  mesh: THREE.InstancedMesh
  index: number
  base: THREE.Matrix4
  /** Solo en arbustos: número de baya. Se ve mientras sea menor que las bayas que le quedan al arbusto. */
  berry?: number
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

  constructor(placements: readonly PropPlacement[]) {
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
    const berryMeshes: THREE.InstancedMesh[] = berries

    const dummy = new THREE.Object3D()
    const next = Object.fromEntries(kinds.map((kind) => [kind, 0])) as Record<PropKind, number>
    for (const p of placements) {
      dummy.position.set(p.x, p.y, p.z)
      dummy.rotation.set(p.rotX, p.rotY, 0)
      dummy.scale.set(p.scaleX, p.scaleY, p.scaleZ)
      dummy.updateMatrix()
      const index = next[p.kind]++
      this.instances[p.id] = meshesOf[p.kind].map((mesh): PropInstance => {
        mesh.setMatrixAt(index, dummy.matrix)
        // La base se lee de vuelta (Float32) para que restaurarla tras un wobble sea exacto.
        const base = new THREE.Matrix4()
        mesh.getMatrixAt(index, base)
        const berry = berryMeshes.indexOf(mesh)
        return berry < 0 ? { mesh, index, base } : { mesh, index, base, berry }
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
        // Las bayas ya recogidas siguen ocultas durante el wobble.
        if (instance.berry !== undefined && instance.berry >= this.berries[id]) continue
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
    for (const instances of this.instances) {
      for (const { mesh, index, base } of instances) mesh.setMatrixAt(index, base)
    }
    for (const mesh of this.allMeshes) mesh.instanceMatrix.needsUpdate = true
  }

  /** Los props como dice un estado completo (al entrar en una sala o volver de la pausa en red), sin animar. */
  sync(props: readonly Pick<PropData, 'id' | 'kind' | 'hp' | 'alive'>[]) {
    this.reset()
    for (const { id, kind, hp, alive } of props) {
      if (!alive) this.destroy(id)
      else if (PROP_DEFS[kind].family === 'bush' && hp !== this.berries[id]) this.setBerries(id, hp)
    }
  }

  /** Libera las instancias (las geometrías y los materiales son compartidos y se quedan). */
  dispose() {
    for (const mesh of this.allMeshes) mesh.dispose()
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

  /** Deja `count` bayas visibles en el arbusto; solo toca las que cambian. */
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
