import * as THREE from 'three'
import { createProps } from './world/props'
import { createTerrain, createWater } from './world/terrain'

const SKY_COLOR = '#9fd4f0'
const SUN_DIR = new THREE.Vector3(60, 90, 40).normalize()
const SUN_DISTANCE = 150
const SHADOW_HALF = 60
const SHADOW_MAP_SIZE = 2048
const TEXEL = (SHADOW_HALF * 2) / SHADOW_MAP_SIZE

// Orientación de la cámara de sombras (mira en -SUN_DIR con up +Y, igual que la que crea three).
const lightRotation = new THREE.Matrix4().lookAt(SUN_DIR, new THREE.Vector3(), new THREE.Object3D().up)
const lightRotationInv = lightRotation.clone().invert()
const snapped = new THREE.Vector3()

export function createScene() {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(SKY_COLOR)
  scene.fog = new THREE.Fog(SKY_COLOR, 120, 320)

  scene.add(new THREE.HemisphereLight('#d6ecff', '#5d7a3a', 1.4))

  const sun = new THREE.DirectionalLight('#fff3d6', 2.6)
  sun.castShadow = true
  sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE)
  Object.assign(sun.shadow.camera, {
    left: -SHADOW_HALF,
    right: SHADOW_HALF,
    top: SHADOW_HALF,
    bottom: -SHADOW_HALF,
    near: 1,
    far: SUN_DISTANCE * 2,
  })
  sun.shadow.bias = -0.0005
  sun.shadow.normalBias = 0.02
  scene.add(sun, sun.target)

  const terrain = createTerrain()
  const water = createWater()
  const world = createProps()
  scene.add(terrain, water, world.group)

  return { scene, sun, water, world }
}

/**
 * Centra la cámara de sombras en `center` (normalmente por delante del jugador),
 * ajustada a la rejilla de texels en el espacio de la luz para que las sombras no parpadeen.
 */
export function updateSun(sun: THREE.DirectionalLight, center: THREE.Vector3) {
  snapped.copy(center).applyMatrix4(lightRotationInv)
  snapped.x = Math.round(snapped.x / TEXEL) * TEXEL
  snapped.y = Math.round(snapped.y / TEXEL) * TEXEL
  snapped.applyMatrix4(lightRotation)
  sun.target.position.copy(snapped)
  sun.position.copy(snapped).addScaledVector(SUN_DIR, SUN_DISTANCE)
  sun.target.updateMatrixWorld()
}
