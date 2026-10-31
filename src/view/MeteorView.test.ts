import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { METEOR_RADIUS, STEP } from '../sim/constants'
import { heightAt } from '../sim/world/terrain'
import type { Meteor } from '../sim/worldEvents'
import { MeteorView } from './MeteorView'

const LAND_TICK = 1000
const COOLED = 2

describe('MeteorView', () => {
  const setup = () => {
    const view = new MeteorView()
    const [fireball, rock, burst] = view.group.children as [THREE.Group, THREE.Mesh, THREE.Mesh]
    const meteor: Meteor = { x: 7, y: heightAt(7, -5), z: -5, radius: METEOR_RADIUS, alive: true, landTick: LAND_TICK, landed: false, coolDay: null }
    const heat = () => ((rock.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity
    // Los discos del suelo: el aviso (rojo) y el cráter comparten forma.
    const disc = (color: string) =>
      view.group.children.find((c) => c instanceof THREE.Mesh && c.material instanceof THREE.Material && (c.material as THREE.MeshBasicMaterial).color?.getStyle() === color && c !== rock && c !== burst) as THREE.Mesh
    return { view, fireball, rock, burst, meteor, heat, disc }
  }
  const WARNING_COLOR = new THREE.Color('#ff3b2f').getStyle()
  const SCORCH_COLOR = new THREE.Color('#1c1714').getStyle()

  it('cayendo se ve la bola bajando hacia donde cae, y el aviso en el suelo; aún no la roca', () => {
    const { view, fireball, rock, meteor, disc } = setup()
    view.update(0.016, meteor, LAND_TICK - 360)
    expect(fireball.visible).toBe(true)
    expect(rock.visible).toBe(false)
    expect(disc(WARNING_COLOR).visible).toBe(true)
    expect(disc(SCORCH_COLOR).visible).toBe(false)
    const high = fireball.position.y
    expect(high).toBeGreaterThan(meteor.y + 300)
    view.update(0.016, meteor, LAND_TICK - 1)
    expect(fireball.position.y).toBeLessThan(meteor.y + 2)
    expect(Math.hypot(fireball.position.x - meteor.x, fireball.position.z - meteor.z)).toBeLessThan(1)
  })

  it('al llegar su tick salen el destello, el cráter y la roca, aunque el evento llegara antes', () => {
    const { view, fireball, rock, burst, meteor, disc } = setup()
    meteor.landed = true
    view.update(0.016, meteor, LAND_TICK - 30)
    expect(fireball.visible).toBe(true)
    view.update(0.016, meteor, LAND_TICK)
    expect(fireball.visible).toBe(false)
    expect(rock.visible).toBe(true)
    expect(rock.position.x).toBe(meteor.x)
    expect(burst.visible).toBe(true)
    expect(disc(WARNING_COLOR).visible).toBe(false)
    expect(disc(SCORCH_COLOR).visible).toBe(true)
    view.update(1, meteor, LAND_TICK + 60)
    expect(burst.visible).toBe(false)
  })

  it('el cráter sigue el terreno', () => {
    const { view, meteor, disc } = setup()
    view.update(0.016, meteor, LAND_TICK)
    const position = disc(SCORCH_COLOR).geometry.getAttribute('position')
    expect(position.count).toBeGreaterThan(30)
    for (let i = 0; i < position.count; i += 7) expect(position.getY(i)).toBeCloseTo(heightAt(position.getX(i), position.getZ(i)) + 0.06, 5)
  })

  it('sigue brillando mientras esté caliente y luego se apaga poco a poco', () => {
    const { view, meteor, heat } = setup()
    view.update(STEP, meteor, LAND_TICK)
    view.update(60, meteor, LAND_TICK + 1)
    expect(heat()).toBe(1)
    meteor.coolDay = COOLED
    view.update(10, meteor, LAND_TICK + 2)
    expect(heat()).toBeGreaterThan(0.5)
    expect(heat()).toBeLessThan(1)
    view.update(60, meteor, LAND_TICK + 3)
    expect(heat()).toBe(0)
  })

  it('quien llega con la roca en el suelo la ve como está, sin destello', () => {
    const { view, rock, burst, meteor, heat } = setup()
    Object.assign(meteor, { landed: true, coolDay: COOLED })
    view.update(0.016, meteor, LAND_TICK + 5000)
    expect(rock.visible).toBe(true)
    expect(burst.visible).toBe(false)
    expect(heat()).toBe(0)
  })

  it('al desaparecer no queda nada, y el siguiente es otro', () => {
    const { view, fireball, rock, meteor } = setup()
    view.update(0.016, meteor, LAND_TICK)
    const shapes = view.group.children.length
    view.update(0.016, null, LAND_TICK + 1)
    expect(rock.visible).toBe(false)
    expect(view.group.children).toHaveLength(3)
    view.update(0.016, { ...meteor, landTick: 9000 }, 8000)
    expect(fireball.visible).toBe(true)
    expect(rock.visible).toBe(false)
    expect(view.group.children).toHaveLength(shapes)
  })

  it('reiniciar no deja nada', () => {
    const { view, fireball, meteor } = setup()
    view.update(0.016, meteor, LAND_TICK - 10)
    view.reset()
    expect(fireball.visible).toBe(false)
    expect(view.group.children).toHaveLength(3)
  })
})
