import { describe, expect, it } from 'vitest'
import { clockOf } from '../match'
import { DAY_FRACTION, DayClock, isNight, NIGHT_LENGTH, START_PHASE } from './daycycle'

const clockFor = (players: number) => {
  const clock = new DayClock()
  clock.configure(clockOf(players))
  return clock
}

describe('reloj por jugadores', () => {
  it.each([
    [1, 45],
    [2, 40],
    [3, 34],
    [4, 31],
    [5, 28],
  ])('con %i la Noche Eterna cae en el minuto %i', (players, minute) => {
    expect(Math.round(clockFor(players).eternalAt / 60)).toBe(minute)
  })

  it('más jugadores, menos luz y campanas más seguidas', () => {
    expect([1, 2, 3, 4, 5].map((n) => clockOf(n).daylight / 60)).toEqual([6, 5, 4, 3.5, 3])
    expect([1, 2, 3, 4, 5].map((n) => clockOf(n).bell / 60)).toEqual([6, 5.5, 5, 4.5, 4])
  })

  it.each([1, 3, 5])('con %i: empieza a media mañana, anochece en la misma fase y la noche dura lo mismo', (players) => {
    const clock = clockFor(players)
    const { daylight } = clockOf(players)
    expect(clock.phase).toBeCloseTo(START_PHASE, 9)
    expect(clock.day).toBe(1)
    // Hasta el anochecer del día 2.
    const dusk = clock.elapsedAt(2, DAY_FRACTION)
    clock.elapsed = dusk - 0.01
    expect(isNight(clock.phase)).toBe(false)
    clock.elapsed = dusk + 0.01
    expect(isNight(clock.phase)).toBe(true)
    expect(clock.day).toBe(2)
    clock.elapsed = dusk + NIGHT_LENGTH - 0.01
    expect(clock.day).toBe(2)
    clock.elapsed = dusk + NIGHT_LENGTH + 0.01
    expect(clock.day).toBe(3)
    expect(clock.phase).toBeLessThan(0.001)
    expect(clock.nextMorning - clock.elapsed).toBeCloseTo(daylight + NIGHT_LENGTH - 0.01, 6)
  })

  it('`elapsedAt` y `phase` son inversos', () => {
    const clock = clockFor(2)
    for (const [day, phase] of [[1, 0.2], [2, 0.5], [3, 0.7], [5, 0.95]]) {
      clock.elapsed = clock.elapsedAt(day, phase)
      expect(clock.day).toBe(day)
      expect(clock.phase).toBeCloseTo(phase, 9)
    }
  })

  it('sin reglas es el ciclo de siempre, sin Noche Eterna', () => {
    const clock = new DayClock()
    expect(clock.eternalAt).toBe(Infinity)
    clock.elapsed = 1e6
    expect(clock.eternal).toBe(false)
  })
})

describe('Noche Eterna', () => {
  it('cae en la noche 6: ya no amanece, la fase se queda en plena noche y el día sube con cada campana', () => {
    const clock = clockFor(3)
    const { bell } = clockOf(3)
    clock.elapsed = clock.eternalAt - 0.01
    expect(clock.eternal).toBe(false)
    expect(clock.day).toBe(6)
    clock.elapsed = clock.eternalAt
    expect(clock).toMatchObject({ eternal: true, day: 6 })
    expect(clock.phase).toBeCloseTo(DAY_FRACTION, 9)
    clock.elapsed += bell - 1
    expect(clock.day).toBe(6)
    const midnight = clock.phase
    expect(isNight(midnight)).toBe(true)
    clock.elapsed += 2
    expect(clock.day).toBe(7)
    expect(clock.phase).toBe(midnight)
    clock.elapsed += bell * 10
    expect(clock.day).toBe(17)
    expect(clock.phase).toBe(midnight)
  })

  it('la siguiente mañana es la siguiente campana', () => {
    const clock = clockFor(5)
    const { bell } = clockOf(5)
    clock.elapsed = clock.eternalAt + 10
    expect(clock.nextMorning).toBeCloseTo(clock.eternalAt + bell, 9)
    clock.elapsed = clock.eternalAt + bell + 10
    expect(clock.nextMorning).toBeCloseTo(clock.eternalAt + 2 * bell, 9)
  })

  it('saltar a una noche de la Noche Eterna va a su campana', () => {
    const clock = clockFor(1)
    expect(clock.elapsedAt(9, 0.8)).toBe(clock.eternalAt + 3 * clockOf(1).bell)
  })
})
