import { aimRay, createPropHitboxes, pickTarget, type AimRay, type PropHitboxes } from './aim'
import { resetProp, startRegrow, type PropData, type PropWorld } from './props'
import { heightAt } from './world/terrain'
import { NO_EMIT, type Emit, type PlayerId } from './events'
import { BASE_DAMAGE, ENEMY_DEF, HIT_COOLDOWN, PROP_DEFS, TOOL_DEFS } from './constants'
import type { Enemies, EnemyData } from './enemies'
import type { Inventory, ItemId } from './inventory'
import type { Player } from './player'
import type { Pickups } from './pickups'

/** Lo que se puede golpear: un prop o un enemigo (se distinguen por `kind`). */
export type Target = PropData | EnemyData

/** Espera entre golpes de un jugador. */
export interface Combat {
  /** Segundos hasta poder volver a golpear. */
  cooldown: number
  /** Un golpe pedido (acción `swing`) durante el cooldown: se da en cuanto acabe. */
  pendingSwing: boolean
}

/** Lo que Interaction necesita de un jugador para que golpee (un PlayerSlot lo cumple). */
export interface Fighter {
  id: PlayerId
  player: Pick<Player, 'pos' | 'yaw' | 'pitch'>
  inventory: Inventory
  combat: Combat
  /** Lo que tiene delante, a su alcance (lo calcula `updateTarget`). */
  target: Target | null
}

export const createCombat = (): Combat => ({ cooldown: 0, pendingSwing: false })

// Altura sobre la base (rocas: sobre el centro) desde la que cae lo que sueltan.
const DROP_HEIGHT = { tree: 1, rock: 0.3, enemy: 0.8 }

/**
 * Objetivo, golpes, destrucción de props y recogida de bayas (el rebrote es `growBerries`); golpes a enemigos.
 * Lo que sueltan árboles, rocas y enemigos cae al suelo (`pickups`); las bayas van directas al inventario de
 * quien golpea. Es una para todos los jugadores: lo de cada uno (objetivo, cooldown, inventario) va en su Fighter.
 * Solo cambia el estado: lo que se ve (wobble, props ocultos, bayas) lo dibuja PropView desde los eventos.
 */
export class Interaction {
  private hitboxes: PropHitboxes
  /** Rayo de puntería, reutilizado entre llamadas. */
  private ray: AimRay = aimRay({ pos: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0 })

  constructor(
    private world: PropWorld,
    private pickups: Pickups,
    private enemies?: Enemies,
    private emit: Emit = NO_EMIT,
  ) {
    this.hitboxes = createPropHitboxes(world.placements)
  }

  /** Lo que tiene delante el jugador (el centro de su pantalla), a su alcance, desde su posición y su mirada. */
  updateTarget(fighter: Fighter) {
    aimRay(fighter.player, this.ray)
    fighter.target = pickTarget(this.ray, this.world.grid, this.hitboxes, this.enemies?.list ?? [])
  }

  /**
   * Paso fijo: mientras se mantiene el ataque, da un golpe cada vez que termina el cooldown,
   * también al aire (como la animación). `swing` pide un golpe (un clic): si el cooldown no ha acabado,
   * queda pendiente y se da en cuanto acabe, sin sumarse a los del ataque mantenido.
   * Devuelve el golpe que empieza en este paso, si lo hay: `target` es null al aire y `dropped` dice
   * si soltó algo (lo rompió, lo mató o cogió una baya).
   */
  step(fighter: Fighter, dt: number, attackHeld: boolean, swing = false): { target: Target | null; dropped: boolean } | null {
    const { combat } = fighter
    combat.cooldown = Math.max(0, combat.cooldown - dt)
    if (swing) combat.pendingSwing = true
    if (!(attackHeld || combat.pendingSwing) || combat.cooldown > 1e-9) return null
    const target = fighter.target
    combat.pendingSwing = false
    combat.cooldown = HIT_COOLDOWN
    this.emit({
      type: 'playerSwing',
      id: fighter.id,
      item: fighter.inventory.selectedItem,
      target: target && { kind: target.kind === 'enemy' ? 'enemy' : 'prop', id: target.id },
    })
    return { target, dropped: target ? this.hit(fighter, target) : false }
  }

