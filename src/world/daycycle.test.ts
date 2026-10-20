import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { DAY_FRACTION, DAY_LENGTH, DayClock, START_PHASE } from '../sim/world/daycycle'
import { createSkyState, sampleSky, sunDirection } from './daycycle'

describe('reloj del día', () => {
  it('empieza de día en el día 1', () => {
    const clock = new DayClock()
    expect(clock.day).toBe(1)
    expect(clock.phase).toBeCloseTo(START_PHASE, 9)
    expect(sunDirection(clock.phase).y).toBeGreaterThan(0.3)
  })

  it('cambia de día en el amanecer', () => {
    const clock = new DayClock()
    const toDawn = (1 - START_PHASE) * DAY_LENGTH
    clock.step(toDawn - 0.01)
    expect(clock.day).toBe(1)
    clock.step(0.02)
    expect(clock.day).toBe(2)
    clock.step(DAY_LENGTH)
    expect(clock.day).toBe(3)
  })

  it('fijar la fase no cambia el día', () => {
    const clock = new DayClock()
    clock.step(DAY_LENGTH * 1.5)
    const day = clock.day
    clock.phase = 0.9
    expect(clock.day).toBe(day)
    expect(clock.phase).toBeCloseTo(0.9, 9)
    clock.reset()
    expect(clock.day).toBe(1)
  })
})

describe('sol', () => {
  it('está sobre el horizonte de día y bajo él de noche', () => {
    for (let p = 0.01; p < 1; p += 0.01) {
      const y = sunDirection(p).y
      if (p < DAY_FRACTION) expect(y).toBeGreaterThan(0)
      else expect(y).toBeLessThan(0)
    }
  })

  it('es unitario y continuo', () => {
    const prev = sunDirection(0)
    for (let p = 0.001; p <= 1; p += 0.001) {
      const dir = sunDirection(p)
      expect(dir.length()).toBeCloseTo(1, 9)
      expect(dir.distanceTo(prev)).toBeLessThan(0.02)
      prev.copy(dir)
    }
  })
})

describe('cielo', () => {
  it('la luz principal siempre viene de arriba', () => {
    const state = createSkyState()
    for (let p = 0; p < 1; p += 0.005) expect(sampleSky(p, state).lightDir.y).toBeGreaterThanOrEqual(0)
  })

  it('las luces cambian sin saltos al pasar por el horizonte', () => {
    const state = createSkyState()
    const prev = { light: 0, hemi: 0, sky: new THREE.Color() }
    sampleSky(0, state)
    Object.assign(prev, { light: state.lightIntensity, hemi: state.hemiIntensity })
    prev.sky.copy(state.sky)
    for (let p = 0.0005; p <= 1; p += 0.0005) {
      sampleSky(p, state)
      expect(Math.abs(state.lightIntensity - prev.light)).toBeLessThan(0.05)
      expect(Math.abs(state.hemiIntensity - prev.hemi)).toBeLessThan(0.05)
      expect(Math.abs(state.sky.r - prev.sky.r) + Math.abs(state.sky.g - prev.sky.g) + Math.abs(state.sky.b - prev.sky.b)).toBeLessThan(0.05)
      prev.light = state.lightIntensity
      prev.hemi = state.hemiIntensity
      prev.sky.copy(state.sky)
    }
  })

  it('a mediodía conserva el cielo de siempre y de noche está oscuro', () => {
    const state = createSkyState()
    sampleSky(DAY_FRACTION / 2, state)
    expect(state.sky.getHexString()).toBe('9fd4f0')
    expect(state.lightIntensity).toBeCloseTo(2.6, 6)
    const noon = state.sky.getHSL({ h: 0, s: 0, l: 0 }).l

    sampleSky((1 + DAY_FRACTION) / 2, state)
    expect(state.sky.getHSL({ h: 0, s: 0, l: 0 }).l).toBeLessThan(noon / 3)
    expect(state.lightIntensity).toBeLessThan(1)
  })
})
