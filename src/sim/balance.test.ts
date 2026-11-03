import { describe, expect, it } from 'vitest'
import { ENEMY_DEFS, ENEMY_TYPES, HIT_COOLDOWN, PROP_DEFS, SHELL_RESIST, SWEEP_TARGETS, type EnemyType } from './constants'
import { BUILD_DEFS, phaseCost } from './builds'
import { recipeById, type RecipeId } from './crafting'
import { bossScale, enemyCapFor, spawnChance } from './enemies'
import type { ItemId } from './inventory'
import type { MatchRules } from './match'
import { generatePropPlacements, type PropKind } from './props'
import { FUEL_SECONDS, STATION_DEFS } from './stations'
import type { StructureKind } from './structures'
import { attackDamage, swingCooldown } from './tiers'

/** Jugadores de una sala llena (MAX_PLAYERS en src/net/protocol.ts, que src/sim no importa). */
const MAX_PLAYERS = 5

/** Lo que fabrica cada jugador para llegar al final: todas las herramientas y espadas y una fogata. */
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
  'wood_sword',
  'stone_sword',
  'iron_sword',
  'mithril_sword',
]
/** Las estaciones son compartidas: una de cada para todos. */
const SHARED: readonly RecipeId[] = ['workbench', 'furnace', 'anvil']

type Amounts = Partial<Record<ItemId, number>>

/** Lo que cuesta sacar una unidad de `item` de una estación: lo que se mete y la madera que arde mientras (null si no sale de ninguna). */
function processCost(item: ItemId): Amounts | null {
  for (const def of Object.values(STATION_DEFS)) {
    const process = def!.processes.find((p) => p.output === item)
    if (process) return { [process.input]: process.amount, ...(def!.fuel ? { wood: process.time / FUEL_SECONDS.wood! } : {}) }
  }
  return null
}

/** Suma `amount` de `item` en materiales que se recogen: deshace las recetas y lo que sale de las estaciones. */
function addRaw(item: ItemId, amount: number, into: Amounts) {
  const process = processCost(item)
  if (recipeById(item as RecipeId)) rawCost(item as RecipeId, into, amount)
  else if (process) for (const [input, n] of Object.entries(process) as [ItemId, number][]) addRaw(input, n * amount, into)
  else into[item] = (into[item] ?? 0) + amount
}

/** Lo que cuesta `recipe` en materiales que se recogen, deshaciendo los lingotes en mineral y madera (la del horno, en fracciones). */
function rawCost(recipe: RecipeId, into: Amounts = {}, times = 1): Amounts {
  for (const { item, amount } of recipeById(recipe)!.cost) addRaw(item, amount * times, into)
  return into
}

/** Redondeado hacia arriba: la madera del horno sale en fracciones. */
const whole = (amounts: Amounts): Amounts => Object.fromEntries(Object.entries(amounts).map(([item, n]) => [item, Math.ceil(n! - 1e-9)]))

/** Lo que dan todos los árboles y rocas de la isla (no vuelven); lo que se recoge poco a poco no cuenta. */
function supply(): Amounts {
  const total: Amounts = {}
  for (const { kind } of generatePropPlacements()) {
    const { item, amount } = PROP_DEFS[kind].drop
    if (!PROP_DEFS[kind].harvest) total[item] = (total[item] ?? 0) + amount
  }
  return total
}

