import { describe, expect, it } from 'vitest'
import { CameraShake } from './shake'

/** Lo más que se aparta la cámara en una sacudida a `distance` metros. */
function strongest(distance: number) {
  const shake = new CameraShake()
  shake.start(distance)
  let most = 0
  for (let i = 0; i < 60; i++) {
    const { x, y } = shake.update(1 / 60)
    most = Math.max(most, Math.abs(x), Math.abs(y))
  }
  return most
}

describe('sacudida de la cámara', () => {
  it('sin nada que la provoque no se mueve', () => {
    expect(new CameraShake().update(1 / 60)).toEqual({ x: 0, y: 0 })
  })

  it('cuanto más cerca, más tiembla; muy lejos, nada', () => {
    expect(strongest(5)).toBeGreaterThan(strongest(60))
    expect(strongest(60)).toBeGreaterThan(0)
    expect(strongest(500)).toBe(0)
  })

  it('se acaba sola', () => {
    const shake = new CameraShake()
    shake.start(1)
    for (let i = 0; i < 120; i++) shake.update(1 / 60)
    expect(shake.update(1 / 60)).toEqual({ x: 0, y: 0 })
  })
})
