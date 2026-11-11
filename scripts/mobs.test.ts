import { existsSync, readFileSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ENEMY_DEFS, ENEMY_TYPES, LOOK_GROWTH, type EnemyType } from '../src/sim/constants'
import { ENEMY_MODELS } from '../src/view/enemyModels'

const DIR = 'public/models/mobs'
/** Se descarga uno por tipo la primera vez que sale: que no pese. El trasgo gigante va tal cual, con sus texturas. */
const MAX_BYTES = 1.5 * 1024 * 1024
const MAX_TEXTURED_BYTES = 7 * 1024 * 1024
/** Los extras de los clips van redondeados a la centésima. */
const CLOSE = 2

interface Gltf {
  scenes: { extras?: { escala?: Record<string, number> } }[]
  nodes: { name?: string; mesh?: number }[]
  meshes: { primitives: unknown[] }[]
  images?: unknown[]
  animations: { name: string; extras?: Record<string, number>; samplers: { input: number }[] }[]
  accessors: { max?: number[] }[]
}

const cache = new Map<string, Gltf>()
const read = (file: string): Gltf => {
  let json = cache.get(file)
  if (!json) {
    const data = readFileSync(`${DIR}/${file}.glb`)
    expect(data.toString('ascii', 0, 4)).toBe('glTF')
    json = JSON.parse(data.toString('utf8', 20, 20 + data.readUInt32LE(12))) as Gltf
    cache.set(file, json)
  }
  return json
}
const clip = (json: Gltf, name: string) => json.animations.find((a) => a.name === name)
/** Lo que dura un clip: lo que llega el último de sus tiempos. */
const duration = (json: Gltf, name: string) => Math.max(...clip(json, name)!.samplers.map((s) => json.accessors[s.input].max?.[0] ?? 0))

describe('los modelos de los mobs', () => {
  it('llevan su licencia', () => {
    expect(existsSync(`${DIR}/LICENSE.txt`)).toBe(true)
  })

  it.each(ENEMY_TYPES)('%s: existe, no pesa de más y tiene las animaciones que usa el juego', (type: EnemyType) => {
    const { file, clips } = ENEMY_MODELS[type]
    const json = read(file)
    const textured = (json.images?.length ?? 0) > 0
    expect(statSync(`${DIR}/${file}.glb`).size).toBeLessThanOrEqual(textured ? MAX_TEXTURED_BYTES : MAX_BYTES)
    for (const name of Object.values(clips)) if (typeof name === 'string') expect(clip(json, name), `${type}: ${name}`).toBeDefined()
    // Sin texturas, horneado: como mucho dos piezas por malla (lo que se ilumina y lo que brilla).
    if (!textured) for (const mesh of json.meshes) expect(mesh.primitives.length).toBeLessThanOrEqual(2)
  })

  it.each(ENEMY_TYPES.filter((t) => ENEMY_DEFS[t].specials))('%s: cada ataque especial tiene su clip, con el aviso y lo agotado de la simulación', (type: EnemyType) => {
    const json = read(ENEMY_MODELS[type].file)
    const def = ENEMY_DEFS[type]
    for (const special of def.specials!) {
      const anim = clip(json, special.id)
      expect(anim, `${type}: ${special.id}`).toBeDefined()
      if (special.id === 'charge') {
        expect(anim!.extras?.aviso).toBeCloseTo(special.windup, CLOSE)
        expect(anim!.extras?.golpe).toBeCloseTo(special.windup + def.charge!.time, CLOSE)
      } else {
        expect(anim!.extras?.golpe, `${type}: ${special.id}`).toBeCloseTo(special.windup, CLOSE)
      }
      expect(anim!.extras?.agotado, `${type}: ${special.id}`).toBeCloseTo(special.recover, CLOSE)
    }
  })

  it('el lancero suelta la lanza cuando la simulación, y acaba el lanzamiento cuando ella', () => {
    const json = read(ENEMY_MODELS.spearGoblin.file)
    const { windup, ranged } = ENEMY_DEFS.spearGoblin
    const name = ENEMY_MODELS.spearGoblin.clips.throw!
    expect(clip(json, name)!.extras?.soltar).toBeCloseTo(windup, CLOSE)
    expect(duration(json, name) - windup).toBeCloseTo(ranged!.recover, 1)
  })

  it('crecen con su apariencia lo mismo en el modelo que en la simulación (LOOK_GROWTH)', () => {
    for (const type of ENEMY_TYPES) {
      const escala = read(ENEMY_MODELS[type].file).scenes[0].extras?.escala ?? {}
      const growth = LOOK_GROWTH[type] ?? [1, 1, 1]
      expect([1, escala.noche ?? 1, escala.totem ?? 1], type).toEqual([...growth])
    }
  })
})