describe('equilibrio de recursos (§2.2 del plan)', () => {
  it(`con ${MAX_PLAYERS} jugadores la isla da para que todos lleguen al mithril, con margen`, () => {
    const need: Amounts = {}
    for (const r of PER_PLAYER) rawCost(r, need, MAX_PLAYERS)
    for (const r of SHARED) rawCost(r, need)
    expect(whole(need)).toEqual({ wood: 280, stone: 93, iron_ore: 49, birch_wood: 30, mithril_ore: 40, dark_wood: 30 })
    const have = supply()
    expect(have).toEqual({ wood: 720, stone: 180, iron_ore: 120, birch_wood: 160, mithril_ore: 80, dark_wood: 80, coal: 60, crystal: 36 })
    // Sobra de todo: el faro, el tótem y el avión también tiran de lo mismo.
    for (const item of Object.keys(need) as ItemId[]) expect(have[item]! / need[item]!, item).toBeGreaterThanOrEqual(1.25)
  })

  it(`con ${MAX_PLAYERS} jugadores, el mejor peto y el mejor escudo para cada uno también caben`, () => {
    const need: Amounts = {}
    for (const r of [...PER_PLAYER, 'mithril_chestplate', 'crystal_shield'] as const) rawCost(r, need, MAX_PLAYERS)
    for (const r of SHARED) rawCost(r, need)
    const have = supply()
    for (const item of Object.keys(need) as ItemId[]) expect(need[item], item).toBeLessThanOrEqual(have[item]!)
  })

  it(`la espada de meteorito, una para cada uno de los ${MAX_PLAYERS}, cabe en la madera oscura de la isla`, () => {
    const need: Amounts = {}
    for (const r of [...PER_PLAYER, 'meteor_sword'] as const) rawCost(r, need, MAX_PLAYERS)
    expect(need.meteor_fragment).toBe(ENEMY_DEFS.guardian.loot[0].amount * MAX_PLAYERS)
    expect(need.dark_wood).toBeLessThanOrEqual(supply().dark_wood!)
  })

  it('un jugador solo rompe unos 18 árboles, 11 rocas, 5 menas de hierro, 2 de mithril, 2 abedules y 2 pinos oscuros', () => {
    const need = whole([...PER_PLAYER, ...SHARED].reduce((into, r) => rawCost(r, into), {} as Amounts))
    expect(need).toEqual({ wood: 71, stone: 33, iron_ore: 13, birch_wood: 6, mithril_ore: 8, dark_wood: 6 })
    const kinds = Object.keys(PROP_DEFS) as PropKind[]
    const props = Object.fromEntries(
      (Object.keys(need) as ItemId[]).map((item) => {
        const kind = kinds.find((k) => PROP_DEFS[k].drop.item === item)!
        return [kind, Math.ceil(need[item]! / PROP_DEFS[kind].drop.amount)]
      }),
    )
    expect(props).toEqual({ tree: 18, rock: 11, iron_ore: 5, birch: 2, mithril_ore: 2, darkpine: 2 })
  })
})

/** Tiempo para matar: en golpes enteros, con el primero en t = 0. */
function timeToKill(item: ItemId | null, type: EnemyType, hp = ENEMY_DEFS[type].hp) {
  return (Math.ceil(hp / attackDamage(item, type)) - 1) * swingCooldown(item)
}

const LEVELS = [
  ['wood_axe', 'wood_sword'],
  ['stone_axe', 'stone_sword'],
  ['iron_axe', 'iron_sword'],
  ['mithril_axe', 'mithril_sword'],
] as const

/** Lo que cuesta construir `kind` entero, deshaciendo los lingotes en mineral y madera. */
function buildRaw(kind: StructureKind, rules: MatchRules, into: Amounts = {}) {
  BUILD_DEFS[kind]!.phases.forEach((_, phase) => {
    for (const { item, amount } of phaseCost(kind, phase, rules)) addRaw(item, amount, into)
  })
  return into
}

describe('equilibrio de las prioridades', () => {
  it.each([1, 2, 3, 4, 5])('con %i jugadores, lo imprescindible para escapar cabe en la isla', (players) => {
    const rules: MatchRules = { players, difficulty: 'normal' }
    const need = buildRaw('totem', rules)
    const have = supply()
    for (const item of Object.keys(need) as ItemId[]) {
      if (item === 'meteor_fragment' || item === 'boss_trophy') continue
      expect(need[item], item).toBeLessThanOrEqual(have[item]!)
    }
  })

  it('el corazón del tótem sale de un guardián y de un jefe de noche', () => {
    expect(phaseCost('totem', 2, { players: 4, difficulty: 'normal' })).toEqual([{ item: 'meteor_fragment', amount: 12 }, { item: 'boss_trophy', amount: 1 }])
    expect(ENEMY_DEFS.guardian.loot[0]).toEqual({ item: 'meteor_fragment', amount: 3 })
    for (const boss of ['giant', 'thrower'] as const) expect(ENEMY_DEFS[boss].loot.map((l) => l.item)).toContain('boss_trophy')
  })
})

