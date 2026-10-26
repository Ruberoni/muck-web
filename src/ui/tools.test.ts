import { describe, expect, it } from 'vitest'
import { missingTool, swingFeedback, toolName } from './tools'

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

  it('un golpe que no hace nada tiembla siempre, pero solo avisa si es propio y el prop sigue ahí', () => {
    expect(swingFeedback(null, 'rock', true, true)).toEqual({ wobble: true, warn: true })
    expect(swingFeedback(null, 'rock', true, false)).toEqual({ wobble: true, warn: false })
    expect(swingFeedback(null, 'rock', false, true)).toEqual({ wobble: false, warn: false })
    // Si le hace algo, tiembla por su propHit y no hay aviso.
    expect(swingFeedback('wood_pickaxe', 'rock', true, true)).toEqual({ wobble: false, warn: false })
    expect(swingFeedback(null, 'tree', true, true)).toEqual({ wobble: false, warn: false })
    expect(swingFeedback(null, 'bush', true, true)).toEqual({ wobble: false, warn: false })
  })

  it('el abedul pide el hacha de piedra y la mena de hierro el pico de piedra', () => {
    expect(missingTool(null, 'birch')).toBe('hacha de piedra')
    expect(missingTool('wood_axe', 'birch')).toBe('hacha de piedra')
    expect(missingTool('stone_axe', 'birch')).toBeNull()
    expect(missingTool('wood_pickaxe', 'iron_ore')).toBe('pico de piedra')
    expect(missingTool('stone_pickaxe', 'iron_ore')).toBeNull()
  })

  it('árboles y arbustos no piden nada', () => {
    expect(missingTool(null, 'tree')).toBeNull()
    expect(missingTool('wood_pickaxe', 'tree')).toBeNull()
    expect(missingTool(null, 'bush')).toBeNull()
  })
})
