import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { STRUCTURE_DEFS, Structures, type StructureSpot } from '../sim/structures'
import { CAMPFIRE_LIGHTS } from '../sim/constants'
import { outlineMaterial, StructureView } from './StructureView'

const lightsOf = (scene: THREE.Scene) => scene.children.filter((c): c is THREE.PointLight => c instanceof THREE.PointLight)
/** Los contornos puestos en un modelo: las copias infladas, hijas cada una de la pieza que contornean. */
const hullsOf = (root: THREE.Object3D) => {
  const hulls: THREE.Mesh[] = []
  root.traverse((node) => {
    if (node instanceof THREE.Mesh && node.material === outlineMaterial) hulls.push(node)
  })
  return hulls
}

function setup() {
  const scene = new THREE.Scene()
  const fires = new Structures()
  const view = new StructureView(scene)
  // Las fogatas se colocan apagadas: estas ya tienen leña, salvo que se diga lo contrario.
  const place = (spot: StructureSpot, lit = true) => {
    const fire = fires.place(spot, 'campfire')!
    if (lit) fire.station!.fuel = { item: 'wood', amount: 1 }
    return fire
  }
  const update = (phase = 0.8, viewer = { x: 0, z: 0 }) => view.update(0, phase, viewer, fires.list)
  return { scene, fires, view, update, place }
}

