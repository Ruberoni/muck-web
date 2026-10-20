import { describe, expect, it } from 'vitest'
import { WATER_LEVEL, WORLD_SIZE } from './world/terrain'
import { FLOAT_DEPTH, STAMINA_RECOVER_THRESHOLD, STEP, WALK_SPEED, WORLD_BOUND_FACTOR } from './constants'
import {
  createPlayer,
  interpolate,
  NO_INPUT,
  stepPlayer,
  teleportPlayer,
  type PlayerEnv,
  type PlayerInput,
} from './player'

const flat = (h: number): PlayerEnv => ({ heightAt: () => h })
const input = (keys: Partial<PlayerInput>): PlayerInput => ({ ...NO_INPUT, ...keys })
const run = (player: ReturnType<typeof createPlayer>, keys: Partial<PlayerInput>, env: PlayerEnv, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / STEP); i++) stepPlayer(player, input(keys), env, STEP)
}

describe('suelo y gravedad', () => {
  it('bajando una rampa suave sigue pegado al suelo', () => {
    // Pendiente de 0,5 hacia -z: al avanzar (yaw 0 → -z) se baja.
    const env: PlayerEnv = { heightAt: (_x, z) => 20 + z * 0.5 }
    const player = createPlayer(env, 0, 0)
    for (let i = 0; i < 120; i++) {
      stepPlayer(player, input({ forward: true }), env, STEP)
      expect(player.grounded).toBe(true)
      expect(player.pos.y).toBeCloseTo(env.heightAt(player.pos.x, player.pos.z), 6)
    }
  })

  it('en un desnivel brusco cae', () => {
    const env: PlayerEnv = { heightAt: (_x, z) => (z > -1 ? 10 : 5) }
    const player = createPlayer(env, 0, 0)
    run(player, { forward: true }, env, 0.3)
    expect(player.grounded).toBe(false)
    run(player, {}, env, 1.5)
    expect(player.grounded).toBe(true)
    expect(player.pos.y).toBeCloseTo(5, 6)
  })

  it('saltar desde la orilla al agua profunda aterriza en la flotación', () => {
    const env: PlayerEnv = { heightAt: (_x, z) => (z > -0.5 ? 0.5 : -5) }
    const player = createPlayer(env, 0, 0)
    run(player, { forward: true, jump: true }, env, STEP)
    expect(player.grounded).toBe(false)
    run(player, { forward: true }, env, 1.5)
    expect(player.grounded).toBe(true)
    expect(player.pos.y).toBeCloseTo(WATER_LEVEL - FLOAT_DEPTH, 6)
    expect(player.floating).toBe(true)
  })

  it('flotando no se salta ni se corre', () => {
    const env = flat(-5)
    const player = createPlayer(env, 0, 0)
    run(player, { jump: true, forward: true, sprint: true }, env, 0.5)
    expect(player.grounded).toBe(true)
    expect(player.pos.y).toBeCloseTo(WATER_LEVEL - FLOAT_DEPTH, 6)
    expect(player.stamina).toBe(100)
    expect(Math.hypot(player.vel.x, player.vel.z)).toBeCloseTo(WALK_SPEED * 0.5, 6)
  })
})

describe('movimiento', () => {
  it('la diagonal está normalizada', () => {
    const env = flat(5)
    const player = createPlayer(env, 0, 0)
    stepPlayer(player, input({ forward: true, right: true }), env, STEP)
    expect(Math.hypot(player.vel.x, player.vel.z)).toBeCloseTo(WALK_SPEED, 6)
  })

  it('el límite circular es una pared dura', () => {
    const env = flat(5)
    const bound = WORLD_SIZE * WORLD_BOUND_FACTOR
    const player = createPlayer(env, 0, -bound + 1)
    run(player, { forward: true }, env, 2)
    expect(Math.hypot(player.pos.x, player.pos.z)).toBeLessThanOrEqual(bound + 1e-9)
  })
})

describe('stamina', () => {
  it('correr parado o en el aire no gasta', () => {
    const env = flat(5)
    const player = createPlayer(env, 0, 0)
    run(player, { sprint: true }, env, 1)
    expect(player.stamina).toBe(100)

    stepPlayer(player, input({ jump: true }), env, STEP)
    const afterJump = player.stamina
    expect(afterJump).toBe(90)
    stepPlayer(player, input({ sprint: true, forward: true }), env, STEP)
    expect(player.grounded).toBe(false)
    expect(player.stamina).toBe(afterJump)
  })

  it('saltar reinicia el retraso de regeneración', () => {
    const env = flat(5)
    const player = createPlayer(env, 0, 0)
    stepPlayer(player, input({ jump: true }), env, STEP)
    run(player, {}, env, 0.9)
    expect(player.stamina).toBe(90)
    run(player, {}, env, 0.5)
    expect(player.stamina).toBeGreaterThan(90)
  })

  it('agotamiento con histéresis: no oscila con Shift mantenido', () => {
    const env = flat(5)
    const player = createPlayer(env, 0, 0)
    run(player, { forward: true, sprint: true }, env, 6)
    expect(player.exhausted).toBe(true)
    expect(player.sprintLocked).toBe(true)

    // Con Shift mantenido regenera, sale de exhausted al llegar a 15, pero no vuelve a correr.
    let minAfterRecover = Infinity
    for (let i = 0; i < Math.round(4 / STEP); i++) {
      stepPlayer(player, input({ forward: true, sprint: true }), env, STEP)
      if (!player.exhausted) minAfterRecover = Math.min(minAfterRecover, player.stamina)
    }
    expect(player.exhausted).toBe(false)
    expect(player.sprintLocked).toBe(true)
    expect(minAfterRecover).toBeGreaterThanOrEqual(STAMINA_RECOVER_THRESHOLD)

    // Al soltar Shift se desbloquea y puede volver a correr.
    stepPlayer(player, input({ forward: true }), env, STEP)
    expect(player.sprintLocked).toBe(false)
    const before = player.stamina
    stepPlayer(player, input({ forward: true, sprint: true }), env, STEP)
    expect(player.stamina).toBeLessThan(before)
  })

  it('se puede saltar agotado si queda stamina suficiente', () => {
    const env = flat(5)
    const player = createPlayer(env, 0, 0)
    player.stamina = 12
    player.exhausted = true
    stepPlayer(player, input({ jump: true }), env, STEP)
    expect(player.grounded).toBe(false)
    expect(player.stamina).toBeCloseTo(2, 6)
  })
})

describe('interpolación', () => {
  it('teleport no barre entre la posición vieja y la nueva', () => {
    const env = flat(5)
    const player = createPlayer(env, 0, 0)
    run(player, { forward: true }, env, 0.5)
    teleportPlayer(player, env, 30, 30)
    const out = interpolate(player, 0.5, { x: 0, y: 0, z: 0 })
    expect(out).toEqual({ x: 30, y: 5, z: 30 })
  })

  it('alpha interpola entre el paso anterior y el actual', () => {
    const env = flat(5)
    const player = createPlayer(env, 0, 0)
    stepPlayer(player, input({ forward: true }), env, STEP)
    const out = interpolate(player, 0.5, { x: 0, y: 0, z: 0 })
    expect(out.z).toBeCloseTo((player.prev.z + player.pos.z) / 2, 9)
  })
})
