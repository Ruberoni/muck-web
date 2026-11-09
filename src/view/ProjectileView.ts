import * as THREE from 'three'
import { PROJECTILE_DEFS, type Projectile, type ProjectileKind } from '../sim/projectiles'

const SPIN = 7

const geometries: Record<ProjectileKind, THREE.BufferGeometry> = {
  rock: new THREE.IcosahedronGeometry(PROJECTILE_DEFS.rock.radius, 0),
  boulder: new THREE.IcosahedronGeometry(PROJECTILE_DEFS.boulder.radius, 0),
  // Un trasgo hecho una bola, dando vueltas.
  goblin: new THREE.IcosahedronGeometry(PROJECTILE_DEFS.goblin.radius, 0).scale(1, 1.2, 0.9),
}
// Un poco de emisivo para que se vea venir de noche.
const materials: Record<ProjectileKind, THREE.Material> = {
  rock: new THREE.MeshStandardMaterial({ color: '#8a877c', emissive: '#3a3226', flatShading: true }),
  boulder: new THREE.MeshStandardMaterial({ color: '#6f6a5e', emissive: '#4a2410', flatShading: true }),
  goblin: new THREE.MeshStandardMaterial({ color: '#9558bd', emissive: '#2b1240', flatShading: true }),
}

/** Lo que vuela. Sigue la lista de la simulación en cada frame: crea el modelo de los nuevos y quita los que ya no están. */
export class ProjectileView {
  readonly group = new THREE.Group()
  private models = new Map<number, THREE.Mesh>()
  private seen = new Set<number>()

  /** Por frame: coloca cada uno entre el paso anterior y el actual (alpha = 1: posición simulada). */
  update(dt: number, list: readonly Projectile[], alpha: number) {
    this.seen.clear()
    for (const p of list) {
      this.seen.add(p.id)
      let mesh = this.models.get(p.id)
      if (!mesh) {
        mesh = new THREE.Mesh(geometries[p.kind], materials[p.kind])
        mesh.castShadow = true
        this.models.set(p.id, mesh)
        this.group.add(mesh)
      }
      mesh.position.set(p.prev.x + (p.pos.x - p.prev.x) * alpha, p.prev.y + (p.pos.y - p.prev.y) * alpha, p.prev.z + (p.pos.z - p.prev.z) * alpha)
      mesh.rotation.x += dt * SPIN
      mesh.rotation.z += dt * SPIN * 0.6
    }
    for (const [id, mesh] of this.models) {
      if (this.seen.has(id)) continue
      this.models.delete(id)
      this.group.remove(mesh)
    }
    this.group.updateMatrixWorld()
  }

  /** Reinicio de partida: sin nada en el aire. */
  reset() {
    this.group.clear()
    this.models.clear()
  }
}
