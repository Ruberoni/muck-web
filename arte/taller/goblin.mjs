// Monta el goblin de joney_lol (malla suelta en cruz, sin esqueleto) sobre el esqueleto del jugador y le da las
// apariencias del trasgo: base, noche y totem (más musculoso). Los colores cambian por papel: Piel, Ropa, Ojos, Dientes.
// node goblin.mjs <Goblin.glb> <Casual.glb> <animations.glb> <salida.glb>
// APARIENCIAS=tonos para probar colores de piel; PIEL=#rrggbb para la piel de la apariencia base.
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { add, mul } from './rig.mjs'
import { montar } from './montar.mjs'

const [goblinPath, skinPath, animPath, outPath] = process.argv.slice(2)
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const [goblin, skinDoc, doc] = await Promise.all([goblinPath, skinPath, animPath].map((p) => io.read(p)))

// ---------- la malla, en metros, con un papel por cara ----------
const HEIGHT = 1.45
const ROLE = { 'Material.005': 'Piel', 'Material.004': 'Ropa', 'Material.001': 'Ojos', 'Material.006': 'Dientes' }
const orig = [], faces = []
for (const node of goblin.getRoot().listNodes()) {
  const mesh = node.getMesh()
  if (!mesh) continue
  for (const prim of mesh.listPrimitives()) {
    const P = prim.getAttribute('POSITION'), I = prim.getIndices()
    const base = orig.length
    for (let i = 0; i < P.getCount(); i++) orig.push(P.getElement(i, []))
    const n = I ? I.getCount() : P.getCount()
    const role = ROLE[prim.getMaterial()?.getName()] ?? 'Piel'
    for (let t = 0; t < n; t += 3) faces.push({ role, ids: [0, 1, 2].map((k) => base + (I ? I.getScalar(t + k) : t + k)) })
  }
}
// Los brazos son cajas largas sin vértices en medio: sin subdividirlos no se pueden doblar por el codo.
/** Caras del brazo desnudo: van del hombro (|x| ≈ 0.16) al guante (|x| ≈ 0.37), sin orejas ni guantes. */
const isArmFace = (ids) => {
  const ps = ids.map((i) => orig[i]), ax = ps.map((p) => Math.abs(p[0]))
  return ps.every((p) => Math.abs(p[0]) > 0.13 && p[1] > -0.2 && p[1] < 0.16) && Math.min(...ax) < 0.3 && Math.max(...ax) < 0.41
}
const mids = new Map()
function mid(a, b) {
  const key = a < b ? `${a},${b}` : `${b},${a}`
  if (!mids.has(key)) { orig.push(orig[a].map((v, k) => (v + orig[b][k]) / 2)); mids.set(key, orig.length - 1) }
  return mids.get(key)
}
for (let level = 0; level < 2; level++) {
  for (const f of [...faces]) {
    if (!isArmFace(f.ids)) continue
    const [a, b, c] = f.ids, ab = mid(a, b), bc = mid(b, c), ca = mid(c, a)
    f.ids = [a, ab, ca]
    faces.push({ role: f.role, ids: [ab, b, bc] }, { role: f.role, ids: [ca, bc, c] }, { role: f.role, ids: [ab, bc, ca] })
  }
}
const minY = Math.min(...orig.map((p) => p[1])), maxY = Math.max(...orig.map((p) => p[1]))
const S = HEIGHT / (maxY - minY)
const Y = (y) => (y - minY) * S
const verts = orig.map((p) => [p[0] * S, Y(p[1]), p[2] * S])
const all = [...orig.keys()]
const ox = (i) => orig[i][0], oy = (i) => orig[i][1]
const centroid = (ids) => mul(ids.reduce((a, i) => add(a, verts[i]), [0, 0, 0]), 1 / ids.length)

