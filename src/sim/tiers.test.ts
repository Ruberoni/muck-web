import { describe, expect, it } from 'vitest'
import { PROP_DEFS, TOOL_DEFS } from './constants'
import { ITEM_NAMES, type ItemId } from './inventory'
import type { PropKind } from './props'
import { attackDamage, canDamage, propDamage, requiredTool } from './tiers'

const KINDS = Object.keys(PROP_DEFS) as PropKind[]
const ITEMS = [null, ...(Object.keys(ITEM_NAMES) as ItemId[])]
/** Golpes para romper un prop de `kind` con `item`. */
const hits = (item: ItemId, kind: PropKind) => Math.ceil(PROP_DEFS[kind].hp / propDamage(item, kind))

describe('niveles: daño contra props', () => {
  // Tabla completa (§2.3 del plan): árbol y arbusto de nivel 0, roca de nivel 1, abedul y mena de hierro de nivel 2,
  // pino oscuro y mena de mithril de nivel 3.
  const TABLE: [ItemId | null, number, number, number, number, number, number, number][] = [
    // objeto, árbol, abedul, pino oscuro, roca, mena de hierro, mena de mithril, arbusto
    [null, 1, 0, 0, 0, 0, 0, 1],
    ['wood', 1, 0, 0, 0, 0, 0, 1],
    ['stone', 1, 0, 0, 0, 0, 0, 1],
    ['berry', 1, 0, 0, 0, 0, 0, 1],
    ['raw_meat', 1, 0, 0, 0, 0, 0, 1],
    ['campfire', 1, 0, 0, 0, 0, 0, 1],
    ['birch_wood', 1, 0, 0, 0, 0, 0, 1],
    ['dark_wood', 1, 0, 0, 0, 0, 0, 1],
    ['iron_ore', 1, 0, 0, 0, 0, 0, 1],
    ['iron_bar', 1, 0, 0, 0, 0, 0, 1],
    ['mithril_ore', 1, 0, 0, 0, 0, 0, 1],
    ['mithril_bar', 1, 0, 0, 0, 0, 0, 1],
    ['workbench', 1, 0, 0, 0, 0, 0, 1],
    ['furnace', 1, 0, 0, 0, 0, 0, 1],
    ['anvil', 1, 0, 0, 0, 0, 0, 1],
    ['wood_axe', 2, 0, 0, 0, 0, 0, 1],
    ['stone_axe', 4, 4, 0, 0, 0, 0, 1],
    ['iron_axe', 6, 6, 6, 0, 0, 0, 1],
    ['mithril_axe', 12, 12, 12, 0, 0, 0, 1],
    ['wood_pickaxe', 1, 0, 0, 2, 0, 0, 1],
    ['stone_pickaxe', 1, 0, 0, 4, 4, 0, 1],
    ['iron_pickaxe', 1, 0, 0, 6, 6, 6, 1],
    ['mithril_pickaxe', 1, 0, 0, 12, 12, 12, 1],
  ]
  it.each(TABLE)(
    '%s: árbol %i, abedul %i, pino oscuro %i, roca %i, mena de hierro %i, mena de mithril %i, arbusto %i',
    (item, tree, birch, darkpine, rock, ironOre, mithrilOre, bush) => {
      expect(propDamage(item, 'tree')).toBe(tree)
      expect(propDamage(item, 'birch')).toBe(birch)
      expect(propDamage(item, 'darkpine')).toBe(darkpine)
      expect(propDamage(item, 'rock')).toBe(rock)
      expect(propDamage(item, 'iron_ore')).toBe(ironOre)
      expect(propDamage(item, 'mithril_ore')).toBe(mithrilOre)
      expect(propDamage(item, 'bush')).toBe(bush)
    },
  )

  it('la tabla recorre todos los objetos', () => {
    expect(new Set(TABLE.map(([item]) => item))).toEqual(new Set(ITEMS))
  })

  it('el pico de piedra pica la mena de hierro en 3 golpes y el de madera no; con el abedul, igual con las hachas', () => {
    expect(Math.ceil(PROP_DEFS.iron_ore.hp / propDamage('stone_pickaxe', 'iron_ore'))).toBe(3)
    expect(canDamage('wood_pickaxe', 'iron_ore')).toBe(false)
    expect(Math.ceil(PROP_DEFS.birch.hp / propDamage('stone_axe', 'birch'))).toBe(3)
    expect(canDamage('wood_axe', 'birch')).toBe(false)
    expect(requiredTool('iron_ore')).toEqual({ family: 'pickaxe', tier: 2 })
    expect(requiredTool('birch')).toEqual({ family: 'axe', tier: 2 })
  })

  it('las herramientas de hierro: 2 golpes a la mena de hierro y al abedul, 1 a la roca y al árbol', () => {
    expect(hits('iron_pickaxe', 'iron_ore')).toBe(2)
    expect(hits('iron_axe', 'birch')).toBe(2)
    expect(hits('iron_pickaxe', 'rock')).toBe(1)
    expect(hits('iron_axe', 'tree')).toBe(1)
    // Cada una solo sirve para lo suyo.
    expect(canDamage('iron_axe', 'iron_ore')).toBe(false)
    expect(canDamage('iron_pickaxe', 'birch')).toBe(false)
  })

  it('mena de mithril y pino oscuro: 3 golpes con hierro y 2 con mithril; con mithril, abedul y mena de hierro caen de uno', () => {
    expect(hits('iron_pickaxe', 'mithril_ore')).toBe(3)
    expect(hits('mithril_pickaxe', 'mithril_ore')).toBe(2)
    expect(hits('iron_axe', 'darkpine')).toBe(3)
    expect(hits('mithril_axe', 'darkpine')).toBe(2)
    expect(hits('mithril_pickaxe', 'iron_ore')).toBe(1)
    expect(hits('mithril_axe', 'birch')).toBe(1)
    expect(canDamage('stone_pickaxe', 'mithril_ore')).toBe(false)
    expect(canDamage('stone_axe', 'darkpine')).toBe(false)
    expect(canDamage('mithril_axe', 'mithril_ore')).toBe(false)
    expect(requiredTool('mithril_ore')).toEqual({ family: 'pickaxe', tier: 3 })
    expect(requiredTool('darkpine')).toEqual({ family: 'axe', tier: 3 })
    // Ningún prop pide nivel 4.
    expect(Math.max(...KINDS.map((k) => PROP_DEFS[k].tier))).toBe(3)
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

  it('cada nivel de herramienta rompe más deprisa todo lo de su familia que la anterior aún no rompía de un golpe', () => {
    // Equilibrio (PR 11): con 9 de daño, el mithril tardaba lo mismo que el hierro con el abedul y la mena de hierro.
    const tools = Object.entries(TOOL_DEFS) as [ItemId, NonNullable<(typeof TOOL_DEFS)[ItemId]>][]
    for (const [item, tool] of tools) {
      const previous = tools.find(([, t]) => t.family === tool.family && t.tier === tool.tier - 1)
      if (!previous) continue
      for (const kind of KINDS.filter((k) => PROP_DEFS[k].tool === tool.family && canDamage(previous[0], k))) {
        const before = hits(previous[0], kind)
        if (before > 1) expect(hits(item, kind), `${item} contra ${kind} (${previous[0]}: ${before})`).toBeLessThan(before)
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
    expect(attackDamage('iron_axe')).toBe(4)
    expect(attackDamage('iron_pickaxe')).toBe(4)
    expect(attackDamage('mithril_axe')).toBe(6)
    expect(attackDamage('mithril_pickaxe')).toBe(6)
  })
})
