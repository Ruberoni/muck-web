import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { DAY_FRACTION } from '../sim/world/daycycle'
import { createSkyState, moonPhaseOf, sampleSky, SKY_AXIS, sunDirection } from './daycycle'
import { MOON_DISTANCE, STAR_COUNT, SUN_DISTANCE, SkyView, starsOf } from './sky'

const eye = new THREE.Vector3(12, 30, -40)

function viewAt(phase: number, eternal = 0, moonPhase = 0.5) {
  const state = sampleSky(phase, createSkyState())
  const view = new SkyView()
  view.update(state, phase, eye, state.sky, eternal, moonPhase)
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

const MIDNIGHT = (1 + DAY_FRACTION) / 2
const toMoon = (view: SkyView) => view.moon.position.clone().sub(eye).normalize()

describe('luna y estrellas', () => {
  it('la luna crece noche a noche hasta estar llena en la noche 5 y sigue llena en la Noche Eterna', () => {
    const lit = (phase: number) => (1 - Math.cos(2 * Math.PI * phase)) / 2
    const nights = [1, 2, 3, 4, 5].map((day) => moonPhaseOf(day, 6))
    for (let i = 1; i < nights.length; i++) expect(lit(nights[i])).toBeGreaterThan(lit(nights[i - 1]))
    for (const phase of nights) expect(phase).toBeLessThanOrEqual(0.5)
    expect(lit(nights[0])).toBeGreaterThan(0)
    expect(nights[4]).toBe(0.5)
    for (const day of [6, 7, 12]) expect(moonPhaseOf(day, 6)).toBe(0.5)
  })

  it('sin Noche Eterna (el menú) la luna da vueltas a sus fases, sin luna nueva', () => {
    const phases = Array.from({ length: 20 }, (_, i) => moonPhaseOf(i + 1, Infinity))
    for (const phase of phases) {
      expect(phase).toBeGreaterThan(0)
      expect(phase).toBeLessThan(1)
    }
    expect(new Set(phases).size).toBeGreaterThan(4)
    expect(moonPhaseOf(1, Infinity)).toBe(moonPhaseOf(9, Infinity))
  })

  it('la luna está siempre enfrente del sol, mirando a la cámara', () => {
    for (let p = 0; p < 1; p += 0.02) {
      const { view } = viewAt(p)
      expect(toMoon(view).distanceTo(sunDirection(p).negate())).toBeLessThan(1e-9)
      expect(view.moon.position.distanceTo(eye)).toBeCloseTo(MOON_DISTANCE, 6)
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(view.moon.quaternion)
      expect(normal.dot(toMoon(view))).toBeCloseTo(-1, 6)
    }
  })

  it('de noche la luz de las sombras viene de la luna', () => {
    const { state, view } = viewAt(MIDNIGHT)
    expect(toMoon(view).distanceTo(state.lightDir)).toBeLessThan(1e-9)
  })

  it('el lado iluminado de la luna mira hacia donde va, hacia el sol escondido', () => {
    const { view } = viewAt(MIDNIGHT)
    const side = new THREE.Vector3(1, 0, 0).applyQuaternion(view.moon.quaternion)
    const ahead = sunDirection(MIDNIGHT + 0.01).negate().sub(toMoon(view))
    expect(side.dot(ahead)).toBeGreaterThan(0)
    expect(viewAt(MIDNIGHT, 0, 0.1).view.moon.material.uniforms.phase.value).toBeCloseTo(0.1, 12)
  })

  it('la luna no se ve de día y sí de noche', () => {
    for (let p = 0.03; p < DAY_FRACTION - 0.03; p += 0.01) expect(viewAt(p).view.moon.visible).toBe(false)
    expect(viewAt(MIDNIGHT).view.moon.visible).toBe(true)
  })

  it('las estrellas no se ven de día y sí de noche', () => {
    for (let p = 0; p < DAY_FRACTION; p += 0.01) {
      const { view } = viewAt(p)
      expect(view.stars.material.uniforms.opacity.value).toBe(0)
      expect(view.stars.visible).toBe(false)
    }
    expect(viewAt(MIDNIGHT).view.stars.material.uniforms.opacity.value).toBe(1)
    expect(starsOf(0)).toBe(0)
  })

  it('las estrellas giran con el cielo: el mismo ángulo que el sol, sobre el mismo eje', () => {
    for (let p = 0; p < 1; p += 0.05) {
      const { view } = viewAt(p)
      const turned = new THREE.Vector3(1, 0, 0).applyQuaternion(view.stars.quaternion)
      expect(turned.distanceTo(sunDirection(p))).toBeLessThan(1e-9)
      expect(SKY_AXIS.clone().applyQuaternion(view.stars.quaternion).distanceTo(SKY_AXIS)).toBeLessThan(1e-9)
      expect(view.stars.position.equals(eye)).toBe(true)
    }
  })

  it('las estrellas cubren la esfera entera y son siempre las mismas', () => {
    const a = new SkyView().stars.geometry.attributes.position
    const b = new SkyView().stars.geometry.attributes.position
    expect(a.count).toBe(STAR_COUNT)
    expect(Array.from(a.array)).toEqual(Array.from(b.array))
    let below = 0
    for (let i = 0; i < a.count; i++) if (a.getY(i) < 0) below++
    expect(below / a.count).toBeGreaterThan(0.4)
    expect(below / a.count).toBeLessThan(0.6)
  })
})
