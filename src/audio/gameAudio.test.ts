import { describe, expect, it } from 'vitest'
import { STEP } from '../sim/constants'
import type { SimEvent, TargetRef } from '../sim/events'
import type { PropKind } from '../sim/props'
import { GameAudio, GROWL_DISTANCE, REMOTE_DEATH_GAIN, REMOTE_HEARING, STRIDE, type RemoteWalker } from './gameAudio'
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

  it('cada golpe suena según lo que golpea; si lo rompe o lo mata, solo la rotura o la muerte', () => {
    const { audio, names } = setup()
    const kinds: PropKind[] = ['tree', 'rock', 'bush']
    const propKind = (id: number) => kinds[id]
    const swing = (target: TargetRef | null): SimEvent => ({ tick: 1, type: 'playerSwing', id: 0, item: null, target })
    const step = (...list: SimEvent[]) => audio.events(list, 0, propKind)
    step(swing(null))
    step(swing({ kind: 'prop', id: 0 }), { tick: 1, type: 'propHit', id: 0, hp: 2, by: 0 })
    step(swing({ kind: 'prop', id: 0 }), { tick: 1, type: 'propDestroyed', id: 0, by: 0 })
    step(swing({ kind: 'prop', id: 1 }), { tick: 1, type: 'propHit', id: 1, hp: 2, by: 0 })
    step(swing({ kind: 'prop', id: 1 }), { tick: 1, type: 'propDestroyed', id: 1, by: 0 })
    step(swing({ kind: 'prop', id: 2 }), { tick: 1, type: 'berryTaken', id: 2, hp: 1, by: 0 })
    step(swing({ kind: 'prop', id: 2 }))
    step(swing({ kind: 'enemy', id: 0 }), { tick: 1, type: 'enemyHit', id: 0, hp: 3, kx: 1, kz: 0, by: 0 })
    step(swing({ kind: 'enemy', id: 0 }), { tick: 1, type: 'enemyDied', id: 0, by: 0 })
    expect(names()).toEqual(['swing', 'hitWood', 'breakWood', 'hitStone', 'breakStone', 'hitBush', 'pickup', 'hitBush', 'enemyHit', 'enemyDeath'])
  })

  it('varias piezas recogidas en un paso suenan una vez; lo que hace otro jugador no suena como propio', () => {
    const { audio, names } = setup()
    const step = (...list: SimEvent[]) => audio.events(list, 0, () => 'tree')
    step({ tick: 1, type: 'pickupCollected', id: 0, by: 0 }, { tick: 1, type: 'pickupCollected', id: 1, by: 0 })
    expect(names()).toEqual(['pickup'])
    step(
      { tick: 2, type: 'pickupCollected', id: 2, by: 1 },
      { tick: 2, type: 'playerSwing', id: 1, item: null, target: null },
      { tick: 2, type: 'playerHurt', id: 1, dmg: 10 },
      { tick: 2, type: 'playerAte', id: 1 },
    )
    expect(names()).toEqual(['pickup'])
  })

  it('daño, comer, fabricar, colocar una fogata y morir', () => {
    const { audio, names } = setup()
    audio.events(
      [
        { tick: 1, type: 'playerHurt', id: 0, dmg: 10 },
        { tick: 1, type: 'playerAte', id: 0 },
        { tick: 1, type: 'playerCrafted', id: 0, recipe: 2 },
        { tick: 1, type: 'campfirePlaced', id: 0, x: 0, y: 0, z: 0, rotY: 0, by: 0 },
        { tick: 1, type: 'playerPlaced', id: 0 },
        { tick: 1, type: 'playerDied', id: 0 },
      ],
      0,
      () => 'tree',
    )
    expect(names()).toEqual(['hurt', 'eat', 'craft', 'place', 'death'])
  })
})

describe('sonido de los demás', () => {
  const listener = { x: 0, z: 0, yaw: 0 }
  const kinds: PropKind[] = ['tree', 'rock']

  it('cada evento suena donde pasa: por su lado, más bajo de lejos y nada fuera de su alcance', () => {
    const { audio, played } = setup()
    // El jugador 1 a 10 m a la derecha; el 2, a 25 m (fuera del alcance del daño, dentro del de los golpes).
    const where: Record<number, { x: number; z: number }> = { 1: { x: 10, z: 0 }, 2: { x: 25, z: 0 } }
    const locate = (e: SimEvent) => ('id' in e && e.type.startsWith('player') ? where[e.id] : 'by' in e ? where[e.by] : null)
    audio.remote(
      [
        { tick: 1, type: 'playerSwing', id: 1, item: null, target: { kind: 'prop', id: 0 } },
        { tick: 1, type: 'playerHurt', id: 2, dmg: 5 },
        { tick: 1, type: 'playerSwing', id: 2, item: null, target: { kind: 'prop', id: 1 } },
        { tick: 1, type: 'propDestroyed', id: 1, by: 2 },
        { tick: 1, type: 'pickupCollected', id: 4, by: 1 },
      ],
      listener,
      locate,
      (id) => kinds[id],
    )
    expect(played.map((p) => p.name)).toEqual(['hitWood', 'breakStone'])
    expect(played[0].options!.gain).toBeCloseTo(spatialize(10, 0, 0, REMOTE_HEARING.hit).gain)
    expect(played[0].options!.pan).toBeGreaterThan(0.5)
    expect(played[1].options!.gain).toBeLessThan(played[0].options!.gain!)
  })

  it('la muerte de otro se oye siempre, aunque esté lejísimos', () => {
    const { audio, played } = setup()
    audio.remote([{ tick: 1, type: 'playerDied', id: 3 }], listener, () => ({ x: -500, z: 0 }), () => 'tree')
    expect(played).toEqual([{ name: 'death', options: { gain: REMOTE_DEATH_GAIN, pan: expect.any(Number) } }])
    expect(played[0].options!.pan).toBeLessThan(0)
  })

  it('pasos de cada uno por separado, solo andando por el suelo y hasta 15 m', () => {
    const { audio, played } = setup()
    const near: RemoteWalker = { id: 1, x: 5, z: 0, grounded: true, inWater: false, alive: true }
    const far: RemoteWalker = { id: 2, x: 40, z: 0, grounded: true, inWater: false, alive: true }
    const air: RemoteWalker = { id: 3, x: -5, z: 0, grounded: false, inWater: false, alive: true }
    for (let i = 0; i <= 100; i++) {
      audio.remoteSteps([near, far, air], listener)
      near.z += 0.1
      far.z += 0.1
      air.z += 0.1
    }
    expect(played.map((p) => p.name)).toEqual(Array(Math.floor(10 / STRIDE)).fill('step'))
    expect(played[0].options!.pan).toBeGreaterThan(0)
    // Un salto de 30 m (teletransporte) no es un paso.
    played.length = 0
    near.z += 30
    audio.remoteSteps([near], listener)
    expect(played).toEqual([])
  })
})
