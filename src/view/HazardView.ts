import * as THREE from 'three'
import { STEP } from '../sim/constants'
import { ringRadius, type Hazard, type HazardLook } from '../sim/hazards'
import { DEFAULT_ISLAND, type Island } from '../sim/world/island'
import { WATER_LEVEL } from '../sim/world/terrain'

/** Altura sobre el suelo, para que no parpadee con él. */
const LIFT = 0.08
/** Latidos por segundo del aviso de una zona. */
const PULSE = 6
/** Segundos que se ve el golpe de una zona al caer. */
const BURST_TIME = 0.35

const COLORS: Record<HazardLook, string> = { stomp: '#ffb13b', rock: '#ff3b2f', fire: '#ff6a1f', light: '#fff2b0', crystal: '#2fb4ff' }

const discGeometry = new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2)
const ringGeometry = new THREE.RingGeometry(0.85, 1, 40).rotateX(-Math.PI / 2)

interface Model {
  mesh: THREE.Mesh
  material: THREE.MeshBasicMaterial
}

/**
 * Los peligros de los jefes, en el tick que se le pasa (el de render en red): una zona es un disco que late hasta que
 * cae y luego destella (o arde mientras dura); una onda es un anillo que crece desde su centro. No dependen de la luz ni
 * de la niebla: se ven igual de noche.
 */
export class HazardView {
  readonly group = new THREE.Group()
  island: Island = DEFAULT_ISLAND
  private models = new Map<number, Model>()
  private seen = new Set<number>()

  update(list: readonly Hazard[], tick: number) {
    this.seen.clear()
    for (const h of list) {
      const model = this.modelOf(h)
      this.seen.add(h.id)
      const { mesh, material } = model
      const ground = Math.max(this.island.heightAt(h.x, h.z), WATER_LEVEL) + LIFT
      const t = (tick - h.hitTick) * STEP
      if (h.ring) {
        const r = ringRadius(h, tick)
        mesh.visible = tick >= h.hitTick && r <= h.radius + h.ring.width
        mesh.scale.setScalar(Math.max(0.01, r))
        material.opacity = 0.85 * (1 - Math.min(1, r / (h.radius + h.ring.width)) * 0.6)
      } else if (tick < h.hitTick) {
        // El aviso: late más deprisa cuanto menos falta.
        const warn = (tick - h.startTick) * STEP
        mesh.visible = true
        mesh.scale.setScalar(h.radius)
        material.opacity = 0.25 + 0.25 * (0.5 + 0.5 * Math.sin(warn * PULSE * Math.PI * 2 * (1 + warn)))
      } else if (h.pulse) {
        mesh.visible = tick <= h.endTick
        mesh.scale.setScalar(h.radius)
        material.opacity = 0.45 + 0.15 * Math.sin(t * 9)
      } else {
        mesh.visible = t <= BURST_TIME
        mesh.scale.setScalar(h.radius * (1 + t * 0.6))
        material.opacity = 0.8 * (1 - t / BURST_TIME)
      }
      mesh.position.set(h.x, ground, h.z)
    }
    for (const [id, model] of this.models) {
      if (this.seen.has(id)) continue
      this.group.remove(model.mesh)
      model.material.dispose()
      this.models.delete(id)
    }
  }

  reset() {
    for (const model of this.models.values()) model.material.dispose()
    this.models.clear()
    this.group.clear()
  }

  private modelOf(h: Hazard): Model {
    let model = this.models.get(h.id)
    if (model) return model
    const material = new THREE.MeshBasicMaterial({ color: COLORS[h.look], transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide })
    const mesh = new THREE.Mesh(h.ring ? ringGeometry : discGeometry, material)
    mesh.renderOrder = 1
    model = { mesh, material }
    this.models.set(h.id, model)
    this.group.add(mesh)
    return model
  }
}
