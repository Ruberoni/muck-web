import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { STEP } from '../sim/constants'
import { Projectiles } from '../sim/projectiles'
import { mulberry32 } from '../sim/random'
import { AttackFxView, GIANT_BLUE } from './AttackFxView'

/** Avanza la vista `seconds` en frames de 16 ms con la lista de proyectiles de ahora. */
const play = (view: AttackFxView, seconds: number, projectiles: Projectiles = new Projectiles()) => {
  for (let t = 0; t < seconds; t += 0.016) view.update(0.016, projectiles.list, 1)
}

describe('AttackFxView', () => {
  it('el golpe al suelo levanta viento, polvo y piedritas, y se recoge todo al acabar', () => {
    const view = new AttackFxView(mulberry32(1))
    view.smash(0, 0, { x: -2, z: 0 })
    expect(view.live).toBeGreaterThan(10)
    expect(view.group.children).toHaveLength(view.live)
    play(view, 0.1)
    expect(view.live).toBeGreaterThan(0)
    play(view, 2)
    expect(view.live).toBe(0)
    expect(view.group.children).toHaveLength(0)
  })

  it('sin quien golpea no sale el tajo, solo el viento de alrededor', () => {
    const withSwing = new AttackFxView(mulberry32(1))
    const without = new AttackFxView(mulberry32(1))
    withSwing.smash(0, 0, { x: -2, z: 0 })
    without.smash(0, 0)
    expect(without.live).toBe(withSwing.live - 1)
  })

  it('reutiliza las piezas: un segundo golpe no crea otras nuevas', () => {
    const view = new AttackFxView(mulberry32(1))
    view.smash(0, 0)
    const first = new Set(view.group.children)
    play(view, 2)
    view.smash(5, 5)
    expect(view.group.children.every((mesh) => first.has(mesh))).toBe(true)
  })

  it('la roca lleva estela y deja aros por el camino; al caer, polvo, y después nada', () => {
    const projectiles = new Projectiles()
    const view = new AttackFxView(mulberry32(1))
    const p = projectiles.launch(0, 'rock', { x: 0, y: 30, z: 0 }, { x: 30, y: 0, z: 0 }, 1)
    view.update(0.016, projectiles.list, 1)
    // El pincho de salida, el estampido y la estela (dos conos).
    expect(view.live).toBe(4)
    for (let tick = 1; tick <= 30; tick++) {
      projectiles.step(tick, [])
      view.update(STEP, projectiles.list, 1)
    }
    // Medio segundo a 30 m/s: unos 15 m, un aro cada 1,5 m (los primeros ya se han apagado).
    expect(view.live).toBeGreaterThan(6)
    projectiles.remove(p.id)
    view.update(0.016, projectiles.list, 1)
    const landed = view.live
    play(view, 2, projectiles)
    expect(landed).toBeGreaterThan(0)
    expect(view.live).toBe(0)
  })

  it('las lanzas del trasgo no llevan estela', () => {
    const projectiles = new Projectiles()
    const view = new AttackFxView(mulberry32(1))
    projectiles.launch(0, 'spear', { x: 0, y: 30, z: 0 }, { x: 16, y: 0, z: 0 }, 1)
    view.update(0.016, projectiles.list, 1)
    expect(view.live).toBe(0)
  })

  it('la flecha del gigante sale con un destello, lleva estela azul con la punta encendida y suelta chispas', () => {
    const projectiles = new Projectiles()
    const view = new AttackFxView(mulberry32(1))
    const p = projectiles.launch(0, 'arrow', { x: 0, y: 30, z: 0 }, { x: 30, y: 0, z: 0 }, 1)
    view.update(0.016, projectiles.list, 1)
    const blue = (mesh: THREE.Object3D) => ((mesh as THREE.Mesh).material as THREE.MeshBasicMaterial).color.getHexString() === GIANT_BLUE.slice(1)
    expect(view.group.children.some(blue)).toBe(true)
    const launched = view.live
    for (let tick = 1; tick <= 20; tick++) {
      projectiles.step(tick, [])
      view.update(STEP, projectiles.list, 1)
    }
    // Una chispa cada 0,45 m de camino: muchas más piezas que al salir.
    expect(view.live).toBeGreaterThan(launched)
    projectiles.remove(p.id)
    play(view, 2, projectiles)
    expect(view.live).toBe(0)
  })

  it('el pisotón abre grietas, y la onda suelta polvo mientras avanza hasta su radio', () => {
    const view = new AttackFxView(mulberry32(1))
    view.stomp(0, 0, 7, 12)
    const first = view.live
    // Siete grietas, cada una dos veces (halo y centro).
    expect(first).toBeGreaterThan(14)
    play(view, 0.3)
    // La onda va por la mitad y sigue soltando polvo.
    expect(view.live).toBeGreaterThan(0)
    play(view, 3)
    expect(view.live).toBe(0)
  })

  it('la embestida enciende la lanza, deja polvo y rayas mientras corre, y al pegar brilla más que al pararse sin pegar', () => {
    /** Un gigante que embiste 0,6 s hacia +x y acaba pegando (o no). */
    const rush = (hit: boolean) => {
      const view = new AttackFxView(mulberry32(1))
      const giant = { id: 5, pos: { x: 0, z: 0 }, prev: { x: 0, z: 0 }, yaw: Math.PI / 2 }
      view.rushStart(5)
      expect(view.live).toBe(1)
      for (let i = 0; i < 36; i++) {
        giant.prev = { ...giant.pos }
        giant.pos = { x: giant.pos.x + 16 * STEP, z: 0 }
        view.update(STEP, [], 1, [giant])
      }
      expect(view.live).toBeGreaterThan(5)
      const running = view.live
      view.rushEnd(5, hit)
      return { view, added: view.live - running }
    }
    const hit = rush(true)
    expect(hit.added).toBeGreaterThan(rush(false).added)
    play(hit.view, 2)
    expect(hit.view.live).toBe(0)
    // Acabar una que no existe no hace nada.
    hit.view.rushEnd(9, true)
    expect(hit.view.live).toBe(0)
  })

  it('si el gigante desaparece a mitad de la embestida, la lanza se apaga', () => {
    const view = new AttackFxView(mulberry32(1))
    view.rushStart(5)
    view.update(STEP, [], 1, [])
    expect(view.live).toBe(0)
  })

  it('reiniciar no deja nada', () => {
    const projectiles = new Projectiles()
    const view = new AttackFxView(mulberry32(1))
    projectiles.launch(0, 'rock', { x: 0, y: 30, z: 0 }, { x: 30, y: 0, z: 0 }, 1)
    view.update(0.016, projectiles.list, 1)
    view.smash(0, 0)
    view.reset()
    expect(view.live).toBe(0)
    expect(view.group.children).toHaveLength(0)
  })
})

