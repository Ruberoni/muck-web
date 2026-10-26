import { describe, expect, it } from 'vitest'
import { PROP_DEFS, TOOL_DEFS } from './constants'
import { ITEM_NAMES, type ItemId } from './inventory'
import type { PropKind } from './props'
import { attackDamage, canDamage, propDamage, requiredTool } from './tiers'

const KINDS = Object.keys(PROP_DEFS) as PropKind[]
const ITEMS = [null, ...(Object.keys(ITEM_NAMES) as ItemId[])]

describe('niveles: daño contra props', () => {
  // Tabla completa (§2.3 del plan) con lo que hay hoy: árbol y arbusto de nivel 0, roca de nivel 1.
  it.each<[ItemId | null, number, number, number]>([
    // objeto, árbol, roca, arbusto
    [null, 1, 0, 1],
    ['wood', 1, 0, 1],
    ['stone', 1, 0, 1],
    ['berry', 1, 0, 1],
    ['campfire', 1, 0, 1],
    ['wood_axe', 2, 0, 1],
    ['stone_axe', 4, 0, 1],
    ['wood_pickaxe', 1, 2, 1],
    ['stone_pickaxe', 1, 4, 1],
  ])('%s: árbol %i, roca %i, arbusto %i', (item, tree, rock, bush) => {
    expect(propDamage(item, 'tree')).toBe(tree)
    expect(propDamage(item, 'rock')).toBe(rock)
    expect(propDamage(item, 'bush')).toBe(bush)
  })

  it('para cualquier objeto y tipo: lo de nivel 0 siempre se daña, y lo que no es herramienta solo daña eso', () => {
    for (const kind of KINDS) {
      const { tier } = PROP_DEFS[kind]
      for (const item of ITEMS) {
        const damage = propDamage(item, kind)
        if (tier === 0) expect(damage, `${item} → ${kind}`).toBeGreaterThanOrEqual(1)
        if (!(item && TOOL_DEFS[item])) expect(damage, `${item} → ${kind}`).toBe(tier === 0 ? 1 : 0)
        expect(canDamage(item, kind)).toBe(damage > 0)
      }
    }
  })

  it('una herramienta de más nivel nunca hace menos daño que una de menos', () => {
    const tools = Object.entries(TOOL_DEFS)
    for (const [, a] of tools) {
      for (const [, b] of tools) {
        if (a!.family === b!.family && a!.tier > b!.tier) {
          expect(a!.damage).toBeGreaterThan(b!.damage)
          expect(a!.attack).toBeGreaterThanOrEqual(b!.attack)
        }
      }
    }
  })

  it('la roca pide un pico de madera; árbol y arbusto, nada', () => {
    expect(requiredTool('rock')).toEqual({ family: 'pickaxe', tier: 1 })
    expect(requiredTool('tree')).toBeNull()
    expect(requiredTool('bush')).toBeNull()
  })

  it('contra enemigos cuenta el ataque, sea cual sea la familia', () => {
    expect(attackDamage(null)).toBe(1)
    expect(attackDamage('stone')).toBe(1)
    expect(attackDamage('wood_axe')).toBe(2)
    expect(attackDamage('wood_pickaxe')).toBe(2)
    expect(attackDamage('stone_axe')).toBe(3)
    expect(attackDamage('stone_pickaxe')).toBe(3)
  })
})
