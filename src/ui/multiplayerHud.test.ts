import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { NAME_DISTANCE, pickNameTags } from './multiplayerHud'

describe('pickNameTags', () => {
  // Cámara en el origen mirando a −Z, como la del juego con yaw 0.
  const camera = new THREE.PerspectiveCamera(70, 2, 0.1, 600)
  camera.updateMatrixWorld()
  const v = new THREE.Vector3()
  const project = (x: number, y: number, z: number) => v.set(x, y, z).project(camera)
  const tag = (id: number, x: number, z: number) => ({ id, name: `J${id}`, x, y: 0, z })

  it('solo los que están delante, en pantalla y a menos de 40 m', () => {
    const tags = pickNameTags(
      [tag(1, 0, -10), tag(2, 0, 10), tag(3, 0, -(NAME_DISTANCE + 1)), tag(4, 200, -10), tag(5, 3, -20)],
      camera.position,
      project,
      800,
      400,
    )
    expect(tags.map((t) => t.id)).toEqual([1, 5])
    // Justo delante: en el centro de la pantalla.
    expect(tags[0].left).toBeCloseTo(400)
    expect(tags[0].top).toBeCloseTo(200)
    // A la derecha, a la derecha.
    expect(tags[1].left).toBeGreaterThan(400)
  })
})
