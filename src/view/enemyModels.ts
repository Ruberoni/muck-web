import * as THREE from 'three'
import type { EnemyType, HitEfficacy, MobLook } from '../sim/constants'
import { ENEMY_BODY_LIFT, ENEMY_BODY_RADIUS, ENEMY_BODY_SCALE } from '../sim/aim'

/** Las animaciones de un tipo de enemigo, por nombre de clip en su modelo. Los ataques especiales usan su `SpecialId`. */
export interface EnemyClips {
  idle: string
  walk: string
  run?: string
  /** El golpe cuerpo a cuerpo (`enemySwing`), y en qué segundo del clip pega si no lo dice su `extras.golpe`. */
  attack?: string
  impact?: number
  /** El lanzamiento (`enemyCharge aim` del lancero): suelta en `extras.soltar`. */
  throw?: string
  hit?: string
  death: string
}

/** De qué archivo sale cada tipo (`public/models/mobs/<file>.glb`, de `arte/taller/exportar.mjs`) y sus animaciones. */
export const ENEMY_MODELS: Record<EnemyType, { file: string; clips: EnemyClips }> = {
  goblin: { file: 'Trasgo', clips: { idle: 'Idle', walk: 'Walk', run: 'Run', attack: 'Sword_Slash', impact: 0.55, hit: 'HitRecieve', death: 'Death' } },
  spearGoblin: { file: 'TrasgoLanza', clips: { idle: 'Idle', walk: 'Walk', run: 'Run', throw: 'Lanzar', hit: 'HitRecieve', death: 'Death' } },
  golem: { file: 'Golem', clips: { idle: 'Idle', walk: 'Walk', run: 'Run', attack: 'Punch_Right', impact: 0.45, hit: 'HitRecieve', death: 'Death' } },
  spirit: { file: 'Espiritu', clips: { idle: 'Idle', walk: 'Walk', run: 'Run', attack: 'Attack', hit: 'HitRecieve', death: 'Death' } },
  dog: { file: 'Perro', clips: { idle: 'Idle', walk: 'Walk', run: 'Gallop', attack: 'Attack', impact: 0.55, hit: 'Idle_HitReact_Left', death: 'Death' } },
  giant: { file: 'TrasgoGigante', clips: { idle: 'Idle', walk: 'Walk', run: 'Run', hit: 'HitRecieve', death: 'Death' } },
  thrower: { file: 'Lanzarrocas', clips: { idle: 'Idle', walk: 'Walk', run: 'Run', hit: 'HitRecieve', death: 'Death' } },
  guardian: { file: 'Guardian', clips: { idle: 'Idle', walk: 'Walk', run: 'Run', hit: 'HitRecieve', death: 'Death' } },
  colossus: { file: 'Coloso', clips: { idle: 'Idle', walk: 'Walk', run: 'Run', hit: 'HitRecieve', death: 'Death' } },
}

const LOOK_NAMES = ['base', 'noche', 'totem'] as const
/** Alto de la hitbox sin escalar (sim/aim.ts): el modelo se ajusta a él, y luego crece con la escala de su tipo. */
export const HITBOX_HEIGHT = ENEMY_BODY_LIFT + ENEMY_BODY_RADIUS * ENEMY_BODY_SCALE.y

export type FlashKind = HitEfficacy | 'warn'

/** Lo que comparten todos los enemigos de un tipo con una apariencia: el modelo, sus clips y sus destellos. */
export interface EnemyTemplate {
  scene: THREE.Object3D
  clips: THREE.AnimationClip[]
  /** Escala que lo deja del alto de la hitbox sin escalar (HITBOX_HEIGHT), y cuánto subirlo para que pise el suelo. */
  fit: number
  lift: number
  /** Los materiales de destello de cada material del modelo (los que no se iluminan no destellan). */
  flashes: Map<THREE.Material, Record<FlashKind, THREE.Material>>
  clone(): THREE.Object3D
}

const FLASH: Record<FlashKind, { color: string; intensity: number }> = {
  normal: { color: '#ff3b2f', intensity: 0.8 },
  effective: { color: '#ffc21f', intensity: 0.8 },
  resisted: { color: '#8e8e8e', intensity: 0.6 },
  // El aviso de un ataque especial o de un lanzamiento: más suave que un golpe.
  warn: { color: '#ff3b2f', intensity: 0.35 },
}

/** Busca los modelos de los enemigos: `get` devuelve el de un tipo si ya está, y si no lo pide (se ve el de cajas). */
export interface EnemyModelSource {
  get(type: EnemyType, look: MobLook): EnemyTemplate | null
}

const modelUrl = (file: string) => `${import.meta.env.BASE_URL}models/mobs/${file}.glb`

