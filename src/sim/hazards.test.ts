import { describe, expect, it } from 'vitest'
import { BURN, DAZED_DAMAGE, ENEMY_DEFS, SHELL_BROKEN_PACE, SPECIAL_GAP, STEP, type SpecialId } from './constants'
import { Enemies, furious, type EnemyData } from './enemies'
import { Hazards, ticks, type Hazard } from './hazards'
import { mulberry32 } from './random'
import type { SimEventData } from './events'
import { Simulation } from './Simulation'

const at = (x: number, z: number, grounded = true) => ({ id: 0, pos: { x, z }, alive: true, grounded })

describe('los peligros de los jefes', () => {
  it('una zona avisa y daña una vez, en su tick, a quien esté dentro', () => {
    const hazards = new Hazards()
    hazards.add({ look: 'rock', x: 0, z: 0, radius: 2, startTick: 0, hitTick: 10, damage: 15 })
    for (let tick = 0; tick < 10; tick++) expect(hazards.step(tick, [at(0.5, 0)])).toEqual([])
    expect(hazards.step(10, [at(0.5, 0), { ...at(5, 0), id: 1 }])).toEqual([{ playerId: 0, damage: 15 }])
    expect(hazards.list).toHaveLength(0)
  })

  it('una onda crece desde su centro, da una vez y se esquiva saltando', () => {
    const run = (grounded: boolean) => {
      const hazards = new Hazards()
      hazards.add({ look: 'stomp', x: 0, z: 0, radius: 7, startTick: 0, hitTick: 0, damage: 20, ring: { speed: 12, width: 1.2 } })
      let damage = 0
      for (let tick = 0; tick < ticks(2); tick++) for (const d of hazards.step(tick, [at(4, 0, grounded)])) damage += d.damage
      return damage
    }
    expect(run(true)).toBe(20)
    expect(run(false)).toBe(0)
  })

  it('el suelo ardiendo quema a pulsos mientras dura', () => {
    const hazards = new Hazards()
    hazards.add({ look: 'fire', x: 0, z: 0, radius: 2, startTick: 0, hitTick: 0, endTick: ticks(2), pulse: ticks(0.5), damage: 4 })
    let damage = 0
    for (let tick = 0; tick <= ticks(3); tick++) for (const d of hazards.step(tick, [at(0, 0)])) damage += d.damage
    expect(damage).toBe(4 * 5)
  })

  it('el gigante avisa, pisa y queda agotado recibiendo el doble; luego espera', () => {
    const events: SimEventData[] = []
    const specials: string[] = []
    const enemies = new Enemies([], mulberry32(1), (e) => events.push(e), undefined, undefined, (_e, id) => specials.push(id))
    const boss = enemies.spawnAt(0, 0, 'giant')
    const player = { id: 0, pos: { x: 3, z: 0 }, alive: true }
    const stomp = ENEMY_DEFS.giant.specials!.find((s) => s.id === 'stomp')!
    let t = 0
    while (!specials.length && t < 5) {
      enemies.step(STEP, [player], 0.3, 3)
      player.pos.x = boss.pos.x + 3
      t += STEP
    }
    expect(specials).toEqual(['stomp'])
    expect(t).toBeGreaterThanOrEqual(stomp.windup - STEP)
    expect(boss.special.recover).toBe(true)
    const hp = boss.hp
    enemies.hit(boss, 100, player.pos, 0)
    expect(hp - boss.hp).toBeCloseTo(Math.max(0, 100) * DAZED_DAMAGE, 0)
    // Tras lo agotado y la espera común no repite enseguida.
    for (let i = 0; i < Math.round((stomp.recover + SPECIAL_GAP * 0.5) / STEP); i++) {
      enemies.step(STEP, [player], 0.3, 3)
      player.pos.x = boss.pos.x + 3
    }
    expect(specials).toEqual(['stomp'])
    expect(events.some((e) => e.type === 'enemySpecial')).toBe(true)
  })
})

