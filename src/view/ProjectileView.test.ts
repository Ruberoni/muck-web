import { describe, expect, it } from 'vitest'
import { Projectiles } from '../sim/projectiles'
import { ProjectileView } from './ProjectileView'

describe('ProjectileView', () => {
  const setup = () => {
    const projectiles = new Projectiles()
    const view = new ProjectileView()
    const p = projectiles.launch(0, 'rock', { x: 1, y: 40, z: 3 }, { x: 6, y: 0, z: 0 }, 1)
    return { projectiles, view, p }
  }

  it('crea un modelo por proyectil, interpolado entre pasos, y lo quita al acabar', () => {
    const { projectiles, view, p } = setup()
    projectiles.step(1, [])
    projectiles.step(2, [])
    view.update(0.016, projectiles.list, 0.5)
    expect(view.group.children).toHaveLength(1)
    expect(view.group.children[0].position.x).toBeCloseTo((p.prev.x + p.pos.x) / 2)
    projectiles.remove(p.id)
    view.update(0.016, projectiles.list, 1)
    expect(view.group.children).toHaveLength(0)
  })

  it('reiniciar no deja nada', () => {
    const { projectiles, view } = setup()
    view.update(0.016, projectiles.list, 1)
    view.reset()
    expect(view.group.children).toHaveLength(0)
  })
})
