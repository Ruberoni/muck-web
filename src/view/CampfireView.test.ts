import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { Campfires } from '../sim/campfires'
import { CAMPFIRE_LIGHTS } from '../sim/constants'
import { CampfireView } from './CampfireView'

const lightsOf = (scene: THREE.Scene) => scene.children.filter((c): c is THREE.PointLight => c instanceof THREE.PointLight)

function setup() {
  const scene = new THREE.Scene()
  const fires = new Campfires()
  const view = new CampfireView(scene)
  const update = (phase = 0.8, viewer = { x: 0, z: 0 }) => view.update(0, phase, viewer, fires.list)
  return { scene, fires, view, update }
}

describe('CampfireView', () => {
  it('dibuja cada fogata con su posición y su giro, y las quita al reiniciar', () => {
    const { fires, view, update } = setup()
    fires.place({ x: 0, y: 5, z: 0, valid: true })
    fires.place({ x: 5, y: 5, z: 0, valid: true })
    update()
    expect(view.group.children).toHaveLength(2)
    const model = view.modelOf(1)!
    expect(model.root.rotation.y).toBe(fires.list[1].rotY)
    expect(model.root.position.x).toBe(5)

    fires.clear()
    view.reset()
    expect(view.group.children).toHaveLength(0)
    fires.place({ x: 2, y: 5, z: 0, valid: true })
    update()
    expect(view.group.children).toHaveLength(1)
    expect(view.modelOf(0)!.root.position.x).toBe(2)
  })

  it('una fogata que sale de la lista deja de dibujarse', () => {
    const { fires, view, update } = setup()
    fires.place({ x: 0, y: 5, z: 0, valid: true })
    update()
    fires.clear()
    update()
    expect(view.group.children).toHaveLength(0)
  })

  it('el número de luces es fijo e iluminan las fogatas más cercanas', () => {
    const { scene, fires, update } = setup()
    const lights = lightsOf(scene)
    expect(lights).toHaveLength(CAMPFIRE_LIGHTS)
    update()
    expect(lights.every((l) => l.intensity === 0)).toBe(true)

    for (let i = 0; i <= CAMPFIRE_LIGHTS; i++) fires.place({ x: 10 + i * 3, y: 5, z: 10, valid: true })
    update(0.8, { x: 10, z: 10 })
    expect(lightsOf(scene)).toHaveLength(CAMPFIRE_LIGHTS)
    expect(lights.every((l) => l.intensity > 0)).toBe(true)
    // La más lejana se queda sin luz.
    const farthest = 10 + CAMPFIRE_LIGHTS * 3
    expect(lights.some((l) => l.position.x === farthest)).toBe(false)
  })

  it('de noche ilumina bastante más que a mediodía', () => {
    const { scene, fires, update } = setup()
    const [light] = lightsOf(scene)
    fires.place({ x: 0, y: 5, z: 0, valid: true })
    update(0.325)
    const noon = light.intensity
    update(0.825)
    const midnight = light.intensity
    expect(midnight).toBeGreaterThan(noon * 3)
  })

  it('reset apaga las luces y oculta la vista previa', () => {
    const { scene, fires, view, update } = setup()
    fires.place({ x: 0, y: 5, z: 0, valid: true })
    view.setGhost({ x: 0, y: 5, z: 3, valid: true })
    update()
    view.reset()
    expect(lightsOf(scene).every((l) => l.intensity === 0)).toBe(true)
    expect(scene.children.some((c) => c !== view.group && c.type === 'Group' && c.visible)).toBe(false)
  })
})
