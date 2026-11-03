import * as THREE from 'three'
import type { PlayerId, SimEventData } from '../sim/events'
import type { Fish } from '../sim/fish'
import { WATER_LEVEL } from '../sim/world/terrain'

/** Da vueltas a esta distancia de su presa, con la aleta fuera del agua. */
const CIRCLE_RADIUS = 3.2
const CIRCLE_SPEED = 1.4
/** El cuerpo, algo hundido: se ve a través del agua. */
const BODY_DEPTH = 0.45
/** Al morder se lanza hasta la presa y vuelve. */
const LUNGE_TIME = 0.45

const bodyMaterial = new THREE.MeshStandardMaterial({ color: '#4c5a66', flatShading: true, roughness: 0.6 })
const bellyMaterial = new THREE.MeshStandardMaterial({ color: '#c9d2d6', flatShading: true, roughness: 0.6 })
const eyeMaterial = new THREE.MeshBasicMaterial({ color: '#0d0f12' })

/** Un pez grande, low-poly, mirando a −Z: el cuerpo, la panza, la aleta de arriba, las de los lados y la cola. */
export function fishModel(): THREE.Group {
  const g = new THREE.Group()
  const body = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0).scale(0.55, 0.45, 1.9), bodyMaterial)
  const belly = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0).scale(0.45, 0.25, 1.5).translate(0, -0.2, 0.05), bellyMaterial)
  // La aleta de arriba: lo único que asoma.
  const dorsal = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.95, 4).scale(0.25, 1, 1).translate(0, 0.85, 0.25), bodyMaterial)
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.8, 4).scale(0.2, 1, 1).rotateX(-Math.PI / 2).translate(0, 0.05, 2.15), bodyMaterial)
  const sides = [-1, 1].map((side) => new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.7, 3).scale(1, 1, 0.3).rotateZ(side * 1.9).translate(side * 0.6, -0.15, -0.2), bodyMaterial))
  const eyes = [-1, 1].map((side) => new THREE.Mesh(new THREE.OctahedronGeometry(0.07, 0).translate(side * 0.3, 0.1, -1.3), eyeMaterial))
  g.add(body, belly, dorsal, tail, ...sides, ...eyes)
  return g
}

interface Shown {
  object: THREE.Group
  angle: number
  lunge: number
}

/**
 * Los peces del mar: cada uno da vueltas alrededor de su presa con la aleta fuera del agua y, al morder (`fishBite`), se
 * lanza hasta ella. Sigue la lista de la simulación (en red, el espejo, por sus avisos).
 */
export class FishView {
  readonly group = new THREE.Group()
  private shown = new Map<PlayerId, Shown>()

  present(events: readonly SimEventData[]) {
    for (const e of events) if (e.type === 'fishBite') {
      const fish = this.shown.get(e.id)
      if (fish) fish.lunge = LUNGE_TIME
    }
  }

  /** Por frame. `positionOf`: dónde se ve ahora cada jugador (null si no se ve). */
  update(dt: number, fishes: readonly Fish[], positionOf: (id: PlayerId) => { x: number; z: number } | null) {
    const seen = new Set<PlayerId>()
    for (const { target } of fishes) {
      const at = positionOf(target)
      if (!at) continue
      seen.add(target)
      let fish = this.shown.get(target)
      if (!fish) {
        fish = { object: fishModel(), angle: Math.random() * Math.PI * 2, lunge: 0 }
        this.shown.set(target, fish)
        this.group.add(fish.object)
      }
      fish.angle += CIRCLE_SPEED * dt
      fish.lunge = Math.max(0, fish.lunge - dt)
      // De la vuelta hasta la presa y de vuelta, en lo que dura el mordisco.
      const k = fish.lunge > 0 ? Math.sin((1 - fish.lunge / LUNGE_TIME) * Math.PI) : 0
      const radius = CIRCLE_RADIUS * (1 - k * 0.8)
      const x = at.x + Math.cos(fish.angle) * radius
      const z = at.z + Math.sin(fish.angle) * radius
      fish.object.position.set(x, WATER_LEVEL - BODY_DEPTH + k * 0.3, z)
      // Nada tangente a la vuelta (forward = −Z) y, al morder, mira a la presa.
      const along = Math.atan2(-Math.sin(fish.angle), Math.cos(fish.angle)) + Math.PI
      const toward = Math.atan2(-(at.x - x), -(at.z - z))
      fish.object.rotation.set(0, k > 0 ? toward : along, Math.sin(fish.angle * 3) * 0.08)
    }
    for (const [id, fish] of this.shown) {
      if (seen.has(id)) continue
      this.group.remove(fish.object)
      this.shown.delete(id)
    }
  }

  /** Cuántos se ven (para las pruebas). */
  get count() {
    return this.shown.size
  }

  reset() {
    for (const fish of this.shown.values()) this.group.remove(fish.object)
    this.shown.clear()
  }
}
