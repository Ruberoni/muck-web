import * as THREE from 'three'
import { METEOR_BLAST, METEOR_RADIUS, STEP } from '../sim/constants'
import { heightAt } from '../sim/world/terrain'
import type { Meteor } from '../sim/worldEvents'

/** Metros por segundo a los que cae: del cielo y un poco de lado, para que se vea venir. */
const FALL = new THREE.Vector3(-24, -58, 30)
const HEAD_RADIUS = 2.4
const TRAIL_LENGTH = 48
const TRAIL_RADIUS = 2
/** Altura sobre el terreno del cráter y del aviso de dónde cae, para que no parpadeen con él. */
const DISC_LIFT = 0.06
const DISC_RINGS = 4
const DISC_SEGMENTS = 18
/** Radio de la mancha del cráter: algo más que la explosión. */
const SCORCH_RADIUS = METEOR_BLAST * 1.25
const WARNING_PULSE = 7
const BURST_TIME = 0.6
const COOL_TIME = 30
/** Cuánto asoma la roca: el resto queda enterrado. */
const ROCK_RISE = 0.45

const headGeometry = new THREE.IcosahedronGeometry(HEAD_RADIUS, 0)
// Sale de la cabeza hacia +Y y acaba en punta.
const trailGeometry = new THREE.ConeGeometry(TRAIL_RADIUS, TRAIL_LENGTH, 8).translate(0, TRAIL_LENGTH / 2, 0)
const ROCK_SIZE = METEOR_RADIUS * 1.15
const rockGeometry = new THREE.IcosahedronGeometry(ROCK_SIZE, 0)
// Algo girado dentro de la roca: sus puntas asoman por las caras, como grietas al rojo.
const coreGeometry = new THREE.IcosahedronGeometry(ROCK_SIZE * 0.98, 0).rotateX(0.6).rotateY(0.9)
const burstGeometry = new THREE.IcosahedronGeometry(1, 1)

// La estela no depende de la luz ni de la niebla: desde lejos se ve igual.
const headMaterial = new THREE.MeshBasicMaterial({ color: '#ffe9a8', fog: false })
const trailMaterial = new THREE.MeshBasicMaterial({ color: '#ff7a1f', transparent: true, opacity: 0.75, depthWrite: false, fog: false })
const scorchMaterial = new THREE.MeshStandardMaterial({ color: '#1c1714', vertexColors: true, transparent: true, depthWrite: false, flatShading: true })
const warningMaterial = new THREE.MeshBasicMaterial({ color: '#ff3b2f', vertexColors: true, transparent: true, depthWrite: false })
const rockMaterial = new THREE.MeshStandardMaterial({ color: '#4a403a', flatShading: true })
const coreMaterial = new THREE.MeshStandardMaterial({ color: '#4a403a', emissive: '#ff5a1f', flatShading: true })
const burstMaterial = new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, depthWrite: false })

/** Un disco sobre el terreno en (x, z), que se desvanece hacia el borde. */
function groundDisc(x: number, z: number, radius: number) {
  const positions: number[] = []
  const colors: number[] = []
  const index: number[] = []
  const vertex = (dx: number, dz: number, alpha: number) => {
    positions.push(x + dx, heightAt(x + dx, z + dz) + DISC_LIFT, z + dz)
    colors.push(1, 1, 1, alpha)
  }
  vertex(0, 0, 1)
  for (let ring = 1; ring <= DISC_RINGS; ring++) {
    for (let i = 0; i < DISC_SEGMENTS; i++) {
      const angle = (i / DISC_SEGMENTS) * Math.PI * 2
      const r = (ring / DISC_RINGS) * radius
      vertex(Math.cos(angle) * r, Math.sin(angle) * r, ring === DISC_RINGS ? 0 : 1 - (ring / DISC_RINGS) ** 2)
    }
  }
  const at = (ring: number, i: number) => (ring === 0 ? 0 : 1 + (ring - 1) * DISC_SEGMENTS + (i % DISC_SEGMENTS))
  for (let ring = 0; ring < DISC_RINGS; ring++) {
    for (let i = 0; i < DISC_SEGMENTS; i++) {
      index.push(at(ring, i), at(ring + 1, i + 1), at(ring + 1, i))
      if (ring > 0) index.push(at(ring, i), at(ring, i + 1), at(ring + 1, i + 1))
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4))
  geometry.setIndex(index)
  geometry.computeVertexNormals()
  return geometry
}

