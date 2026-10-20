import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { computeWorldHash } from './hash'
import { createPropWorld } from '../sim/props'
import { islandMeshes, PropView } from '../view/PropView'

describe('mundo determinista', () => {
  const world = createPropWorld()
  const view = new PropView(world.placements)

  // El código de la fase 1 da '50ef32fe' en Node y '2e7f5c79' en Chromium (las funciones
  // matemáticas difieren en los últimos bits). El valor del navegador se comprueba con Playwright.
  it('conserva el hash de la fase 1 (referencia en Node)', () => {
    expect(computeWorldHash(islandMeshes(view))).toBe('50ef32fe')
  })

  it('los arbustos son deterministas', () => {
    const again = new PropView(createPropWorld().placements)
    const { bushes, berries } = view.meshes
    expect(bushes.count).toBeGreaterThan(30)
    for (const mesh of berries) expect(mesh.count).toBe(bushes.count)
    expect(computeWorldHash([again.meshes.bushes, ...again.meshes.berries])).toBe(computeWorldHash([bushes, ...berries]))
  })

  it('las posiciones de las colocaciones coinciden con las matrices de instancia', () => {
    const m = new THREE.Matrix4()
    const p = new THREE.Vector3()
    for (const prop of world.placements) {
      for (const { mesh, index } of view.instancesOf(prop.id)) {
        mesh.getMatrixAt(index, m)
        p.setFromMatrixPosition(m)
        expect(p.x).toBeCloseTo(prop.x, 4)
        expect(p.y).toBeCloseTo(prop.y, 4)
        expect(p.z).toBeCloseTo(prop.z, 4)
      }
    }
  })

  it('propAt apunta al prop correcto en cada mesh', () => {
    for (const prop of world.placements) {
      for (const { mesh, index } of view.instancesOf(prop.id)) expect(view.propAt(mesh, index)).toBe(prop.id)
    }
    expect(view.propAt(view.meshes.trunks, undefined)).toBe(-1)
  })
})