describe('los ataques del guardián y del Coloso', () => {
  /** Un jefe a `distance` metros del jugador, quieto: hasta su primer ataque especial; devuelve cuál y lo que deja. */
  const first = (type: 'guardian' | 'colossus', distance: number, cooling: SpecialId[] = []) => {
    const sim = new Simulation(1)
    sim.addPlayer(0)
    const { player } = sim.slot(0)
    const boss = sim.enemies.spawnAt(player.pos.x + distance, player.pos.z, type)
    for (const id of cooling) boss.special.cooldowns[id] = 1e9
    let attack: string | null = null
    for (let i = 0; i < ticks(4) && !attack; i++) {
      Object.assign(player, { health: 100 })
      for (const e of sim.step(new Map())) if (e.type === 'enemySpecial') attack = e.attack
    }
    const def = ENEMY_DEFS[type].specials!.find((s) => s.id === attack)!
    for (let i = 0; i < ticks(def.windup) + 1; i++) sim.step(new Map())
    return { sim, boss, player, attack, hazards: sim.hazards.list, projectiles: sim.projectiles.list }
  }

  it('el guardián, pegado, baja el espadón: su tajo de lava es lo primero', () => {
    expect(first('guardian', 2.5).attack).toBe('lavaSlash')
  })

  it('el guardián, cerca, suelta un anillo de fuego que se esquiva saltando', () => {
    const { attack, hazards } = first('guardian', 5)
    expect(attack).toBe('fireRing')
    expect(hazards).toHaveLength(1)
    expect(hazards[0]).toMatchObject({ look: 'fire', ring: { speed: expect.any(Number) }, burn: true })
  })

  it('el guardián, de lejos, prende cuatro charcos de lava alrededor del jugador que queman a pulsos', () => {
    const { attack, hazards, player } = first('guardian', 10)
    expect(attack).toBe('burningGround')
    expect(hazards).toHaveLength(4)
    for (const h of hazards) {
      expect(h).toMatchObject({ look: 'lava', pulse: ticks(0.5), burn: true })
      expect(Math.hypot(h.x - player.pos.x, h.z - player.pos.z)).toBeLessThan(6)
      expect((h.endTick - h.hitTick) * STEP).toBeCloseTo(5)
    }
  })

  it('el guardián, de lejos y con los charcos en espera, llama un meteorito pequeño', () => {
    expect(first('guardian', 10, ['burningGround']).attack).toBe('meteorDrop')
  })

  it('el Coloso, pegado, avisa y estalla a su alrededor', () => {
    const { attack, hazards, boss } = first('colossus', 2.5)
    expect(attack).toBe('pulse')
    expect(hazards).toHaveLength(1)
    expect(hazards[0]).toMatchObject({ look: 'crystal', x: boss.pos.x, z: boss.pos.z })
    expect(hazards[0].hitTick).toBeGreaterThan(hazards[0].startTick)
  })

  it('el Coloso levanta una fila de pilares hacia el jugador, uno tras otro', () => {
    const { attack, hazards, boss, player } = first('colossus', 10)
    expect(attack).toBe('pillars')
    expect(hazards).toHaveLength(6)
    const toward = Math.atan2(player.pos.z - boss.pos.z, player.pos.x - boss.pos.x)
    for (let i = 0; i < hazards.length; i++) {
      const h = hazards[i]
      expect(Math.atan2(h.z - boss.pos.z, h.x - boss.pos.x)).toBeCloseTo(toward, 1)
      if (i) expect(h.hitTick).toBeGreaterThan(hazards[i - 1].hitTick)
    }
  })

  it('el Coloso lanza un abanico de cinco esquirlas, la del centro hacia el jugador', () => {
    const { attack, projectiles } = first('colossus', 18)
    expect(attack).toBe('shardFan')
    expect(projectiles.filter((p) => p.kind === 'shard')).toHaveLength(5)
  })

  it('el haz de luz apunta 2 s y cae donde estaba el jugador al acabar, 0,8 s después', () => {
    const { attack, hazards, player } = first('colossus', 26)
    expect(attack).toBe('lightBeam')
    expect(hazards).toHaveLength(1)
    expect(hazards[0]).toMatchObject({ look: 'light' })
    expect(Math.hypot(hazards[0].x - player.pos.x, hazards[0].z - player.pos.z)).toBeLessThan(0.01)
    expect((hazards[0].hitTick - hazards[0].startTick) * STEP).toBeCloseTo(0.8, 1)
  })

  it('con la coraza rota, el Coloso repite antes', () => {
    const cooldownAfter = (broken: boolean) => {
      const enemies = new Enemies([], mulberry32(1), undefined, undefined, undefined, () => {})
      const boss = enemies.spawnAt(0, 0, 'colossus')
      if (broken) boss.shell = 0
      enemies.step(STEP, [{ id: 0, pos: { x: 2.5, z: 0 }, alive: true }], 0.3, 1)
      return boss.special.cooldowns.pulse!
    }
    expect(cooldownAfter(true) / cooldownAfter(false)).toBeCloseTo(SHELL_BROKEN_PACE, 2)
  })
})

