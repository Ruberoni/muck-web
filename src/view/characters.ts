import type * as THREE from 'three'
import { SKINS } from '../net/skins'
import { CharacterRig } from './CharacterRig'

/** Crea un personaje con la skin `skin`; falla si no se puede cargar, y entonces se sigue viendo el avatar de cajas. */
export type LoadCharacter = (skin: number) => Promise<CharacterRig>

const modelUrl = (path: string) => `${import.meta.env.BASE_URL}models/${path}.glb`

/** Solo se descarga lo que hace falta: el cargador, la primera vez que se ve un personaje (el del menú, también en solitario). */
const tools = async () => {
  const [{ GLTFLoader }, { clone }] = await Promise.all([import('three/examples/jsm/loaders/GLTFLoader.js'), import('three/examples/jsm/utils/SkeletonUtils.js')])
  return { loader: new GLTFLoader(), clone }
}

let toolsLoading: ReturnType<typeof tools> | null = null
let clipsLoading: Promise<THREE.AnimationClip[]> | null = null
const bodies = new Map<number, Promise<THREE.Object3D>>()

/** Vuelve a intentar la próxima vez en vez de recordar el fallo: puede haber sido la conexión. */
function remember<T>(load: Promise<T>, forget: () => void) {
  load.catch(forget)
  return load
}

function loadClips() {
  clipsLoading ??= remember(
    (async () => {
      const { loader } = await (toolsLoading ??= tools())
      return (await loader.loadAsync(modelUrl('animations'))).animations
    })(),
    () => (clipsLoading = null),
  )
  return clipsLoading
}

function loadBody(skin: number) {
  let body = bodies.get(skin)
  if (!body) {
    body = remember(
      (async () => {
        const { loader } = await (toolsLoading ??= tools())
        return (await loader.loadAsync(modelUrl(`skins/${SKINS[skin].file}`))).scene
      })(),
      () => bodies.delete(skin),
    )
    bodies.set(skin, body)
  }
  return body
}

/** Descarga el personaje `skin` y las animaciones sin crear ninguno (la pantalla de carga espera a que lleguen). */
export async function preloadCharacter(skin: number): Promise<void> {
  await Promise.all([(toolsLoading ??= tools()), loadBody(skin), loadClips()])
}

export const loadCharacter: LoadCharacter = async (skin) => {
  const [{ clone }, body, clips] = await Promise.all([(toolsLoading ??= tools()), loadBody(skin), loadClips()])
  return new CharacterRig(clone(body), clips)
}
