import * as THREE from 'three'
import type { PropData, World } from '../world/props'
import type { Collider, SpatialGrid } from './collision'
import { BASE_DAMAGE, ENEMY_DEF, HIT_COOLDOWN, PLAYER_RADIUS, PROP_DEFS, REACH, REGROW_CLEARANCE, TOOL_DEFS, WOBBLE_DURATION } from './constants'
import type { Enemies, EnemyData } from './enemies'
import type { Inventory, ItemId } from './inventory'

/** Lo que se puede golpear: un prop o un enemigo (se distinguen por `kind`). */
export type Target = PropData | EnemyData

const SCREEN_CENTER = new THREE.Vector2(0, 0)
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0)
const WOBBLE_AMOUNT = 0.12

/** Objetivo, golpes, animación de golpe, destrucción y reaparición de props; golpes a enemigos. */
export class Interaction {
  target: Target | null = null
  private cooldown = 0
  private raycaster = new THREE.Raycaster()
  private objects: THREE.Object3D[]
  private wobbles = new Map<PropData, number>()
  /** Segundos que faltan para que reaparezca cada prop destruido que vuelve a crecer. */
  private regrowing = new Map<PropData, number>()
  private scratch = new THREE.Matrix4()
  private hits: THREE.Intersection[] = []

  /** `canRegrow` decide si un prop ya puede reaparecer; si no, se vuelve a probar en cada paso. */
  constructor(
    private world: World,
    private inventory: Inventory,
    private canRegrow: (prop: PropData) => boolean = () => true,
    private enemies?: Enemies,
  ) {
    this.objects = [...Object.values(world.meshes), ...(enemies ? [enemies.group] : [])]
    this.raycaster.far = REACH
  }

  /** Requiere camera.matrixWorld actualizada. */
  updateTarget(camera: THREE.Camera) {
    this.raycaster.setFromCamera(SCREEN_CENTER, camera)
    this.hits.length = 0
    // Recursivo por el grupo de enemigos; los props no tienen hijos. Los impactos vienen ordenados por distancia.
    this.raycaster.intersectObjects(this.objects, true, this.hits)
    this.target = null
    for (const hit of this.hits) {
      const enemy = hit.object.userData.enemy as EnemyData | undefined
      if (enemy) {
        if (!enemy.alive) continue
        this.target = enemy
        break
      }
      const id = hit.instanceId === undefined ? -1 : (this.world.instanceToProp.get(hit.object as THREE.InstancedMesh)?.[hit.instanceId] ?? -1)
      const prop = this.world.props[id]
      if (prop?.alive) {
        this.target = prop
        break
      }
    }
  }

  /**
   * Paso fijo: mientras se mantiene el ataque, da un golpe cada vez que termina el cooldown,
   * también al aire (como la animación). Devuelve si ha empezado un golpe en este paso.
   */
  step(dt: number, attackHeld: boolean): boolean {
    for (const [prop, left] of this.regrowing) {
      if (left - dt > 1e-9) this.regrowing.set(prop, left - dt)
      else if (this.canRegrow(prop)) this.respawn(prop)
      else this.regrowing.set(prop, 0)
    }
    this.cooldown = Math.max(0, this.cooldown - dt)
    if (!attackHeld || this.cooldown > 1e-9) return false
    if (this.target) this.hit(this.target)
    this.cooldown = HIT_COOLDOWN
    return true
  }

  private hit(target: Target) {
    if (target.kind === 'enemy') return this.hitEnemy(target)
    const prop = target
    prop.hp = Math.max(0, prop.hp - hitDamage(this.inventory.selectedItem, prop.kind))
    if (prop.hp <= 0) this.destroy(prop)
    else this.wobbles.set(prop, 0)
  }

  private hitEnemy(enemy: EnemyData) {
    // El raycast salió de la cámara: el retroceso es en sentido contrario al jugador.
    const from = this.raycaster.ray.origin
    if (!this.enemies?.hit(enemy, hitDamage(this.inventory.selectedItem, 'enemy'), from)) return
    if (this.target === enemy) this.target = null
    this.inventory.add(ENEMY_DEF.drop.item, ENEMY_DEF.drop.amount)
  }

  private destroy(prop: PropData) {
    // Cancelar la animación antes de ocultar: si no, restauraría la escala y el prop "reviviría".
    this.wobbles.delete(prop)
    prop.alive = false
    for (const { mesh, index } of prop.instances) {
      mesh.setMatrixAt(index, HIDDEN)
      mesh.instanceMatrix.needsUpdate = true
    }
    if (this.target === prop) this.target = null
    const { drop, regrow } = PROP_DEFS[prop.kind]
    if (regrow !== undefined) this.regrowing.set(prop, regrow)
    this.inventory.add(drop.item, drop.amount)
  }

  /** Devuelve el prop a su estado original (vida llena, matriz base). */
  respawn(prop: PropData) {
    this.regrowing.delete(prop)
    this.wobbles.delete(prop)
    prop.hp = prop.maxHp
    prop.alive = true
    for (const { mesh, index, base } of prop.instances) {
      mesh.setMatrixAt(index, base)
      mesh.instanceMatrix.needsUpdate = true
    }
  }

  /** Reinicio de partida: todos los props como al generar la isla. */
  reset() {
    for (const prop of this.world.props) {
      if (!prop.alive || prop.hp < prop.maxHp || this.wobbles.has(prop)) this.respawn(prop)
    }
    this.regrowing.clear()
    this.cooldown = 0
    this.target = null
  }

  /** Por frame: animación de golpe (tronco y copa a la vez). */
  updateAnimations(dt: number) {
    for (const [prop, elapsed] of this.wobbles) {
      const t = elapsed + dt
      const done = t >= WOBBLE_DURATION
      const a = done ? 0 : WOBBLE_AMOUNT * Math.sin((Math.PI * t) / WOBBLE_DURATION)
      for (const { mesh, index, base } of prop.instances) {
        this.scratch.makeScale(1 + a, 1 - a * 0.5, 1 + a).premultiply(base)
        mesh.setMatrixAt(index, this.scratch)
        mesh.instanceMatrix.needsUpdate = true
      }
      if (done) this.wobbles.delete(prop)
      else this.wobbles.set(prop, t)
    }
  }
}

/** Un prop no reaparece encima del jugador (con margen) ni de otro collider vivo, como una fogata. */
export function canRegrowAt(prop: PropData, player: { x: number; z: number }, blockers: SpatialGrid<Collider>): boolean {
  if (Math.hypot(player.x - prop.x, player.z - prop.z) < prop.radius + PLAYER_RADIUS + REGROW_CLEARANCE) return false
  for (const c of blockers.query(prop.x, prop.z, prop.radius + blockers.maxRadius)) {
    if (c.alive && Math.hypot(c.x - prop.x, c.z - prop.z) < c.radius + prop.radius) return false
  }
  return true
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
