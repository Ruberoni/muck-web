import { existsSync, readFileSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { autoSkin, isSkin, SKINS } from '../src/net/skins'

/** Lo mismo que limita el coste de una sala: cada skin se descarga entera. */
const MAX_SKIN_BYTES = 1024 * 1024
/** La náufraga: el cuerpo en piezas y las cuatro de armadura, que se prenden y se apagan. */
const PIECES = ['Naufraga_Pelo', 'Naufraga_Cabeza', 'Naufraga_Torso', 'Naufraga_Piernas', 'Naufraga_Pies', 'Armadura_Casco', 'Armadura_Peto', 'Armadura_Pantalon', 'Armadura_Botas']

const glbJson = (path) => {
  const file = readFileSync(path)
  expect(file.toString('ascii', 0, 4)).toBe('glTF')
  return JSON.parse(file.toString('utf8', 20, 20 + file.readUInt32LE(12)))
}

const skinPath = (file) => `public/models/skins/${file}.glb`

describe('los modelos', () => {
  it('cada skin trae el cuerpo y las cuatro piezas de armadura, sin animaciones', () => {
    for (const { file } of SKINS) {
      const gltf = glbJson(skinPath(file))
      expect(gltf.nodes.filter((n) => n.mesh !== undefined).map((n) => n.name).sort()).toEqual([...PIECES].sort())
      for (const mesh of gltf.meshes) {
        // Como mucho dos materiales: el del cuerpo y el que se tiñe del metal de la armadura.
        expect(mesh.primitives.length).toBeLessThanOrEqual(2)
        for (const p of mesh.primitives) expect(Object.keys(p.attributes)).toEqual(expect.arrayContaining(['JOINTS_0', 'NORMAL', 'POSITION', 'WEIGHTS_0']))
      }
      for (const piece of ['Casco', 'Peto', 'Pantalon', 'Botas']) expect(gltf.materials.map((m) => m.name)).toContain(`Armadura_${piece}_Tinte`)
      expect(gltf.animations).toBeUndefined()
      expect(statSync(skinPath(file)).size).toBeLessThan(MAX_SKIN_BYTES)
    }
  })

  it('todas comparten esqueleto con las animaciones', () => {
    const bones = (path) =>
      glbJson(path)
        .nodes.filter((node) => node.mesh === undefined)
        .map((node) => node.name)
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
