// Pasar animaciones de un modelo sobre el esqueleto del jugador (`src`) a otro modelo con su propio esqueleto (`doc`),
// sin tocar su malla: cada hueso del destino gira en el mundo lo mismo que su par en el jugador, desde la pose en
// cruz de los dos; la cadera además se mueve (escalada a su altura). Las armas del jugador (nodos colgados de una mano)
// giran en el mundo como las suyas. Lo usan gigante.mjs y coloso-lowpo.mjs.
import { bindPositions } from './lib.mjs'
import { invert4 } from './rig.mjs'
import { qinv, qmul, qrot } from './anim.mjs'

const add = (a, b) => a.map((x, i) => x + b[i])
const sub = (a, b) => a.map((x, i) => x - b[i])
const mul = (a, s) => a.map((x) => x * s)
const qnorm = (q) => { const l = Math.hypot(...q) || 1; return q.map((x) => x / l) }
const slerp = (a, b, t) => {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
  if (d < 0) { b = b.map((x) => -x); d = -d }
  if (d > 0.9995) return qnorm(a.map((x, i) => x + (b[i] - x) * t))
  const th = Math.acos(d), s = Math.sin(th)
  return a.map((x, i) => (x * Math.sin((1 - t) * th) + b[i] * Math.sin(t * th)) / s)
}
/** Rotación (cuaternión) de la parte 3×3 de una matriz 4×4 en columnas (sin escala). */
export function quatOf(m) {
  const n3 = (v) => mul(v, 1 / (Math.hypot(...v) || 1))
  const c = [[m[0], m[1], m[2]], [m[4], m[5], m[6]], [m[8], m[9], m[10]]].map(n3)
  const [m00, m10, m20] = c[0], [m01, m11, m21] = c[1], [m02, m12, m22] = c[2]
  const tr = m00 + m11 + m22
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; return [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4] }
  if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; return [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s] }
  if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; return [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s] }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2; return [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s]
}
/** Rotación de reposo (en cruz) de un hueso, en el mundo: de las matrices de bind. */
export function restQ(d, name) {
  const sk = d.getRoot().listSkins()[0], i = sk.listJoints().findIndex((j) => j.getName() === name)
  if (i < 0) throw new Error(`no hay hueso ${name}`)
  return quatOf(invert4(sk.getInverseBindMatrices().getElement(i, [])))
}

function sample(ch, t) {
  const s = ch.getSampler(), times = s.getInput().getArray(), out = s.getOutput(), n = times.length
  const get = (i) => out.getElement(i, [])
  if (t <= times[0]) return get(0)
  if (t >= times[n - 1]) return get(n - 1)
  let i = 0
  while (times[i + 1] < t) i++
  if (s.getInterpolation() === 'STEP') return get(i)
  const f = (t - times[i]) / (times[i + 1] - times[i])
  return ch.getTargetPath() === 'rotation' ? slerp(get(i), get(i + 1), f) : get(i).map((x, k) => x + (get(i + 1)[k] - x) * f)
}

/**
 * Escribe en `doc` las animaciones de `src` (borra las que tuviera). `MAP`: hueso del destino → hueso del jugador.
 * `pelvis`: el hueso del destino que además se mueve, como `Hips` del jugador. `weapons`: [{ node, hand, from }]:
 * el nodo `node` (ya colgado del hueso `hand` del destino) gira como el nodo `from` del jugador, y se esconde con él.
 * Devuelve la función que da la rotación del arma en el primer cuadro de la pose quieta, para dejarla de reposo.
 */