describe('los ataques del trasgo gigante y del lanzarrocas', () => {
  /** Un jefe a `distance` metros del jugador, quieto, y lo que pasa en sus primeros `seconds` segundos. */
  const run = (type: 'giant' | 'thrower', distance: number, seconds: number, prepare = (_boss: ReturnType<Simulation['enemies']['spawnAt']>) => {}) => {
    const sim = new Simulation(1)
    sim.addPlayer(0)
    const { player } = sim.slot(0)
    const boss = sim.enemies.spawnAt(player.pos.x + distance, player.pos.z, type)
    prepare(boss)
    const specials: string[] = []
    let attacks = 0
    let launched = 0
    for (let i = 0; i < ticks(seconds); i++) {
      Object.assign(player, { health: 100 })
      const before = sim.projectiles.list.length
      for (const e of sim.step(new Map())) {
        if (e.type === 'enemySpecial') specials.push(e.attack)
        if (e.type === 'enemyAttack' && e.id === boss.id) attacks++
      }
      launched += Math.max(0, sim.projectiles.list.length - before)
    }
    return { sim, boss, player, specials, attacks, launched }
  }

  it('el gigante, de lejos, tira tres flechas seguidas con el arco', () => {
    const volley = ENEMY_DEFS.giant.specials!.find((s) => s.id === 'arrowVolley')!
    const { specials, attacks, sim } = run('giant', 18, volley.windup + volley.recover)
    expect(specials).toEqual(['arrowVolley'])
    expect(attacks).toBe(3)
    expect(sim.projectiles.list.every((p) => p.kind === 'arrow')).toBe(true)
  })

  it('la embestida del gigante, si alcanza, pega más fuerte que su golpe', () => {
    const enemies = new Enemies([], mulberry32(1), undefined, undefined, undefined, () => {})
    enemies.spawnAt(7, 0, 'giant')
    let dealt: number[] = []
    for (let i = 0; i < ticks(3) && !dealt.length; i++) dealt = enemies.step(STEP, [{ id: 0, pos: { x: 0, z: 0 }, alive: true }], 0.3, 1).map((d) => d.damage)
    expect(dealt).toEqual([ENEMY_DEFS.giant.charge!.damage])
    expect(ENEMY_DEFS.giant.charge!.damage!).toBeGreaterThan(ENEMY_DEFS.giant.damage)
  })

  it('el lanzarrocas llama dos gólems a su alrededor, y no más de tres a la vez', () => {
    const summon = ENEMY_DEFS.thrower.specials!.find((s) => s.id === 'summonGolems')!
    const { specials, sim, boss } = run('thrower', 12, summon.windup + 0.1)
    expect(specials).toEqual(['summonGolems'])
    const golems = () => sim.enemies.list.filter((e) => e.type === 'golem')
    expect(golems()).toHaveLength(2)
    for (const g of golems()) expect(Math.hypot(g.pos.x - boss.pos.x, g.pos.z - boss.pos.z)).toBeLessThan(5)
    ;(sim as unknown as { special: (e: unknown, id: string, t: unknown) => void }).special(boss, 'summonGolems', { id: 0, pos: sim.slot(0).player.pos, alive: true })
    expect(golems()).toHaveLength(3)
  })

  it('el lanzarrocas, pegado, golpea el suelo delante; de lejos, tira una roca muy rápida', () => {
    const near = run('thrower', 2.5, 0.8)
    expect(near.specials).toEqual(['smash'])
    const smash = near.sim.hazards.list.length ? near.sim.hazards.list[0] : null
    // El golpe es en su tick: o se ve todavía o ya pegó; en los dos casos el jugador estaba delante.
    if (smash) expect(smash).toMatchObject({ look: 'rock' })
    const far = run('thrower', 14, 0.8, (boss) => { boss.special.cooldowns.summonGolems = 1e9 })
    expect(far.specials).toEqual(['fastRock'])
    expect(far.launched).toBeGreaterThanOrEqual(1)
  })
})

