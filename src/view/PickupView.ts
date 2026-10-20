import * as THREE from 'three'
import { STEP } from '../sim/constants'
import type { ItemId } from '../sim/inventory'
import type { Pickup } from '../sim/pickups'
import { itemModel } from '../game/handheld'

// Los modelos de la mano son pequeños: en el suelo se ven algo más grandes.
const MODEL_SCALE = 2.2
const HOVER = 0.08
const BOB = 0.06
const SPIN_RATE = 1.5

/** Los objetos en el suelo dibujados. Sigue la lista de la simulación en cada frame: un modelo por pieza. */
export class PickupView {
  readonly group = new THREE.Group()
  private models = new Map<ItemId, THREE.Group>()
  private objects = new Map<number, THREE.Group>()
  private seen = new Set<number>()

  /** Por frame: coloca los modelos entre el paso anterior y el actual (alpha = 1: posición simulada). */
  update(pickups: readonly Pickup[], alpha: number) {
    this.seen.clear()
    for (const p of pickups) {
      this.seen.add(p.id)
      let object = this.objects.get(p.id)
      if (!object) {
        // Cada pieza es un clon que comparte geometría y material.
        object = this.model(p.item).clone()
        this.objects.set(p.id, object)
        this.group.add(object)
      }
      place(object, p, alpha)
    }
    for (const [id, object] of this.objects) {
      if (this.seen.has(id)) continue
      this.objects.delete(id)
      this.group.remove(object)
    }
  }

  /** Reinicio de partida: sin nada en el suelo. */
  reset() {
    this.objects.clear()
    this.group.clear()
  }

  /** Un modelo por objeto. */
  private model(item: ItemId) {
    let model = this.models.get(item)
    if (!model) {
      model = itemModel(item)
      model.scale.setScalar(MODEL_SCALE)
      model.traverse((o) => (o.castShadow = true))
      this.models.set(item, model)
    }
    return model
  }
}

function place(object: THREE.Object3D, p: Pickup, alpha: number) {
  const lerp = (a: number, b: number) => a + (b - a) * alpha
  const t = p.age - STEP * (1 - alpha)
  // En el suelo flota un poco y sube y baja; girando se ve qué es desde cualquier lado.
  const bob = p.grounded ? HOVER + BOB * (1 + Math.sin(t * 3 + p.spin)) : 0
  object.position.set(lerp(p.prev.x, p.pos.x), lerp(p.prev.y, p.pos.y) + bob, lerp(p.prev.z, p.pos.z))
  object.rotation.y = p.spin + t * SPIN_RATE
}