  /** Devuelve si el golpe suelta algo. */
  private hit(fighter: Fighter, target: Target): boolean {
    if (target.kind === 'enemy') return this.hitEnemy(fighter, target)
    const prop = target
    // Otro jugador lo rompió antes en este mismo paso.
    if (!prop.alive) return false
    if (PROP_DEFS[prop.kind].harvest) return this.harvest(fighter, prop)
    prop.hp = Math.max(0, prop.hp - hitDamage(fighter.inventory.selectedItem, prop.kind))
    if (prop.hp <= 0) this.destroy(fighter, prop)
    else this.emit({ type: 'propHit', id: prop.id, hp: prop.hp, by: fighter.id })
    return !prop.alive
  }

  private hitEnemy(fighter: Fighter, enemy: EnemyData): boolean {
    // El retroceso es en sentido contrario al atacante.
    const { pos } = fighter.player
    if (!this.enemies?.hit(enemy, hitDamage(fighter.inventory.selectedItem, 'enemy'), pos, fighter.id)) return false
    if (fighter.target === enemy) fighter.target = null
    const { x, z } = enemy.pos
    this.pickups.drop(ENEMY_DEF.drop.item, ENEMY_DEF.drop.amount, x, heightAt(x, z) + DROP_HEIGHT.enemy, z)
    return true
  }

  private destroy(fighter: Fighter, prop: PropData) {
    prop.alive = false
    if (fighter.target === prop) fighter.target = null
    this.emit({ type: 'propDestroyed', id: prop.id, by: fighter.id })
    const { drop } = PROP_DEFS[prop.kind]
    const height = prop.kind === 'tree' || prop.kind === 'rock' ? DROP_HEIGHT[prop.kind] : 0
    this.pickups.drop(drop.item, drop.amount, prop.x, prop.y + height, prop.z)
  }

  /** Cada clic quita una baya; el arbusto se queda aunque esté vacío. Sin sitio en la hotbar, la baya se queda. */
  private harvest(fighter: Fighter, bush: PropData): boolean {
    const { drop } = PROP_DEFS[bush.kind]
    const { inventory } = fighter
    if (bush.hp <= 0 || !inventory.canAdd(drop.item)) return false
    bush.hp--
    // El rebrote sigue su ritmo: recoger no reinicia el temporizador de la siguiente baya.
    startRegrow(bush)
    inventory.add(drop.item, drop.amount)
    this.emit({ type: 'berryTaken', id: bush.id, hp: bush.hp, by: fighter.id })
    return true
  }

  /** Reinicio de partida: todos los props como al generar la isla, sin rebrotes pendientes. */
  reset() {
    for (const prop of this.world.props) resetProp(prop)
  }
}

/** Daño de un golpe con el objeto en la mano (null = mano vacía). */
export function hitDamage(item: ItemId | null, kind: Target['kind']): number {
  const tool = item ? TOOL_DEFS[item] : undefined
  if (kind === 'enemy') return tool?.attack ?? BASE_DAMAGE
  return BASE_DAMAGE * (tool?.kind === kind ? tool.multiplier : 1)
}

/** Posición y orientación para apuntar a un prop desde fuera de su radio (debug y tests). */
export function aimPose(prop: PropData, isFree: (x: number, z: number) => boolean) {
  const dist = prop.radius + 1.2
  let x = prop.x + dist
  let z = prop.z
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2
    const cx = prop.x + Math.cos(angle) * dist
    const cz = prop.z + Math.sin(angle) * dist
    if (isFree(cx, cz)) {
      x = cx
      z = cz
      break
    }
  }
  const dx = prop.x - x
  const dz = prop.z - z
  // forward = (-sin(yaw), -cos(yaw))
  const yaw = Math.atan2(-dx, -dz)
  const aimY = prop.kind === 'tree' ? prop.y + 1.2 : prop.kind === 'bush' ? prop.y + 0.5 : prop.y + 0.2
  return { x, z, yaw, aimY, horizontal: Math.hypot(dx, dz) }
}
