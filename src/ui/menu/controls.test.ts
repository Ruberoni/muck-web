import { describe, expect, it } from 'vitest'
import { DEFAULT_BINDINGS } from '../../game/bindings'
import { controlGroups } from './controls'

describe('controlGroups', () => {
  it('los cinco grupos, con las teclas por defecto', () => {
    const groups = controlGroups({ ...DEFAULT_BINDINGS })
    expect(groups.map((g) => g.title)).toEqual(['Moverse', 'Combate y comida', 'Inventario y crafteo', 'Construir y estaciones', 'Partida'])
    const keys = groups.flatMap((g) => g.rows.map((r) => r.key))
    expect(keys).toContain('WASD')
    expect(keys).toContain('Mayús')
    expect(keys).toContain('Tab / E')
  })

  it('enseña las teclas reasignadas', () => {
    const groups = controlGroups({ ...DEFAULT_BINDINGS, forward: 'ArrowUp', jump: 'KeyJ', recipes: '' })
    const keys = groups.flatMap((g) => g.rows.map((r) => r.key))
    expect(keys).toContain('↑ A S D')
    expect(keys).toContain('J')
    expect(keys).toContain('—')
  })
})
