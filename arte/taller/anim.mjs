// Animaciones hechas a mano sobre el esqueleto del jugador (animations.glb): se parte de la primera pose de Idle y
// se apuntan los huesos hacia direcciones del espacio del modelo (mira a +Z, arriba es +Y, el brazo derecho está
// en −X). Cuaterniones como en glTF: [x, y, z, w].

export const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
]
export const qinv = (q) => [-q[0], -q[1], -q[2], q[3]]
export const qrot = (q, v) => qmul(qmul(q, [...v, 0]), qinv(q)).slice(0, 3)
const unit = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l) }
const sub3 = (a, b) => a.map((x, i) => x - b[i])
export const qaxis = (axis, deg) => { const a = unit(axis), h = (deg * Math.PI) / 360; return [...a.map((x) => x * Math.sin(h)), Math.cos(h)] }
/** La rotación más corta que lleva la dirección `a` a la `b`. */
export function qfromto(a, b) {
  a = unit(a); b = unit(b)
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  if (d < -0.9999) return qaxis(Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], 180)
  const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  return unit([...c, 1 + d])
}

/** Una pose que se puede ir torciendo: rotaciones y traslaciones locales de cada nodo, y su cinemática directa. */
export class Pose {
  constructor(doc, clipName = 'Idle') {
    const root = doc.getRoot()
    this.nodes = root.listNodes()
    this.parent = new Map()
    for (const n of this.nodes) for (const c of n.listChildren()) this.parent.set(c, n)
    this.byName = Object.fromEntries(this.nodes.map((n) => [n.getName(), n]))
    this.R = new Map(this.nodes.map((n) => [n, n.getRotation()]))
    this.T = new Map(this.nodes.map((n) => [n, n.getTranslation()]))
    const clip = root.listAnimations().find((a) => a.getName() === clipName)
    this.animated = []
    for (const ch of clip.listChannels()) {
      const node = ch.getTargetNode(), path = ch.getTargetPath()
      if (path !== 'rotation' && path !== 'translation') continue
      const first = ch.getSampler().getOutput().getElement(0, [])
      ;(path === 'rotation' ? this.R : this.T).set(node, first)
      this.animated.push([node, path])
    }
  }
  clone() {
    const p = Object.create(Pose.prototype)
    Object.assign(p, this, { R: new Map(this.R), T: new Map(this.T) })
    p.ref ??= this // la pose de partida: de ella salen los largos de las piernas
    return p
  }
  /** Rotación y posición en el espacio del modelo. */
  world(node) {
    const chain = []
    for (let n = node; n; n = this.parent.get(n)) chain.unshift(n)
    let q = [0, 0, 0, 1], p = [0, 0, 0]
    for (const n of chain) {
      const t = qrot(q, this.T.get(n))
      p = p.map((x, i) => x + t[i])
      q = qmul(q, this.R.get(n))
    }
    return { q, p }
  }
  /** Gira el hueso `name` por `D`, una rotación del espacio del modelo. */
  turn(name, D) {
    const n = this.byName[name], par = this.parent.get(n)
    const wp = par ? this.world(par).q : [0, 0, 0, 1]
    this.R.set(n, qmul(qinv(wp), qmul(D, this.world(n).q)))
    return this
  }
  /** Apunta el hueso `name` (de él a su hijo `child`) hacia la dirección `dir` del espacio del modelo. */
  aim(name, child, dir) {
    const a = this.world(this.byName[name]).p, b = this.world(this.byName[child]).p
    return this.turn(name, qfromto(b.map((x, i) => x - a[i]), dir))
  }
  /** Mueve el nodo `name` por `delta`, en el espacio del modelo. */
  move(name, delta) {
    const n = this.byName[name], par = this.parent.get(n)
    const d = par ? qrot(qinv(this.world(par).q), delta) : delta
    this.T.set(n, this.T.get(n).map((x, i) => x + d[i]))
    return this
  }
  /**
   * Dobla la pierna `side` ('L' o 'R') para que el tobillo llegue al pie (el nodo Foot cuelga de Root, como un
   * objetivo de IK): sirve después de bajar o subir el cuerpo. La rodilla va hacia adelante.
   */
  legIK(side) {
    const up = this.byName[`UpperLeg.${side}`], low = this.byName[`LowerLeg.${side}`], foot = this.byName[`Foot.${side}`]
    const ref = this.ref ?? this
    const rw = (n) => ref.world(n)
    const L1 = Math.hypot(...sub3(rw(low).p, rw(up).p)), L2 = Math.hypot(...sub3(rw(foot).p, rw(low).p))
    // Hacia dónde va la canilla, en el espacio de LowerLeg (sale de la pose de partida).
    const shin = qrot(qinv(rw(low).q), sub3(rw(foot).p, rw(low).p))
    const hip = this.world(up).p, target = this.world(foot).p
    const D = sub3(target, hip), d = Math.min(Math.hypot(...D), (L1 + L2) * 0.999)
    const dn = unit(D)
    const cosA = Math.max(-1, Math.min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d)))
    const sinA = Math.sqrt(1 - cosA * cosA)
    const fwd = [side === 'L' ? 0.12 : -0.12, 0, 1]
    const k = fwd[0] * dn[0] + fwd[1] * dn[1] + fwd[2] * dn[2]
    const perp = unit(fwd.map((x, i) => x - dn[i] * k))
    const knee = hip.map((x, i) => x + L1 * (dn[i] * cosA + perp[i] * sinA))
    this.turn(up.getName(), qfromto(sub3(this.world(low).p, hip), sub3(knee, hip)))
    const now = qrot(this.world(low).q, shin)
    this.turn(low.getName(), qfromto(now, sub3(target, this.world(low).p)))
    return this
  }
  /** La rotación local que debe tener un hijo de `name` para que su +Z apunte a `dir` en el espacio del modelo. */
  pointChild(name, dir) {
    return qmul(qinv(this.world(this.byName[name]).q), qfromto([0, 0, 1], dir))
  }
}

