import { aimRay, createPropHitboxes, pickTarget, type AimRay, type PropHitboxes } from '../sim/aim'
import { resetProp, type PropData, type PropWorld } from '../sim/props'
import { heightAt } from '../sim/world/terrain'
import { LOCAL_PLAYER, NO_EMIT, type Emit } from '../sim/events'
import { BASE_DAMAGE, BERRY_REGROW, ENEMY_DEF, HIT_COOLDOWN, PROP_DEFS, TOOL_DEFS } from '../sim/constants'
import type { Enemies, EnemyData } from './enemies'
import type { Inventory, ItemId } from '../sim/inventory'
import type { Player } from '../sim/player'
import type { Pickups } from './pickups'

/** Lo que se puede golpear: un prop o un enemigo (se distinguen por `kind`). */
export type Target = PropData | EnemyData

// Altura sobre la base (rocas: sobre el centro) desde la que cae lo que sueltan.
const DROP_HEIGHT = { tree: 1, rock: 0.3, enemy: 0.8 }

/**
 * Objetivo, golpes, destrucción de props, recogida y rebrote de bayas; golpes a enemigos.
 * Lo que sueltan árboles, rocas y enemigos cae al suelo (`pickups`); las bayas van directas al inventario.
 * Solo cambia el estado: lo que se ve (wobble, props ocultos, bayas) lo dibuja PropView desde los eventos.
 */
export class Interaction {
  target: Target | null = null
  private cooldown = 0
  private hitboxes: PropHitboxes
  /** El último rayo de puntería: de él sale el retroceso de los enemigos. */
  private ray: AimRay = aimRay({ pos: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0 })
  /** Segundos que faltan para que le vuelva a crecer una baya a cada arbusto incompleto. */
  private regrowing = new Map<PropData, number>()

  constructor(
    private world: PropWorld,
    private inventory: Inventory,
    private pickups: Pickups,
    private enemies?: Enemies,
    private emit: Emit = NO_EMIT,
  ) {
    this.hitboxes = createPropHitboxes(world.placements)
  }

  /** Lo que tiene delante el jugador (el centro de la pantalla), a su alcance, desde su posición y su mirada. */
  updateTarget(player: Pick<Player, 'pos' | 'yaw' | 'pitch'>) {
    aimRay(player, this.ray)
    this.target = pickTarget(this.ray, this.world.grid, this.hitboxes, this.enemies?.list ?? [])
  }

  /**
   * Paso fijo: mientras se mantiene el ataque, da un golpe cada vez que termina el cooldown,
   * también al aire (como la animación). Devuelve el golpe que empieza en este paso, si lo hay:
   * `target` es null al aire y `dropped` dice si soltó algo (lo rompió, lo mató o cogió una baya).
   */
  step(dt: number, attackHeld: boolean): { target: Target | null; dropped: boolean } | null {
    for (const [bush, left] of this.regrowing) {
      if (left - dt > 1e-9) this.regrowing.set(bush, left - dt)
      else this.growBerry(bush)
    }
    this.cooldown = Math.max(0, this.cooldown - dt)
    if (!attackHeld || this.cooldown > 1e-9) return null
    const target = this.target
    this.cooldown = HIT_COOLDOWN
    this.emit({
      type: 'playerSwing',
      id: LOCAL_PLAYER,
      item: this.inventory.selectedItem,
      target: target && { kind: target.kind === 'enemy' ? 'enemy' : 'prop', id: target.id },
    })
    return { target, dropped: target ? this.hit(target) : false }
  }

  /** Devuelve si el golpe suelta algo. */
  private hit(target: Target): boolean {
    if (target.kind === 'enemy') return this.hitEnemy(target)
    const prop = target
    if (PROP_DEFS[prop.kind].harvest) return this.harvest(prop)
    prop.hp = Math.max(0, prop.hp - hitDamage(this.inventory.selectedItem, prop.kind))
    if (prop.hp <= 0) this.destroy(prop)
    else this.emit({ type: 'propHit', id: prop.id, hp: prop.hp, by: LOCAL_PLAYER })
    return !prop.alive
  }

  private hitEnemy(enemy: EnemyData): boolean {
    // El rayo sale de los ojos: el retroceso es en sentido contrario al jugador.
    const from = { x: this.ray.ox, z: this.ray.oz }
    if (!this.enemies?.hit(enemy, hitDamage(this.inventory.selectedItem, 'enemy'), from, LOCAL_PLAYER)) return false
    if (this.target === enemy) this.target = null
    const { x, z } = enemy.pos
    this.pickups.drop(ENEMY_DEF.drop.item, ENEMY_DEF.drop.amount, x, heightAt(x, z) + DROP_HEIGHT.enemy, z)
    return true
  }

  private destroy(prop: PropData) {
    prop.alive = false
    if (this.target === prop) this.target = null
    this.emit({ type: 'propDestroyed', id: prop.id, by: LOCAL_PLAYER })
    const { drop } = PROP_DEFS[prop.kind]
    const height = prop.kind === 'tree' || prop.kind === 'rock' ? DROP_HEIGHT[prop.kind] : 0
    this.pickups.drop(drop.item, drop.amount, prop.x, prop.y + height, prop.z)
  }

  /** Cada clic quita una baya; el arbusto se queda aunque esté vacío. Sin sitio en la hotbar, la baya se queda. */
  private harvest(bush: PropData): boolean {
    const { drop } = PROP_DEFS[bush.kind]
    if (bush.hp <= 0 || !this.inventory.canAdd(drop.item)) return false
    bush.hp--
    // El rebrote sigue su ritmo: recoger no reinicia el temporizador de la siguiente baya.
    if (!this.regrowing.has(bush)) this.regrowing.set(bush, BERRY_REGROW)
    this.inventory.add(drop.item, drop.amount)
    this.emit({ type: 'berryTaken', id: bush.id, hp: bush.hp, by: LOCAL_PLAYER })
    return true
  }

  private growBerry(bush: PropData) {
    bush.hp++
    this.emit({ type: 'berryGrew', id: bush.id, hp: bush.hp })
    if (bush.hp < bush.maxHp) this.regrowing.set(bush, BERRY_REGROW)
    else this.regrowing.delete(bush)
  }

  /** Reinicio de partida: todos los props como al generar la isla. */
  reset() {
    for (const prop of this.world.props) resetProp(prop)
    this.regrowing.clear()
    this.cooldown = 0
    this.target = null
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
