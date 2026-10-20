import { aimPose } from './game/interaction'
import type { Game } from './game/Game'
import type { ItemId } from './game/inventory'
import type { PlayerInput } from './game/player'
import { computeWorldHash } from './world/hash'
import { islandMeshes } from './world/props'
import { heightAt, WATER_LEVEL } from './world/terrain'
import { EYE_HEIGHT, FLOAT_DEPTH, PLAYER_RADIUS, WADE_DEPTH } from './game/constants'
import { ENEMY_AIM_HEIGHT } from './game/enemies'
import { campfireSpot } from './game/campfire'

/** Helpers de depuración y pruebas, solo en desarrollo. */
export function installDebug(game: Game) {
  const { world, player } = game
  // Se calcula antes de que el jugador toque nada: es la huella del mundo generado.
  const worldHash = computeWorldHash(islandMeshes(world))
  // Solo ids de props: los enemigos tienen su propia numeración (ver enemies()).
  const targetPropId = () => {
    const t = game.interaction.target
    return t && t.kind !== 'enemy' ? t.id : null
  }

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
    /** Pulsación única de tecla (e.code), se consume en el siguiente paso. */
    press: (code: string) => game.input.press(code),
    /** Pasos de rueda (positivo hacia abajo), se consumen en el siguiente paso. */
    scroll: (steps: number) => game.input.scroll(steps),
    setVitals(vitals: { health?: number; hunger?: number }) {
      Object.assign(player, vitals)
    },
    state: () => game.state,
    restart: () => game.restart(),
    player: () => ({
      x: player.pos.x,
      y: player.pos.y,
      z: player.pos.z,
      yaw: player.yaw,
      stamina: player.stamina,
      grounded: player.grounded,
      exhausted: player.exhausted,
      sprintLocked: player.sprintLocked,
      health: player.health,
      hunger: player.hunger,
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
      return targetPropId()
    },
    inventory: () => game.inventory.toJSON(),
    hotbar: () => ({ slots: [...game.inventory.slots], selected: game.inventory.selected }),
    give: (item: ItemId, amount = 1) => game.inventory.add(item, amount),
    select: (index: number) => game.inventory.select(index),
    craft: (index: number) => game.craft(index),
    setCrafting: (open: boolean) => game.setCrafting(open),
    campfires: () => game.campfires.list.map(({ id, x, y, z }) => ({ id, x, y, z })),
    /** Coloca una fogata delante de (x, z) mirando a `yaw`, sin gastar materiales; devuelve si se pudo. */
    placeCampfire: (x: number, z: number, yaw = 0) => game.campfires.place(campfireSpot({ x, z }, yaw, [world.grid, game.campfires.grid])),
    props: () => world.props.map(({ id, kind, x, y, z, radius, hp, alive }) => ({ id, kind, x, y, z, radius, hp, alive })),
    target: targetPropId,
    /** Objetos en el suelo, por recoger. */
    pickups: () => game.pickups.list.map(({ id, item, pos, grounded }) => ({ id, item, x: pos.x, y: pos.y, z: pos.z, grounded })),
    enemies: () =>
      game.enemies.list.map(({ id, pos, hp }) => ({ id, x: pos.x, z: pos.z, hp, targeted: game.interaction.target?.kind === 'enemy' && game.interaction.target.id === id })),
    spawnEnemy: (x: number, z: number) => game.enemies.spawnAt(x, z).id,
    /** Gira la cámara hacia el enemigo sin mover al jugador; devuelve si queda apuntado. */
    aimAtEnemy(id: number) {
      const e = game.enemies.list.find((en) => en.id === id)
      if (!e) return false
      const dx = e.pos.x - player.pos.x
      const dz = e.pos.z - player.pos.z
      const dy = heightAt(e.pos.x, e.pos.z) + ENEMY_AIM_HEIGHT - (player.pos.y + EYE_HEIGHT)
      game.teleport(player.pos.x, player.pos.z, Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)))
      game.advance(0)
      game.camera.updateMatrixWorld()
      game.interaction.updateTarget(game.camera)
      return game.interaction.target === e
    },
    hand: () => ({ item: game.handheld.item, action: game.handheld.action }),
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
