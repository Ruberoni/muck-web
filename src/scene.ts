import * as THREE from 'three'
import { createSkyState, sampleSky } from './world/daycycle'
import type { Island } from './sim/world/island'
import { SkyView } from './world/sky'
import { createTerrain, createWater } from './world/terrain'

const SUN_DISTANCE = 150
const SHADOW_HALF = 60
/** Texel de unos 12 cm: suficiente para low-poly y 4 veces menos relleno que 2048. */
const SHADOW_MAP_SIZE = 1024
const TEXEL = (SHADOW_HALF * 2) / SHADOW_MAP_SIZE

// Orientación de la cámara de sombras (mira en -lightDir con up +Y, igual que la que crea three).
const lightRotation = new THREE.Matrix4()
const lightRotationInv = new THREE.Matrix4()
const origin = new THREE.Vector3()
const up = new THREE.Object3D().up
const snapped = new THREE.Vector3()
const state = createSkyState()
// Oscura, no gris, y cerrada: los enemigos salen de ella.
const ETERNAL_FOG = new THREE.Color('#06070c')
const ETERNAL_FOG_NEAR = 10
const ETERNAL_FOG_FAR = 40
/** Con el faro encendido, de noche la isla se ve como con esta luz, algo más cálida. */
const LIGHTHOUSE_HEMI = 1.1
const LIGHTHOUSE_TINT = new THREE.Color('#ffe9a8')

/** Escena con el terreno, el agua y el cielo. Los props los añade Game, con las colocaciones de su sesión. */
/** La escena con la isla `island` (la malla del terreno se cambia con otra isla: ver Game). */
export function createScene(island: Island) {
  const scene = new THREE.Scene()
  // El fondo es el cielo, que se dibuja antes en su propia escena: esta no borra el color (ver Game.render).
  const background = new THREE.Color()
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

  const terrain = createTerrain(island)
  const water = createWater()
  scene.add(terrain, water)

  const view = new SkyView()
  const sky = { background, fog, hemi, sun, view }
  return { scene, sky, water, terrain }
}

export type Sky = ReturnType<typeof createScene>['sky']

/**
 * Aplica la hora del día (`phase`, ver DayClock) a cielo, niebla y luces, y centra la cámara
 * de sombras en `center` (normalmente por delante del jugador), ajustada a la rejilla de texels
 * en el espacio de la luz para que las sombras no parpadeen. La cúpula y el sol siguen a la cámara, en `eye`. `eternal`: cuánto ha cerrado la niebla de la Noche Eterna, de 0 a 1;
 * `lighthouse`: cuánto se nota el faro encendido, de 0 a 1.
 */
export function updateSky(sky: Sky, phase: number, center: THREE.Vector3, eye: THREE.Vector3, eternal = 0, lighthouse = 0) {
  sampleSky(phase, state)
  sky.background.copy(state.sky).lerp(ETERNAL_FOG, eternal)
  sky.fog.color.copy(sky.background)
  sky.fog.near = THREE.MathUtils.lerp(state.fogNear, ETERNAL_FOG_NEAR, eternal)
  sky.fog.far = THREE.MathUtils.lerp(state.fogFar, ETERNAL_FOG_FAR, eternal)
  sky.view.update(state, phase, eye, sky.background, eternal)
  sky.hemi.color.copy(state.hemiSky).lerp(LIGHTHOUSE_TINT, lighthouse * 0.5)
  sky.hemi.groundColor.copy(state.hemiGround)
  sky.hemi.intensity = THREE.MathUtils.lerp(state.hemiIntensity, Math.max(state.hemiIntensity, LIGHTHOUSE_HEMI), lighthouse)
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
