import { aimRay, createPropHitboxes, pickTarget, type AimRay, type PropHitboxes } from './aim'
import { boostFactor, boostedDamage } from './boosts'
import { resetProp, startRegrow, type PropData, type PropWorld } from './props'
import { DEFAULT_ISLAND, type Island } from './world/island'
import { enemyFloor } from './world/terrain'
import { NO_EMIT, type Emit, type PlayerId, type TargetRef } from './events'
import { ENEMY_DEFS, PROP_DEFS, REACH, SWEEP_TARGETS, type PropFamily } from './constants'
import { enemyAimHeight, type Enemies, type EnemyData } from './enemies'
import type { Inventory, ItemId } from './inventory'
import type { Player } from './player'
import type { Pickups } from './pickups'
import { attackDamage, hitEfficacy, isSword, propDamage, swingCooldown, weaponClass } from './tiers'

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
  player: Pick<Player, 'pos' | 'yaw' | 'pitch' | 'boosts'>
  inventory: Inventory
  combat: Combat
  /** Lo que tiene delante, a su alcance (lo calcula `updateTarget`). */
  target: Target | null
}

export const createCombat = (): Combat => ({ cooldown: 0, pendingSwing: false })

// Altura sobre la base (rocas: sobre el centro) desde la que cae lo que sueltan. Lo que se recoge no suelta nada al suelo.
const DROP_HEIGHT: Record<PropFamily, number> = { tree: 1, rock: 0.3, bush: 0, herb: 0 }
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
    private island: Island = DEFAULT_ISLAND,
  ) {
    this.hitboxes = createPropHitboxes(world.placements)
  }

  /** Lo que tiene delante el jugador (el centro de su pantalla), a su alcance, desde su posición y su mirada. */
  updateTarget(fighter: Fighter) {
    aimRay(fighter.player, this.ray)
    fighter.target = pickTarget(this.ray, this.world.grid, this.hitboxes, this.enemies?.list ?? [], undefined, this.island)
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
    if (target.kind === 'enemy') return this.enemyInReach(fighter, target, AIM_SLACK_ENEMY) ? target : null
    return this.inReach(fighter, target.x, aimHeight(target), target.z, target.radius + AIM_SLACK_PROP) ? target : null
  }

  private enemyInReach(fighter: Fighter, enemy: EnemyData, slack: number) {
    const { x, z } = enemy.pos
    return this.inReach(fighter, x, enemyFloor(this.island, x, z) + enemyAimHeight(enemy.type), z, ENEMY_DEFS[enemy.type].radius + slack)
  }

  /** Si (x, y, z) está a como mucho REACH + `radius` de los ojos y a menos de 60° de la mirada. */
  private inReach(fighter: Fighter, x: number, y: number, z: number, radius: number): boolean {
    const ray = aimRay(fighter.player, this.ray)
    const dx = x - ray.ox
    const dy = y - ray.oy
    const dz = z - ray.oz
    const distance = Math.hypot(dx, dy, dz)
    if (distance > REACH + radius) return false
    // Pegado al objetivo cualquier dirección vale.
    return distance < 1e-6 || (dx * ray.dx + dy * ray.dy + dz * ray.dz) / distance >= AIM_MIN_COS
  }

  /**
   * Paso fijo: mientras se mantiene el ataque, da un golpe cada vez que termina el cooldown,
   * también al aire (como la animación). `swing` pide un golpe (un clic): si el cooldown no ha acabado,
   * queda pendiente y se da en cuanto acabe, sin sumarse a los del ataque mantenido.
   * Devuelve el golpe que empieza en este paso, si lo hay: `target` es null al aire y `dropped` dice
   * si soltó algo (lo rompió, lo mató o cogió una baya).
   */
  step(fighter: Fighter, dt: number, attackHeld: boolean, swing = false): { target: Target | null; dropped: boolean } | null {
    return startSwing(fighter.combat, dt, attackHeld, swing, fighter.inventory.selectedItem) ? this.strike(fighter) : null
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
    const hit = target ? this.hit(fighter, target) : false
    const swept = isSword(fighter.inventory.selectedItem) && this.sweep(fighter, target)
    return { target, dropped: hit || swept }
  }

  /**
   * El arco de la espada: además del apuntado, alcanza a los enemigos más cercanos de delante, hasta SWEEP_TARGETS,
   * aunque el golpe vaya al aire. Solo enemigos, nunca props. Lo decide el servidor: la predicción no sabe qué acierta.
   */
  private sweep(fighter: Fighter, target: Target | null): boolean {
    if (!this.enemies) return false
    const { pos } = fighter.player
    const distance = (e: EnemyData) => Math.hypot(e.pos.x - pos.x, e.pos.z - pos.z)
    const near = this.enemies.list.filter((e) => e !== target && this.enemyInReach(fighter, e, 0)).sort((a, b) => distance(a) - distance(b) || a.id - b.id)
    let dropped = false
    for (const enemy of near.slice(0, SWEEP_TARGETS - (target?.kind === 'enemy' ? 1 : 0))) dropped = this.hitEnemy(fighter, enemy) || dropped
    return dropped
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
    // La fuerza del mercader también recolecta más deprisa.
    prop.hp = Math.max(0, prop.hp - boostedDamage(damage, fighter.player.boosts))
    if (prop.hp <= 0) this.destroy(fighter, prop)
    else this.emit({ type: 'propHit', id: prop.id, hp: prop.hp, by: fighter.id })
    return !prop.alive
  }

  private hitEnemy(fighter: Fighter, enemy: EnemyData): boolean {
    // El retroceso es en sentido contrario al atacante.
    const { pos, boosts } = fighter.player
    const item = fighter.inventory.selectedItem
    const damage = boostedDamage(attackDamage(item, enemy.type), boosts)
    if (!this.enemies?.hit(enemy, damage, pos, fighter.id, hitEfficacy(item, enemy.type), weaponClass(item), boostFactor(boosts, 'knockback'))) return false
    if (fighter.target === enemy) fighter.target = null
    const { x, z } = enemy.pos
    const def = ENEMY_DEFS[enemy.type]
    for (const { item, amount } of def.loot) {
      const scale = item === 'coin' ? enemy.lootScale * enemy.coinScale : enemy.lootScale
      this.pickups.drop(item, Math.round(amount * scale), x, enemyFloor(this.island, x, z) + ENEMY_DROP_HEIGHT, z)
    }
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
 * pendiente con el cooldown acabado), con la cadencia de `item`. Sin mundo: la predicción del cliente la usa tal cual.
 */