/**
 * Agrega a `doc` una animación `name` con las poses `keys` ([tiempo, Pose]); los nodos que la Idle anima y que
 * ninguna pose cambia quedan quietos en la primera pose de la Idle. `extra` agrega pistas a mano:
 * [{ node, path, times, values, interpolation }].
 */
export function addClip(doc, name, keys, extra = []) {
  const root = doc.getRoot(), buffer = root.listBuffers()[0]
  const anim = doc.createAnimation(name)
  const acc = (type, arr) => doc.createAccessor().setType(type).setArray(new Float32Array(arr)).setBuffer(buffer)
  const track = (node, path, times, values, interpolation = 'LINEAR') => {
    const sampler = doc.createAnimationSampler().setInput(acc('SCALAR', times)).setOutput(acc(path === 'rotation' ? 'VEC4' : 'VEC3', values.flat())).setInterpolation(interpolation)
    anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler))
  }
  const times = keys.map(([t]) => t)
  const base = keys[0][1]
  const tracks = [...base.animated]
  const has = new Set(tracks.map(([n, p]) => `${n.getName()}|${p}`))
  for (const node of base.nodes) {
    const moved = keys.some(([, p]) => p.R.get(node).some((x, i) => Math.abs(x - base.R.get(node)[i]) > 1e-6))
    if (moved && !has.has(`${node.getName()}|rotation`)) tracks.push([node, 'rotation'])
    const shifted = keys.some(([, p]) => p.T.get(node).some((x, i) => Math.abs(x - base.T.get(node)[i]) > 1e-6))
    if (shifted && !has.has(`${node.getName()}|translation`)) tracks.push([node, 'translation'])
  }
  for (const [node, path] of tracks) {
    const values = keys.map(([, p]) => [...(path === 'rotation' ? p.R : p.T).get(node)])
    if (path === 'rotation') for (let i = 1; i < values.length; i++) {
      // Por el camino corto: q y −q son la misma rotación.
      const d = values[i].reduce((s, x, k) => s + x * values[i - 1][k], 0)
      if (d < 0) values[i] = values[i].map((x) => -x)
    }
    track(node, path, times, values)
  }
  for (const e of extra) track(e.node, e.path, e.times, e.values, e.interpolation)
  return anim
}
