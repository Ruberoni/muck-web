import { describe, expect, it } from 'vitest'
import { missingTool, toolName } from './tools'

describe('herramienta que falta', () => {
  it('nombra la herramienta más baja que cumple el requisito, en minúscula', () => {
    expect(toolName({ family: 'pickaxe', tier: 1 })).toBe('pico de madera')
    expect(toolName({ family: 'pickaxe', tier: 2 })).toBe('pico de piedra')
    expect(toolName({ family: 'axe', tier: 1 })).toBe('hacha de madera')
    // Un nivel sin herramienta todavía.
    expect(toolName({ family: 'axe', tier: 9 })).toBe('hacha de nivel 9')
  })

  it('la roca pide el pico de madera a quien no lo lleva; con un pico, nada', () => {
    expect(missingTool(null, 'rock')).toBe('pico de madera')
    expect(missingTool('stone_axe', 'rock')).toBe('pico de madera')
    expect(missingTool('wood_pickaxe', 'rock')).toBeNull()
    expect(missingTool('stone_pickaxe', 'rock')).toBeNull()
  })

  it('árboles y arbustos no piden nada', () => {
    expect(missingTool(null, 'tree')).toBeNull()
    expect(missingTool('wood_pickaxe', 'tree')).toBeNull()
    expect(missingTool(null, 'bush')).toBeNull()
  })
})
