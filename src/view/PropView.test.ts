import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { BERRIES_PER_BUSH, WOBBLE_DURATION } from '../sim/constants'
import { generatePropPlacements } from '../sim/props'
import { CULL_DISTANCE, LOD_DISTANCE, MODEL_PIECES, PropView, type PropInstance } from './PropView'

const placements = generatePropPlacements()
const tree = placements.find((p) => p.kind === 'tree')!
const bush = placements.find((p) => p.kind === 'bush')!

const m = new THREE.Matrix4()
const isHidden = ({ mesh, index }: PropInstance) => {
  mesh.getMatrixAt(index, m)
  return new THREE.Vector3().setFromMatrixScale(m).length() === 0
}
const atBase = ({ mesh, index, base }: PropInstance) => {
  mesh.getMatrixAt(index, m)
  return m.equals(base)
}

describe('PropView', () => {
  it('construye una instancia por pieza: tronco y copa, roca, mena y cristales, arbusto y una por baya', () => {
    const view = new PropView(placements)
    expect(view.instancesOf(tree.id)).toHaveLength(2)
    expect(view.instancesOf(placements.find((p) => p.kind === 'rock')!.id)).toHaveLength(1)
    expect(view.instancesOf(placements.find((p) => p.kind === 'birch')!.id)).toHaveLength(2)
    expect(view.instancesOf(placements.find((p) => p.kind === 'iron_ore')!.id)).toHaveLength(2)
    expect(view.instancesOf(placements.find((p) => p.kind === 'darkpine')!.id)).toHaveLength(2)
    expect(view.instancesOf(placements.find((p) => p.kind === 'mithril_ore')!.id)).toHaveLength(2)
    expect(view.instancesOf(bush.id).filter((i) => i.berry !== undefined)).toHaveLength(BERRIES_PER_BUSH)
    expect(view.instancesOf(tree.id).every(atBase)).toBe(true)
  })

  it('cada tipo tiene sus propios meshes, con una instancia por prop', () => {
    const view = new PropView(placements)
    const kinds = ['tree', 'birch', 'darkpine', 'rock', 'iron_ore', 'mithril_ore', 'healing_herb'] as const
    const meshes = kinds.flatMap((kind) => view.byKind[kind])
    expect(new Set(meshes).size).toBe(meshes.length)
    for (const kind of kinds) {
      for (const mesh of view.byKind[kind]) expect(mesh.count).toBe(placements.filter((p) => p.kind === kind).length)
    }
  })

  it('un golpe en un prop ya roto no lo vuelve a mostrar', () => {
    const view = new PropView(placements)
    view.present([{ type: 'propDestroyed', id: tree.id, by: 0 }])
    view.present([{ type: 'propHit', id: tree.id, hp: 1, by: 0 }])
    view.update(WOBBLE_DURATION / 2)
    view.update(WOBBLE_DURATION)
    expect(view.instancesOf(tree.id).every(isHidden)).toBe(true)
  })

  it('las bayas siguen la vida del arbusto en berryTaken y berryGrew', () => {
    const view = new PropView(placements)
    const visible = () => view.instancesOf(bush.id).filter((i) => i.berry !== undefined && !isHidden(i)).length
    view.present([
      { type: 'berryTaken', id: bush.id, hp: 5, by: 0 },
      { type: 'berryTaken', id: bush.id, hp: 4, by: 0 },
    ])
    expect(visible()).toBe(4)
    view.update(WOBBLE_DURATION / 2)
    expect(visible()).toBe(4)
    view.present([{ type: 'berryGrew', id: bush.id, hp: 5 }])
    expect(visible()).toBe(5)
    view.update(WOBBLE_DURATION)
    expect(view.instancesOf(bush.id).filter((i) => !isHidden(i)).every(atBase)).toBe(true)
  })

  it('reset devuelve todas las instancias a su matriz base', () => {
    const view = new PropView(placements)
    view.present([
      { type: 'propDestroyed', id: tree.id, by: 0 },
      { type: 'berryTaken', id: bush.id, hp: 0, by: 0 },
    ])
    view.update(WOBBLE_DURATION / 2)
    view.reset()
    for (const p of [tree, bush]) expect(view.instancesOf(p.id).every(atBase)).toBe(true)
  })

  it('sync dibuja los props como dice un estado completo, sin animarlos', () => {
    const view = new PropView(placements)
    const rock = placements.find((p) => p.kind === 'rock')!
    view.present([{ type: 'propDestroyed', id: rock.id, by: 0 }])
    const props = placements.map((p) => ({ ...p, hp: p.id === bush.id ? 2 : 3, alive: p.id !== tree.id }))
    view.sync(props)
    expect(view.instancesOf(tree.id).every(isHidden)).toBe(true)
    // Lo de antes del estado no cuenta.
    expect(view.instancesOf(rock.id).every(atBase)).toBe(true)
    expect(view.instancesOf(bush.id).filter((i) => i.berry !== undefined && !isHidden(i))).toHaveLength(2)
    expect(view.instancesOf(bush.id).filter((i) => !isHidden(i)).every(atBase)).toBe(true)
  })
})

