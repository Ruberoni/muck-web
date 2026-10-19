import { aimPose } from './game/interaction'
import type { Game } from './game/Game'
import type { PlayerInput } from './game/player'
import { computeWorldHash } from './world/hash'
import { heightAt, WATER_LEVEL } from './world/terrain'
import { EYE_HEIGHT, FLOAT_DEPTH, PLAYER_RADIUS, WADE_DEPTH } from './game/constants'

/** Helpers de depuración y pruebas, solo en desarrollo. */
export function installDebug(game: Game) {
  const { world, player } = game
  // Se calcula antes de que el jugador toque nada: es la huella del mundo generado.
  const worldHash = computeWorldHash(Object.values(world.meshes))

  const api = {
    worldHash,
    start({ manual = false }: { manual?: boolean } = {}) {
      game.manualClock = manual
      game.setState('playing')
    },
    advance: (seconds: number) => game.advance(seconds),
    setKeys(keys: Partial<PlayerInput> | null) {
      game.inputOverride = keys
    },
    setAttack(held: boolean | null) {
      game.attackOverride = held
    },
    player: () => ({
      x: player.pos.x,
      y: player.pos.y,
      z: player.pos.z,
      yaw: player.yaw,
      stamina: player.stamina,
      grounded: player.grounded,
      exhausted: player.exhausted,
      sprintLocked: player.sprintLocked,
    }),
    teleport: (x: number, z: number, yaw?: number) => game.teleport(x, z, yaw, 0),
    aimAt(propId: number) {
      const prop = world.props[propId]
      const isFree = (x: number, z: number) => {
        if (heightAt(x, z) < WATER_LEVEL - WADE_DEPTH) return false
        for (const other of world.grid.query(x, z, PLAYER_RADIUS + world.grid.maxRadius)) {
          if (other.alive && Math.hypot(other.x - x, other.z - z) < other.radius + PLAYER_RADIUS) return false
        }
        return true
      }
      const pose = aimPose(prop, isFree)
      const eyeY = Math.max(heightAt(pose.x, pose.z), WATER_LEVEL - FLOAT_DEPTH) + EYE_HEIGHT
      game.teleport(pose.x, pose.z, pose.yaw, Math.atan2(pose.aimY - eyeY, pose.horizontal))
      game.advance(0)
      return game.interaction.target?.id ?? null
    },
    inventory: () => game.inventory.toJSON(),
    props: () => world.props.map(({ id, kind, x, y, z, radius, hp, alive }) => ({ id, kind, x, y, z, radius, hp, alive })),
    target: () => game.interaction.target?.id ?? null,
    heightAt,
    clock: () => ({ day: game.clock.day, phase: game.clock.phase }),
    /** Salta a una hora del día actual (0 = amanecer) y renderiza. */
    setPhase(phase: number) {
      game.clock.phase = phase
      game.advance(0)
    },
  }

  window.__debug = api
  return api
}

export type DebugApi = ReturnType<typeof installDebug>
