import { describe, expect, it } from 'vitest'
import { allFailed, loadFraction, LoadTracker } from './loadTracker'

const later = () => {
  let resolve!: () => void
  let reject!: (e: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('LoadTracker', () => {
  it('cuenta lo pedido, lo que llega y lo que falla', async () => {
    const tracker = new LoadTracker()
    let changes = 0
    tracker.onChange = () => changes++
    const a = later()
    const b = later()
    tracker.track(a.promise)
    tracker.track(b.promise).catch(() => {})
    expect(tracker.state).toEqual({ total: 2, done: 0, failed: 0 })
    expect(tracker.pending).toBe(2)
    expect(loadFraction(tracker.state)).toBe(0)
    a.resolve()
    await a.promise
    expect(tracker.state).toEqual({ total: 2, done: 1, failed: 0 })
    b.reject(new Error('sin red'))
    await b.promise.catch(() => {})
    expect(tracker.pending).toBe(0)
    expect(loadFraction(tracker.state)).toBe(1)
    expect(allFailed(tracker.state)).toBe(false)
    expect(changes).toBe(4)
  })

  it('todo fallado solo si se pidió algo y no llegó nada', () => {
    expect(allFailed({ total: 0, done: 0, failed: 0 })).toBe(false)
    expect(allFailed({ total: 3, done: 0, failed: 3 })).toBe(true)
    expect(allFailed({ total: 3, done: 1, failed: 2 })).toBe(false)
    expect(loadFraction({ total: 0, done: 0, failed: 0 })).toBe(1)
  })
})
