import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { computeWorldHash } from './hash'
import { createProps, islandMeshes } from './props'
import { heightAt, ROCK_LEVEL, SAND_LEVEL } from '../sim/world/terrain'

describe('mundo determinista', () => {
  const world = createProps()

  // El código de la fase 1 da '50ef32fe' en Node y '2e7f5c79' en Chromium (las funciones
  // matemáticas difieren en los últimos bits). El valor del navegador se comprueba con Playwright.
  it('conserva el hash de la fase 1 (referencia en Node)', () => {
    expect(computeWorldHash(islandMeshes(world))).toBe('50ef32fe')
  })

  it('los arbustos son deterministas y no cambian árboles ni rocas', () => {
    const again = createProps()
    const { bushes, berries } = world.meshes
    expect(bushes.count).toBeGreaterThan(30)
    for (const mesh of berries) expect(mesh.count).toBe(bushes.count)
    expect(computeWorldHash([again.meshes.bushes, ...again.meshes.berries])).toBe(computeWorldHash([bushes, ...berries]))
    // Los arbustos van al final: los ids de árboles y rocas no se mueven.
    const firstBush = world.props.findIndex((p) => p.kind === 'bush')
    expect(world.props.slice(firstBush).every((p) => p.kind === 'bush')).toBe(true)
  })

  it('los arbustos están en hierba y no se solapan con otros props', () => {
    for (const bush of world.props.filter((p) => p.kind === 'bush')) {
      const h = heightAt(bush.x, bush.z)
      expect(h).toBeGreaterThan(SAND_LEVEL)
      expect(h).toBeLessThanOrEqual(ROCK_LEVEL)
      for (const other of world.props) {
        if (other === bush) continue
        expect(Math.hypot(other.x - bush.x, other.z - bush.z)).toBeGreaterThan(other.radius + bush.radius)
      }
    }
  })

  it('las posiciones de PropData coinciden con las matrices de instancia', () => {
    const m = new THREE.Matrix4()
    const p = new THREE.Vector3()
    for (const prop of world.props) {
      for (const { mesh, index } of prop.instances) {
        mesh.getMatrixAt(index, m)
        p.setFromMatrixPosition(m)
        expect(p.x).toBeCloseTo(prop.x, 4)
        expect(p.y).toBeCloseTo(prop.y, 4)
        expect(p.z).toBeCloseTo(prop.z, 4)
      }
    }
  })

  it('instanceToProp apunta al prop correcto en cada mesh', () => {
    for (const prop of world.props) {
      for (const { mesh, index } of prop.instances) expect(world.instanceToProp.get(mesh)![index]).toBe(prop.id)
    }
  })
})