describe('equilibrio del combate: la espada, el arma más versátil', () => {
  it('la tabla de tiempos para matar a un trasgo', () => {
    expect(timeToKill(null, 'goblin')).toBeCloseTo(6 * HIT_COOLDOWN, 6)
    expect(LEVELS.map(([tool]) => timeToKill(tool, 'goblin'))).toEqual([1.2000000000000002, 0.8, 0.4, 0.4])
    expect(LEVELS.map(([, sword]) => timeToKill(sword, 'goblin'))).toEqual([1, 0.5, 0.25, 0.25])
    expect(timeToKill('meteor_sword', 'goblin')).toBeCloseTo(0.22, 6)
  })

  it.each(LEVELS)('contra un trasgo, %s mata más despacio que %s', (tool, sword) => {
    expect(timeToKill(sword, 'goblin')).toBeLessThan(timeToKill(tool, 'goblin'))
  })

  // La armadura castiga las armas débiles y rápidas: con la de madera, un jefe es cosa de otra arma.
  it.each(LEVELS.slice(1))('contra los jefes, %s mata más despacio que %s', (tool, sword) => {
    for (const boss of ['giant', 'thrower'] as const) {
      for (const players of [1, 2, 3, 5]) {
        const hp = ENEMY_DEFS[boss].hp * bossScale(players)
        expect(timeToKill(sword, boss, hp), `${boss} con ${players}`).toBeLessThan(timeToKill(tool, boss, hp))
      }
    }
  })

  it.each(LEVELS)('contra 3 trasgos juntos, %s tarda al menos el doble que %s', (tool, sword) => {
    // La espada los alcanza a los 3 con cada golpe; la herramienta va uno por uno, sin pausa entre ellos.
    expect(SWEEP_TARGETS).toBeGreaterThanOrEqual(3)
    const hits = Math.ceil(ENEMY_DEFS.goblin.hp / attackDamage(tool, 'goblin'))
    const oneByOne = (hits * 3 - 1) * swingCooldown(tool)
    expect(timeToKill(sword, 'goblin')).toBeLessThanOrEqual(oneByOne / 2)
  })

  // Herramienta buena y herramienta mala contra cada enemigo.
  const MATCHUPS = [
    ['golem', 'pickaxe', 'axe'],
    ['spirit', 'axe', 'pickaxe'],
  ] as const
  const MATERIALS = ['wood', 'stone', 'iron', 'mithril'] as const

  it.each(MATCHUPS)('contra el %s, la herramienta adecuada gana a la espada, pero como mucho por el doble', (type, right) => {
    for (const material of MATERIALS) {
      const good = timeToKill(`${material}_${right}`, type)
      const sword = timeToKill(`${material}_sword`, type)
      expect(good, material).toBeLessThan(sword)
      expect(sword, material).toBeLessThanOrEqual(good * 2)
    }
  })

  it.each(MATCHUPS)('contra el %s, la espada es al menos el doble de rápida que la herramienta equivocada', (type, _right, wrong) => {
    for (const material of MATERIALS) {
      expect(timeToKill(`${material}_${wrong}`, type), material).toBeGreaterThanOrEqual(timeToKill(`${material}_sword`, type) * 2)
    }
  })

  it('contra el guardián, con cualquier grupo, el pico gana a la espada como mucho por el doble, y la espada al hacha', () => {
    for (const players of [1, 2, 3, 5]) {
      const hp = ENEMY_DEFS.guardian.hp * players
      for (const material of MATERIALS.slice(1)) {
        const pickaxe = timeToKill(`${material}_pickaxe`, 'guardian', hp)
        const sword = timeToKill(`${material}_sword`, 'guardian', hp)
        expect(pickaxe, material).toBeLessThan(sword)
        expect(sword, material).toBeLessThanOrEqual(pickaxe * 2)
        expect(sword, material).toBeLessThan(timeToKill(`${material}_axe`, 'guardian', hp))
      }
    }
  })

  // Tiempo para matar acertando el 40 % del tiempo, con la espada de cada nivel: la tabla del diseño.
  it.each([
    ['giant', 75, 45, 28, 18],
    ['thrower', 44, 29, 19, 13],
    ['guardian', 63, 38, 23, 15],
    ['colossus', 188, 94, 54, 33],
  ] as const)('%s, con un jugador, tarda lo que debe', (type, stone, iron, mithril, meteor) => {
    const seconds = (item: ItemId) => Math.round(ENEMY_DEFS[type].hp / ((attackDamage(item, type) / swingCooldown(item)) * 0.4))
    expect((['stone_sword', 'iron_sword', 'mithril_sword', 'meteor_sword'] as const).map(seconds)).toEqual([stone, iron, mithril, meteor])
  })

  it('la coraza del Coloso se rompe en pocos golpes con un pico bueno, y nada se la salta', () => {
    const swings = (item: ItemId) => Math.ceil(ENEMY_DEFS.colossus.shell! / attackDamage(item, 'colossus'))
    expect((['stone_pickaxe', 'iron_pickaxe', 'mithril_pickaxe'] as const).map(swings)).toEqual([27, 16, 9])
    // Con la espada, sin romperla: un 10 % de lo que haría.
    expect(ENEMY_DEFS.colossus.hp / (attackDamage('meteor_sword', 'colossus') * SHELL_RESIST)).toBeGreaterThan(500)
  })

  it('un grupo no mata a un jefe antes que uno solo: la vida sube igual que el daño', () => {
    for (const players of [2, 3, 5]) expect(bossScale(players)).toBe(players)
  })

  it('la espada de meteorito es la mejor espada contra todos', () => {
    for (const type of ENEMY_TYPES) expect(timeToKill('meteor_sword', type), type).toBeLessThan(timeToKill('mithril_sword', type))
  })

  it('ejemplo: el gólem con equipo de piedra', () => {
    expect(timeToKill('stone_pickaxe', 'golem')).toBeCloseTo(0.8, 6)
    expect(timeToKill('stone_sword', 'golem')).toBeCloseTo(1.5, 6)
    expect(timeToKill('stone_axe', 'golem')).toBeCloseTo(4.4, 6)
  })

  it('la mano siempre es lo peor, contra todos', () => {
    for (const type of ENEMY_TYPES) {
      const hand = timeToKill(null, type)
      for (const material of MATERIALS) {
        for (const family of ['axe', 'pickaxe', 'sword'] as const) expect(timeToKill(`${material}_${family}`, type), `${material} ${family} ${type}`).toBeLessThan(hand)
      }
    }
  })
})

describe('equilibrio: lo que sueltan los enemigos', () => {
  /** Mineral de hierro que dan por jugador los gólems hasta la noche `last`, si salen todos en la montaña y se matan todos. */
  function ironFromGolems(last: number, players: number) {
    let total = 0
    for (let night = 2; night <= last; night++) total += enemyCapFor(night, players) * spawnChance('golem', night, 'mountain')
    const { amount } = ENEMY_DEFS.golem.loot.find((l) => l.item === 'iron_ore')!
    return (total * amount) / players
  }

  it.each([1, 2, 3, 5])('con %i jugadores el hierro de los gólems no sustituye a picar menas antes de la noche 4', (players) => {
    const need: Amounts = {}
    for (const r of PER_PLAYER) rawCost(r, need)
    // Ni en el mejor caso llega a la mitad de lo que pide el juego de hierro.
    expect(ironFromGolems(3, players)).toBeLessThan(need.iron_ore! * 0.5)
  })
})