/**
 * El meteorito dibujado: una bola con estela que baja del cielo y un aviso en el suelo; al caer, un destello, el cráter
 * y la roca, que brilla hasta enfriarse. Sigue al que haya en cada frame. Lo que se ve lo decide el `tick` de render,
 * no `landed`: en red, el evento llega antes de que el render llegue a él.
 */
export class MeteorView {
  readonly group = new THREE.Group()
  private fireball = new THREE.Group()
  private rock = new THREE.Mesh(rockGeometry, rockMaterial)
  private burst = new THREE.Mesh(burstGeometry, burstMaterial)
  private scorch: THREE.Mesh | null = null
  private warning: THREE.Mesh | null = null
  /** El que está dibujado: un `landTick` distinto es otro meteorito. */
  private shown: number | null = null
  private landed = false
  /** 1 recién caído y 0 frío. */
  private heat = 1
  private bursting = 0
  private time = 0

  constructor() {
    this.fireball.add(new THREE.Mesh(headGeometry, headMaterial), new THREE.Mesh(trailGeometry, trailMaterial))
    // +Y (hacia donde sale la estela) mirando de donde viene.
    this.fireball.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), FALL.clone().negate().normalize())
    this.rock.castShadow = true
    this.rock.receiveShadow = true
    this.rock.add(new THREE.Mesh(coreGeometry, coreMaterial))
    this.group.add(this.fireball, this.rock, this.burst)
    this.hide()
  }

  /** Por frame. `tick`: el de render. */
  update(dt: number, meteor: Meteor | null, tick: number) {
    this.time += dt
    if ((meteor?.landTick ?? null) !== this.shown) this.show(meteor, tick)
    if (meteor) {
      const left = (meteor.landTick - tick) * STEP
      if (left <= 0 && !this.landed) this.land()
      if (this.landed) this.heat = meteor.coolDay === null ? 1 : Math.max(0, this.heat - dt / COOL_TIME)
      else this.falling(meteor, left)
      coreMaterial.emissiveIntensity = this.heat
    }
    if (this.bursting > 0) {
      this.bursting = Math.max(0, this.bursting - dt)
      const k = 1 - this.bursting / BURST_TIME
      this.burst.visible = this.bursting > 0
      this.burst.scale.setScalar(1 + k * METEOR_BLAST * 1.5)
      burstMaterial.opacity = 1 - k
    }
    this.group.updateMatrixWorld()
  }

  /** Reinicio de partida: nada a la vista. */
  reset() {
    this.show(null, 0)
  }

  private show(meteor: Meteor | null, tick: number) {
    this.hide()
    this.shown = meteor?.landTick ?? null
    if (!meteor) return
    const { x, y, z } = meteor
    this.rock.position.set(x, y + METEOR_RADIUS * ROCK_RISE, z)
    this.burst.position.set(x, y + 1, z)
    this.scorch = new THREE.Mesh(groundDisc(x, z, SCORCH_RADIUS), scorchMaterial)
    this.scorch.receiveShadow = true
    this.warning = new THREE.Mesh(this.scorch.geometry, warningMaterial)
    this.group.add(this.scorch, this.warning)
    // Quien entra a mitad lo ve como está, sin el destello de caer.
    this.landed = tick >= meteor.landTick
    this.heat = meteor.coolDay === null ? 1 : 0
    this.setLanded(this.landed)
  }

  private hide() {
    this.fireball.visible = this.rock.visible = this.burst.visible = false
    this.bursting = 0
    for (const mesh of [this.scorch, this.warning]) if (mesh) this.group.remove(mesh)
    this.scorch?.geometry.dispose()
    this.scorch = this.warning = null
  }

  private falling({ x, y, z }: Meteor, left: number) {
    this.fireball.position.set(x - FALL.x * left, y - FALL.y * left, z - FALL.z * left)
    warningMaterial.opacity = 0.3 + 0.2 * Math.sin(this.time * WARNING_PULSE)
  }

  private land() {
    this.landed = true
    this.bursting = BURST_TIME
    this.setLanded(true)
  }

  private setLanded(landed: boolean) {
    this.fireball.visible = !landed
    this.warning!.visible = !landed
    this.rock.visible = this.scorch!.visible = landed
  }
}
