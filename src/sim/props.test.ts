import { describe, expect, it } from 'vitest'
import { PROP_DEFS } from './constants'
import { createPropWorld, generatePropPlacements, resetProp } from './props'
import { heightAt, ROCK_LEVEL, SAND_LEVEL } from './world/terrain'

describe('colocación de props', () => {
  const placements = generatePropPlacements()

  it('es determinista', () => {
    expect(generatePropPlacements()).toEqual(placements)
  })

  it('el id es el índice: árboles, luego rocas y al final arbustos', () => {
    expect(placements.every((p, i) => p.id === i)).toBe(true)
    const kinds = placements.map((p) => p.kind)
    const order = ['tree', 'rock', 'bush']
    for (let i = 1; i < kinds.length; i++) expect(order.indexOf(kinds[i])).toBeGreaterThanOrEqual(order.indexOf(kinds[i - 1]))
    for (const kind of order) expect(kinds).toContain(kind)
  })

  it('árboles y arbustos solo giran en Y y escalan igual en los tres ejes', () => {
    for (const p of placements.filter((p) => p.kind !== 'rock')) {
      expect(p.rotX).toBe(0)
      expect(p.scaleY).toBe(p.scaleX)
      expect(p.scaleZ).toBe(p.scaleX)
    }
  })

  it('los arbustos están en hierba y no se solapan con otros props', () => {
    for (const bush of placements.filter((p) => p.kind === 'bush')) {
      const h = heightAt(bush.x, bush.z)
      expect(h).toBeGreaterThan(SAND_LEVEL)
      expect(h).toBeLessThanOrEqual(ROCK_LEVEL)
      for (const other of placements) {
        if (other === bush) continue
        expect(Math.hypot(other.x - bush.x, other.z - bush.z)).toBeGreaterThan(other.radius + bush.radius)
      }
    }
  })
})

describe('estado de los props', () => {
  it('empiezan vivos y con la vida de su tipo; la rejilla los contiene a todos', () => {
    const world = createPropWorld()
    expect(world.props).toHaveLength(world.placements.length)
    for (const prop of world.props) {
      expect(prop.alive).toBe(true)
      expect(prop.hp).toBe(PROP_DEFS[prop.kind].hp)
      expect(prop.maxHp).toBe(prop.hp)
      expect(world.grid.query(prop.x, prop.z, 0)).toContain(prop)
    }
  })

  it('resetProp lo revive con la vida llena', () => {
    const [prop] = createPropWorld().props
    prop.hp = 0
    prop.alive = false
    resetProp(prop)
    expect(prop).toMatchObject({ hp: prop.maxHp, alive: true })
  })
})
