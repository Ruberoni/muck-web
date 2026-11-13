import * as THREE from 'three'
import { SKY_AXIS, skyAngle, sunDirection, type SkyState } from './daycycle'

/** Radio de la cúpula del cielo: dentro del `far` de la cámara (600). */
export const DOME_RADIUS = 450
/** Distancia del disco del sol a la cámara (por dentro de la cúpula). */
export const SUN_DISTANCE = 400
/** Radio del disco del sol a mediodía (unos 2,5°: grande, como en un juego low-poly). */
const SUN_RADIUS = 17
/** Lados del disco del sol: low-poly. */
const SUN_SIDES = 12
/** Distancia de la luna (la misma que el sol: nunca coinciden, van enfrentados). */
export const MOON_DISTANCE = 400
/** Radio del disco de la luna: algo menor que el sol. */
export const MOON_RADIUS = 15
const MOON_SIDES = 14
/** El halo de la luna, en radios de la luna. */
const MOON_HALO = 3.2
/** Las estrellas: cuántas, a qué distancia, de qué tamaño en píxeles (CSS) y con qué semilla. */
export const STAR_COUNT = 800
const STAR_DISTANCE = 420
const STAR_SIZE = [2, 3.5]
const STAR_SEED = 0x5747
const MOON_LIT = new THREE.Color('#f6f3e8')
const MOON_CRATER = new THREE.Color('#d5d2c6')
const MOON_HALO_COLOR = new THREE.Color('#9fb4e8')

// La mitad de abajo de la cúpula es el color de la niebla y nada se dibuja bajo el horizonte:
// el agua es transparente y dejaría ver un sol o un brillo por debajo.
const domeVertex = /* glsl */ `
varying vec3 vDir;
void main() {
  // Unitario ya aquí: con mediump, 450² se desbordaría en el fragment shader.
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const domeFragment = /* glsl */ `
uniform vec3 horizon;
uniform vec3 zenith;
uniform vec3 glowColor;
uniform vec3 sunDir;
uniform float glowStrength;
uniform float glowPower;
uniform float sunset;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  vec3 color = mix(horizon, zenith, smoothstep(0.0, 0.7, h));
  float toSun = max(dot(d, sunDir), 0.0);
  // Brillo alrededor del sol y, en el amanecer y el atardecer, una franja naranja sobre el horizonte de su lado.
  float glow = pow(toSun, glowPower) * glowStrength + pow(toSun, 600.0) * glowStrength;
  float band = sunset * pow(toSun, 1.5) * (1.0 - smoothstep(0.0, 0.35, h)) * 0.6;
  color += glowColor * (glow + band);
  // Pegado al horizonte se funde con la niebla, para que no haya costura con la isla lejana.
  color = mix(horizon, color, smoothstep(0.0, 0.04, d.y));
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}
`

const diskVertex = /* glsl */ `
varying float vHeight;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vHeight = world.y - cameraPosition.y;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

const diskFragment = /* glsl */ `
uniform vec3 color;
varying float vHeight;
void main() {
  // Lo que queda bajo el horizonte no se dibuja: se vería a través del agua.
  if (vHeight < 0.0) discard;
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}
`