// ---------- puntos (en las unidades del archivo: y de -0.9 a 0.42, brazos en cruz hasta x ±0.5) ----------
const side = (s) => {
  // Hombro: el arranque del brazo; muñeca: donde empieza el guante; codo, a medio camino.
  const Sh = centroid(all.filter((i) => s * ox(i) > 0.14 && s * ox(i) < 0.2 && oy(i) > -0.03 && oy(i) < 0.13))
  const W = centroid(all.filter((i) => s * ox(i) > 0.35 && s * ox(i) < 0.39 && oy(i) > -0.2 && oy(i) < 0.05))
  const E = [(Sh[0] + W[0]) / 2, (Sh[1] + W[1]) / 2 - 0.01, (Sh[2] + W[2]) / 2]
  const hand = all.filter((i) => s * ox(i) > 0.36 && oy(i) > -0.3)
  const F = centroid(hand)
  const leg = all.filter((i) => s * ox(i) > 0.005 && s * ox(i) < 0.2 && oy(i) < -0.3)
  const slice = (lo, hi) => centroid(leg.filter((i) => oy(i) >= lo && oy(i) < hi))
  const hip = slice(-0.36, -0.3), knee = slice(-0.66, -0.54), ankle = slice(-0.86, -0.78)
  const toe = leg.filter((i) => oy(i) < -0.82).reduce((a, i) => (verts[i][2] > verts[a][2] ? i : a))
  return {
    Sh, E, W, F,
    H: [hip[0], Y(-0.27), hip[2]], K: [knee[0], Y(-0.6), knee[2]], A: [ankle[0], 0.02, ankle[2]], Toe: [ankle[0], 0.02, verts[toe][2]],
  }
}
const L = side(1), R = side(-1)
const neck = centroid(all.filter((i) => oy(i) > 0.12 && oy(i) < 0.2 && Math.abs(ox(i)) < 0.08))
const N = [0, Y(0.16), neck[2]]
const HC = [0, L.H[1], (L.H[2] + R.H[2]) / 2]
const headIds = all.filter((i) => oy(i) > 0.17)
if (process.env.DEBUG) console.log(JSON.stringify({ L, R, N, HC }, (k, v) => (typeof v === 'number' ? +v.toFixed(3) : v)))

/** Los huesos que pueden mover cada vértice, según la zona del cuerpo en que está. */
function candidates(i) {
  const x = ox(i), y = oy(i), s = x >= 0 ? 'L' : 'R', ax = Math.abs(x)
  if (y > 0.2) return ['Head']
  if (y > 0.12 && ax < 0.1) return ['Neck', 'Head', 'Chest']
  if (ax > 0.15 && y > -0.3) return [`UpperArm.${s}`, `LowerArm.${s}`, `Wrist.${s}`]
  if (ax > 0.09 && y > 0.0) return [`Shoulder.${s}`, `UpperArm.${s}`, 'Chest']
  if (y < -0.33) return [`UpperLeg.${s}`, `LowerLeg.${s}`, `Foot.${s}`]
  if (y < -0.2) return ['Hips', `UpperLeg.${s}`]
  return ['Hips', 'Abdomen', 'Torso', 'Chest', `Shoulder.${s}`]
}

// ---------- apariencias ----------
const PRESETS = {
  // Pieles para elegir (con la ropa de cuero de la base).
  tonos: {
    verde: { Piel: { color: '#5f9a3a' } }, claro: { Piel: { color: '#e0b48e' } }, trigueno: { Piel: { color: '#c38a5c' } },
    moreno: { Piel: { color: '#8e5b3a' } }, oscuro: { Piel: { color: '#5b3b28' } },
  },
  apariencias: {
    base: {
      Piel: { color: process.env.PIEL ?? '#8e5b3a' }, Ropa: { color: '#4a3423' },
      Ojos: { color: '#ffe066', emissive: '#5a4400' }, Dientes: { color: '#e8dcc0' },
    },
    noche: {
      Piel: { color: '#3b3533' }, Ropa: { color: '#121116' },
      Ojos: { color: '#d4c2ff', emissive: '#b48cff' }, Dientes: { color: '#8f8a99' },
    },
    totem: {
      Piel: { color: '#8c4a30' }, Ropa: { color: '#3a1610' },
      Ojos: { color: '#ffb36b', emissive: '#ff5a1f' }, Dientes: { color: '#d9ccb0' },
    },
  },
}
const DEFAULTS = { Piel: { color: '#8e5b3a' }, Ropa: { color: '#4a3423' }, Ojos: { color: '#ffe066', emissive: '#5a4400' }, Dientes: { color: '#e8dcc0' } }

await montar({
  io, doc, skinDoc, verts, faces, L, R, N, HC, top: Y(maxY), candidates, headIds,
  looks: PRESETS[process.env.APARIENCIAS ?? 'apariencias'], defaults: DEFAULTS, label: 'goblin', outPath,
})
