import { describe, expect, it } from 'vitest'
import { resultLines } from './results'

const names = ['Ana', 'Bea', 'Cris']
const nameOf = (id: number) => names[id]

describe('pantalla final', () => {
  it('dice cómo acabó, hasta dónde se llegó y quién murió más', () => {
    const players = [{ id: 0, deaths: 1, escaped: false }, { id: 1, deaths: 3, escaped: false }]
    expect(resultLines({ end: 'lost', day: 7, seconds: 1865, players }, nameOf)).toEqual(['Fin de la partida', 'Día 7 · 31 min 05 s', 'Más muertes: Bea (3)'])
  })

  it('al escapar dice quién se salvó', () => {
    const players = [{ id: 0, deaths: 0, escaped: true }, { id: 1, deaths: 0, escaped: false }]
    expect(resultLines({ end: 'escaped', day: 9, seconds: 60, players }, nameOf)).toEqual(['¡Habéis escapado!', 'Día 9 · 1 min 00 s', 'Ana: se salvó', 'Bea: se quedó en la isla'])
  })

  it('en solitario no compara', () => {
    expect(resultLines({ end: 'lost', day: 2, seconds: 5, players: [{ id: 0, deaths: 2, escaped: false }] }, nameOf)).toHaveLength(2)
  })
})
