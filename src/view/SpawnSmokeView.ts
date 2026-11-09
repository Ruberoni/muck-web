import * as THREE from 'three'
import { SPAWN_WARN } from '../sim/constants'
import { DEFAULT_ISLAND, type Island } from '../sim/world/island'
import { enemyFloor } from '../sim/world/terrain'

/** Bolas de humo por columna: suben, crecen y se deshacen. */
const PUFFS = 9
/** Lo que dura la columna: el aviso y un poco después de salir el mob. */
const SMOKE_TIME = SPAWN_WARN + 1.4
/** Altura a la que llega la columna: alta, para verse por encima de los árboles y de la niebla. */
const RISE = 7
const PUFF_RADIUS = 0.55
const PUFF_GROW = 2.6

const puffGeometry = new THREE.IcosahedronGeometry(1, 1)

interface Column {
  group: THREE.Group
  puffs: THREE.Mesh[]
  material: THREE.MeshBasicMaterial
  age: number
}

/**
 * El humo de las apariciones: una columna oscura donde va a salir un mob (`enemyIncoming`), o donde sale un jefe. No
 * depende de la luz ni de la niebla, para que se vea venir también en la Noche Eterna. Solo vista: no tiene colisión.
 */
export class SpawnSmokeView {
  readonly group = new THREE.Group()
  island: Island = DEFAULT_ISLAND
  private columns: Column[] = []

  /** Una columna nueva en (x, z). */
  puff(x: number, z: number) {
    const material = new THREE.MeshBasicMaterial({ color: '#3b3640', transparent: true, opacity: 0.85, depthWrite: false, fog: false })
    const group = new THREE.Group()
    group.position.set(x, enemyFloor(this.island, x, z), z)
    const puffs: THREE.Mesh[] = []
    for (let i = 0; i < PUFFS; i++) {
      const mesh = new THREE.Mesh(puffGeometry, material)
      // Cada bola sale un poco después de la anterior y algo desplazada, para que no parezca un cilindro.
      mesh.userData.delay = (i / PUFFS) * SPAWN_WARN
      mesh.userData.dx = Math.sin(i * 2.4) * 0.5
      mesh.userData.dz = Math.cos(i * 2.4) * 0.5
      mesh.visible = false
      group.add(mesh)
      puffs.push(mesh)
    }
    this.group.add(group)
    this.columns.push({ group, puffs, material, age: 0 })
  }

  /** Por frame. */
  update(dt: number) {
    for (const column of [...this.columns]) {
      column.age += dt
      if (column.age >= SMOKE_TIME) {
        this.remove(column)
        continue
      }
      // Se va aclarando al final.
      column.material.opacity = 0.85 * Math.min(1, (SMOKE_TIME - column.age) / 0.8)
      for (const mesh of column.puffs) {
        const t = (column.age - mesh.userData.delay) / (SMOKE_TIME - mesh.userData.delay)
        mesh.visible = t > 0
        if (t <= 0) continue
        const s = PUFF_RADIUS * (1 + PUFF_GROW * t)
        mesh.scale.setScalar(s)
        mesh.position.set(mesh.userData.dx * (1 + t), RISE * Math.sqrt(t), mesh.userData.dz * (1 + t))
      }
    }
  }

  /** Al cambiar de partida o de isla. */
  reset() {
    for (const column of [...this.columns]) this.remove(column)
  }

  private remove(column: Column) {
    this.group.remove(column.group)
    column.material.dispose()
    this.columns.splice(this.columns.indexOf(column), 1)
  }
}
