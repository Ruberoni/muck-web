import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { DAY_FRACTION } from '../sim/world/daycycle'
import { createSkyState, sampleSky, sunDirection } from './daycycle'
import { SUN_DISTANCE, SkyView } from './sky'

const eye = new THREE.Vector3(12, 30, -40)

function viewAt(phase: number, eternal = 0) {
  const state = sampleSky(phase, createSkyState())
  const view = new SkyView()
  view.update(state, phase, eye, state.sky, eternal)
  return { state, view }
}

/** Hacia el disco del sol desde la cámara. */
const toSun = (view: SkyView) => view.sun.position.clone().sub(eye).normalize()

describe('cielo visible', () => {
  it('el sol está donde dice sunDirection, y de día justo donde viene la luz de las sombras', () => {
    for (let p = 0; p < 1; p += 0.02) {
      const { state, view } = viewAt(p)
      expect(toSun(view).distanceTo(sunDirection(p))).toBeLessThan(1e-9)
      expect(view.sun.position.distanceTo(eye)).toBeCloseTo(SUN_DISTANCE, 6)
      if (p > 0.01 && p < DAY_FRACTION - 0.01) expect(toSun(view).distanceTo(state.lightDir)).toBeLessThan(1e-9)
    }
  })

  it('el disco del sol mira a la cámara', () => {
    const { view } = viewAt(DAY_FRACTION / 2)
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(view.sun.quaternion)
    expect(normal.dot(toSun(view))).toBeCloseTo(-1, 6)
  })

  it('el sol no se ve bajo el horizonte', () => {
    for (let p = DAY_FRACTION + 0.03; p < 0.97; p += 0.01) expect(viewAt(p).view.sun.visible).toBe(false)
    expect(viewAt(DAY_FRACTION / 2).view.sun.visible).toBe(true)
  })

  it('el horizonte de la cúpula es el color de la niebla', () => {
    const fog = new THREE.Color('#123456')
    const state = sampleSky(0.1, createSkyState())
    const view = new SkyView()
    view.update(state, 0.1, eye, fog)
    expect(view.dome.material.uniforms.horizon.value.equals(fog)).toBe(true)
    expect(view.dome.position.equals(eye)).toBe(true)
  })

  it('con el sol bajo el brillo es más naranja, más ancho y más fuerte que con el sol alto', () => {
    const low = sampleSky(0.01, createSkyState())
    const high = sampleSky(DAY_FRACTION / 2, createSkyState())
    const warmth = (c: THREE.Color) => c.r - c.b
    expect(warmth(low.glow)).toBeGreaterThan(warmth(high.glow) + 0.2)
    expect(warmth(low.sunColor)).toBeGreaterThan(warmth(high.sunColor))
    expect(low.glowPower).toBeLessThan(high.glowPower)
    expect(low.glowStrength).toBeGreaterThan(high.glowStrength)
    expect(low.sunset).toBeGreaterThan(0.9)
    expect(high.sunset).toBe(0)
  })

  it('de noche cerrada no queda brillo del sol', () => {
    const night = sampleSky(DAY_FRACTION + (1 - DAY_FRACTION) / 2, createSkyState())
    expect(night.glowStrength).toBe(0)
    expect(night.sunset).toBe(0)
  })

  it('la Noche Eterna apaga el brillo y lleva el cénit a la niebla', () => {
    const { view } = viewAt(DAY_FRACTION + 0.02, 1)
    const u = view.dome.material.uniforms
    expect(u.glowStrength.value).toBe(0)
    expect(u.zenith.value.equals(u.horizon.value)).toBe(true)
    expect(view.sun.visible).toBe(false)
  })
})
