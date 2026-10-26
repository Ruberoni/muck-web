import { aimRay, createPropHitboxes, pickTarget, type AimRay, type PropHitboxes } from './aim'
import { resetProp, startRegrow, type PropData, type PropWorld } from './props'
import { heightAt } from './world/terrain'
import { NO_EMIT, type Emit, type PlayerId, type TargetRef } from './events'
import { ENEMY_DEF, ENEMY_RADIUS, HIT_COOLDOWN, PROP_DEFS, REACH, type PropFamily } from './constants'
import { ENEMY_AIM_HEIGHT, type Enemies, type EnemyData } from './enemies'
import type { Inventory } from './inventory'
import type { Player } from './player'
import type { Pickups } from './pickups'
import { attackDamage, propDamage } from './tiers'

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

// Altura sobre la base (rocas: sobre el centro) desde la que cae lo que sueltan. Los arbustos no sueltan nada al suelo.
const DROP_HEIGHT: Record<PropFamily, number> = { tree: 1, rock: 0.3, bush: 0 }
const ENEMY_DROP_HEIGHT = 0.8

// Validación permisiva del objetivo que dice tener delante un jugador en red (es cooperativo: no es antitrampas).
// El cliente ve a los enemigos unos 100 ms en el pasado, de ahí el margen mayor.
const AIM_SLACK_PROP = 0.5
const AIM_SLACK_ENEMY = 1.5
/** Ángulo máximo entre la mirada y el centro del objetivo (60°). */
const AIM_MIN_COS = Math.cos(Math.PI / 3)

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
   * Objetivo que el cliente dice tener delante (`Move.aim`), validado de forma permisiva: existe, está vivo,
   * a como mucho REACH + su radio + un margen de los ojos y a menos de 60° de la mirada. Si no, golpe al aire.
   */
  validateAim(fighter: Fighter, aim: TargetRef | null) {
    fighter.target = aim && this.checkAim(fighter, aim)
  }

  private checkAim(fighter: Fighter, aim: TargetRef): Target | null {
    const target = aim.kind === 'prop' ? this.world.props[aim.id] : this.enemies?.list.find((e) => e.id === aim.id)
    if (!target?.alive) return null
    const enemy = target.kind === 'enemy'
    const { x, z } = enemy ? target.pos : target
    const y = enemy ? heightAt(x, z) + ENEMY_AIM_HEIGHT : aimHeight(target)
    const radius = enemy ? ENEMY_RADIUS + AIM_SLACK_ENEMY : target.radius + AIM_SLACK_PROP
    const ray = aimRay(fighter.player, this.ray)
    const dx = x - ray.ox
    const dy = y - ray.oy
    const dz = z - ray.oz
    const distance = Math.hypot(dx, dy, dz)
    if (distance > REACH + radius) return null
    // Pegado al objetivo cualquier dirección vale.
    return distance < 1e-6 || (dx * ray.dx + dy * ray.dy + dz * ray.dz) / distance >= AIM_MIN_COS ? target : null
  }

  /**
   * Paso fijo: mientras se mantiene el ataque, da un golpe cada vez que termina el cooldown,
   * también al aire (como la animación). `swing` pide un golpe (un clic): si el cooldown no ha acabado,
   * queda pendiente y se da en cuanto acabe, sin sumarse a los del ataque mantenido.
   * Devuelve el golpe que empieza en este paso, si lo hay: `target` es null al aire y `dropped` dice
   * si soltó algo (lo rompió, lo mató o cogió una baya).
   */
  step(fighter: Fighter, dt: number, attackHeld: boolean, swing = false): { target: Target | null; dropped: boolean } | null {
    return startSwing(fighter.combat, dt, attackHeld, swing) ? this.strike(fighter) : null
  }

  /** El golpe que empieza (ya decidido por `startSwing`) contra el objetivo del jugador, o al aire. */
  strike(fighter: Fighter): { target: Target | null; dropped: boolean } {
    const target = fighter.target
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
    // Sin la herramienta que pide (§2.4 del plan) el golpe se da, pero no le hace nada: ni vida ni `propHit`.
    const damage = propDamage(fighter.inventory.selectedItem, prop.kind)
    if (damage <= 0) return false
    prop.hp = Math.max(0, prop.hp - damage)
    if (prop.hp <= 0) this.destroy(fighter, prop)
    else this.emit({ type: 'propHit', id: prop.id, hp: prop.hp, by: fighter.id })
    return !prop.alive
  }

  private hitEnemy(fighter: Fighter, enemy: EnemyData): boolean {
    // El retroceso es en sentido contrario al atacante.
    const { pos } = fighter.player
    if (!this.enemies?.hit(enemy, attackDamage(fighter.inventory.selectedItem), pos, fighter.id)) return false
    if (fighter.target === enemy) fighter.target = null
    const { x, z } = enemy.pos
    this.pickups.drop(ENEMY_DEF.drop.item, ENEMY_DEF.drop.amount, x, heightAt(x, z) + ENEMY_DROP_HEIGHT, z)
    return true
  }

  private destroy(fighter: Fighter, prop: PropData) {
    prop.alive = false
    if (fighter.target === prop) fighter.target = null
    this.emit({ type: 'propDestroyed', id: prop.id, by: fighter.id })
    const { drop, family } = PROP_DEFS[prop.kind]
    this.pickups.drop(drop.item, drop.amount, prop.x, prop.y + DROP_HEIGHT[family], prop.z)
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

/**
 * La espera entre golpes de un paso: baja el cooldown y dice si empieza un golpe (ataque mantenido o `swing`
 * pendiente con el cooldown acabado). Sin mundo: la predicción del cliente la usa tal cual.
 */
export function startSwing(combat: Combat, dt: number, attackHeld: boolean, swing: boolean): boolean {
  combat.cooldown = Math.max(0, combat.cooldown - dt)
  if (swing) combat.pendingSwing = true
  if (!(attackHeld || combat.pendingSwing) || combat.cooldown > 1e-9) return false
  combat.pendingSwing = false
  combat.cooldown = HIT_COOLDOWN
  return true
}

// Altura sobre la base (rocas: sobre el centro) a la que se apunta: el tronco, la roca o el centro del arbusto.
const AIM_HEIGHT: Record<PropFamily, number> = { tree: 1.2, rock: 0.2, bush: 0.5 }

const aimHeight = (prop: PropData) => prop.y + AIM_HEIGHT[PROP_DEFS[prop.kind].family]

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
  const aimY = aimHeight(prop)
  return { x, z, yaw, aimY, horizontal: Math.hypot(dx, dz) }
}
