import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { aimRay, createPropHitboxes, pickTarget, type AimRay } from '../sim/aim'
import { SpatialGrid } from '../sim/collision'
import { EYE_HEIGHT, PROP_DEFS, REACH } from '../sim/constants'
import { createPropWorld, type PropData, type PropKind } from '../sim/props'
import { mulberry32 } from '../sim/random'
import { heightAt } from '../sim/world/terrain'
import { Enemies } from '../sim/enemies'
import { EnemyView } from './EnemyView'
import { PropView } from './PropView'

// Paridad de src/sim/aim.ts con el raycast de three contra los meshes, que era como se buscaba el objetivo.

const world = createPropWorld()
const view = new PropView(world.placements)
const hitboxes = createPropHitboxes(world.placements)
const raycaster = new THREE.Raycaster()
const hits: THREE.Intersection[] = []

/** Lo primero que toca el raycast de three: id de prop, 'enemy' o null. */
function meshTarget(objects: THREE.Object3D[], ray: AimRay): number | 'enemy' | null {
  raycaster.set(new THREE.Vector3(ray.ox, ray.oy, ray.oz), new THREE.Vector3(ray.dx, ray.dy, ray.dz))
  raycaster.far = REACH
  hits.length = 0
  raycaster.intersectObjects(objects, true, hits)
  for (const hit of hits) {
    if (hit.object.userData.enemy !== undefined) return 'enemy'
    const id = view.propAt(hit.object, hit.instanceId)
    if (id >= 0) return id
  }
  return null
}

const pose = (x: number, z: number, yaw: number, pitch: number) => ({ pos: { x, y: heightAt(x, z), z }, yaw, pitch })

/** Desde los ojos en (x, z) hacia el punto (tx, ty, tz). */
function rayTowards(x: number, z: number, tx: number, ty: number, tz: number) {
  const dx = tx - x
  const dz = tz - z
  const eye = heightAt(x, z) + EYE_HEIGHT
  return aimRay(pose(x, z, Math.atan2(-dx, -dz), Math.atan2(ty - eye, Math.hypot(dx, dz))))
}

/** Compara los dos métodos en los rayos que tocan algo con alguno de ellos. */
function compare(samples: { mesh: unknown; box: unknown }[]) {
  const touched = samples.filter((s) => s.mesh !== null || s.box !== null)
  return {
    touched: touched.length,
    same: touched.filter((s) => s.mesh === s.box).length,
    /** La hitbox toca algo donde el modelo no: apuntaría a algo que no se ve. */
    boxOnly: touched.filter((s) => s.mesh === null).length,
    /** Toca el modelo pero no la hitbox (detalles que no cuentan: bayas, cuernos, pies, ojos). */
    meshOnly: touched.filter((s) => s.box === null).length,
  }
}

/** 40 props de un tipo, 60 rayos a cada uno desde fuera de su radio hacia su volumen y sus bordes (según su familia). */
function propSamples(kind: PropKind) {
  const { family } = PROP_DEFS[kind]
  const rng = mulberry32(42)
  const samples: { mesh: number | 'enemy' | null; box: number | null }[] = []
  for (const prop of world.props.filter((p) => p.kind === kind).slice(0, 40)) {
    const height = (family === 'tree' ? 6 : 1.2) * prop.scaleY
    const base = family === 'rock' ? prop.y - 0.6 * prop.scaleY : prop.y
    const spread = prop.radius * 1.6 + (family === 'tree' ? 1.5 : 0.5)
    for (let i = 0; i < 60; i++) {
      const angle = rng() * Math.PI * 2
      const dist = prop.radius + 0.4 + rng() * 3
      const ray = rayTowards(
        prop.x + Math.cos(angle) * dist,
        prop.z + Math.sin(angle) * dist,
        prop.x + (rng() - 0.5) * spread,
        base + rng() * height,
        prop.z + (rng() - 0.5) * spread,
      )
      samples.push({ mesh: meshTarget(view.allMeshes, ray), box: pickTarget(ray, world.grid, hitboxes, [])?.id ?? null })
    }
  }
  return samples
}

describe('objetivo sin cámara: paridad con el raycast de three', () => {
  it('aimRay es el rayo del centro de la pantalla', () => {
    const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 600)
    camera.rotation.order = 'YXZ'
    const rng = mulberry32(1)
    for (let i = 0; i < 50; i++) {
      const p = pose(rng() * 20, rng() * 20, (rng() - 0.5) * 10, (rng() - 0.5) * 3)
      camera.position.set(p.pos.x, p.pos.y + EYE_HEIGHT, p.pos.z)
      camera.rotation.set(p.pitch, p.yaw, 0)
      camera.updateMatrixWorld()
      raycaster.setFromCamera(new THREE.Vector2(0, 0), camera)
      const ray = aimRay(p)
      const { origin, direction } = raycaster.ray
      expect([ray.ox, ray.oy, ray.oz, ray.dx, ray.dy, ray.dz].map((v) => v.toFixed(6))).toEqual(
        [origin.x, origin.y, origin.z, direction.x, direction.y, direction.z].map((v) => v.toFixed(6)),
      )
    }
  })

  // Árboles, abedules, pinos oscuros y rocas tienen las mismas caras que el modelo (el tronco del abedul está partido
  // en franjas, pero es la misma superficie).
  it.each(['tree', 'birch', 'darkpine', 'rock'] as const)('%s: el mismo objetivo en todos los rayos', (kind) => {
    const result = compare(propSamples(kind))
    expect(result.touched).toBeGreaterThan(800)
    expect(result.same).toBe(result.touched)
  })

  // Las menas de mithril son pocas (16) y pequeñas: tocan menos rayos.
  it.each([
    ['bush', 'las bayas', 800],
    ['iron_ore', 'los cristales', 800],
    ['mithril_ore', 'los cristales', 300],
  ] as const)('%s: solo difiere en %s que sobresalen', (kind, _part, minTouched) => {
    const result = compare(propSamples(kind))
    expect(result.touched).toBeGreaterThan(minTouched)
    expect(result.boxOnly).toBe(0)
    expect(result.same).toBe(result.touched - result.meshOnly)
    expect(result.meshOnly / result.touched).toBeLessThan(0.05)
  })

  it('enemigo: el cuerpo sin bote ni embestida; solo faltan cuernos, pies y ojos', () => {
    const enemies = new Enemies([])
    const enemyView = new EnemyView()
    const rng = mulberry32(5)
    const grid = new SpatialGrid<PropData>()
    const [ex, ez] = [10, 10]
    const samples: { mesh: boolean | null; box: boolean | null }[] = []
    for (let i = 0; i < 1000; i++) {
      enemies.reset()
      enemyView.reset()
      const enemy = enemies.spawnAt(ex, ez)
      enemy.yaw = rng() * Math.PI * 2
      enemyView.update(0, enemies.list, 1)
      const angle = rng() * Math.PI * 2
      const dist = 0.9 + rng() * 2.5
      const ray = rayTowards(
        ex + Math.cos(angle) * dist,
        ez + Math.sin(angle) * dist,
        ex + (rng() - 0.5) * 1.6,
        heightAt(ex, ez) + rng() * 2.2,
        ez + (rng() - 0.5) * 1.6,
      )
      samples.push({ mesh: meshTarget([enemyView.group], ray) === 'enemy' || null, box: pickTarget(ray, grid, hitboxes, enemies.list) === enemy || null })
    }
    const result = compare(samples)
    expect(result.touched).toBeGreaterThan(300)
    expect(result.boxOnly).toBe(0)
    expect(result.meshOnly / result.touched).toBeLessThan(0.1)
  })
})
