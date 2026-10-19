import * as THREE from 'three'

/** Duración de un ciclo completo (día + noche) en segundos de juego. */
export const DAY_LENGTH = 360
/** Fracción del ciclo con el sol sobre el horizonte. */
export const DAY_FRACTION = 0.65
/** La partida empieza a media mañana del día 1. */
export const START_PHASE = 0.12
// Inclinación de la órbita respecto a la vertical: a mediodía el sol queda a unos 60°.
const ORBIT_TILT = THREE.MathUtils.degToRad(30)

/** Reloj de la partida. Fase 0 = amanecer; el día cambia en cada amanecer. */
export class DayClock {
  elapsed = 0

  step(dt: number) {
    this.elapsed += dt
  }

  reset() {
    this.elapsed = 0
  }

  /** Ciclos completos desde el primer amanecer, con decimales. */
  private get cycles() {
    return START_PHASE + this.elapsed / DAY_LENGTH
  }

  get day() {
    return Math.floor(this.cycles) + 1
  }

  /** Posición dentro del ciclo actual, en [0, 1). */
  get phase() {
    return this.cycles - Math.floor(this.cycles)
  }

  set phase(value: number) {
    const target = Math.floor(this.cycles) + THREE.MathUtils.euclideanModulo(value, 1)
    this.elapsed = (target - START_PHASE) * DAY_LENGTH
  }
}

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
  sky: THREE.Color
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
  hemiSky: THREE.Color
  hemiGround: THREE.Color
  hemiIntensity: number
  fogNear: number
  fogFar: number
}

const stop = (elevation: number, sky: string, hemiSky: string, hemiGround: string, hemiIntensity: number, fogNear: number, fogFar: number): SkyStop => ({
  elevation,
  sky: new THREE.Color(sky),
  hemiSky: new THREE.Color(hemiSky),
  hemiGround: new THREE.Color(hemiGround),
  hemiIntensity,
  fogNear,
  fogFar,
})

// Ordenados por altura del sol. Amanecer y atardecer comparten colores.
const STOPS: SkyStop[] = [
  stop(-0.35, '#0b1630', '#41598f', '#1b2616', 0.55, 50, 220),
  stop(-0.1, '#26305a', '#5a6aa0', '#232e1c', 0.6, 60, 240),
  stop(0, '#e8956b', '#f5c19a', '#4a5a30', 0.9, 90, 280),
  stop(0.12, '#c9d6d8', '#e6e2d6', '#58723a', 1.2, 110, 310),
  stop(0.3, '#9fd4f0', '#d6ecff', '#5d7a3a', 1.4, 120, 320),
]

const SUN_INTENSITY = 2.6
const SUN_HIGH = new THREE.Color('#fff3d6')
const SUN_LOW = new THREE.Color('#ff9a5a')
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