describe('los ataques del trasgo gigante y del lanzarrocas castigan mucho', () => {
  /** El golpe al suelo del Lanzarrocas a un jugador con toda la vida y la armadura `armor` (o sin ella): la vida que le queda. */
  const smashed = (armor: 'mithril' | null) => {
    const sim = new Simulation(1)
    sim.addPlayer(0)
    const { player, inventory } = sim.slot(0)
    if (armor) Object.assign(inventory.equipped, { head: `${armor}_helmet`, chest: `${armor}_chestplate`, legs: `${armor}_leggings`, feet: `${armor}_boots` })
    const boss = sim.enemies.spawnAt(player.pos.x + 2.5, player.pos.z, 'thrower')
    sim.enemies.forceSpecial(boss.id, 'smash')
    for (let i = 0; i < ticks(1); i++) if (sim.step(new Map()).some((e) => e.type === 'playerHurt')) break
    return player.health
  }

  it('el golpe al suelo mata sin armadura, y con la de mithril se aguanta con algo de vida', () => {
    expect(smashed(null)).toBe(0)
    const left = smashed('mithril')
    expect(left).toBeGreaterThan(30)
    expect(left).toBeLessThan(50)
  })
})

describe('los jefes solo atacan con sus ataques especiales', () => {
  const BOSS_TYPES = ['giant', 'thrower', 'guardian', 'colossus'] as const

  it.each(BOSS_TYPES)('%s, pegado al jugador y sin ataques especiales, no le hace nada', (type) => {
    const events: SimEventData[] = []
    const enemies = new Enemies([], mulberry32(1), (e) => events.push(e), undefined, undefined, () => {})
    const boss = enemies.spawnAt(1.5, 0, type)
    boss.special.gap = 1e9
    const player = { id: 0, pos: { x: 0, z: 0 }, alive: true }
    let damage = 0
    for (let i = 0; i < ticks(6); i++) for (const hit of enemies.step(STEP, [player], 0.3, 3)) damage += hit.damage
    expect(damage).toBe(0)
    expect(events.some((e) => e.type === 'enemyAttack' || e.type === 'enemySwing')).toBe(false)
  })

  it.each(BOSS_TYPES)('%s tiene a 0–9 m algún ataque especial que se repite en 10 s o menos', (type) => {
    const specials = ENEMY_DEFS[type].specials!
    for (let d = 0; d <= 9; d += 0.5) {
      const near = specials.filter((s) => d >= s.min && d <= s.max)
      expect(near.length, `${type} a ${d} m`).toBeGreaterThan(0)
      expect(Math.min(...near.map((s) => s.cooldown)), `${type} a ${d} m`).toBeLessThanOrEqual(10)
    }
  })
})

