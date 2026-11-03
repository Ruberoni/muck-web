import * as THREE from 'three'
import { SpatialGrid, type Collider } from '../sim/collision'
import type { PropPlacement } from '../sim/props'
import { mulberry32 } from '../sim/random'
import type { Biome } from '../sim/world/biomes'
import { DEFAULT_ISLAND, type Island } from '../sim/world/island'
import { MAX_SLOPE, ROCK_LEVEL, SAND_LEVEL, WATER_LEVEL, WORLD_SIZE } from '../sim/world/terrain'
import { biomeBlend, terrainColor } from '../world/ground'
import type { NatureModels } from './nature'

/** Hasta dónde se dibuja la decoración alrededor de la cámara: más allá no se distingue y solo costaría. */
export const DECOR_RADIUS = 50
/** Cuánto tiene que moverse la cámara para volver a elegir qué se dibuja. */
const DECOR_STEP = 4
/** Siempre la misma: la decoración no es de la partida y sale igual en todos los clientes. */
const DECOR_SEED = 0x5eed
/** Lo que deja libre alrededor de cada prop. */
const PROP_GAP = 0.3

interface DecorDef {
  models: string[]
  count: number
  /** Cuánto sale en cada bioma, de 0 a 1. */
  biomes: Partial<Record<Biome, number>>
  scale: [number, number]
  /** Se tiñe del color del suelo de su sitio (la hierba); si no, lleva sus colores. */
  ground?: boolean
}

const DECOR: DecorDef[] = [
  { models: ['grass_0', 'grass_1', 'grass_2'], count: 2600, biomes: { meadow: 1, forest: 0.6, mountain: 0.15 }, scale: [0.8, 1.4], ground: true },
  { models: ['flower_0', 'flower_1', 'flower_2'], count: 360, biomes: { meadow: 1, forest: 0.2 }, scale: [0.8, 1.3] },
  { models: ['mushroom_0', 'mushroom_1'], count: 160, biomes: { forest: 1, meadow: 0.05 }, scale: [0.7, 1.3] },
  { models: ['pebble_0', 'pebble_1', 'pebble_2', 'pebble_3'], count: 300, biomes: { beach: 1, mountain: 0.8, meadow: 0.15, forest: 0.15 }, scale: [0.6, 1.2] },
]

/** Las piezas de los modelos que usa la decoración. */
export const DECOR_MODELS: readonly string[] = DECOR.flatMap((d) => d.models)

/** Una pieza de decoración: dónde está, su matriz y, si se tiñe, su color. */
export interface DecorItem {
  x: number
  z: number
  matrix: THREE.Matrix4
  color: THREE.Color | null
}

/**
 * Dónde va la decoración de la isla, con una semilla fija: en su bioma, por encima del agua (la de colores, también de
 * la arena), sin pendientes fuertes ni encima de los props. Sin colisión ni nada en la simulación.
 */
export function scatterDecor(placements: readonly PropPlacement[], island: Island = DEFAULT_ISLAND, seed = DECOR_SEED): DecorItem[][][] {
  const rng = mulberry32(seed)
  const props = new SpatialGrid<Collider>()
  for (const { x, z, radius } of placements) props.insert({ x, z, radius, alive: true })
  const dummy = new THREE.Object3D()
  return DECOR.map((def) => {
    const byModel: DecorItem[][] = def.models.map(() => [])
    for (let tries = 0, placed = 0; placed < def.count && tries < def.count * 20; tries++) {
      const x = (rng() - 0.5) * WORLD_SIZE
      const z = (rng() - 0.5) * WORLD_SIZE
      const model = Math.floor(rng() * def.models.length)
      const s = def.scale[0] + rng() * (def.scale[1] - def.scale[0])
      const turn = rng() * Math.PI * 2
      const chance = rng()
      const y = island.heightAt(x, z)
      if (y < WATER_LEVEL + 0.1 || y > ROCK_LEVEL || island.slopeAt(x, z) > MAX_SLOPE) continue
      if (chance >= (def.biomes[island.biomeAt(x, z, y)] ?? 0)) continue
      if ([...props.query(x, z, PROP_GAP + props.maxRadius)].some((p) => Math.hypot(p.x - x, p.z - z) < p.radius + PROP_GAP)) continue
      placed++
      dummy.position.set(x, y - 0.03, z)
      dummy.rotation.set(0, turn, 0)
      dummy.scale.setScalar(s)
      dummy.updateMatrix()
      let color: THREE.Color | null = null
      if (def.ground) {
        const [r, g, b] = terrainColor(y, false, biomeBlend(island, x, z, y))
        // Algo más clara que el suelo, para que se vea.
        color = new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace).multiplyScalar(y < SAND_LEVEL ? 1 : 1.15)
      }
      byModel[model].push({ x, z, matrix: dummy.matrix.clone(), color })
    }
    return byModel
  })
}

/**
 * La decoración de la isla: hierba, flores, setas y guijarros de los modelos de naturaleza. Solo se dibuja lo que queda
 * a DECOR_RADIUS o menos de la cámara, sin sombras; un InstancedMesh por modelo.
 */
export class DecorView {
  readonly group = new THREE.Group()
  private meshes: { mesh: THREE.InstancedMesh; items: DecorItem[] }[] = []
  private material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true })
  private from: { x: number; z: number } | null = null

  constructor(models: NatureModels, placements: readonly PropPlacement[], island: Island = DEFAULT_ISLAND) {
    scatterDecor(placements, island).forEach((byModel, d) => {
      DECOR[d].models.forEach((name, m) => {
        const geometry = models.get(name)
        const items = byModel[m]
        if (!geometry || !items.length) return
        const mesh = new THREE.InstancedMesh(geometry, this.material, items.length)
        mesh.count = 0
        mesh.receiveShadow = true
        // Cambia de sitio con la cámara: su esfera no sirve para descartarla.
        mesh.frustumCulled = false
        if (DECOR[d].ground) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(items.length * 3), 3)
        this.meshes.push({ mesh, items })
        this.group.add(mesh)
      })
    })
  }

  /** Por frame: lo que queda cerca de `camera`, si se ha movido algo desde la última vez. */
  update(camera: { x: number; z: number }) {
    if (this.from && Math.hypot(camera.x - this.from.x, camera.z - this.from.z) < DECOR_STEP) return
    this.from = { x: camera.x, z: camera.z }
    for (const { mesh, items } of this.meshes) {
      let n = 0
      for (const item of items) {
        if (Math.hypot(item.x - camera.x, item.z - camera.z) > DECOR_RADIUS) continue
        mesh.setMatrixAt(n, item.matrix)
        if (item.color) mesh.setColorAt(n, item.color)
        n++
      }
      mesh.count = n
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }

  /** Cuántas piezas se dibujan ahora (para las pruebas). */
  get drawn() {
    return this.meshes.reduce((sum, { mesh }) => sum + mesh.count, 0)
  }

  dispose() {
    for (const { mesh } of this.meshes) mesh.dispose()
    this.material.dispose()
  }
}
