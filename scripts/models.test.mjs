import { existsSync, readFileSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { autoSkin, isSkin, SKINS } from '../src/net/skins'

/** Lo mismo que limita el coste de una sala: cada skin se descarga entera. */
const MAX_SKIN_BYTES = 1024 * 1024

const glbJson = (path) => {
  const file = readFileSync(path)
  expect(file.toString('ascii', 0, 4)).toBe('glTF')
  return JSON.parse(file.toString('utf8', 20, 20 + file.readUInt32LE(12)))
}

const skinPath = (file) => `public/models/skins/${file}.glb`

describe('los modelos', () => {
  it('cada skin es una sola malla, sin animaciones y con colores en los vértices', () => {
    for (const { file } of SKINS) {
      const gltf = glbJson(skinPath(file))
      expect(gltf.meshes).toHaveLength(1)
      expect(gltf.meshes[0].primitives).toHaveLength(1)
      expect(Object.keys(gltf.meshes[0].primitives[0].attributes).sort()).toEqual(['COLOR_0', 'JOINTS_0', 'NORMAL', 'POSITION', 'WEIGHTS_0'])
      expect(gltf.animations).toBeUndefined()
      expect(statSync(skinPath(file)).size).toBeLessThan(MAX_SKIN_BYTES)
    }
  })

  it('todas comparten esqueleto con las animaciones', () => {
    const bones = (path) =>
      glbJson(path)
        .nodes.map((node) => node.name)
        .filter((name) => name !== 'Character')
    const expected = bones('public/models/animations.glb')
    for (const { file } of SKINS) expect(bones(skinPath(file))).toEqual(expected)
  })

  it('están las animaciones que usa el personaje', () => {
    const names = glbJson('public/models/animations.glb').animations.map((a) => a.name)
    for (const name of ['Idle', 'Walk', 'Run', 'Run_Back', 'Run_Left', 'Run_Right', 'Sword_Slash', 'Punch_Right', 'Interact', 'HitRecieve', 'Death']) expect(names).toContain(name)
  })

  it('la licencia va con ellos', () => {
    expect(existsSync('public/models/LICENSE.txt')).toBe(true)
  })
})

describe('las skins', () => {
  it('a quien no elige le toca una distinta en una sala llena', () => {
    // Con una sola skin todos caen en la misma; si vuelven a ser varias, que no se repitan en una sala llena.
    const auto = [0, 1, 2, 3, 4].map(autoSkin)
    expect(new Set(auto).size).toBe(Math.min(5, SKINS.length))
    expect([0, 7, 123].every((id) => isSkin(autoSkin(id)))).toBe(true)
  })

  it('solo vale un índice de la lista', () => {
    expect(isSkin(0)).toBe(true)
    expect(isSkin(SKINS.length - 1)).toBe(true)
    expect(isSkin(SKINS.length)).toBe(false)
    expect(isSkin(-1)).toBe(false)
    expect(isSkin(1.5)).toBe(false)
    expect(isSkin('0')).toBe(false)
  })
})
