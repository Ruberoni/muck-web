import * as THREE from 'three'
import { heightAt, WATER_LEVEL, WORLD_SIZE } from '../sim/world/terrain'
import { biomeBlend, terrainColor } from './ground'

const SEGMENTS = 80

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
    const avgX = (position.getX(i) + position.getX(i + 1) + position.getX(i + 2)) / 3
    const avgY = (position.getY(i) + position.getY(i + 1) + position.getY(i + 2)) / 3
    const avgZ = (position.getZ(i) + position.getZ(i + 1) + position.getZ(i + 2)) / 3
    const steep = normal.getY(i) < 0.8
    const [r, g, b] = terrainColor(avgY, steep, biomeBlend(avgX, avgZ, avgY))
    color.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace)

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
