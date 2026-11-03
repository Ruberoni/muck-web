import type * as THREE from 'three'

/**
 * Las piezas de los modelos de naturaleza (public/models/nature/nature.glb, de scripts/build-nature.mjs), por nombre:
 * `tree_trunk_0`, `rock_2`, `grass_1`… y, de las grandes, su versión para lejos (`<nombre>_far`).
 */
export type NatureModels = ReadonlyMap<string, THREE.BufferGeometry>

/** Descarga los modelos una vez; si falla, se sigue con las formas de siempre. */
export async function loadNature(): Promise<NatureModels> {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
  const gltf = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/nature/nature.glb`)
  const models = new Map<string, THREE.BufferGeometry>()
  gltf.scene.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (mesh.isMesh) models.set(mesh.name || object.name, mesh.geometry)
  })
  return models
}
