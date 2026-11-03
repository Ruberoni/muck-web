import * as THREE from 'three'
import { ISLAND_SIZE, type Island } from '../sim/world/island'
import { WATER_LEVEL } from '../sim/world/terrain'
import { biomeBlend, terrainColor } from './ground'

/** Metros por cuadro de la malla: más grande la isla, más cuadros. */
const SEGMENT_SIZE = 2.5

export function createTerrain(island: Island): THREE.Mesh {
  const segments = Math.round(island.size / SEGMENT_SIZE)
  const indexed = new THREE.PlaneGeometry(island.size, island.size, segments, segments)
  // Rotar la geometría (no el mesh) para que cada vértice quede en (x, z) del mundo.
  indexed.rotateX(-Math.PI / 2)

  const pos = indexed.attributes.position
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, island.heightAt(pos.getX(i), pos.getZ(i)))
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
    const [r, g, b] = terrainColor(avgY, steep, biomeBlend(island, avgX, avgZ, avgY))
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
  // Hasta el horizonte de la isla más grande.
  const geometry = new THREE.PlaneGeometry(ISLAND_SIZE * 4, ISLAND_SIZE * 4)
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
