import { readFileSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PATH = 'public/models/weapons.glb'

describe('las armas', () => {
  it('tres piezas con el metal aparte (se tiñe de su nivel) y el mango, sin texturas, y no pesan', () => {
    const file = readFileSync(PATH)
    const json = JSON.parse(file.toString('utf8', 20, 20 + file.readUInt32LE(12)))
    expect(json.nodes.map((n: { name: string }) => n.name).sort()).toEqual(['Espada', 'Espadon', 'Hacha'])
    expect(json.materials.map((m: { name: string }) => m.name).sort()).toEqual(['Mango', 'Metal'])
    expect(json.images).toBeUndefined()
    for (const mesh of json.meshes) for (const p of mesh.primitives) expect(Object.keys(p.attributes)).toContain('COLOR_0')
    expect(statSync(PATH).size).toBeLessThan(256 * 1024)
  })
})
