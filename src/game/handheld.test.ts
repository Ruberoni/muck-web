import { describe, expect, it } from 'vitest'
import { ACTION_DURATION, actionPose, Handheld, SWING_KEYS, swingDuration, swingImpactAt, swingPhases, swingPose, type HandAction } from './handheld'
import { ITEM_NAMES, type ItemId } from '../sim/inventory'
import { swingCooldown, weaponClass } from '../sim/tiers'

describe('golpe según el arma', () => {
  it('dura casi su cadencia, y la espada deja una estela que culmina al pegar; las herramientas, no', () => {
    for (const item of [null, 'wood_sword', 'wood_axe', 'stone_pickaxe'] as const) {
      expect(swingDuration(item)).toBeLessThan(swingCooldown(item))
      expect(swingDuration(item)).toBeGreaterThan(swingCooldown(item) * 0.9)
    }
    const hand = new Handheld(1)
    hand.setItem('wood_sword')
    hand.play('swing')
    hand.update(swingDuration('wood_sword') * swingImpactAt('wood_sword'), 0, true)
    expect(hand.trail.visible).toBe(true)
    // La estela va por donde pasa la hoja: delante de la cámara, sin puntos sueltos.
    const position = hand.trail.geometry.getAttribute('position')
    for (let i = 0; i < position.count; i++) {
      expect(position.getZ(i)).toBeLessThan(0)
      expect(Number.isFinite(position.getX(i))).toBe(true)
    }
    hand.update(swingDuration('wood_sword'), 0, true)
    expect(hand.action).toBeNull()
    expect(hand.trail.visible).toBe(false)

    hand.setItem('wood_axe')
    hand.play('swing')
    hand.update(swingDuration('wood_axe') * 0.4, 0, true)
    expect(hand.trail.visible).toBe(false)
  })

  it('pega cuando la simulación: llega a su pose de golpe justo en swingImpact, y lo más deprisa del golpe es justo antes', () => {
    for (const item of [null, 'wood_sword', 'iron_axe', 'mithril_pickaxe'] as const) {
      for (let variant = 0; variant < 5; variant++) {
        const { hit } = SWING_KEYS[weaponClass(item)][variant]
        const impact = swingImpactAt(item)
        const pose = swingPose(item, variant, impact)
        for (const key of ['rx', 'rz', 'x', 'y', 'z'] as const) expect(pose[key]).toBeCloseTo(hit[key], 6)
        // Empieza y acaba en reposo.
        for (const p of [0, 1]) for (const v of Object.values(swingPose(item, variant, p))) expect(Math.abs(v)).toBeLessThan(1e-9)
        // Cae cada vez más deprisa: lo que se mueve en el último trozo antes de pegar es más que en cualquier otro igual.
        const moved = (p: number) => Math.abs(swingPose(item, variant, p).rx - swingPose(item, variant, p - 0.02).rx)
        const last = moved(impact)
        for (let p = 0.02; p <= 1; p += 0.02) if (Math.abs(p - impact) > 0.021) expect(moved(p)).toBeLessThanOrEqual(last + 1e-9)
      }
    }
  })

  it('al dar en algo rebota en vez de seguir de largo', () => {
    const { follow, impact } = swingPhases(swingImpactAt('iron_axe'))
    const p = (impact + follow) / 2
    const free = swingPose('iron_axe', 0, p).rx
    const landed = swingPose('iron_axe', 0, p, undefined, true).rx
    const hit = SWING_KEYS.axe[0].hit.rx
    // Sin dar en nada sigue más allá de la pose del golpe (más hacia delante); dando, vuelve un poco atrás.
    expect(free).toBeLessThan(hit)
    expect(landed).toBeGreaterThan(hit)
  })

  it('cinco golpes por arma, y nunca el mismo dos veces seguidas', () => {
    for (const keys of Object.values(SWING_KEYS)) expect(keys).toHaveLength(5)
    let seed = 1
    const hand = new Handheld(1, () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646)
    hand.setItem('iron_sword')
    const seen: number[] = []
    for (let i = 0; i < 40; i++) {
      hand.play('swing')
      seen.push(hand.swingVariant)
    }
    for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1])
    expect(new Set(seen).size).toBe(5)
    expect(swingPose('iron_sword', 0, 0.3)).not.toEqual(swingPose('iron_sword', 1, 0.3))
  })

  it('un golpe nuevo se funde con el anterior: no salta de pose', () => {
    const hand = new Handheld(1)
    hand.setItem('iron_axe')
    hand.play('swing')
    hand.update(swingDuration('iron_axe') * 0.4, 0, true)
    const root = hand.scene.children.find((o) => o.children.includes(hand['holder']))!
    const before = root.rotation.x
    hand.play('swing')
    hand.update(0, 0, true)
    expect(root.rotation.x).toBeCloseTo(before, 6)
  })

  it('al andar se balancea, y quieto casi no se mueve', () => {
    const hand = new Handheld(1)
    hand.setItem('iron_axe')
    const root = hand.scene.children.find((o) => o.children.includes(hand['holder']))!
    const track = (speed: number) => {
      let min = Infinity
      let max = -Infinity
      for (let i = 0; i < 120; i++) {
        hand.update(1 / 60, speed, true)
        min = Math.min(min, root.position.x)
        max = Math.max(max, root.position.x)
      }
      return max - min
    }
    track(0)
    const still = track(0)
    const walking = track(5)
    expect(walking).toBeGreaterThan(0.02)
    expect(still).toBeLessThan(0.005)
  })

  it('la espada dice hacia dónde cruza la pantalla su golpe', () => {
    const hand = new Handheld(16 / 9)
    hand.setItem('iron_sword')
    expect(hand.slashAngle()).toBeNull()
    hand.play('swing')
    expect(Number.isFinite(hand.slashAngle())).toBe(true)
  })

  it('no se ve la mano: solo el objeto', () => {
    const hand = new Handheld(1)
    hand.setItem(null)
    let meshes = 0
    hand.scene.traverse((o) => {
      if ((o as { isMesh?: boolean }).isMesh && o !== hand.trail) meshes++
    })
    expect(meshes).toBe(0)
  })
})