describe('StructureView', () => {
  it('dibuja cada fogata con su posición y su giro, y las quita al reiniciar', () => {
    const { fires, view, update, place } = setup()
    place({ x: 0, y: 5, z: 0, valid: true })
    place({ x: 5, y: 5, z: 0, valid: true })
    update()
    expect(view.group.children).toHaveLength(2)
    const model = view.modelOf(1)!
    expect(model.root.rotation.y).toBe(fires.list[1].rotY)
    expect(model.root.position.x).toBe(5)

    fires.clear()
    view.reset()
    expect(view.group.children).toHaveLength(0)
    place({ x: 2, y: 5, z: 0, valid: true })
    update()
    expect(view.group.children).toHaveLength(1)
    expect(view.modelOf(0)!.root.position.x).toBe(2)
  })

  it('una fogata que sale de la lista deja de dibujarse', () => {
    const { fires, view, update, place } = setup()
    place({ x: 0, y: 5, z: 0, valid: true })
    update()
    fires.clear()
    update()
    expect(view.group.children).toHaveLength(0)
  })

  it('el número de luces es fijo e iluminan las fogatas más cercanas', () => {
    const { scene, place, update } = setup()
    const lights = lightsOf(scene)
    expect(lights).toHaveLength(CAMPFIRE_LIGHTS)
    update()
    expect(lights.every((l) => l.intensity === 0)).toBe(true)

    for (let i = 0; i <= CAMPFIRE_LIGHTS; i++) place({ x: 10 + i * 3, y: 5, z: 10, valid: true })
    update(0.8, { x: 10, z: 10 })
    expect(lightsOf(scene)).toHaveLength(CAMPFIRE_LIGHTS)
    expect(lights.every((l) => l.intensity > 0)).toBe(true)
    // La más lejana se queda sin luz.
    const farthest = 10 + CAMPFIRE_LIGHTS * 3
    expect(lights.some((l) => l.position.x === farthest)).toBe(false)
  })

  it('una fogata apagada no da luz ni enseña la llama, y la luz se va a la encendida aunque esté más lejos', () => {
    const { scene, view, place, update } = setup()
    const [light] = lightsOf(scene)
    const out = place({ x: 0, y: 5, z: 0, valid: true }, false)
    update()
    expect(lightsOf(scene).every((l) => l.intensity === 0)).toBe(true)
    expect(view.modelOf(out.id)!.flame!.visible).toBe(false)
    const lit = place({ x: 8, y: 5, z: 0, valid: true })
    update()
    expect(light.intensity).toBeGreaterThan(0)
    expect(light.position.x).toBe(8)
    expect(view.modelOf(lit.id)!.flame!.visible).toBe(true)
    out.station!.burn = 30
    update()
    expect(view.modelOf(out.id)!.flame!.visible).toBe(true)
  })

  it('de noche ilumina bastante más que a mediodía', () => {
    const { scene, place, update } = setup()
    const [light] = lightsOf(scene)
    place({ x: 0, y: 5, z: 0, valid: true })
    update(0.325)
    const noon = light.intensity
    update(0.825)
    const midnight = light.intensity
    expect(midnight).toBeGreaterThan(noon * 3)
  })

  it('reset apaga las luces y oculta la vista previa', () => {
    const { scene, place, view, update } = setup()
    place({ x: 0, y: 5, z: 0, valid: true })
    view.setGhost({ kind: 'campfire', spot: { x: 0, y: 5, z: 3, valid: true }, yaw: 0 })
    update()
    view.reset()
    expect(lightsOf(scene).every((l) => l.intensity === 0)).toBe(true)
    expect(scene.children.some((c) => c !== view.group && c.type === 'Group' && c.visible)).toBe(false)
  })

  it('la vista previa sigue al sitio y cambia de color; null la oculta', () => {
    const { scene, view } = setup()
    const ghosts = () => scene.children.filter((c) => c !== view.group && c.type === 'Group')
    view.setGhost({ kind: 'campfire', spot: { x: 1, y: 5, z: 3, valid: true }, yaw: 1 })
    expect(ghosts()).toHaveLength(1)
    const [ghost] = ghosts()
    const color = () => ((ghost.children.find((c) => c instanceof THREE.Mesh) as THREE.Mesh).material as THREE.MeshBasicMaterial).color.getHexString()
    expect(ghost.visible).toBe(true)
    expect(ghost.position.x).toBe(1)
    expect(color()).toBe('7dff8a')
    view.setGhost({ kind: 'campfire', spot: { x: 2, y: 5, z: 3, valid: false }, yaw: 1 })
    expect(ghosts()).toHaveLength(1)
    expect(ghost.position.x).toBe(2)
    expect(color()).toBe('ff5a4f')
    // La fogata, redonda, no gira; la mesa sale girada como quedará al colocarla.
    expect(ghost.rotation.y).toBe(0)
    view.setGhost({ kind: 'workbench', spot: { x: 2, y: 5, z: 3, valid: true }, yaw: 1 })
    expect(ghost.visible).toBe(false)
    const bench = ghosts().find((g) => g.visible)!
    expect(bench.rotation.y).toBe(1)
    view.setGhost(null)
    expect(ghosts().some((g) => g.visible)).toBe(false)
  })

  it('el horno y el yunque: cada uno con su modelo y su giro; el fuego del horno parpadea pero no da luz', () => {
    const { scene, fires, view, update } = setup()
    fires.place({ x: 0, y: 5, z: 0, valid: true }, 'furnace', 0, 0.7)
    fires.place({ x: 4, y: 5, z: 0, valid: true }, 'anvil', 0, -0.3)
    update(0.825, { x: 0, z: 0 })
    expect(view.group.children).toHaveLength(2)
    const furnace = view.modelOf(0)!
    expect(furnace.root.rotation.y).toBe(0.7)
    expect(furnace.flame).not.toBeNull()
    expect(furnace.flame!.scale.y).not.toBe(1)
    const anvil = view.modelOf(1)!
    expect(anvil.root.rotation.y).toBe(-0.3)
    expect(anvil.flame).toBeNull()
    expect(lightsOf(scene).every((l) => l.intensity === 0)).toBe(true)
    // Cada modelo, fuego incluido, cabe en el círculo de colisión de su estructura (en horizontal, todos los vértices).
    // El contorno no cuenta: asoma a propósito por fuera de la silueta, y no es sólido.
    for (const [id, kind] of [[0, 'furnace'], [1, 'anvil']] as const) {
      const root = view.modelOf(id)!.root
      root.updateMatrixWorld(true)
      let farthest = 0
      const v = new THREE.Vector3()
      root.traverse((node) => {
        if (!(node instanceof THREE.Mesh) || node.material === outlineMaterial) return
        const position = node.geometry.getAttribute('position')
        for (let i = 0; i < position.count; i++) {
          v.fromBufferAttribute(position, i).applyMatrix4(node.matrixWorld)
          farthest = Math.max(farthest, Math.hypot(v.x - root.position.x, v.z - root.position.z))
        }
      })
      expect(farthest, kind).toBeLessThanOrEqual(STRUCTURE_DEFS[kind].radius)
    }
  })

  it('un id que vuelve en otro sitio (otra partida sin reset de la vista) se dibuja de nuevo', () => {
    const { fires, view, update, place } = setup()
    place({ x: 0, y: 5, z: 0, valid: true })
    update()
    fires.clear()
    place({ x: 7, y: 5, z: 0, valid: true })
    update()
    expect(view.group.children).toHaveLength(1)
    expect(view.modelOf(0)!.root.position.x).toBe(7)
  })

  it('el contorno va en la estructura que se le da, en cada pieza sólida, y se quita con null', () => {
    const { fires, view, update } = setup()
    fires.place({ x: 0, y: 5, z: 0, valid: true }, 'campfire')
    fires.place({ x: 4, y: 5, z: 0, valid: true }, 'campfire')
    update()
    expect(hullsOf(view.modelOf(0)!.root)).toHaveLength(0)
    view.setOutline(fires.list[0])
    // 7 piedras + 4 troncos + 2 llamas.
    expect(hullsOf(view.modelOf(0)!.root)).toHaveLength(13)
    expect(hullsOf(view.modelOf(1)!.root)).toHaveLength(0)
    // Pasar a otra los mueve, y null los quita.
    view.setOutline(fires.list[1])
    expect(hullsOf(view.modelOf(0)!.root)).toHaveLength(0)
    expect(hullsOf(view.modelOf(1)!.root)).toHaveLength(13)
    view.setOutline(null)
    expect(hullsOf(view.modelOf(1)!.root)).toHaveLength(0)
  })

  it('el contorno es una copia inflada dibujada del revés: solo asoma la línea de la silueta', () => {
    const { fires, view, update } = setup()
    fires.place({ x: 0, y: 5, z: 0, valid: true }, 'campfire')
    update()
    view.setOutline(fires.list[0])
    const hulls = hullsOf(view.modelOf(0)!.root)
    const material = hulls[0].material as THREE.MeshBasicMaterial
    expect(material.side).toBe(THREE.BackSide)
    expect(material.transparent).toBe(true)
    expect(material.depthWrite).toBe(false)
    const radius = (geometry: THREE.BufferGeometry) => (geometry.computeBoundingSphere(), geometry.boundingSphere!.radius)
    for (const hull of hulls) {
      const piece = hull.parent as THREE.Mesh
      // La pieza sigue con su geometría: la inflada es otra, algo más grande, y no proyecta sombra.
      expect(piece.material).not.toBe(outlineMaterial)
      expect(hull.geometry).not.toBe(piece.geometry)
      expect(radius(hull.geometry)).toBeGreaterThan(radius(piece.geometry))
      expect(hull.castShadow).toBe(false)
      expect(hull.receiveShadow).toBe(false)
    }
  })

  it('lo transparente no se contornea y lo que aún no está construido, tampoco', () => {
    const { fires, view, update } = setup()
    fires.place({ x: 0, y: 5, z: 0, valid: true }, 'grave')
    fires.place({ x: 8, y: 5, z: 0, valid: true }, 'lighthouse')
    update()
    // La columna de luz de la tumba es transparente: se queda sin contorno; la lápida y la losa, no.
    view.setOutline(fires.list[0])
    const grave = view.modelOf(0)!
    expect(hullsOf(grave.beam!)).toHaveLength(0)
    expect(hullsOf(grave.root)).toHaveLength(2)
    // Sin ninguna fase entregada la torre del faro está oculta, y su contorno va con ella: tampoco se ve.
    view.setOutline(fires.list[1])
    const lighthouse = view.modelOf(1)!
    const tower = lighthouse.stages![1]
    expect(tower.visible).toBe(false)
    // La torre, las dos franjas y la galería.
    expect(hullsOf(tower)).toHaveLength(4)
    // Cada contorno es hijo de la pieza que contornea: si la pieza (o su fase) no se ve, el contorno tampoco.
    expect(hullsOf(lighthouse.root).every((hull) => (hull.parent as THREE.Mesh).isMesh)).toBe(true)
  })

  it('el contorno se va con la estructura que desaparece y con el reset', () => {
    const { fires, view, update } = setup()
    fires.place({ x: 0, y: 5, z: 0, valid: true }, 'campfire')
    update()
    view.setOutline(fires.list[0])
    expect(hullsOf(view.modelOf(0)!.root)).toHaveLength(13)
    fires.clear()
    update()
    // Al volver a colocar otra fogata con el mismo id, su modelo es nuevo y no hereda el contorno.
    fires.place({ x: 3, y: 5, z: 0, valid: true }, 'campfire')
    update()
    expect(hullsOf(view.modelOf(0)!.root)).toHaveLength(0)
    view.setOutline(fires.list[0])
    expect(hullsOf(view.modelOf(0)!.root)).toHaveLength(13)
    view.reset()
    expect(view.group.children).toHaveLength(0)
  })
})
