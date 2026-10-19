import * as THREE from 'three'
import type { PropData, World } from '../world/props'
import { BASE_DAMAGE, HIT_COOLDOWN, PROP_DEFS, REACH, TOOL_DEFS, WOBBLE_DURATION } from './constants'
import type { Inventory, ItemId } from './inventory'

const SCREEN_CENTER = new THREE.Vector2(0, 0)
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0)
const WOBBLE_AMOUNT = 0.12

/** Objetivo, golpes, animación de golpe, destrucción y reaparición de props. */
export class Interaction {
  target: PropData | null = null
  private cooldown = 0
  private raycaster = new THREE.Raycaster()
  private meshes: THREE.InstancedMesh[]
  private wobbles = new Map<PropData, number>()
  /** Segundos que faltan para que reaparezca cada prop destruido que vuelve a crecer. */
  private regrowing = new Map<PropData, number>()
  private scratch = new THREE.Matrix4()
  private hits: THREE.Intersection[] = []

  constructor(
    private world: World,
    private inventory: Inventory,
  ) {
    this.meshes = Object.values(world.meshes)
    this.raycaster.far = REACH
  }

  /** Requiere camera.matrixWorld actualizada. */
  updateTarget(camera: THREE.Camera) {
    this.raycaster.setFromCamera(SCREEN_CENTER, camera)
    this.hits.length = 0
    this.raycaster.intersectObjects(this.meshes, false, this.hits)
    this.target = null
    for (const hit of this.hits) {
      const id = hit.instanceId === undefined ? -1 : (this.world.instanceToProp.get(hit.object as THREE.InstancedMesh)?.[hit.instanceId] ?? -1)
      const prop = this.world.props[id]
      if (prop?.alive) {
        this.target = prop
        break
      }
    }
  }

  /** Paso fijo: mientras se mantiene el ataque, golpea cada vez que termina el cooldown. */
  step(dt: number, attackHeld: boolean) {
    for (const [prop, left] of this.regrowing) {
      if (left - dt > 1e-9) this.regrowing.set(prop, left - dt)
      else this.respawn(prop)
    }
    this.cooldown = Math.max(0, this.cooldown - dt)
    if (!attackHeld || this.cooldown > 1e-9 || !this.target) return
    this.hit(this.target)
    this.cooldown = HIT_COOLDOWN
  }

  private hit(prop: PropData) {
    prop.hp = Math.max(0, prop.hp - hitDamage(this.inventory.selectedItem, prop.kind))
    if (prop.hp <= 0) this.destroy(prop)
    else this.wobbles.set(prop, 0)
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

/** Daño de un golpe con el objeto en la mano (null = mano vacía). */
export function hitDamage(item: ItemId | null, kind: PropData['kind']): number {
  const tool = item ? TOOL_DEFS[item] : undefined
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