describe('el fuego del Guardián del meteorito', () => {
  /** El Guardián a `distance` m del jugador hace ya `attack` (con `prepare` antes): los peligros que deja y lo que pasa. */
  const strike = (attack: SpecialId, distance = 4, prepare = (_boss: EnemyData) => {}) => {
    const sim = new Simulation(1)
    sim.addPlayer(0)
    const { player } = sim.slot(0)
    const boss = sim.enemies.spawnAt(player.pos.x + distance, player.pos.z, 'guardian')
    prepare(boss)
    const start = { x: player.pos.x, z: player.pos.z }
    expect(sim.enemies.forceSpecial(boss.id, attack)).toBe(true)
    const def = ENEMY_DEFS.guardian.specials!.find((s) => s.id === attack)!
    const hazards: Hazard[] = []
    const hurt: SimEventData[] = []
    for (let i = 0; i < ticks(def.windup) + 2; i++)
      for (const e of sim.step(new Map())) {
        if (e.type === 'hazardAdded') hazards.push(e.hazard)
        if (e.type === 'playerHurt') hurt.push(e)
      }
    return { sim, boss, player, start, hazards, hurt }
  }
  const angry = (boss: EnemyData) => {
    boss.hp = boss.maxHp * 0.4
  }

  it('el tajo de lava da delante, hacia el jugador, y le prende fuego', () => {
    const { hazards, boss, player, hurt } = strike('lavaSlash', 2.5)
    expect(hazards).toHaveLength(1)
    expect(hazards[0]).toMatchObject({ look: 'fire', burn: true })
    expect(hazards[0].ring).toBeUndefined()
    expect(hazards[0].x).toBeLessThan(boss.pos.x)
    expect(hurt[0]).toMatchObject({ ignited: true })
    expect(player.burnLeft).toBeGreaterThan(BURN.seconds - 0.1)
  })

  it('enfurecido, el anillo de fuego sale dos veces, uno detrás de otro', () => {
    expect(strike('fireRing').hazards).toHaveLength(1)
    const [first, second] = strike('fireRing', 4, angry).hazards
    expect(second).toMatchObject({ look: 'fire', ring: first.ring })
    expect((second.hitTick - first.hitTick) * STEP).toBeGreaterThan(0.5)
  })

  it('el meteorito cae donde estaba el jugador al segundo; enfurecido caen tres, uno tras otro', () => {
    const calm = strike('meteorDrop', 10)
    expect(calm.hazards).toHaveLength(1)
    expect(calm.hazards[0]).toMatchObject({ look: 'meteor', burn: true })
    expect(Math.hypot(calm.hazards[0].x - calm.start.x, calm.hazards[0].z - calm.start.z)).toBeLessThan(0.01)
    expect((calm.hazards[0].hitTick - calm.hazards[0].startTick) * STEP).toBeCloseTo(1, 1)
    const fury = strike('meteorDrop', 10, angry).hazards
    expect(fury).toHaveLength(3)
    expect(fury[1].hitTick).toBeGreaterThan(fury[0].hitTick)
    expect(fury[2].hitTick).toBeGreaterThan(fury[1].hitTick)
    for (const h of fury.slice(1)) expect(Math.hypot(h.x - fury[0].x, h.z - fury[0].z)).toBeGreaterThan(3)
  })

  it('se enfurece una vez, al bajar de media vida, y entonces ataca más seguido', () => {
    const events: SimEventData[] = []
    const enemies = new Enemies([], mulberry32(1), (e) => events.push(e), undefined, undefined, () => {})
    const boss = enemies.spawnAt(0, 0, 'guardian')
    const player = { x: 3, z: 0 }
    enemies.hit(boss, boss.maxHp * 0.4, player, 0)
    expect(furious(boss)).toBe(false)
    enemies.hit(boss, boss.maxHp * 0.2, player, 0)
    enemies.hit(boss, 10, player, 0)
    expect(furious(boss)).toBe(true)
    expect(events.filter((e) => e.type === 'enemyFury')).toEqual([{ type: 'enemyFury', id: boss.id }])
    const cooldownAfter = (hp: number) => {
      const e = new Enemies([], mulberry32(1), undefined, undefined, undefined, () => {}).spawnAt(0, 0, 'guardian')
      e.hp = e.maxHp * hp
      const list = new Enemies([], mulberry32(1), undefined, undefined, undefined, () => {})
      list.list.push(e)
      list.step(STEP, [{ id: 0, pos: { x: 2.5, z: 0 }, alive: true }], 0.3, 1)
      return e.special.cooldowns.lavaSlash!
    }
    expect(cooldownAfter(0.4) / cooldownAfter(1)).toBeCloseTo(ENEMY_DEFS.guardian.fury!.pace, 2)
  })

  it('arder quita BURN.damage cada BURN.every durante BURN.seconds, y otro fuego vuelve a empezar la cuenta', () => {
    const sim = new Simulation(1)
    sim.addPlayer(0)
    const { player } = sim.slot(0)
    sim.hazards.add({ look: 'lava', x: player.pos.x, z: player.pos.z, radius: 2, startTick: 0, hitTick: sim.tick + 1, damage: 10, burn: true })
    const hurt: SimEventData[] = []
    for (let i = 0; i < ticks(BURN.seconds + 1); i++) for (const e of sim.step(new Map())) if (e.type === 'playerHurt') hurt.push(e)
    expect(hurt[0]).toMatchObject({ dmg: 10, ignited: true })
    const burns = hurt.slice(1)
    expect(burns).toHaveLength(BURN.seconds / BURN.every)
    for (const e of burns) expect(e).toMatchObject({ dmg: BURN.damage, burning: true })
    expect(player.burnLeft).toBe(0)
  })

  it('en el agua no prende, y si ya ardía se apaga', () => {
    const sim = new Simulation(1)
    sim.addPlayer(0)
    const { player } = sim.slot(0)
    player.burnLeft = BURN.seconds
    sim.teleport(0, 0, 94, 0, 0)
    const hurt: SimEventData[] = []
    for (let i = 0; i < ticks(1); i++) for (const e of sim.step(new Map())) if (e.type === 'playerHurt') hurt.push(e)
    expect(player.burnLeft).toBe(0)
    expect(hurt.filter((e) => e.type === 'playerHurt' && e.burning)).toEqual([])
  })
})

