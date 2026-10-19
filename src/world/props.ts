import * as THREE from 'three'
import { createPropsRng } from './random'
import { heightAt, ROCK_LEVEL, SAND_LEVEL, WORLD_SIZE } from './terrain'

const TREE_COUNT = 180
const ROCK_COUNT = 60
const MAX_SLOPE = 1.6

// Una geometría y un material por tipo, compartidos por todas las instancias.
const trunkGeometry = new THREE.CylinderGeometry(0.25, 0.35, 2, 6).translate(0, 1, 0)
const foliageGeometry = new THREE.ConeGeometry(1.5, 3.4, 7).translate(0, 3.4, 0)
const rockGeometry = new THREE.IcosahedronGeometry(1, 0)

const trunkMaterial = new THREE.MeshStandardMaterial({ color: '#7a5230', flatShading: true })
const foliageMaterial = new THREE.MeshStandardMaterial({ color: '#2f6f2e', flatShading: true })
const rockMaterial = new THREE.MeshStandardMaterial({ color: '#9a978a', flatShading: true })

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
    trunks.setMatrixAt(trees, dummy.matrix)
    foliage.setMatrixAt(trees, dummy.matrix)
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
    rocks.setMatrixAt(rockCount, dummy.matrix)
    rockCount++
  }
  rocks.count = rockCount

  const group = new THREE.Group()
  group.add(trunks, foliage, rocks)

  return { group, instances: [trunks, foliage, rocks] }
}