describe('objeto en la mano', () => {
  it('hay modelo para cada objeto', () => {
    const hand = new Handheld(16 / 9)
    for (const item of Object.keys(ITEM_NAMES) as ItemId[]) {
      hand.setItem(item)
      expect(hand.item).toBe(item)
    }
    hand.setItem(null)
    expect(hand.item).toBeNull()
  })

  it('cada animación empieza y acaba en reposo', () => {
    for (const action of Object.keys(ACTION_DURATION) as HandAction[]) {
      for (const p of [0, 1]) {
        const pose = actionPose(action, p)
        for (const v of Object.values(pose)) expect(Math.abs(v)).toBeLessThan(1e-9)
      }
    }
  })

  it('el golpe echa el brazo atrás y luego golpea hacia delante', () => {
    expect(actionPose('swing', 0.25).rx).toBeGreaterThan(0)
    expect(actionPose('swing', 0.5).rx).toBeLessThan(-0.5)
    expect(actionPose('swing', 0.5).z).toBeLessThan(0)
  })

  it('la animación termina tras su duración', () => {
    const hand = new Handheld(1)
    hand.play('swing')
    hand.update(swingDuration(null) / 2, 0, true)
    expect(hand.action).toBe('swing')
    hand.update(swingDuration(null), 0, true)
    expect(hand.action).toBeNull()
  })

  it('comiendo, el objeto no cambia hasta acabar; golpeando sí', () => {
    const hand = new Handheld(1)
    hand.setItem('berry')
    hand.play('eat')
    hand.setItem(null)
    expect(hand.item).toBe('berry')
    hand.update(ACTION_DURATION.eat + 0.01, 0, true)
    hand.setItem(null)
    expect(hand.item).toBeNull()

    hand.setItem('wood_axe')
    hand.play('eat', 'berry')
    expect(hand.item).toBe('berry')
    hand.update(ACTION_DURATION.eat + 0.01, 0, true)
    hand.setItem('wood_axe')
    expect(hand.item).toBe('wood_axe')

    hand.play('swing')
    hand.setItem('stone_axe')
    expect(hand.item).toBe('stone_axe')
    expect(hand.action).toBeNull()
  })
})
