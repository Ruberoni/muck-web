import * as THREE from 'three'
import type { PropData, PropInstance, World } from '../world/props'
import { heightAt } from '../sim/world/terrain'
import { LOCAL_PLAYER, NO_EMIT, type Emit } from '../sim/events'
import { BASE_DAMAGE, BERRY_REGROW, ENEMY_DEF, HIT_COOLDOWN, PROP_DEFS, REACH, TOOL_DEFS, WOBBLE_DURATION } from '../sim/constants'
import type { Enemies, EnemyData } from './enemies'
import type { Inventory, ItemId } from '../sim/inventory'
import type { Pickups } from './pickups'

/** Lo que se puede golpear: un prop o un enemigo (se distinguen por `kind`). */
export type Target = PropData | EnemyData

const SCREEN_CENTER = new THREE.Vector2(0, 0)
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0)
const WOBBLE_AMOUNT = 0.12
// Altura sobre la base (rocas: sobre el centro) desde la que cae lo que sueltan.
const DROP_HEIGHT = { tree: 1, rock: 0.3, enemy: 0.8 }

/**
 * Objetivo, golpes, animación de golpe, destrucción de props, recogida y rebrote de bayas; golpes a enemigos.
 * Lo que sueltan árboles, rocas y enemigos cae al suelo (`pickups`); las bayas van directas al inventario.
 */
export class Interaction {
  target: Target | null = null
  private cooldown = 0
  private raycaster = new THREE.Raycaster()
  private objects: THREE.Object3D[]
  private wobbles = new Map<PropData, number>()
  /** Segundos que faltan para que le vuelva a crecer una baya a cada arbusto incompleto. */
  private regrowing = new Map<PropData, number>()
  private scratch = new THREE.Matrix4()
  private hits: THREE.Intersection[] = []

  constructor(
    private world: World,
    private inventory: Inventory,
    private pickups: Pickups,
    private enemies?: Enemies,
    private emit: Emit = NO_EMIT,
  ) {
    this.objects = [...world.allMeshes, ...(enemies ? [enemies.group] : [])]
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
    else {
      this.wobbles.set(prop, 0)
      this.emit({ type: 'propHit', id: prop.id, hp: prop.hp, by: LOCAL_PLAYER })
    }
    return !prop.alive
  }

  private hitEnemy(enemy: EnemyData): boolean {
    // El raycast salió de la cámara: el retroceso es en sentido contrario al jugador.
    const from = this.raycaster.ray.origin
    if (!this.enemies?.hit(enemy, hitDamage(this.inventory.selectedItem, 'enemy'), from, LOCAL_PLAYER)) return false
    if (this.target === enemy) this.target = null
    const { x, z } = enemy.pos
    this.pickups.drop(ENEMY_DEF.drop.item, ENEMY_DEF.drop.amount, x, heightAt(x, z) + DROP_HEIGHT.enemy, z)
    return true
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
    this.setBerry(bush, bush.hp, false)
    // El rebrote sigue su ritmo: recoger no reinicia el temporizador de la siguiente baya.
    if (!this.regrowing.has(bush)) this.regrowing.set(bush, BERRY_REGROW)
    this.wobbles.set(bush, 0)
    this.inventory.add(drop.item, drop.amount)
    this.emit({ type: 'berryTaken', id: bush.id, hp: bush.hp, by: LOCAL_PLAYER })
    return true
  }

  private growBerry(bush: PropData) {
    this.setBerry(bush, bush.hp, true)
    bush.hp++
    this.emit({ type: 'berryGrew', id: bush.id, hp: bush.hp })
    if (bush.hp < bush.maxHp) this.regrowing.set(bush, BERRY_REGROW)
    else this.regrowing.delete(bush)
  }

  private setBerry(bush: PropData, berry: number, visible: boolean) {
    const instance = bush.instances.find((i) => i.berry === berry)
    if (!instance) return
    instance.mesh.setMatrixAt(instance.index, visible ? instance.base : HIDDEN)
    instance.mesh.instanceMatrix.needsUpdate = true
  }

  /** Devuelve el prop a su estado original (vida llena, matriz base). */
  private respawn(prop: PropData) {
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
      for (const instance of prop.instances) {
        // Las bayas ya recogidas siguen ocultas durante el wobble.
        if (!isShown(prop, instance)) continue
        const { mesh, index, base } = instance
        this.scratch.makeScale(1 + a, 1 - a * 0.5, 1 + a).premultiply(base)
        mesh.setMatrixAt(index, this.scratch)
        mesh.instanceMatrix.needsUpdate = true
      }
      if (done) this.wobbles.delete(prop)
      else this.wobbles.set(prop, t)
    }
  }
}

const isShown = (prop: PropData, instance: PropInstance) => instance.berry === undefined || instance.berry < prop.hp

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