// La luna en coordenadas del disco (radio 1): +x mira hacia donde se fue el sol, por donde queda iluminada al crecer.
const moonVertex = /* glsl */ `
varying vec2 vLocal;
varying float vHeight;
void main() {
  vLocal = position.xy;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vHeight = world.y - cameraPosition.y;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

const moonFragment = /* glsl */ `
uniform vec3 lit;
uniform vec3 crater;
uniform vec3 shade;
uniform float phase;
varying vec2 vLocal;
varying float vHeight;
float spot(vec2 c, float r) {
  return 1.0 - step(r, length(vLocal - c));
}
void main() {
  if (vHeight < 0.0) discard;
  // La sombra es una media elipse: creciendo, se ilumina desde +x; menguando, se apaga desde +x.
  float w = sqrt(max(1.0 - vLocal.y * vLocal.y, 0.0));
  float waxing = step(phase, 0.5);
  float edge = w * cos(6.2831853 * (phase - 0.5 * (1.0 - waxing)));
  float on = mix(step(vLocal.x, edge), step(edge, vLocal.x), waxing);
  // Unos cráteres planos, como en un dibujo.
  float c = max(max(spot(vec2(-0.3, 0.25), 0.22), spot(vec2(0.32, -0.28), 0.17)), max(spot(vec2(0.05, -0.55), 0.12), spot(vec2(0.38, 0.4), 0.1)));
  vec3 color = mix(shade, mix(lit, crater, c), on);
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}
`

const haloFragment = /* glsl */ `
uniform vec3 color;
uniform float strength;
varying vec2 vLocal;
varying float vHeight;
void main() {
  if (vHeight < 0.0) discard;
  float r = length(vLocal);
  float a = pow(max(1.0 - r, 0.0), 2.5) * strength;
  gl_FragColor = vec4(color * a, 1.0);
  #include <colorspace_fragment>
}
`

// Puntos redondos de tamaño fijo en pantalla, que se apagan al acercarse al horizonte y algunos parpadean.
const starVertex = /* glsl */ `
attribute float size;
attribute float seed;
uniform float pixelRatio;
uniform float time;
varying float vBright;
varying float vSize;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  float up = normalize(world.xyz - cameraPosition).y;
  float twinkle = step(0.7, seed) * 0.35 * sin(time * (1.5 + seed * 3.0) + seed * 40.0);
  vBright = smoothstep(0.0, 0.12, up) * (0.65 + 0.35 * fract(seed * 7.13) + twinkle);
  vSize = size * pixelRatio;
  gl_PointSize = vSize;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

const starFragment = /* glsl */ `
uniform float opacity;
varying float vBright;
varying float vSize;
void main() {
  if (vBright <= 0.0) discard;
  // Borde suave de un píxel: con un recorte duro, las pequeñas se apagarían enteras al caer entre píxeles.
  float r = length(gl_PointCoord - 0.5) * vSize;
  float edge = 1.0 - smoothstep(0.5 * vSize - 1.0, 0.5 * vSize, r);
  if (edge <= 0.0) discard;
  gl_FragColor = vec4(vec3(1.0, 0.98, 0.92) * vBright * opacity * edge, 1.0);
  #include <colorspace_fragment>
}
`

/** Puntos repartidos por la esfera entera (al girar, media esfera dejaría un hueco), con una semilla fija. */
function starGeometry() {
  let s = STAR_SEED
  const random = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
  const positions = new Float32Array(STAR_COUNT * 3)
  const sizes = new Float32Array(STAR_COUNT)
  const seeds = new Float32Array(STAR_COUNT)
  for (let i = 0; i < STAR_COUNT; i++) {
    const y = random() * 2 - 1
    const a = random() * Math.PI * 2
    const r = Math.sqrt(1 - y * y)
    positions.set([Math.cos(a) * r * STAR_DISTANCE, y * STAR_DISTANCE, Math.sin(a) * r * STAR_DISTANCE], i * 3)
    // Muchas pequeñas y pocas grandes.
    sizes[i] = STAR_SIZE[0] + (STAR_SIZE[1] - STAR_SIZE[0]) * random() ** 3
    seeds[i] = random()
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1))
  geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 1))
  return geometry
}

const scratch = new THREE.Vector3()
const tangent = new THREE.Vector3()
const facing = new THREE.Vector3()
const side = new THREE.Vector3()
const basis = new THREE.Matrix4()

/**
 * El cielo: una cúpula con degradado (horizonte = niebla, cénit más oscuro) y brillo hacia el sol, el disco del sol, la
 * luna con su fase y su halo enfrente, y las estrellas, que giran con el cielo.
 * Va en su propia escena, sin niebla y sin escribir profundidad: se dibuja antes que la principal y la isla queda encima.
 * Sigue a la cámara.
 */
