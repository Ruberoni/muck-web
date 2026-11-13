import * as THREE from 'three'
import { DAY_FRACTION } from '../sim/world/daycycle'

// Inclinación de la órbita respecto a la vertical: a mediodía el sol queda a unos 60°.
const ORBIT_TILT = THREE.MathUtils.degToRad(30)

/** Dirección hacia el sol: sale por +X, culmina hacia +Z y se pone por -X. */
export function sunDirection(phase: number, out = new THREE.Vector3()) {
  const p = THREE.MathUtils.euclideanModulo(phase, 1)
  // El día ocupa media órbita (0..π) y la noche la otra mitad, cada uno a su ritmo.
  const angle = p < DAY_FRACTION ? (p / DAY_FRACTION) * Math.PI : Math.PI + ((p - DAY_FRACTION) / (1 - DAY_FRACTION)) * Math.PI
  return out.set(Math.cos(angle), Math.sin(angle) * Math.cos(ORBIT_TILT), Math.sin(angle) * Math.sin(ORBIT_TILT))
}

export interface SkyState {
  /** Hacia la luz principal: el sol de día y la luna (opuesta al sol) de noche. Siempre con y ≥ 0. */
  lightDir: THREE.Vector3
  lightColor: THREE.Color
  lightIntensity: number
  /** Color del horizonte y de la niebla. */
  sky: THREE.Color
  /** Color del cielo en lo alto. */
  zenith: THREE.Color
  /** Brillo del cielo alrededor del sol: su color, cuánto se nota (0..1) y lo concentrado que va (exponente). */
  glow: THREE.Color
  glowStrength: number
  glowPower: number
  /** Cuánto se nota el amanecer o el atardecer: 1 con el sol en el horizonte, 0 con el sol alto o bien escondido. */
  sunset: number
  /** El disco del sol: su color y su tamaño relativo (1 a mediodía, mayor en el horizonte). */
  sunColor: THREE.Color
  sunScale: number
  hemiSky: THREE.Color
  hemiGround: THREE.Color
  hemiIntensity: number
  fogNear: number
  fogFar: number
}

export const createSkyState = (): SkyState => ({
  lightDir: new THREE.Vector3(),
  lightColor: new THREE.Color(),
  lightIntensity: 0,
  sky: new THREE.Color(),
  zenith: new THREE.Color(),
  glow: new THREE.Color(),
  glowStrength: 0,
  glowPower: 1,
  sunset: 0,
  sunColor: new THREE.Color(),
  sunScale: 1,
  hemiSky: new THREE.Color(),
  hemiGround: new THREE.Color(),
  hemiIntensity: 0,
  fogNear: 0,
  fogFar: 0,
})

interface SkyStop {
  /** Altura del sol (y de su dirección). */
  elevation: number
  sky: THREE.Color
  zenith: THREE.Color
  hemiSky: THREE.Color
  hemiGround: THREE.Color
  hemiIntensity: number
  fogNear: number
  fogFar: number
}

const stop = (elevation: number, sky: string, zenith: string, hemiSky: string, hemiGround: string, hemiIntensity: number, fogNear: number, fogFar: number): SkyStop => ({
  elevation,
  sky: new THREE.Color(sky),
  zenith: new THREE.Color(zenith),
  hemiSky: new THREE.Color(hemiSky),
  hemiGround: new THREE.Color(hemiGround),
  hemiIntensity,
  fogNear,
  fogFar,
})

// Ordenados por altura del sol. Amanecer y atardecer comparten colores.
const STOPS: SkyStop[] = [
  stop(-0.35, '#0b1630', '#03081a', '#41598f', '#1b2616', 0.55, 50, 220),
  stop(-0.1, '#26305a', '#0f1538', '#5a6aa0', '#232e1c', 0.6, 60, 240),
  stop(0, '#e8956b', '#3d4f86', '#f5c19a', '#4a5a30', 0.9, 90, 280),
  stop(0.12, '#c9d6d8', '#6f9fd0', '#e6e2d6', '#58723a', 1.2, 110, 310),
  stop(0.3, '#9fd4f0', '#4c97dc', '#d6ecff', '#5d7a3a', 1.4, 120, 320),
]

const SUN_INTENSITY = 2.6
const SUN_HIGH = new THREE.Color('#fff3d6')
const SUN_LOW = new THREE.Color('#ff9a5a')
// El disco del sol y el brillo que lo rodea: blanco cálido arriba, naranja en el horizonte.
const SUN_DISK_HIGH = new THREE.Color('#fff8e0')
const SUN_DISK_LOW = new THREE.Color('#ff9440')
const GLOW_HIGH = new THREE.Color('#fff2cc')
const GLOW_LOW = new THREE.Color('#ff7a3a')
const MOON_INTENSITY = 0.45
const MOON_COLOR = new THREE.Color('#a9bcff')

const smoothstep = THREE.MathUtils.smoothstep

/** Luces, cielo y niebla para una fase del ciclo. Escribe en `out` para no reservar memoria por frame. */
export function sampleSky(phase: number, out: SkyState) {
  const sun = sunDirection(phase, out.lightDir)
  const e = sun.y

  let i = 0
  while (i < STOPS.length - 2 && e > STOPS[i + 1].elevation) i++
  const a = STOPS[i]
  const b = STOPS[i + 1]
  const t = THREE.MathUtils.clamp((e - a.elevation) / (b.elevation - a.elevation), 0, 1)
  out.sky.lerpColors(a.sky, b.sky, t)
  out.hemiSky.lerpColors(a.hemiSky, b.hemiSky, t)
  out.hemiGround.lerpColors(a.hemiGround, b.hemiGround, t)
  out.hemiIntensity = THREE.MathUtils.lerp(a.hemiIntensity, b.hemiIntensity, t)
  out.fogNear = THREE.MathUtils.lerp(a.fogNear, b.fogNear, t)
  out.fogFar = THREE.MathUtils.lerp(a.fogFar, b.fogFar, t)
  out.zenith.lerpColors(a.zenith, b.zenith, t)

  // Amanecer y atardecer: del todo con el sol en el horizonte; se van al subir y poco después de esconderse.
  out.sunset = e >= 0 ? 1 - smoothstep(e, 0.02, 0.3) : 1 - smoothstep(-e, 0, 0.15)
  const low = 1 - smoothstep(e, 0, 0.3)
  out.glow.lerpColors(GLOW_HIGH, GLOW_LOW, low)
  // Con el sol alto, un brillo blanco y estrecho; en el horizonte, uno naranja y ancho hacia su lado del cielo.
  out.glowStrength = THREE.MathUtils.lerp(0.3, 0.85, low) * (e >= 0 ? 1 : 1 - smoothstep(-e, 0, 0.15))
  out.glowPower = THREE.MathUtils.lerp(24, 3, low)
  out.sunColor.lerpColors(SUN_DISK_HIGH, SUN_DISK_LOW, low)
  out.sunScale = 1 + 0.35 * low

  // Ambas luces se apagan en el horizonte, así que el cambio de sol a luna no se nota.
  if (e >= 0) {
    out.lightIntensity = SUN_INTENSITY * smoothstep(e, 0, 0.25)
    out.lightColor.lerpColors(SUN_LOW, SUN_HIGH, smoothstep(e, 0, 0.35))
  } else {
    sun.negate()
    out.lightIntensity = MOON_INTENSITY * smoothstep(-e, 0, 0.2)
    out.lightColor.copy(MOON_COLOR)
  }
  return out
}
