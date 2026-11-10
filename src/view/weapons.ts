import * as THREE from 'three'

/** Las armas de `public/models/weapons.glb` (de `arte/taller/armas.mjs`), con el origen en su agarre y hacia +Y. */
export type WeaponName = 'Hacha' | 'Espada' | 'Espadon'

const pieces = new Map<WeaponName, THREE.Object3D>()
/** Un material de metal con el color de los vértices por cada material de nivel (madera, piedra, hierro…). */
const tinted = new Map<THREE.Material, THREE.Material>()
let loading: Promise<void> | null = null

/** Descarga las armas una vez; si falla, se sigue con las hechas en código y se reintenta la próxima vez. */
export function loadWeapons(): Promise<void> {
  loading ??= (async () => {
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
    const gltf = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/weapons.glb`)
    for (const name of ['Hacha', 'Espada', 'Espadon'] as const) {
      const piece = gltf.scene.getObjectByName(name)
      if (piece) pieces.set(name, piece)
    }
  })()
  loading.catch(() => (loading = null))
  return loading
}

/** Para las pruebas: como si ya se hubieran cargado. */
export function setWeapon(name: WeaponName, piece: THREE.Object3D | null) {
  if (piece) pieces.set(name, piece)
  else pieces.delete(name)
}

/**
 * Un arma de las del modelo, con su parte de `Metal` del material de su nivel (por el gris de sus vértices) y el
 * mango con su color. null si aún no ha cargado: entonces se usa la hecha en código.
 */
export function weaponModel(name: WeaponName, metal: THREE.Material): THREE.Group | null {
  const piece = pieces.get(name)
  if (!piece) return null
  const group = new THREE.Group()
  const copy = piece.clone()
  copy.position.set(0, 0, 0)
  copy.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = true
    const own = mesh.material as THREE.MeshStandardMaterial
    if (own.name === 'Metal') mesh.material = tintOf(metal)
    else own.flatShading = true
  })
  group.add(copy)
  return group
}

function tintOf(metal: THREE.Material) {
  let out = tinted.get(metal)
  if (!out) {
    const clone = metal.clone() as THREE.MeshStandardMaterial
    clone.vertexColors = true
    tinted.set(metal, (out = clone))
  }
  return out
}
