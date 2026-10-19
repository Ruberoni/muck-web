import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { computeWorldHash } from './debug'
import { createScene } from './scene'
import { WATER_LEVEL } from './world/terrain'

const container = document.querySelector<HTMLDivElement>('#app')!

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap
container.appendChild(renderer.domElement)

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 600)
camera.position.set(70, 55, 70)

const controls = new OrbitControls(camera, renderer.domElement)
controls.target.set(0, 4, 0)
controls.enableDamping = true
controls.minDistance = 10
controls.maxDistance = 220
controls.maxPolarAngle = Math.PI * 0.47

const { scene, water, propInstances } = createScene()

if (import.meta.env.DEV) {
  window.__debug = { worldHash: computeWorldHash(propInstances) }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

renderer.setAnimationLoop((time) => {
  water.position.y = WATER_LEVEL + Math.sin(time * 0.0008) * 0.08
  controls.update()
  renderer.render(scene, camera)
})