export class SkyView {
  readonly scene = new THREE.Scene()
  readonly dome: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>
  readonly sun: THREE.Mesh<THREE.CircleGeometry, THREE.ShaderMaterial>
  readonly moon: THREE.Mesh<THREE.CircleGeometry, THREE.ShaderMaterial>
  readonly moonHalo: THREE.Mesh<THREE.CircleGeometry, THREE.ShaderMaterial>
  readonly stars: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>
  /** Hacia el sol (no hacia la luz: de noche la luz es la luna). */
  readonly sunDir = new THREE.Vector3()
  /** Hacia la luna: siempre enfrente del sol. */
  readonly moonDir = new THREE.Vector3()

  constructor() {
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(DOME_RADIUS, 32, 16),
      new THREE.ShaderMaterial({
        vertexShader: domeVertex,
        fragmentShader: domeFragment,
        uniforms: {
          horizon: { value: new THREE.Color() },
          zenith: { value: new THREE.Color() },
          glowColor: { value: new THREE.Color() },
          sunDir: { value: this.sunDir },
          glowStrength: { value: 0 },
          glowPower: { value: 1 },
          sunset: { value: 0 },
        },
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        fog: false,
      }),
    )
    this.dome.renderOrder = -2
    this.dome.frustumCulled = false

    this.sun = new THREE.Mesh(
      new THREE.CircleGeometry(SUN_RADIUS, SUN_SIDES),
      new THREE.ShaderMaterial({
        vertexShader: diskVertex,
        fragmentShader: diskFragment,
        uniforms: { color: { value: new THREE.Color() } },
        depthWrite: false,
        depthTest: false,
        fog: false,
      }),
    )
    this.sun.renderOrder = -1
    this.sun.frustumCulled = false

    this.stars = new THREE.Points(
      starGeometry(),
      new THREE.ShaderMaterial({
        vertexShader: starVertex,
        fragmentShader: starFragment,
        uniforms: { opacity: { value: 0 }, pixelRatio: { value: 1 }, time: { value: 0 } },
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        fog: false,
      }),
    )
    this.stars.renderOrder = -1.75
    this.stars.frustumCulled = false

    this.moonHalo = new THREE.Mesh(
      new THREE.CircleGeometry(1, 24),
      new THREE.ShaderMaterial({
        vertexShader: moonVertex,
        fragmentShader: haloFragment,
        uniforms: { color: { value: MOON_HALO_COLOR.clone() }, strength: { value: 0 } },
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        fog: false,
      }),
    )
    this.moonHalo.renderOrder = -1.5
    this.moonHalo.frustumCulled = false

