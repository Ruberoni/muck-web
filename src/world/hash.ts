import type * as THREE from 'three'
import { heightAt, WORLD_SIZE } from '../sim/world/terrain'

const SAMPLE_GRID = 16

/** FNV-1a sobre las transformaciones de los props y una rejilla de muestras de heightAt. */
export function computeWorldHash(instances: THREE.InstancedMesh[]): string {
  let hash = 0x811c9dc5
  const feed = (values: Float32Array) => {
    const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength)
    for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193)
  }

  for (const mesh of instances) feed(mesh.instanceMatrix.array.subarray(0, mesh.count * 16) as Float32Array)

  const samples = new Float32Array(SAMPLE_GRID * SAMPLE_GRID)
  const step = WORLD_SIZE / SAMPLE_GRID
  for (let i = 0; i < SAMPLE_GRID; i++) {
    for (let j = 0; j < SAMPLE_GRID; j++) {
      samples[i * SAMPLE_GRID + j] = heightAt(-WORLD_SIZE / 2 + i * step, -WORLD_SIZE / 2 + j * step)
    }
  }
  feed(samples)

  return (hash >>> 0).toString(16).padStart(8, '0')
}