describe('PropView con los modelos de naturaleza', () => {
  /** Todas las piezas, con una caja cualquiera: solo importa a qué mesh va cada prop. */
  const fake = () => new Map([...MODEL_PIECES, ...MODEL_PIECES.map((n) => `${n}_far`)].map((name) => [name, new THREE.BoxGeometry()]))
  const withModels = () => {
    const view = new PropView(placements)
    view.useModels(fake())
    return view
  }
  const models = (id: number) => view(id).filter((i) => i.lod !== undefined)
  let current: PropView
  const view = (id: number) => current.instancesOf(id)
  const shown = (id: number) => models(id).filter((i) => i.index >= 0 && i.index < i.mesh.count && !isHidden(i)).map((i) => i.lod)

  it('oculta las formas de siempre salvo las bayas, que siguen siendo las mismas', () => {
    current = withModels()
    expect(current.meshes.trunks.visible).toBe(false)
    expect(current.meshes.foliage.visible).toBe(false)
    expect(current.meshes.bushes.visible).toBe(false)
    expect(current.meshes.berries.every((b) => b.visible)).toBe(true)
    // La hierba curativa no tiene modelo.
    expect(current.byKind.healing_herb.every((mesh) => mesh.visible)).toBe(true)
    // Tronco y copa, de cerca y de lejos; empieza viéndose lo de lejos.
    expect(models(tree.id)).toHaveLength(4)
    expect(shown(tree.id)).toEqual([1, 1])
  })

  it('de cerca se ve la versión entera, con sombra, de lejos la simplificada, sin ella, y tras la niebla nada', () => {
    current = withModels()
    current.updateLod(tree)
    expect(shown(tree.id)).toEqual([0, 0])
    const near = models(tree.id).find((i) => i.lod === 0)!
    const far = models(tree.id).find((i) => i.lod === 1)!
    expect(near.mesh.castShadow).toBe(true)
    expect(far.mesh.castShadow).toBe(false)
    // Cada mesh dibuja solo lo que se ve: de cerca, pocos.
    expect(near.mesh.count).toBeGreaterThan(0)
    expect(near.mesh.count).toBeLessThan(placements.filter((p) => p.kind === 'tree').length / 2)
    current.updateLod({ x: tree.x + LOD_DISTANCE + 10, z: tree.z })
    expect(shown(tree.id)).toEqual([1, 1])
    // Justo en el borde no cambia: hay margen para no parpadear.
    current.updateLod({ x: tree.x + LOD_DISTANCE - 1, z: tree.z })
    expect(shown(tree.id)).toEqual([1, 1])
    // Lo que tapa la niebla no se dibuja.
    current.updateLod({ x: tree.x + CULL_DISTANCE + 10, z: tree.z })
    expect(shown(tree.id)).toEqual([])
  })

  it('romper oculta las dos versiones, el temblor no saca la que no toca y reset vuelve a la que toca', () => {
    current = withModels()
    current.updateLod(tree)
    current.present([{ type: 'propHit', id: tree.id, by: 0, hp: 1 } as never])
    for (let t = 0; t < WOBBLE_DURATION; t += 0.016) current.update(0.016)
    expect(shown(tree.id)).toEqual([0, 0])
    current.present([{ type: 'propDestroyed', id: tree.id } as never])
    expect(shown(tree.id)).toEqual([])
    current.updateLod({ x: tree.x + 200, z: tree.z })
    expect(shown(tree.id)).toEqual([])
    current.reset()
    expect(shown(tree.id)).toEqual([1, 1])
    expect(models(tree.id).filter((i) => i.lod === 1).every(atBase)).toBe(true)
  })
})
