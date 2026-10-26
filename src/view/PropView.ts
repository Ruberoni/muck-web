import * as THREE from 'three'
import { BERRIES_PER_BUSH, WOBBLE_DURATION } from '../sim/constants'
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

// Una geometría y un material por tipo, compartidos por todas las instancias. sim/aim.ts construye
// las hitboxes con las mismas caras (salvo las bayas): una geometría nueva tiene que llevarse también allí.
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

const trunkMaterial = new THREE.MeshStandardMaterial({ color: '#7a5230', flatShading: true })
const foliageMaterial = new THREE.MeshStandardMaterial({ color: '#2f6f2e', flatShading: true })
const rockMaterial = new THREE.MeshStandardMaterial({ color: '#9a978a', flatShading: true })
const bushMaterial = new THREE.MeshStandardMaterial({ color: '#3d7d35', flatShading: true })
const berryMaterial = new THREE.MeshStandardMaterial({ color: '#c2304a', flatShading: true })

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
 * Los props dibujados: un InstancedMesh por pieza (tronco, copa, roca, arbusto y cada baya), construido
 * desde las colocaciones. Sigue a la simulación por sus eventos: wobble al golpear, ocultar al romper
 * y bayas que se quitan y vuelven.
 */
export class PropView {
  readonly group = new THREE.Group()
  readonly meshes
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
    const trees = count('tree')
    const bushCount = count('bush')
    const trunks = createInstanced(trunkGeometry, trunkMaterial, trees)
    const foliage = createInstanced(foliageGeometry, foliageMaterial, trees)
    const rocks = createInstanced(rockGeometry, rockMaterial, count('rock'))
    const bushes = createInstanced(bushGeometry, bushMaterial, bushCount)
    const berries = berryGeometries.map((geometry) => createInstanced(geometry, berryMaterial, bushCount))
    this.meshes = { trunks, foliage, rocks, bushes, berries }
    this.allMeshes = [trunks, foliage, rocks, bushes, ...berries]
    const meshesOf: Record<PropKind, THREE.InstancedMesh[]> = { tree: [trunks, foliage], rock: [rocks], bush: [bushes, ...berries] }
    const berryMeshes: THREE.InstancedMesh[] = berries

    const dummy = new THREE.Object3D()
    const next: Record<PropKind, number> = { tree: 0, rock: 0, bush: 0 }
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

  /** Instancias del prop `id` (tronco y copa; roca; arbusto y sus bayas). */
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
      else if (kind === 'bush' && hp !== this.berries[id]) this.setBerries(id, hp)
    }
  }

  /** Libera las instancias (las geometrías y los materiales son compartidos y se quedan). */
  dispose() {
    for (const mesh of this.allMeshes) mesh.dispose()
  }

  private wobble(id: number) {
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
