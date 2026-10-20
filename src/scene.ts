import * as THREE from 'three'
import { createSkyState, sampleSky } from './world/daycycle'
import type { PropPlacement } from './sim/props'
import { PropView } from './view/PropView'
import { createTerrain, createWater } from './world/terrain'

const SUN_DISTANCE = 150
const SHADOW_HALF = 60
const SHADOW_MAP_SIZE = 2048
const TEXEL = (SHADOW_HALF * 2) / SHADOW_MAP_SIZE

// Orientación de la cámara de sombras (mira en -lightDir con up +Y, igual que la que crea three).
const lightRotation = new THREE.Matrix4()
const lightRotationInv = new THREE.Matrix4()
const origin = new THREE.Vector3()
const up = new THREE.Object3D().up
const snapped = new THREE.Vector3()
const state = createSkyState()

/** Escena con el terreno, el agua, el cielo y los props de la isla (`placements`). */
export function createScene(placements: readonly PropPlacement[]) {
  const scene = new THREE.Scene()
  const background = new THREE.Color()
  scene.background = background
  const fog = new THREE.Fog(background, 120, 320)
  scene.fog = fog

  const hemi = new THREE.HemisphereLight()
  scene.add(hemi)

  // De día es el sol y de noche la luna: una sola luz con sombras.
  const sun = new THREE.DirectionalLight()
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
  const propView = new PropView(placements)
  scene.add(terrain, water, propView.group)

  const sky = { background, fog, hemi, sun }
  return { scene, sky, water, propView }
}

export type Sky = ReturnType<typeof createScene>['sky']

/**
 * Aplica la hora del día (`phase`, ver DayClock) a cielo, niebla y luces, y centra la cámara
 * de sombras en `center` (normalmente por delante del jugador), ajustada a la rejilla de texels
 * en el espacio de la luz para que las sombras no parpadeen.
 */
export function updateSky(sky: Sky, phase: number, center: THREE.Vector3) {
  sampleSky(phase, state)
  sky.background.copy(state.sky)
  sky.fog.color.copy(state.sky)
  sky.fog.near = state.fogNear
  sky.fog.far = state.fogFar
  sky.hemi.color.copy(state.hemiSky)
  sky.hemi.groundColor.copy(state.hemiGround)
  sky.hemi.intensity = state.hemiIntensity
  const { sun } = sky
  sun.color.copy(state.lightColor)
  sun.intensity = state.lightIntensity

  lightRotation.lookAt(state.lightDir, origin, up)
  lightRotationInv.copy(lightRotation).invert()
  snapped.copy(center).applyMatrix4(lightRotationInv)
  snapped.x = Math.round(snapped.x / TEXEL) * TEXEL
  snapped.y = Math.round(snapped.y / TEXEL) * TEXEL
  snapped.applyMatrix4(lightRotation)
  sun.target.position.copy(snapped)
  sun.position.copy(snapped).addScaledVector(state.lightDir, SUN_DISTANCE)
  sun.target.updateMatrixWorld()
}
