import * as THREE from 'three'
import { PROP_DEFS } from '../game/constants'
import { SpatialGrid } from '../game/collision'
import { createPropsRng } from './random'
import { heightAt, ROCK_LEVEL, SAND_LEVEL, WORLD_SIZE } from './terrain'

const TREE_COUNT = 180
const ROCK_COUNT = 60
const MAX_SLOPE = 1.6

const TRUNK_BOTTOM_RADIUS = 0.35
const TRUNK_HEIGHT = 2.6
// La base de la copa queda por encima de los ojos (1,7) incluso con la escala mínima (0,8).
const FOLIAGE_BASE = 2.4
const FOLIAGE_HEIGHT = 3.4

// Una geometría y un material por tipo, compartidos por todas las instancias.
const trunkGeometry = new THREE.CylinderGeometry(0.25, TRUNK_BOTTOM_RADIUS, TRUNK_HEIGHT, 6).translate(0, TRUNK_HEIGHT / 2, 0)
const foliageGeometry = new THREE.ConeGeometry(1.5, FOLIAGE_HEIGHT, 7).translate(0, FOLIAGE_BASE + FOLIAGE_HEIGHT / 2, 0)
const rockGeometry = new THREE.IcosahedronGeometry(1, 0)

const trunkMaterial = new THREE.MeshStandardMaterial({ color: '#7a5230', flatShading: true })
const foliageMaterial = new THREE.MeshStandardMaterial({ color: '#2f6f2e', flatShading: true })
const rockMaterial = new THREE.MeshStandardMaterial({ color: '#9a978a', flatShading: true })

export type PropKind = keyof typeof PROP_DEFS

export interface PropInstance {
  mesh: THREE.InstancedMesh
  index: number
  base: THREE.Matrix4
}

export interface PropData {
  id: number
  kind: PropKind
  x: number
  /** Árboles: base del tronco. Rocas: centro. */
  y: number
  z: number
  radius: number
  hp: number
  maxHp: number
  alive: boolean
  instances: PropInstance[]
}

/** Diferencia de altura en un entorno de ±1 unidad: aproxima la pendiente. */
const slopeAt = (x: number, z: number) =>
  Math.abs(heightAt(x + 1, z) - heightAt(x - 1, z)) + Math.abs(heightAt(x, z + 1) - heightAt(x, z - 1))

function createInstanced(geometry: THREE.BufferGeometry, material: THREE.Material, count: number) {
  const mesh = new THREE.InstancedMesh(geometry, material, count)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

export function createProps() {
  const rng = createPropsRng()
  const range = (min: number, max: number) => min + rng() * (max - min)
  const randomPoint = () => {
    const angle = rng() * Math.PI * 2
    const radius = Math.sqrt(rng()) * WORLD_SIZE * 0.45
    return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius }
  }

  const trunks = createInstanced(trunkGeometry, trunkMaterial, TREE_COUNT)
  const foliage = createInstanced(foliageGeometry, foliageMaterial, TREE_COUNT)
  const rocks = createInstanced(rockGeometry, rockMaterial, ROCK_COUNT)
  const dummy = new THREE.Object3D()
  const props: PropData[] = []

  const addProp = (kind: PropKind, x: number, y: number, z: number, radius: number, meshes: THREE.InstancedMesh[], index: number) => {
    const { hp } = PROP_DEFS[kind]
    const instances = meshes.map((mesh) => {
      mesh.setMatrixAt(index, dummy.matrix)
      // La base se lee de vuelta (Float32) para que restaurarla tras un wobble sea exacto.
      const base = new THREE.Matrix4()
      mesh.getMatrixAt(index, base)
      return { mesh, index, base }
    })
    props.push({ id: props.length, kind, x, y, z, radius, hp, maxHp: hp, alive: true, instances })
  }

  // El orden de consumo del PRNG no debe cambiar: define el mundo (ver world/hash.ts).
  let trees = 0
  for (let attempt = 0; trees < TREE_COUNT && attempt < TREE_COUNT * 20; attempt++) {
    const { x, z } = randomPoint()
    const scale = range(0.8, 1.4)
    const rotation = rng() * Math.PI * 2
    const y = heightAt(x, z)
    if (y < SAND_LEVEL + 0.3 || y > ROCK_LEVEL || slopeAt(x, z) > MAX_SLOPE) continue

    dummy.position.set(x, y - 0.1, z)
    dummy.rotation.set(0, rotation, 0)
    dummy.scale.setScalar(scale)
    dummy.updateMatrix()
    addProp('tree', x, y - 0.1, z, TRUNK_BOTTOM_RADIUS * scale, [trunks, foliage], trees)
    trees++
  }
  trunks.count = foliage.count = trees

  let rockCount = 0
  for (let attempt = 0; rockCount < ROCK_COUNT && attempt < ROCK_COUNT * 20; attempt++) {
    const { x, z } = randomPoint()
    const sx = range(0.8, 2.2)
    const sy = range(0.5, 1.2)
    const sz = range(0.8, 2.2)
    const rx = rng() * Math.PI
    const ry = rng() * Math.PI * 2
    const y = heightAt(x, z)
    if (y < SAND_LEVEL || slopeAt(x, z) > MAX_SLOPE * 1.5) continue

    // Algo hundidas para que no parezcan apoyadas en un punto.
    dummy.position.set(x, y - sy * 0.3, z)
    dummy.rotation.set(rx * 0.2, ry, 0)
    dummy.scale.set(sx, sy, sz)
    dummy.updateMatrix()
    // El icosaedro base tiene radio 1: max(sx, sz) cubre sus vértices en XZ.
    addProp('rock', x, y - sy * 0.3, z, Math.max(sx, sz), [rocks], rockCount)
    rockCount++
  }
  rocks.count = rockCount

  const meshes = { trunks, foliage, rocks }
  const instanceToProp = new Map<THREE.InstancedMesh, Int32Array>(
    Object.values(meshes).map((mesh) => [mesh, new Int32Array(mesh.count).fill(-1)]),
  )
  const grid = new SpatialGrid<PropData>()
  for (const prop of props) {
    for (const { mesh, index } of prop.instances) instanceToProp.get(mesh)![index] = prop.id
    grid.insert(prop)
  }

  const group = new THREE.Group()
  group.add(trunks, foliage, rocks)

  return { group, props, meshes, instanceToProp, grid }
}

export type World = ReturnType<typeof createProps>