describe('los ataques del Guardián castigan como los de los otros jefes', () => {
  /** Un ataque del Guardián que da de lleno a un jugador con toda la vida y la armadura `armor`: la vida que le queda al apagarse. */
  const left = (attack: SpecialId, distance: number, armor: 'iron' | 'mithril' | null) => {
    const sim = new Simulation(1)
    sim.addPlayer(0)
    const { player, inventory } = sim.slot(0)
    if (armor) Object.assign(inventory.equipped, { head: `${armor}_helmet`, chest: `${armor}_chestplate`, legs: `${armor}_leggings`, feet: `${armor}_boots` })
    const boss = sim.enemies.spawnAt(player.pos.x + distance, player.pos.z, 'guardian')
    boss.special.gap = 1e9
    sim.enemies.forceSpecial(boss.id, attack)
    // Hasta que pega y se apaga el fuego; el jugador no se mueve (y salta poco: el anillo le da en el suelo).
    for (let i = 0; i < ticks(5); i++) sim.step(new Map())
    return player.health
  }

  it('sin armadura, el tajo de lava, el anillo y el meteorito matan con lo que queman', () => {
    expect(left('lavaSlash', 2.5, null)).toBe(0)
    expect(left('fireRing', 4, null)).toBe(0)
    expect(left('meteorDrop', 10, null)).toBe(0)
  })

  it('con armadura se aguantan: con la de hierro, a duras penas; con la de mithril, con algo de vida', () => {
    for (const [attack, distance] of [['lavaSlash', 2.5], ['fireRing', 4], ['meteorDrop', 10]] as const) {
      const iron = left(attack, distance, 'iron')
      const mithril = left(attack, distance, 'mithril')
      expect(iron, attack).toBeGreaterThan(0)
      expect(iron, attack).toBeLessThan(30)
      expect(mithril, attack).toBeGreaterThan(iron)
      expect(mithril, attack).toBeLessThan(55)
    }
  })
})
