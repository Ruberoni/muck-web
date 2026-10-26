import { describe, expect, it } from 'vitest'
import { PROP_DEFS } from './constants'
import { recipeById, type RecipeId } from './crafting'
import type { ItemId } from './inventory'
import { generatePropPlacements, type PropKind } from './props'

/** Jugadores de una sala llena (MAX_PLAYERS en src/net/protocol.ts, que src/sim no importa). */
const MAX_PLAYERS = 8

/** Lo que fabrica cada jugador para llegar al final: todas las herramientas y una fogata. */
const PER_PLAYER: readonly RecipeId[] = [
  'wood_axe',
  'wood_pickaxe',
  'campfire',
  'stone_axe',
  'stone_pickaxe',
  'iron_axe',
  'iron_pickaxe',
  'mithril_axe',
  'mithril_pickaxe',
]
/** Las estaciones son compartidas: una de cada para todos. */
const SHARED: readonly RecipeId[] = ['workbench', 'furnace', 'anvil']

type Amounts = Partial<Record<ItemId, number>>

/** Lo que cuesta `recipe` en materiales que se recogen, deshaciendo los lingotes en mineral y madera. */
function rawCost(recipe: RecipeId, into: Amounts = {}, times = 1): Amounts {
  for (const { item, amount } of recipeById(recipe)!.cost) {
    if (recipeById(item as RecipeId)) rawCost(item as RecipeId, into, amount * times)
    else into[item] = (into[item] ?? 0) + amount * times
  }
  return into
}

/** Lo que dan todos los árboles y rocas de la isla (no vuelven). */
function supply(): Amounts {
  const total: Amounts = {}
  for (const { kind } of generatePropPlacements()) {
    const { item, amount } = PROP_DEFS[kind].drop
    if (kind !== 'bush') total[item] = (total[item] ?? 0) + amount
  }
  return total
}

describe('equilibrio de recursos (§2.2 del plan)', () => {
  it(`con ${MAX_PLAYERS} jugadores la isla da para que todos lleguen al mithril, con margen`, () => {
    const need: Amounts = {}
    for (const r of PER_PLAYER) rawCost(r, need, MAX_PLAYERS)
    for (const r of SHARED) rawCost(r, need)
    expect(need).toEqual({ wood: 338, stone: 122, iron_ore: 52, birch_wood: 32, mithril_ore: 48, dark_wood: 32 })
    const have = supply()
    expect(have).toEqual({ wood: 720, stone: 180, iron_ore: 120, birch_wood: 160, mithril_ore: 64, dark_wood: 80 })
    // Lo más justo es el mithril: sobra un tercio (16 lingotes), por si alguien se hace más de un juego.
    for (const item of Object.keys(need) as ItemId[]) expect(have[item]! / need[item]!, item).toBeGreaterThanOrEqual(1.25)
  })

  it('un jugador solo rompe unos 15 árboles, 11 rocas, 4 menas de hierro, 2 de mithril, un abedul y un pino oscuro', () => {
    const need: Amounts = {}
    for (const r of [...PER_PLAYER, ...SHARED]) rawCost(r, need)
    expect(need).toEqual({ wood: 58, stone: 31, iron_ore: 10, birch_wood: 4, mithril_ore: 6, dark_wood: 4 })
    const kinds = Object.keys(PROP_DEFS) as PropKind[]
    const props = Object.fromEntries(
      (Object.keys(need) as ItemId[]).map((item) => {
        const kind = kinds.find((k) => PROP_DEFS[k].drop.item === item)!
        return [kind, Math.ceil(need[item]! / PROP_DEFS[kind].drop.amount)]
      }),
    )
    expect(props).toEqual({ tree: 15, rock: 11, iron_ore: 4, birch: 1, mithril_ore: 2, darkpine: 1 })
  })
})
