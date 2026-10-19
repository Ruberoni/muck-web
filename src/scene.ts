import * as THREE from 'three'
import { createProps } from './world/props'
import { createTerrain, createWater, WORLD_SIZE } from './world/terrain'

const SKY_COLOR = '#9fd4f0'

export function createScene() {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(SKY_COLOR)
  scene.fog = new THREE.Fog(SKY_COLOR, 120, 320)

  scene.add(new THREE.HemisphereLight('#d6ecff', '#5d7a3a', 1.4))

  const sun = new THREE.DirectionalLight('#fff3d6', 2.6)
  sun.position.set(60, 90, 40)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  // Cubre toda la isla (~0,1 unidades por texel). Cuando haya jugador, la cámara de sombras
  // debería seguirle con un frustum más pequeño en vez de cubrir el mapa entero.
  const half = WORLD_SIZE / 2
  Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 300 })
  sun.shadow.normalBias = 0.03
  scene.add(sun, sun.target)

  const terrain = createTerrain()
  const water = createWater()
  const props = createProps()
  scene.add(terrain, water, props.group)

  return { scene, water, propInstances: props.instances }
}
