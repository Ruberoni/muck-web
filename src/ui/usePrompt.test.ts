import { describe, expect, it } from 'vitest'
import { BUILD_DEFS } from '../sim/builds'
import { DEFAULT_RULES } from '../sim/match'
import type { Structure } from '../sim/structures'
import { usePrompt } from './usePrompt'

const lighthouse = (fire: Structure['fire']) =>
  ({ kind: 'lighthouse', fire, build: { phase: BUILD_DEFS.lighthouse!.phases.length, delivered: {}, progress: 1 } }) as Structure

describe('el aviso del faro', () => {
  it('sin aceite no ofrece encenderlo', () => {
    const text = usePrompt(lighthouse({ oil: 0, burning: false, left: 0, lit: 0 }), DEFAULT_RULES, false, 'E')
    expect(text).toContain('Sin aceite')
    expect(text).not.toContain('encenderlo')
  })

  it('con aceite se puede encender, y encendido, apagar', () => {
    expect(usePrompt(lighthouse({ oil: 2, burning: false, left: 0, lit: 0 }), DEFAULT_RULES, false, 'E')).toContain('encenderlo')
    expect(usePrompt(lighthouse({ oil: 0, burning: true, left: 10, lit: 0 }), DEFAULT_RULES, false, 'E')).toContain('apagarlo')
  })

  it('apagado a medias, lo que queda de la unidad aún lo enciende', () => {
    expect(usePrompt(lighthouse({ oil: 0, burning: false, left: 10, lit: 0 }), DEFAULT_RULES, false, 'E')).toContain('encenderlo')
  })

  it('la tecla del aviso es la que se haya asignado, no siempre E', () => {
    const oil = { oil: 2, burning: false, left: 0, lit: 0 } as const
    expect(usePrompt(lighthouse(oil), DEFAULT_RULES, false, 'Espacio')).toContain('Espacio para cargar aceite')
    expect(usePrompt(lighthouse(oil), DEFAULT_RULES, false, 'E')).not.toContain('Espacio')
  })
})