export function retarget({ doc, src, MAP, pelvis, weapons = [], fps = 30 }) {
  const root = doc.getRoot(), buffer = root.listBuffers()[0]
  const U = bindPositions(root.listSkins()[0])
  const uNode = Object.fromEntries(root.listNodes().map((n) => [n.getName(), n]))
  const parentOf = new Map()
  for (const n of root.listNodes()) for (const c of n.listChildren()) parentOf.set(c, n)
  const sRoot = src.getRoot(), sNodes = sRoot.listNodes(), sByName = Object.fromEntries(sNodes.map((n) => [n.getName(), n]))
  const sParent = new Map()
  for (const n of sNodes) for (const c of n.listChildren()) sParent.set(c, n)
  const S = bindPositions(sRoot.listSkins()[0])
  const uRest = Object.fromEntries(Object.keys(MAP).map((u) => [u, restQ(doc, u)]))
  const sRest = Object.fromEntries(Object.values(MAP).map((o) => [o, restQ(src, o)]))
  const HIP_SCALE = U[pelvis][1] / S.Hips[1]

  function sourcePose(anim, t) {
    const R = new Map(sNodes.map((n) => [n, n.getRotation()])), T = new Map(sNodes.map((n) => [n, n.getTranslation()])), Sc = new Map(sNodes.map((n) => [n, n.getScale()]))
    for (const ch of anim.listChannels()) {
      const n = ch.getTargetNode(), p = ch.getTargetPath()
      ;(p === 'rotation' ? R : p === 'translation' ? T : Sc).set(n, sample(ch, t))
    }
    const W = new Map()
    const world = (n) => {
      if (W.has(n)) return W.get(n)
      const par = sParent.get(n), pw = par ? world(par) : { q: [0, 0, 0, 1], p: [0, 0, 0] }
      const w = { q: qmul(pw.q, R.get(n)), p: add(pw.p, qrot(pw.q, T.get(n))) }
      W.set(n, w)
      return w
    }
    return { world: (name) => world(sByName[name]), scale: (name) => Sc.get(sByName[name]) }
  }
  const order = []
  const visit = (n) => { order.push(n); for (const c of n.listChildren()) visit(c) }
  for (const n of root.listScenes()[0].listChildren()) visit(n)
  function targetPose(sp) {
    const W = new Map(), local = new Map()
    for (const n of order) {
      const par = parentOf.get(n), pw = par ? W.get(par) : { q: [0, 0, 0, 1], p: [0, 0, 0] }
      const name = n.getName()
      let q = n.getRotation(), t = n.getTranslation()
      if (MAP[name]) {
        const o = MAP[name]
        q = qnorm(qmul(qinv(pw.q), qmul(qmul(sp.world(o).q, qinv(sRest[o])), uRest[name])))
        if (name === pelvis) t = qrot(qinv(pw.q), sub(add(U[pelvis], mul(sub(sp.world('Hips').p, S.Hips), HIP_SCALE)), pw.p))
      }
      local.set(n, { q, t })
      W.set(n, { q: qmul(pw.q, q), p: add(pw.p, qrot(pw.q, t)) })
    }
    return { local, world: (name) => W.get(uNode[name]) }
  }

  for (const a of root.listAnimations()) { for (const c of a.listChannels()) c.dispose(); for (const s of a.listSamplers()) s.dispose(); a.dispose() }
  const acc = (type, arr) => doc.createAccessor().setType(type).setArray(new Float32Array(arr)).setBuffer(buffer)
  for (const sAnim of sRoot.listAnimations()) {
    const end = Math.max(...sAnim.listSamplers().map((s) => s.getInput().getMax([])[0]))
    const keys = new Set(sAnim.listSamplers().flatMap((s) => [...s.getInput().getArray()].map((t) => Math.round(t * 1000) / 1000)))
    for (let t = 0; t <= end; t += 1 / fps) keys.add(Math.round(t * 1000) / 1000)
    const times = [...keys].filter((t) => t <= end + 1e-6).sort((a, b) => a - b)
    const tracks = new Map()
    const push = (node, path, v) => { const k = `${node.getName()}|${path}`; if (!tracks.has(k)) tracks.set(k, { node, path, values: [] }); tracks.get(k).values.push(v) }
    for (const t of times) {
      const sp = sourcePose(sAnim, t), tp = targetPose(sp)
      for (const u of Object.keys(MAP)) push(uNode[u], 'rotation', tp.local.get(uNode[u]).q)
      push(uNode[pelvis], 'translation', tp.local.get(uNode[pelvis]).t)
      for (const w of weapons) {
        push(w.node, 'rotation', qnorm(qmul(qinv(tp.world(w.hand).q), sp.world(w.from).q)))
        push(w.node, 'scale', sp.scale(w.from))
      }
    }
    const anim = doc.createAnimation(sAnim.getName()).setExtras(sAnim.getExtras())
    for (const { node, path, values } of tracks.values()) {
      if (path === 'rotation') for (let i = 1; i < values.length; i++) if (values[i].reduce((s, x, k) => s + x * values[i - 1][k], 0) < 0) values[i] = values[i].map((x) => -x)
      if (path === 'scale' && values.every((v) => v[0] === values[0][0])) { node.setScale(values[0]); continue }
      const sampler = doc.createAnimationSampler().setInput(acc('SCALAR', times)).setOutput(acc(path === 'rotation' ? 'VEC4' : 'VEC3', values.flat()))
        .setInterpolation(path === 'scale' ? 'STEP' : 'LINEAR')
      anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler))
    }
    if (sAnim.getName() === 'Idle') for (const w of weapons) {
      const sp = sourcePose(sAnim, 0), tp = targetPose(sp)
      w.node.setRotation(qnorm(qmul(qinv(tp.world(w.hand).q), sp.world(w.from).q)))
    }
  }
}
