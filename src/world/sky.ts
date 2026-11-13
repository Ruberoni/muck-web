import * as THREE from 'three'
import { sunDirection, type SkyState } from './daycycle'

/** Radio de la cúpula del cielo: dentro del `far` de la cámara (600). */
export const DOME_RADIUS = 450
/** Distancia del disco del sol a la cámara (por dentro de la cúpula). */
export const SUN_DISTANCE = 400
/** Radio del disco del sol a mediodía (unos 2,5°: grande, como en un juego low-poly). */
const SUN_RADIUS = 17
/** Lados del disco del sol: low-poly. */
const SUN_SIDES = 12

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

const scratch = new THREE.Vector3()

/**
 * El cielo: una cúpula con degradado (horizonte = niebla, cénit más oscuro) y brillo hacia el sol, y el disco del sol.
 * Va en su propia escena, sin niebla y sin escribir profundidad: se dibuja antes que la principal y la isla queda encima.
 * Sigue a la cámara.
 */
export class SkyView {
  readonly scene = new THREE.Scene()
  readonly dome: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>
  readonly sun: THREE.Mesh<THREE.CircleGeometry, THREE.ShaderMaterial>
  /** Hacia el sol (no hacia la luz: de noche la luz es la luna). */
  readonly sunDir = new THREE.Vector3()

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
    this.scene.add(this.dome, this.sun)
  }

  /**
   * Coloca el cielo para la fase `phase` alrededor de la cámara `view`. `horizon` es el color de la niebla de ahora
   * (ya con la Noche Eterna), y `eternal` (0..1) oscurece el cénit y apaga el brillo y el sol igual que la niebla.
   */
  update(state: SkyState, phase: number, view: THREE.Vector3, horizon: THREE.Color, eternal = 0) {
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
  }
}
