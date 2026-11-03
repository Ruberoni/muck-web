import { existsSync, readFileSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BUSH_LIFT, BUSH_RADIUS, BUSH_SQUASH, FOLIAGE_BASE, FOLIAGE_HEIGHT, FOLIAGE_RADIUS, ROCK_RADIUS, TRUNK_BOTTOM_RADIUS } from '../src/sim/props'
import { DECOR_MODELS } from '../src/view/DecorView'
import { MODEL_PIECES } from '../src/view/PropView'

const PATH = 'public/models/nature/nature.glb'
/** Se descarga entero al empezar: que no pese. */
const MAX_BYTES = 512 * 1024

interface Gltf {
  nodes: { name: string; mesh: number }[]
  meshes: { primitives: { attributes: Record<string, number>; indices: number }[] }[]
  accessors: { count: number; min?: number[]; max?: number[] }[]
}

let parsed: Gltf | null = null

/** El JSON del `.glb`, leído una vez: cada pieza lo consulta. */
const gltf = (): Gltf => {
  if (parsed) return parsed
  const file = readFileSync(PATH)
  expect(file.toString('ascii', 0, 4)).toBe('glTF')
  return (parsed = JSON.parse(file.toString('utf8', 20, 20 + file.readUInt32LE(12))))
}

/** La caja y los triángulos de la pieza `name`. */
function piece(name: string) {
  const json = gltf()
  const node = json.nodes.find((n) => n.name === name)
  if (!node) return null
  const [primitive] = json.meshes[node.mesh].primitives
  const position = json.accessors[primitive.attributes.POSITION]
  return { min: position.min!, max: position.max!, triangles: json.accessors[primitive.indices].count / 3, attributes: Object.keys(primitive.attributes).sort() }
}

describe('los modelos de naturaleza', () => {
  it('están todas las piezas que usan los props y la decoración, con colores en los vértices', () => {
    for (const name of [...MODEL_PIECES, ...DECOR_MODELS]) {
      expect(piece(name), name).not.toBeNull()
      expect(piece(name)!.attributes, name).toEqual(['COLOR_0', 'POSITION'])
    }
    expect(statSync(PATH).size).toBeLessThan(MAX_BYTES)
    expect(existsSync('public/models/nature/LICENSE.txt')).toBe(true)
  })

  it('la versión de lejos tiene menos triángulos', () => {
    const fars = gltf().nodes.filter((n) => n.name.endsWith('_far'))
    expect(fars.length).toBeGreaterThan(0)
    for (const { name } of fars) expect(piece(name)!.triangles, name).toBeLessThan(piece(name.replace(/_far$/, ''))!.triangles)
  })

  // Las hitboxes (src/sim/aim.ts) no cambian: lo que se ve tiene que quedar más o menos dentro.
  it('los árboles miden lo de su hitbox, con el tronco en el eje', () => {
    for (const name of MODEL_PIECES.filter((n) => /^(tree|birch|pine)_/.test(n))) {
      const { min, max } = piece(name)!
      expect(min[1], name).toBeGreaterThanOrEqual(-0.01)
      expect(max[1], name).toBeLessThanOrEqual(FOLIAGE_BASE + FOLIAGE_HEIGHT + 0.01)
      for (const i of [0, 2]) expect(Math.max(-min[i], max[i]), name).toBeLessThanOrEqual(FOLIAGE_RADIUS * 1.25)
    }
    for (const name of MODEL_PIECES.filter((n) => /trunk/.test(n))) {
      const { min, max } = piece(name)!
      // Lo de abajo del tronco no se sale de la base de la hitbox (el resto se inclina dentro de la copa).
      expect(Math.min(max[0], -min[0]), name).toBeLessThan(TRUNK_BOTTOM_RADIUS * 3)
    }
  })

  it('las rocas caben en su icosaedro y los arbustos en el suyo', () => {
    for (const name of MODEL_PIECES.filter((n) => /^rock_/.test(n))) {
      const { min, max } = piece(name)!
      for (let i = 0; i < 3; i++) expect(Math.max(-min[i], max[i]), name).toBeLessThanOrEqual(ROCK_RADIUS)
    }
    for (const name of MODEL_PIECES.filter((n) => /^bush_/.test(n))) {
      const { min, max } = piece(name)!
      for (const i of [0, 2]) expect(Math.max(-min[i], max[i]), name).toBeLessThanOrEqual(BUSH_RADIUS * 1.1)
      expect(max[1], name).toBeLessThanOrEqual(BUSH_LIFT + BUSH_RADIUS * BUSH_SQUASH + 0.1)
    }
  })
})
