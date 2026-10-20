import { WATER_LEVEL, WORLD_SIZE } from './world/terrain'
import {
  FLOAT_DEPTH,
  GRAVITY,
  HEALTH_MAX,
  HUNGER_MAX,
  GROUND_SNAP,
  JUMP_COST,
  JUMP_VELOCITY,
  MAX_PITCH,
  SPRINT_COST_PER_SEC,
  SPRINT_SPEED,
  STAMINA_MAX,
  STAMINA_RECOVER_THRESHOLD,
  STAMINA_REGEN_DELAY,
  STAMINA_REGEN_PER_SEC,
  WADE_DEPTH,
  WALK_SPEED,
  WATER_SPEED_FACTOR,
  WORLD_BOUND_FACTOR,
} from './constants'
import type { Vitals } from './survival'

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface PlayerInput {
  forward: boolean
  back: boolean
  left: boolean
  right: boolean
  sprint: boolean
  jump: boolean
}

export const NO_INPUT: PlayerInput = { forward: false, back: false, left: false, right: false, sprint: false, jump: false }

export interface PlayerEnv {
  heightAt(x: number, z: number): number
  /** Empuja la posición fuera de los obstáculos (XZ). */
  collide?(pos: Vec3): void
}

export interface Player extends Vitals {
  /** Posición de los pies. La cámara va en pos.y + EYE_HEIGHT. */
  pos: Vec3
  prev: Vec3
  vel: Vec3
  yaw: number
  pitch: number
  grounded: boolean
  inWater: boolean
  floating: boolean
  stamina: number
  exhausted: boolean
  sprintLocked: boolean
  regenDelay: number
}

const BOUND = WORLD_SIZE * WORLD_BOUND_FACTOR

/** Suelo efectivo: el terreno o la superficie de flotación, lo que esté más alto. */
export const floorAt = (env: PlayerEnv, x: number, z: number) => Math.max(env.heightAt(x, z), WATER_LEVEL - FLOAT_DEPTH)

export function createPlayer(env: PlayerEnv, x: number, z: number, yaw = 0): Player {
  const pos = { x, y: floorAt(env, x, z), z }
  return {
    pos,
    prev: { ...pos },
    vel: { x: 0, y: 0, z: 0 },
    yaw,
    pitch: 0,
    grounded: true,
    inWater: false,
    floating: false,
    stamina: STAMINA_MAX,
    exhausted: false,
    sprintLocked: false,
    regenDelay: 0,
    health: HEALTH_MAX,
    hunger: HUNGER_MAX,
  }
}

export function teleportPlayer(player: Player, env: PlayerEnv, x: number, z: number, yaw = player.yaw) {
  player.pos.x = x
  player.pos.z = z
  player.pos.y = floorAt(env, x, z)
  player.vel.x = player.vel.y = player.vel.z = 0
  player.yaw = yaw
  player.grounded = true
  resetInterpolation(player)
}

export function resetInterpolation(player: Player) {
  player.prev.x = player.pos.x
  player.prev.y = player.pos.y
  player.prev.z = player.pos.z
}

export function interpolate(player: Player, alpha: number, out: Vec3): Vec3 {
  out.x = player.prev.x + (player.pos.x - player.prev.x) * alpha
  out.y = player.prev.y + (player.pos.y - player.prev.y) * alpha
  out.z = player.prev.z + (player.pos.z - player.prev.z) * alpha
  return out
}

/** Gira una orientación (la del jugador o la de la cámara del cliente), con el pitch limitado. */
export function rotatePlayer(player: Pick<Player, 'yaw' | 'pitch'>, dYaw: number, dPitch: number) {
  player.yaw += dYaw
  player.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, player.pitch + dPitch))
}

/** Un paso fijo de simulación. */
export function stepPlayer(player: Player, input: PlayerInput, env: PlayerEnv, dt: number) {
  const { pos, vel } = player
  resetInterpolation(player)

  const ground = env.heightAt(pos.x, pos.z)
  player.inWater = ground < WATER_LEVEL - WADE_DEPTH
  player.floating = ground < WATER_LEVEL - FLOAT_DEPTH

  if (!input.sprint) player.sprintLocked = false

  // Dirección local normalizada (la diagonal no es más rápida), rotada por el yaw.
  let mx = (input.right ? 1 : 0) - (input.left ? 1 : 0)
  let mz = (input.back ? 1 : 0) - (input.forward ? 1 : 0)
  const len = Math.hypot(mx, mz)
  const moving = len > 0
  if (moving) {
    mx /= len
    mz /= len
  }
  const sin = Math.sin(player.yaw)
  const cos = Math.cos(player.yaw)
  const wx = mx * cos + mz * sin
  const wz = -mx * sin + mz * cos

  const canSprint = !player.exhausted && !player.sprintLocked
  const sprinting = player.grounded && moving && input.sprint && canSprint && !player.inWater
  let spent = false

  if (player.grounded) {
    const speed = (sprinting ? SPRINT_SPEED : WALK_SPEED) * (player.inWater ? WATER_SPEED_FACTOR : 1)
    vel.x = wx * speed
    vel.z = wz * speed
  }

  if (sprinting) {
    player.stamina -= SPRINT_COST_PER_SEC * dt
    spent = true
  }

  let jumped = false
  if (input.jump && player.grounded && !player.floating && player.stamina >= JUMP_COST) {
    vel.y = JUMP_VELOCITY
    player.stamina -= JUMP_COST
    player.grounded = false
    spent = jumped = true
  }

  if (player.stamina <= 0) {
    player.stamina = 0
    if (!player.exhausted) {
      player.exhausted = true
      player.sprintLocked = true
    }
  }

  if (spent) player.regenDelay = STAMINA_REGEN_DELAY
  else if (player.regenDelay > 0) player.regenDelay = Math.max(0, player.regenDelay - dt)
  else player.stamina = Math.min(STAMINA_MAX, player.stamina + STAMINA_REGEN_PER_SEC * dt)

  if (player.exhausted && player.stamina >= STAMINA_RECOVER_THRESHOLD) player.exhausted = false

  // Integración horizontal + límite circular + colisiones.
  pos.x += vel.x * dt
  pos.z += vel.z * dt
  const r = Math.hypot(pos.x, pos.z)
  if (r > BOUND) {
    pos.x *= BOUND / r
    pos.z *= BOUND / r
  }
  env.collide?.(pos)

  // Vertical: snap al suelo mientras se camina; caída libre si se despega.
  const floor = floorAt(env, pos.x, pos.z)
  if (player.grounded && !jumped) {
    if (pos.y - floor < GROUND_SNAP) {
      pos.y = floor
      vel.y = 0
    } else {
      player.grounded = false
      vel.y = 0
    }
  } else {
    vel.y -= GRAVITY * dt
    pos.y += vel.y * dt
    if (pos.y <= floor) {
      pos.y = floor
      vel.y = 0
      player.grounded = true
    }
  }
}