describe('los golpes del jugador (impact)', () => {
  const at = { x: 0, y: 30, z: 0, nx: 0, nz: 1 }
  /** De qué tipos son las piezas que salen de un golpe. */
  const kinds = (view: AttackFxView) => new Set(view['active'].map((p: { kind: string }) => p.kind))

  it('cada material suelta lo suyo: astillas, lascas, cristales u hojas', () => {
    const cases = [
      ['wood', 'chip'],
      ['stone', 'shard'],
      ['iron', 'shard'],
      ['crystal', 'glassShard'],
      ['leaves', 'leaf'],
    ] as const
    for (const [material, debris] of cases) {
      const view = new AttackFxView(mulberry32(3))
      view.impact({ ...at, material, tool: 'pickaxe' })
      expect(kinds(view), material).toContain(debris)
    }
    // La madera no echa chispas; el mineral sí.
    const wood = new AttackFxView(mulberry32(3))
    wood.impact({ ...at, material: 'wood', tool: 'axe' })
    expect(kinds(wood)).not.toContain('spark')
    const iron = new AttackFxView(mulberry32(3))
    iron.impact({ ...at, material: 'iron', tool: 'pickaxe' })
    expect(kinds(iron)).toContain('spark')
  })

  it('a un enemigo la espada le deja un tajo; el hacha, un golpe sordo sin tajo', () => {
    const sword = new AttackFxView(mulberry32(3))
    sword.impact({ ...at, material: 'creature', tool: 'sword', slash: 0.4 })
    expect(kinds(sword)).toContain('cut')
    const axe = new AttackFxView(mulberry32(3))
    axe.impact({ ...at, material: 'creature', tool: 'axe' })
    expect(kinds(axe)).not.toContain('cut')
    expect(kinds(axe)).toContain('glow')
  })

  it('sin daño (falta la herramienta) solo es un golpe seco: no salta nada', () => {
    const view = new AttackFxView(mulberry32(3))
    view.impact({ ...at, material: 'iron', tool: 'pickaxe', blocked: true })
    expect(kinds(view)).not.toContain('shard')
  })

  it('pocas piezas, que salen donde pega y se van enseguida', () => {
    for (const material of ['wood', 'stone', 'iron', 'mithril', 'crystal', 'creature', 'rockCreature'] as const) {
      const view = new AttackFxView(mulberry32(5))
      view.impact({ ...at, material, tool: 'axe', canopy: 33 })
      expect(view.live, material).toBeGreaterThan(2)
      expect(view.live, material).toBeLessThan(30)
      for (const mesh of view.group.children) expect(mesh.position.distanceTo(new THREE.Vector3(0, 30, 0)), material).toBeLessThan(5)
      play(view, 1.6)
      expect(view.live, material).toBe(0)
    }
  })

  it('dos golpes iguales no se ven iguales', () => {
    const view = new AttackFxView(mulberry32(9))
    view.impact({ ...at, material: 'stone', tool: 'pickaxe' })
    play(view, 0.1)
    const first = view.group.children.map((m) => m.position.clone())
    play(view, 2)
    view.impact({ ...at, material: 'stone', tool: 'pickaxe' })
    play(view, 0.1)
    const second = view.group.children.map((m) => m.position.clone())
    expect(second.some((p, i) => !first[i] || p.distanceTo(first[i]) > 1e-3)).toBe(true)
  })
})
