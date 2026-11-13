import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { DAY_FRACTION, DAY_LENGTH, DayClock, NIGHT_LENGTH } from '../sim/world/daycycle'
import { BLOOD_RAMP, bloodOf, createSkyState, moonPhaseOf, sampleSky, SKY_AXIS, skyPhase, sunDirection } from './daycycle'
import { MOON_DISTANCE, STAR_COUNT, SUN_DISTANCE, SkyView, starsOf } from './sky'

const eye = new THREE.Vector3(12, 30, -40)

function viewAt(phase: number, eternal = 0, moonPhase = 0.5, blood = 0) {
  const state = sampleSky(phase, createSkyState(), blood)
  const view = new SkyView()
  view.update(state, phase, eye, state.sky, eternal, moonPhase, blood)
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

describe('Noche Eterna en el cielo', () => {
  const MIDNIGHT = (1 + DAY_FRACTION) / 2
  const eternalClock = () => {
    const clock = new DayClock()
    clock.configure({ daylight: DAY_LENGTH * DAY_FRACTION, eternalDay: 6, bell: 60 })
    return clock
  }

  it('fuera de la Noche Eterna el cielo va con el reloj', () => {
    const clock = eternalClock()
    for (let t = 0; t < clock.eternalAt; t += 7.3) {
      clock.elapsed = t
      expect(skyPhase(clock)).toBe(clock.phase)
    }
  })

  it('en la Noche Eterna el cielo frena poco a poco hasta pararse en medianoche, sin saltos ni vuelta atrás', () => {
    const clock = eternalClock()
    const normalSpeed = (1 - DAY_FRACTION) / NIGHT_LENGTH
    // Sin salto al entrar: justo antes es el anochecer.
    clock.elapsed = clock.eternalAt - 1e-6
    const before = skyPhase(clock)
    clock.elapsed = clock.eternalAt
    expect(skyPhase(clock)).toBeCloseTo(before, 5)
    expect(skyPhase(clock)).toBeCloseTo(DAY_FRACTION, 9)
    // Al principio, a la velocidad de una noche normal.
    clock.elapsed = clock.eternalAt + 0.01
    expect((skyPhase(clock) - DAY_FRACTION) / 0.01).toBeCloseTo(normalSpeed, 5)
    // Nunca retrocede y cada vez va más despacio.
    let prev = DAY_FRACTION
    let prevStep = Infinity
    for (let t = 1; t <= NIGHT_LENGTH + 1; t++) {
      clock.elapsed = clock.eternalAt + t
      const p = skyPhase(clock)
      expect(p).toBeGreaterThanOrEqual(prev)
      expect(p - prev).toBeLessThanOrEqual(prevStep + 1e-12)
      prevStep = p - prev
      prev = p
    }
    expect(prev).toBeCloseTo(MIDNIGHT, 9)
    // Y parado ahí, campana tras campana.
    for (const t of [NIGHT_LENGTH + 1, 500, 5000]) {
      clock.elapsed = clock.eternalAt + t
      expect(skyPhase(clock)).toBe(MIDNIGHT)
    }
  })

  it('parado, la luna queda a unos 60° hacia el lado donde culmina el sol, y las estrellas quietas', () => {
    const clock = eternalClock()
    clock.elapsed = clock.eternalAt + NIGHT_LENGTH + 1
    // El cielo se para justo donde se para el reloj.
    expect(skyPhase(clock)).toBe(clock.phase)
    const moon = sunDirection(skyPhase(clock)).negate()
    expect(THREE.MathUtils.radToDeg(Math.asin(moon.y))).toBeCloseTo(60, 6)
    expect(moon.z).toBeGreaterThan(0)
    expect(sunDirection(DAY_FRACTION / 2).z).toBeGreaterThan(0)
    const a = viewAt(skyPhase(clock)).view.stars.quaternion.clone()
    clock.elapsed += 500
    const b = viewAt(skyPhase(clock)).view.stars.quaternion
    expect(a.equals(b)).toBe(true)
  })

  it('la luna de sangre sale del reloj: 0 en el menú y antes, 1 en la Noche Eterna, sin saltos', () => {
    const menu = new DayClock()
    for (const t of [0, 100, 1e5]) {
      menu.elapsed = t
      expect(bloodOf(menu)).toBe(0)
      expect(skyPhase(menu)).toBe(menu.phase)
    }
    const clock = eternalClock()
    clock.elapsed = clock.eternalAt - BLOOD_RAMP - 1
    expect(bloodOf(clock)).toBe(0)
    clock.elapsed = clock.eternalAt
    expect(bloodOf(clock)).toBe(1)
    clock.elapsed = clock.eternalAt + 5000
    expect(bloodOf(clock)).toBe(1)
    let prev = 0
    for (let t = clock.eternalAt - BLOOD_RAMP; t <= clock.eternalAt; t += 0.05) {
      clock.elapsed = t
      expect(Math.abs(bloodOf(clock) - prev)).toBeLessThan(0.02)
      prev = bloodOf(clock)
    }
  })

  it('mientras sale, la luna no cambia de golpe al caer la Noche Eterna', () => {
    const clock = eternalClock()
    const at = (elapsed: number) => {
      clock.elapsed = elapsed
      const { view } = viewAt(skyPhase(clock), 0, 0.5, bloodOf(clock))
      return { lit: (view.moon.material.uniforms.lit.value as THREE.Color).clone(), halo: view.moonHalo.scale.x }
    }
    const before = at(clock.eternalAt - 1e-3)
    const after = at(clock.eternalAt)
    expect(Math.abs(before.lit.r - after.lit.r) + Math.abs(before.lit.g - after.lit.g) + Math.abs(before.lit.b - after.lit.b)).toBeLessThan(1e-3)
    expect(Math.abs(before.halo - after.halo)).toBeLessThan(1e-2)
  })

  it('la luna es roja si y solo si es luna de sangre, aunque la niebla se abra junto al faro', () => {
    const night = MIDNIGHT
    const normal = viewAt(night, 0, 0.5, 0).view.moon.material.uniforms.lit.value as THREE.Color
    expect(normal.r).toBeCloseTo(normal.g, 1)
    for (const fog of [0, 1]) {
      const lit = viewAt(night, fog, 0.5, 1).view.moon.material.uniforms.lit.value as THREE.Color
      expect(lit.r).toBeGreaterThan(lit.g * 3)
      expect(lit.r).toBeGreaterThan(lit.b * 3)
    }
  })

  it('la luna de sangre es más oscura saliendo por el horizonte que arriba', () => {
    const rising = viewAt(DAY_FRACTION + 0.01, 1, 0.5, 1).view.moon.material.uniforms.lit.value as THREE.Color
    const high = viewAt(MIDNIGHT, 1, 0.5, 1).view.moon.material.uniforms.lit.value as THREE.Color
    expect(rising.r).toBeLessThan(high.r)
    expect(rising.r).toBeGreaterThan(rising.g * 3)
  })

  it('con luna de sangre la luz de la luna se tiñe algo de rojo, y de día no cambia nada', () => {
    const plain = sampleSky(MIDNIGHT, createSkyState())
    const blood = sampleSky(MIDNIGHT, createSkyState(), 1)
    expect(blood.lightColor.r).toBeGreaterThan(blood.lightColor.b)
    expect(plain.lightColor.r).toBeLessThan(plain.lightColor.b)
    expect(blood.lightIntensity).toBe(plain.lightIntensity)
    expect(blood.lightDir.equals(plain.lightDir)).toBe(true)
    const day = sampleSky(DAY_FRACTION / 2, createSkyState(), 1)
    expect(day.lightColor.equals(sampleSky(DAY_FRACTION / 2, createSkyState()).lightColor)).toBe(true)
  })
})