    // Opaca: tapa las estrellas que tiene detrás, también por la parte en sombra. Va marcada como transparente para
    // dibujarse en la misma lista que el halo y las estrellas, por orden: si no, el halo se sumaría encima.
    this.moon = new THREE.Mesh(
      new THREE.CircleGeometry(1, MOON_SIDES),
      new THREE.ShaderMaterial({
        vertexShader: moonVertex,
        fragmentShader: moonFragment,
        uniforms: {
          lit: { value: MOON_LIT.clone() },
          crater: { value: MOON_CRATER.clone() },
          shade: { value: new THREE.Color() },
          phase: { value: 0.5 },
        },
        transparent: true,
        depthWrite: false,
        depthTest: false,
        fog: false,
      }),
    )
    this.moon.renderOrder = -1
    this.moon.frustumCulled = false
    this.scene.add(this.dome, this.stars, this.moonHalo, this.moon, this.sun)
  }

  /** Las estrellas tienen un tamaño fijo en píxeles: hay que saber cuántos píxeles reales tiene uno CSS. */
  setPixelRatio(ratio: number) {
    this.stars.material.uniforms.pixelRatio.value = ratio
  }

  /**
   * Coloca el cielo para la fase `phase` alrededor de la cámara `view`. `horizon` es el color de la niebla de ahora
   * (ya con la Noche Eterna), y `eternal` (0..1) oscurece el cénit y apaga el brillo y el sol igual que la niebla.
   * `moonPhase` es la fase de la luna de esta noche (ver `moonPhaseOf`). La luna y las estrellas no se apagan con
   * `eternal`: en la Noche Eterna se ven sobre el cielo negro.
   */
  update(state: SkyState, phase: number, view: THREE.Vector3, horizon: THREE.Color, eternal = 0, moonPhase = 0.5) {
    sunDirection(phase, this.sunDir)
    const u = this.dome.material.uniforms
    u.horizon.value.copy(horizon)
    u.zenith.value.copy(state.zenith).lerp(horizon, eternal)
    u.glowColor.value.copy(state.glow)
    u.glowStrength.value = state.glowStrength * (1 - eternal)
    u.glowPower.value = state.glowPower
    u.sunset.value = state.sunset * (1 - eternal)
    this.dome.position.copy(view)

    // Visible mientras asome algo del disco sobre el horizonte; lo de abajo lo recorta el shader.
    const radius = (SUN_RADIUS * state.sunScale) / SUN_DISTANCE
    this.sun.visible = this.sunDir.y > -radius && eternal < 1
    this.sun.position.copy(view).addScaledVector(this.sunDir, SUN_DISTANCE)
    this.sun.scale.setScalar(state.sunScale)
    this.sun.lookAt(scratch.copy(view))
    this.sun.material.uniforms.color.value.copy(state.sunColor).lerp(horizon, eternal)

    // Las estrellas giran con el cielo sobre su eje, con el mismo ángulo que el sol, y salen al anochecer.
    this.stars.position.copy(view)
    this.stars.quaternion.setFromAxisAngle(SKY_AXIS, skyAngle(phase))
    const su = this.stars.material.uniforms
    su.opacity.value = starsOf(this.sunDir.y)
    su.time.value = performance.now() / 1000
    this.stars.visible = su.opacity.value > 0

    // La luna, enfrente del sol, mirando a la cámara, con su +x hacia donde va (hacia el sol escondido).
    this.moonDir.copy(this.sunDir).negate()
    const moonRadius = MOON_RADIUS / MOON_DISTANCE
    this.moon.visible = this.moonDir.y > -moonRadius
    this.moonHalo.visible = this.moon.visible
    this.moon.position.copy(view).addScaledVector(this.moonDir, MOON_DISTANCE)
    this.moon.scale.setScalar(MOON_RADIUS)
    facing.copy(this.moonDir).negate()
    tangent.crossVectors(SKY_AXIS, this.moonDir).normalize()
    side.crossVectors(facing, tangent)
    this.moon.quaternion.setFromRotationMatrix(basis.makeBasis(tangent, side, facing))
    this.moonHalo.position.copy(this.moon.position)
    this.moonHalo.quaternion.copy(this.moon.quaternion)
    this.moonHalo.scale.setScalar(MOON_RADIUS * MOON_HALO)

    const mu = this.moon.material.uniforms
    mu.phase.value = THREE.MathUtils.euclideanModulo(moonPhase, 1)
    // La parte en sombra es el cielo que tiene detrás, apenas aclarado (la luz de la Tierra). En lineal: poco da mucho.
    const sky = mu.shade.value.copy(horizon).lerp(u.zenith.value, THREE.MathUtils.smoothstep(this.moonDir.y, 0, 0.7))
    sky.lerp(MOON_LIT, 0.006)
    // El halo crece con la parte iluminada y se nota solo de noche.
    const lit = (1 - Math.cos(2 * Math.PI * mu.phase.value)) / 2
    this.moonHalo.material.uniforms.strength.value = 0.35 * lit * (0.3 + 0.7 * su.opacity.value)
  }
}

/** Cuánto se ven las estrellas con el sol a la altura `sunY`: nada de día, del todo pasado el anochecer. */
export const starsOf = (sunY: number) => 1 - THREE.MathUtils.smoothstep(sunY, -0.25, -0.03)