export function startSwing(combat: Combat, dt: number, attackHeld: boolean, swing: boolean, item: ItemId | null): boolean {
  combat.cooldown = Math.max(0, combat.cooldown - dt)
  if (swing) combat.pendingSwing = true
  if (!(attackHeld || combat.pendingSwing) || combat.cooldown > 1e-9) return false
  combat.pendingSwing = false
  combat.cooldown = swingCooldown(item)
  return true
}

// Altura sobre la base (rocas: sobre el centro) a la que se apunta: el tronco, la roca o el centro del arbusto.
const AIM_HEIGHT: Record<PropFamily, number> = { tree: 1.2, rock: 0.2, bush: 0.5, herb: 0.2 }

const aimHeight = (prop: PropData) => prop.y + AIM_HEIGHT[PROP_DEFS[prop.kind].family]

/** Posición y orientación para apuntar a un prop desde fuera de su radio (debug y tests). */
export function aimPose(prop: PropData, isFree: (x: number, z: number) => boolean, ground?: (x: number, z: number) => number) {
  const dist = prop.radius + 1.2
  let x = prop.x + dist
  let z = prop.z
  // Con `ground`, de los sitios libres el más a la altura del prop: en una ladera empinada, por arriba queda enterrado.
  const base = ground?.(prop.x, prop.z) ?? 0
  let best = Infinity
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2
    const cx = prop.x + Math.cos(angle) * dist
    const cz = prop.z + Math.sin(angle) * dist
    if (!isFree(cx, cz)) continue
    const off = ground ? Math.abs(ground(cx, cz) - base) : 0
    if (off >= best) continue
    best = off
    x = cx
    z = cz
    if (!ground) break
  }
  const dx = prop.x - x
  const dz = prop.z - z
  // forward = (-sin(yaw), -cos(yaw))
  const yaw = Math.atan2(-dx, -dz)
  const aimY = aimHeight(prop)
  return { x, z, yaw, aimY, horizontal: Math.hypot(dx, dz) }
}
