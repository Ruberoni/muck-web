import { describe, expect, it } from 'vitest'
import { TICK_MS } from './clock'
import { angleDelta, InterpBuffer, Interpolator, MAX_EXTRAPOLATE_MS, PresentationQueue, type Pose } from './interp'

const pose = (x: number, yaw = 0): Pose => ({ x, y: 0, z: 0, yaw, pitch: 0 })

describe('InterpBuffer', () => {
  it('interpola entre las dos muestras que rodean el tick y no dibuja nada antes de la primera', () => {
    const buffer = new InterpBuffer<string>()
    buffer.push(10, pose(0), 'a')
    buffer.push(13, pose(3), 'b')
    expect(buffer.at(9)).toBeNull()
    expect(buffer.at(11.5)).toMatchObject({ pose: { x: 1.5 }, data: 'a' })
    expect(buffer.at(13)).toMatchObject({ pose: { x: 3 }, data: 'b' })
  })

  it('gira por el camino corto', () => {
    const buffer = new InterpBuffer<null>()
    buffer.push(0, pose(0, 3), null)
    buffer.push(2, pose(0, -3), null)
    // De 3 a −3 por π (0,28 rad), no por 0 (6 rad).
    const yaw = buffer.at(1)!.pose.yaw
    expect(Math.abs(angleDelta(yaw, Math.PI))).toBeLessThan(1e-9)
    expect(angleDelta(0.1, -0.1)).toBeCloseTo(-0.2)
    expect(angleDelta(-3, 3)).toBeCloseTo(6 - 2 * Math.PI)
  })

  it(`extrapola con la última velocidad hasta ${MAX_EXTRAPOLATE_MS} ms y luego se queda quieta`, () => {
    const buffer = new InterpBuffer<null>()
    buffer.push(0, pose(0), null)
    buffer.push(3, pose(3), null)
    expect(buffer.at(5)!.pose.x).toBeCloseTo(5)
    const limit = MAX_EXTRAPOLATE_MS / TICK_MS
    expect(buffer.at(3 + limit)!.pose.x).toBeCloseTo(3 + limit)
    expect(buffer.at(100)!.pose.x).toBeCloseTo(3 + limit)
    expect(buffer.at(100, undefined, false)!.pose.x).toBe(3)
  })

  it('olvida lo que ya no hace falta', () => {
    const buffer = new InterpBuffer<null>()
    for (let t = 0; t <= 30; t += 3) buffer.push(t, pose(t), null)
    buffer.trim(10)
    expect(buffer.at(9)!.pose.x).toBe(9)
    expect(buffer.at(8)).toBeNull()
  })
})

describe('Interpolator', () => {
  it('dibuja cada entidad desde su primera muestra hasta el tick en que falta de la lista', () => {
    const interp = new Interpolator<number>()
    interp.push(0, [{ id: 1, pose: pose(0), data: 10 }])
    interp.push(3, [
      { id: 1, pose: pose(3), data: 9 },
      { id: 2, pose: pose(-1), data: 5 },
    ])
    interp.push(6, [{ id: 2, pose: pose(-2), data: 5 }])
    expect(interp.sample(2).map((e) => [e.id, e.pose.x])).toEqual([[1, 2]])
    // La 1 ya no viene en el tick 6: hasta entonces se queda quieta en su última pose, sin extrapolar.
    expect(interp.sample(4.5).map((e) => [e.id, e.pose.x])).toEqual([
      [1, 3],
      [2, -1.5],
    ])
    expect(interp.sample(6).map((e) => e.id)).toEqual([2])
    expect(interp.has(1)).toBe(false)
  })

  it('una entidad que vuelve empieza de cero', () => {
    const interp = new Interpolator<null>()
    interp.push(0, [{ id: 1, pose: pose(0), data: null }])
    interp.push(3, [])
    interp.push(30, [{ id: 1, pose: pose(30), data: null }])
    expect(interp.sample(20)).toEqual([])
    expect(interp.sample(31)[0].pose.x).toBe(30)
  })
})

describe('PresentationQueue', () => {
  it('suelta los eventos cuando el render llega a su tick, en orden', () => {
    const queue = new PresentationQueue<{ tick: number; n: number }>()
    queue.push([
      { tick: 5, n: 1 },
      { tick: 5, n: 2 },
      { tick: 8, n: 3 },
    ])
    expect(queue.take(4.9)).toEqual([])
    expect(queue.take(5).map((e) => e.n)).toEqual([1, 2])
    expect(queue.take(20).map((e) => e.n)).toEqual([3])
    expect(queue.size).toBe(0)
  })
})