type Tools = { loader: { loadAsync(url: string): Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }> }; clone: (o: THREE.Object3D) => THREE.Object3D }

/** Solo se descarga lo que hace falta: el cargador y cada modelo, la primera vez que sale uno de su tipo. */
const tools = async (): Promise<Tools> => {
  const [{ GLTFLoader }, { clone }] = await Promise.all([import('three/examples/jsm/loaders/GLTFLoader.js'), import('three/examples/jsm/utils/SkeletonUtils.js')])
  return { loader: new GLTFLoader(), clone }
}

/** Los modelos de verdad, desde `public/models/mobs`. Si uno no carga se reintenta al rato (puede haber sido la conexión). */
export class EnemyModels implements EnemyModelSource {
  private tools: Promise<Tools> | null = null
  private files = new Map<string, Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }>>()
  private templates = new Map<string, EnemyTemplate | 'loading'>()
  /** Las plantillas que se están descargando, para que `preload` espere también a las que pidió `get`. */
  private loading = new Map<string, Promise<EnemyTemplate>>()

  get(type: EnemyType, look: MobLook): EnemyTemplate | null {
    const key = `${type}:${look}`
    const found = this.templates.get(key)
    if (found === 'loading') return null
    if (found) return found
    this.start(type, look, key).catch(() => {})
    return null
  }

  /** Para que el primero que salga ya tenga su modelo. La promesa acaba cuando han llegado (o falla si alguno no). */
  preload(types: readonly EnemyType[]): Promise<void> {
    return Promise.all(
      types.map((type) => {
        const key = `${type}:0`
        return this.loading.get(key) ?? (this.templates.has(key) ? undefined : this.start(type, 0, key))
      }),
    ).then(() => undefined)
  }

  private start(type: EnemyType, look: MobLook, key: string): Promise<EnemyTemplate> {
    this.templates.set(key, 'loading')
    const load = this.load(type, look)
    this.loading.set(key, load)
    load.finally(() => this.loading.delete(key)).catch(() => {})
    load.then(
      (template) => this.templates.set(key, template),
      () => setTimeout(() => this.templates.delete(key), 10_000),
    )
    return load
  }

  private async load(type: EnemyType, look: MobLook): Promise<EnemyTemplate> {
    const { file } = ENEMY_MODELS[type]
    const { clone, loader } = await (this.tools ??= tools())
    let gltf = this.files.get(file)
    if (!gltf) {
      gltf = loader.loadAsync(modelUrl(file))
      gltf.catch(() => this.files.delete(file))
      this.files.set(file, gltf)
    }
    const { scene, animations } = await gltf
    return buildTemplate(clone(scene), animations, look, clone)
  }
}

/** La apariencia `look` de un modelo exportado: sin las piezas de las demás (si no tiene la suya, la de siempre). */
export function buildTemplate(scene: THREE.Object3D, clips: THREE.AnimationClip[], look: MobLook, clone: (o: THREE.Object3D) => THREE.Object3D): EnemyTemplate {
  const prefixes = new Set<string>()
  scene.traverse((o) => {
    const m = o.name.match(/^(base|noche|totem)__/)
    if (m) prefixes.add(m[1])
  })
  const wanted = prefixes.has(LOOK_NAMES[look]) ? LOOK_NAMES[look] : 'base'
  const drop: THREE.Object3D[] = []
  scene.traverse((o) => {
    const m = o.name.match(/^(base|noche|totem)__/)
    if (m && m[1] !== wanted) drop.push(o)
  })
  for (const o of drop) o.removeFromParent()
  const flashes = new Map<THREE.Material, Record<FlashKind, THREE.Material>>()
  scene.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return
    const mesh = o as THREE.Mesh
    mesh.castShadow = true
    // Animado, la caja de la pose de reposo no vale: que no lo quite de la vista por error.
    mesh.frustumCulled = false
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (flashes.has(material) || !(material as THREE.MeshStandardMaterial).isMeshStandardMaterial) continue
      const entry = {} as Record<FlashKind, THREE.Material>
      for (const kind of Object.keys(FLASH) as FlashKind[]) {
        const flash = (material as THREE.MeshStandardMaterial).clone()
        flash.emissive.set(FLASH[kind].color)
        flash.emissiveIntensity = FLASH[kind].intensity
        entry[kind] = flash
      }
      flashes.set(material, entry)
    }
  })
  scene.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(scene)
  const height = Math.max(0.1, box.max.y - box.min.y)
  const fit = HITBOX_HEIGHT / height
  return { scene, clips, fit, lift: -box.min.y * fit, flashes, clone: () => clone(scene) }
}
