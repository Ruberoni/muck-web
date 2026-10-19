import * as THREE from 'three'
import { createNoise2D } from 'simplex-noise'
import { createTerrainRng } from './random'

export const WORLD_SIZE = 200
const SEGMENTS = 80
export const WATER_LEVEL = 0
export const SAND_LEVEL = 1.2
export const ROCK_LEVEL = 9

const noise2D = createNoise2D(createTerrainRng())

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

/** Altura del terreno en (x, z). Fuente única para la malla y para posar objetos. */
export function heightAt(x: number, z: number): number {
  const n =
    0.6 * noise2D(x * 0.012, z * 0.012) +
    0.3 * noise2D(x * 0.03, z * 0.03) +
    0.1 * noise2D(x * 0.08, z * 0.08)
  const hills = Math.pow(n * 0.5 + 0.5, 1.3) * 12

  // Atenuación radial: la isla baja hacia el mar en los bordes.
  const r = Math.hypot(x, z) / (WORLD_SIZE / 2)
  const falloff = 1 - smoothstep(0.55, 0.95, r)

  return hills * falloff + falloff * 4 - 3
}

const SAND = new THREE.Color('#e3cf8e')
const GRASS_LOW = new THREE.Color('#6fae45')
const GRASS_HIGH = new THREE.Color('#4a8a35')
const ROCK = new THREE.Color('#8b8878')

export function createTerrain(): THREE.Mesh {
  const indexed = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, SEGMENTS, SEGMENTS)
  // Rotar la geometría (no el mesh) para que cada vértice quede en (x, z) del mundo.
  indexed.rotateX(-Math.PI / 2)

  const pos = indexed.attributes.position
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)))
  }

  // No indexada: cada triángulo tiene sus propios vértices y un único color.
  const geometry = indexed.toNonIndexed()
  indexed.dispose()
  geometry.computeVertexNormals()

  const position = geometry.attributes.position
  const normal = geometry.attributes.normal
  const colors = new Float32Array(position.count * 3)
  const color = new THREE.Color()

  for (let i = 0; i < position.count; i += 3) {
    const avgY = (position.getY(i) + position.getY(i + 1) + position.getY(i + 2)) / 3
    const steep = normal.getY(i) < 0.8

    if (avgY < SAND_LEVEL) color.copy(SAND)
    else if (steep || avgY > ROCK_LEVEL) color.copy(ROCK)
    else color.lerpColors(GRASS_LOW, GRASS_HIGH, (avgY - SAND_LEVEL) / (ROCK_LEVEL - SAND_LEVEL))

    for (let v = 0; v < 3; v++) color.toArray(colors, (i + v) * 3)
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

  const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.receiveShadow = true
  return mesh
}

export function createWater(): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(WORLD_SIZE * 4, WORLD_SIZE * 4)
  geometry.rotateX(-Math.PI / 2)
  const material = new THREE.MeshStandardMaterial({
    color: '#3a8fc4',
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    roughness: 0.3,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.y = WATER_LEVEL
  return mesh
}
