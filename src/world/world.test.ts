import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { computeWorldHash } from './hash'
import { createProps } from './props'

describe('mundo determinista', () => {
  const world = createProps()

  // El código de la fase 1 da '50ef32fe' en Node y '2e7f5c79' en Chromium (las funciones
  // matemáticas difieren en los últimos bits). El valor del navegador se comprueba con Playwright.
  it('conserva el hash de la fase 1 (referencia en Node)', () => {
    expect(computeWorldHash(Object.values(world.meshes))).toBe('50ef32fe')
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
