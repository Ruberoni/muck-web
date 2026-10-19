import { describe, expect, it } from 'vitest'
import { STEP } from '../game/constants'
import type { Target } from '../game/interaction'
import { GameAudio, GROWL_DISTANCE, STRIDE } from './gameAudio'
import { spatialize, volumeToGain, type PlayOptions, type SoundName } from './sound'

function setup() {
  const played: { name: SoundName; options?: PlayOptions }[] = []
  const audio = new GameAudio({ play: (name, options) => void played.push({ name, options }) }, () => 0.5)
  const player = { pos: { x: 0, z: 0 }, vel: { y: 0 }, yaw: 0, grounded: true, inWater: false, floating: false }
  const names = () => played.map((p) => p.name)
  return { audio, player, played, names }
}

describe('sonido', () => {
  it('el volumen va al cuadrado y se recorta a [0, 1]', () => {
    expect(volumeToGain(0)).toBe(0)
    expect(volumeToGain(0.5)).toBe(0.25)
    expect(volumeToGain(1)).toBe(1)
    expect(volumeToGain(2)).toBe(1)
    expect(volumeToGain(-1)).toBe(0)
  })

  it('una fuente a la derecha suena por la derecha y más bajo cuanto más lejos', () => {
    // yaw 0 mira a -Z, así que +X queda a la derecha.
    const right = spatialize(5, 0, 0, 20)
    const left = spatialize(-5, 0, 0, 20)
    const ahead = spatialize(0, -5, 0, 20)
    expect(right.pan).toBeGreaterThan(0.5)
    expect(left.pan).toBeLessThan(-0.5)
    expect(Math.abs(ahead.pan)).toBeLessThan(1e-9)
    expect(spatialize(10, 0, 0, 20).gain).toBeLessThan(right.gain)
    expect(spatialize(25, 0, 0, 20).gain).toBe(0)
    // Girado 180°, la derecha pasa a la izquierda.
    expect(spatialize(5, 0, Math.PI, 20).pan).toBeLessThan(-0.5)
  })

  it('un paso cada STRIDE metros andando, ninguno quieto', () => {
    const { audio, player, names } = setup()
    for (let i = 0; i < 60; i++) audio.step(STEP, player, [])
    expect(names()).toEqual([])
    // 10 m a 0,1 m por paso fijo.
    for (let i = 0; i < 100; i++) {
      player.pos.x += 0.1
      audio.step(STEP, player, [])
    }
    expect(names().filter((n) => n === 'step')).toHaveLength(Math.floor(10 / STRIDE))
  })

  it('en el agua los pasos chapotean y flotando no suenan', () => {
    const { audio, player, names } = setup()
    player.inWater = true
    for (let i = 0; i < 50; i++) {
      player.pos.x += 0.1
      audio.step(STEP, player, [])
    }
    expect(names()).toContain('stepWater')
    expect(names()).not.toContain('step')
    const before = names().length
    player.floating = true
    for (let i = 0; i < 50; i++) {
      player.pos.x += 0.1
      audio.step(STEP, player, [])
    }
    expect(names()).toHaveLength(before)
  })

  it('un teletransporte no cuenta como paso', () => {
    const { audio, player, names } = setup()
    audio.step(STEP, player, [])
    player.pos.x += 50
    audio.step(STEP, player, [])
    expect(names()).toEqual([])
  })

  it('saltar suena al despegar y al aterrizar, pero no un bache corto', () => {
    const { audio, player, names } = setup()
    audio.step(STEP, player, [])
    player.grounded = false
    player.vel.y = 7
    audio.step(STEP, player, [])
    expect(names()).toEqual(['jump'])
    player.vel.y = -3
    for (let i = 0; i < 30; i++) audio.step(STEP, player, [])
    player.grounded = true
    audio.step(STEP, player, [])
    expect(names()).toEqual(['jump', 'land'])
    // Caer de un escalón: un instante en el aire sin velocidad hacia arriba.
    player.grounded = false
    player.vel.y = -1
    audio.step(STEP, player, [])
    player.grounded = true
    audio.step(STEP, player, [])
    expect(names()).toEqual(['jump', 'land'])
  })

  it('los enemigos gruñen de vez en cuando, más bajo cuanto más lejos', () => {
    const { audio, player, played } = setup()
    for (let i = 0; i < 60 * 10; i++) audio.step(STEP, player, [{ pos: { x: 5, z: 0 } }])
    const growls = played.filter((p) => p.name === 'growl')
    expect(growls.length).toBeGreaterThanOrEqual(1)
    expect(growls.length).toBeLessThan(5)
    expect(growls[0].options!.pan).toBeGreaterThan(0)
    expect(growls[0].options!.gain).toBeCloseTo(spatialize(5, 0, 0, GROWL_DISTANCE).gain)
  })

  it('cada golpe suena según lo que golpea, y lo que suelta algo suena al recogerlo', () => {
    const { audio, names } = setup()
    const t = (kind: Target['kind']) => ({ kind }) as Target
    audio.hit(t('tree'), false)
    audio.hit(t('tree'), true)
    audio.hit(t('rock'), false)
    audio.hit(t('bush'), false)
    audio.hit(t('enemy'), false)
    audio.hit(t('enemy'), true)
    expect(names()).toEqual(['hitWood', 'breakWood', 'pickup', 'hitStone', 'hitBush', 'pickup', 'enemyHit', 'enemyDeath', 'pickup'])
  })
})
