import { describe, expect, it } from 'vitest'

// Todo src/sim, incluidos los tests: el servidor importa estos módulos sin three ni DOM.
const sources = import.meta.glob<string>('./**/*.ts', { query: '?raw', import: 'default', eager: true })

const importsOf = (source: string) => [...source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1])

describe('src/sim es puro', () => {
  it('encuentra los módulos', () => {
    expect(Object.keys(sources)).toContain('./player.ts')
    expect(Object.keys(sources)).toContain('./world/terrain.ts')
  })

  it('no importa three', () => {
    for (const [file, source] of Object.entries(sources)) {
      for (const spec of importsOf(source)) expect(spec, file).not.toMatch(/^three(\/|$)/)
    }
  })

  it('no importa nada de fuera de src/sim', () => {
    for (const [file, source] of Object.entries(sources)) {
      const depth = file.split('/').length - 2
      for (const spec of importsOf(source)) {
        if (!spec.startsWith('.')) continue
        const ups = spec.split('/').filter((part) => part === '..').length
        expect(ups, `${file} → ${spec}`).toBeLessThanOrEqual(depth)
      }
    }
  })
})
