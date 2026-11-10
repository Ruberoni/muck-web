// Arma el trasgo de la tribu de la isla sobre el cuerpo de la skin Casual (el esqueleto del jugador): un guerrero
// descalzo, con taparrabo, corona de plumas, collar y brazaletes, y pintura en la cara, el pecho, los brazos y las
// piernas. Cuerpo de hombre, piernas algo más cortas y sombreado suave. Sale en dos tipos, con lanza y con cuchillo
// de piedra, que lleva en la mano donde el juego pone lo que se agarra.
// Tres apariencias como variantes de material: base, noche (la pintura brilla en violeta) y totem (más musculoso,
// la pintura como brasa); `totem_Trasgo` reemplaza a `Trasgo`, y las armas también cambian de material.
// node trasgo.mjs <Casual.glb> <animations.glb> <carpeta de salida>
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, KHRMaterialsVariants } from '@gltf-transform/extensions'
import { bindPositions, flatTri, lin, primitive, triangles, weightOf } from './lib.mjs'
import { invert4, restPose, scaledPositions, scaleSkeleton } from './rig.mjs'
import { Pose, addClip, qaxis, qinv, qmul } from './anim.mjs'

const [skinPath, animPath, outDir] = process.argv.slice(2)
// JEFE=gigante: el trasgo gigante, jefe de la tribu, en un solo archivo y con una sola apariencia: el cuerpo corpulento
// con músculos marcados, su tocado y su collar, un arco en la mano izquierda, la lanza en la derecha y un carcaj.
const JEFE = process.env.JEFE
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const src = await io.read(skinPath)
const bind = bindPositions(src.getRoot().listSkins()[0])
const { tris, joints } = triangles(src)
const J = (name) => joints.indexOf(name)
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
const centerOf = (t) => [0, 1, 2].map((k) => (t.vs[0].POSITION[k] + t.vs[1].POSITION[k] + t.vs[2].POSITION[k]) / 3)
const inside = (x, ranges) => ranges.some(([a, b]) => x >= a && x <= b)

// ---------- qué es cada triángulo: piel, pintura, adornos ----------
const isUpper = (t) => t.part.size > 2000
const isLegs = (t) => t.part.size > 500 && t.part.maxY < 1.2 && t.part.minY < 0.4
const isHair = (t) => !isUpper(t) && !isLegs(t) && t.color === '#8b7547'

const eyeTris = tris.filter((t) => t.color === '#31251c')
const eye = [0, 1, 2].map((k) => eyeTris.reduce((s, t) => s + Math.abs(centerOf(t)[k]), 0) / eyeTris.length) // |x|, y, z

const roles = { Piel: [], Pintura: [], Adorno: [], Taparrabo: [], Pelo: [], Ojos: [], Cejas: [], Plumas: [], PuntaPluma: [] }
for (const t of tris) {
  const [x, y, z] = centerOf(t), ax = Math.abs(x)
  let role = 'Piel'
  if (isHair(t)) role = 'Pelo'
  else if (t.color === '#31251c') role = 'Ojos'
  else if (t.color === '#3e3429') role = 'Cejas'
  else if (t.bone === 'Head' || t.bone === 'Neck') {
    // Dos rayas en cada mejilla y el collar en la base del cuello.
    const cheek = ax > eye[0] - 0.02 && ax < eye[0] + 0.03 && z > eye[2] - 0.035
    if (cheek && inside(y, [[eye[1] - 0.05, eye[1] - 0.032], [eye[1] - 0.075, eye[1] - 0.058]])) role = 'Pintura'
    else if (y < 1.53) role = 'Adorno'
  } else if (y > 1.485 && ax < 0.1) role = 'Adorno' // el collar
  else if (ax > 0.15 && y > 1.3) {
    // Brazos (en T): brazalete arriba y en la muñeca, dos rayas en el brazo y dos en el antebrazo.
    if (inside(ax, [[0.17, 0.205], [0.525, 0.555]])) role = 'Adorno'
    else if (inside(ax, [[0.245, 0.27], [0.29, 0.315], [0.405, 0.425], [0.445, 0.465]])) role = 'Pintura'
  } else if (y >= 0.94 && y < 1.04) role = 'Piel' // queda debajo de la faja
  else if (y >= 1.04) {
    // El pecho: una franja por el medio, de arriba abajo.
    if (ax < 0.032 && z > 0.06 && y < 1.43 && !JEFE) role = 'Pintura'
  } else if (y < 0.94) {
    // Piernas: dos rayas en el muslo, el adorno debajo de la rodilla y una raya en la canilla.
    if (inside(y, [[0.4, 0.47]])) role = 'Adorno'
    else if (inside(y, [[0.705, 0.73], [0.765, 0.79], [0.16, 0.19]])) role = 'Pintura'
  }
  roles[role].push(t)
}

// ---------- cabeza algo más grande ----------
const HEAD_GROW = 0.08
for (const t of tris) for (const v of t.vs) {
  const w = weightOf(v, joints, 'Head')
  if (w) v.POSITION = v.POSITION.map((x, i) => bind.Head[i] + (x - bind.Head[i]) * (1 + HEAD_GROW * w))
}

// ---------- corona de plumas ----------
// Una vincha alrededor de la frente y un abanico de plumas detrás de la cabeza, en el plano de la cara.
const skull = tris.filter((t) => t.bone === 'Head').flatMap((t) => t.vs.map((v) => v.POSITION))
const top = Math.max(...skull.map((p) => p[1]))
const bandY = eye[1] + 0.055
const bandPts = skull.filter((p) => Math.abs(p[1] - bandY) < 0.015)
const half = Math.max(...bandPts.map((p) => Math.abs(p[0]))) + 0.01
const zMin = Math.min(...bandPts.map((p) => p[2])) - 0.01, zMax = Math.max(...bandPts.map((p) => p[2])) + 0.01
const zMid = (zMin + zMax) / 2, zHalf = (zMax - zMin) / 2
const H = J('Head')
const SEG = 16
const ringAt = (a, y) => [Math.sin(a) * half, y, zMid + Math.cos(a) * zHalf]
for (let s = 0; s < SEG; s++) {
  const a0 = (s / SEG) * 2 * Math.PI, a1 = ((s + 1) / SEG) * 2 * Math.PI
  const [p, q, r, u] = [ringAt(a0, bandY - 0.015), ringAt(a1, bandY - 0.015), ringAt(a1, bandY + 0.018), ringAt(a0, bandY + 0.018)]
  roles.Adorno.push(flatTri(p, q, r, H), flatTri(p, r, u, H))
}
const fanCenter = [0, bandY + 0.01, zMid - 0.03]
const rx = half, ry = top - fanCenter[1] + 0.005
// El gigante lleva el tocado grande del jefe.
const CROWN = { gigante: { n: 19, length: 0.3, spread: 125 } }[JEFE] ?? { n: 13, length: 0.17, spread: 105 }
const FEATHERS = CROWN.n
for (let f = 0; f < FEATHERS; f++) {
  const a = (-CROWN.spread + (2 * CROWN.spread * f) / (FEATHERS - 1)) * (Math.PI / 180) // 0 = hacia arriba
  const dir = [Math.sin(a), Math.cos(a), 0]
  const side = [Math.cos(a), -Math.sin(a), 0]
  const r0 = Math.hypot(Math.sin(a) * rx, Math.cos(a) * ry) * 0.85
  const length = CROWN.length + 0.04 * Math.cos(a) // más largas arriba
  const at = (d, w, back) => [0, 1, 2].map((i) => fanCenter[i] + dir[i] * (r0 + d * length) + side[i] * w) .map((x, i) => (i === 2 ? x - back : x))
  const B = at(0, 0, 0), L1 = at(0.45, 0.022, 0.02), R1 = at(0.45, -0.022, 0.02), L2 = at(0.72, 0.017, 0.03), R2 = at(0.72, -0.017, 0.03), T = at(1, 0, 0.045)
  // En el tocado del jefe, una pluma sí y una no del otro color.
  const featherRole = JEFE === 'gigante' && f % 2 ? 'PlumasB' : 'Plumas'
  ;(roles[featherRole] ??= []).push(flatTri(B, R1, L1, H), flatTri(L1, R1, R2, H), flatTri(L1, R2, L2, H))
  roles.PuntaPluma.push(flatTri(L2, R2, T, H))
}

// ---------- taparrabo: una faja de tela enrollada en la cintura, que sobresale ----------
const bodyVerts = tris.filter((t) => isUpper(t) || isLegs(t)).flatMap((t) => t.vs)
const bodyPts = bodyVerts.map((v) => v.POSITION)
{
  // [alto, cuánto sobresale del cuerpo]: abultada en el medio, como un rollo de tela.
  const BELT = [[0.92, 0.004], [0.935, 0.02], [0.965, 0.032], [1.0, 0.034], [1.03, 0.026], [1.05, 0.006]]
  const SEGMENTS = 24
  const ring = bodyPts.filter((p) => p[1] > 0.9 && p[1] < 1.07)
  const cz = ring.reduce((s, p) => s + p[2], 0) / ring.length
  const vertex = (y, a, off) => {
    // Lo más saliente del cuerpo en esa dirección y a esa altura (la faja no se mete entre las piernas); la faja
    // toma los pesos de ese punto.
    const near = bodyVerts.filter((v) => Math.abs(v.POSITION[1] - y) < 0.03)
    let best = null, r = -Infinity
    for (const v of near) {
      const d = v.POSITION[0] * Math.sin(a) + (v.POSITION[2] - cz) * Math.cos(a)
      if (d > r) { r = d; best = v }
    }
    return { POSITION: [Math.sin(a) * (r + off), y, cz + Math.cos(a) * (r + off)], NORMAL: [0, 0, 1], COLOR_0: [1, 1, 1], JOINTS_0: [...best.JOINTS_0], WEIGHTS_0: [...best.WEIGHTS_0] }
  }
  const grid = BELT.map(([y, off]) => [...Array(SEGMENTS).keys()].map((s) => vertex(y, (s / SEGMENTS) * 2 * Math.PI, off)))
  const copy = (v) => ({ ...v, POSITION: [...v.POSITION], JOINTS_0: [...v.JOINTS_0], WEIGHTS_0: [...v.WEIGHTS_0] })
  /** Con el frente hacia afuera, para que el sombreado suave no la oscurezca. */
  const outward = (a, b, c) => {
    const u = b.POSITION.map((x, i) => x - a.POSITION[i]), w = c.POSITION.map((x, i) => x - a.POSITION[i])
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]
    const out = n[0] * a.POSITION[0] + n[2] * (a.POSITION[2] - cz) > 0
    return { vs: (out ? [a, b, c] : [a, c, b]).map(copy) }
  }
  for (let r = 0; r < BELT.length - 1; r++) for (let s = 0; s < SEGMENTS; s++) {
    const t = (s + 1) % SEGMENTS
    const [p, q, u, w] = [grid[r][s], grid[r][t], grid[r + 1][t], grid[r + 1][s]]
    roles.Taparrabo.push(outward(p, q, u), outward(p, u, w))
  }
}

// ---------- taparrabo: un paño por delante y otro por detrás, con flecos, colgando de la faja ----------
const HIPS = J('Hips'), UL = J('UpperLeg.L'), UR = J('UpperLeg.R')
function flap(front) {
  const sign = front ? 1 : -1
  const rows = [0.97, 0.84, 0.72, 0.62].map((y, r) => ({ y, w: [0.085, 0.08, 0.075, 0.07][r] }))
  // Cuelga recto: cada fila queda tan afuera como lo más saliente del cuerpo de ahí para arriba.
  let out = -Infinity
  for (const row of rows) {
    const near = bodyPts.filter((p) => Math.abs(p[0]) < row.w + 0.03 && p[1] > row.y - 0.04 && p[1] < 1.02)
    out = Math.max(out, ...near.map((p) => sign * p[2]))
    row.z = sign * (out + 0.038) // por fuera de la faja
  }
  const weights = [[1, 0, 0], [0.7, 0.15, 0.15], [0.45, 0.275, 0.275], [0.4, 0.3, 0.3]]
  const vert = (row, r, x) => ({ POSITION: [x, row.y, row.z], NORMAL: [0, 0, sign], COLOR_0: [1, 1, 1], JOINTS_0: [HIPS, UL, UR, 0], WEIGHTS_0: [...weights[r], 0] })
  const tri = (a, b, c) => ({ vs: [a, b, c].map((v) => ({ ...v, POSITION: [...v.POSITION] })), flat: true })
  for (let r = 0; r < rows.length - 1; r++) {
    const a = rows[r], b = rows[r + 1]
    const cols = [-1, 0, 1]
    for (let c = 0; c < 2; c++) {
      const p = vert(a, r, cols[c] * a.w), q = vert(a, r, cols[c + 1] * a.w), s = vert(b, r + 1, cols[c] * b.w), u = vert(b, r + 1, cols[c + 1] * b.w)
      // El frente de cada cara mira hacia afuera del cuerpo (si no, la luz la pinta del lado oscuro).
      if (front) roles.Taparrabo.push(tri(p, u, q), tri(p, s, u))
      else roles.Taparrabo.push(tri(p, q, u), tri(p, u, s))
    }
  }
  // Flecos en el borde de abajo.
  const last = rows[rows.length - 1]
  const FRINGE = 6
  for (let i = 0; i < FRINGE; i++) {
    const x0 = -last.w + (2 * last.w * i) / FRINGE, x1 = x0 + (2 * last.w) / FRINGE
    const tip = { ...vert(last, 3, (x0 + x1) / 2), POSITION: [(x0 + x1) / 2, last.y - 0.045 - (i % 2) * 0.015, last.z] }
    roles.Taparrabo.push(front ? tri(vert(last, 3, x1), vert(last, 3, x0), tip) : tri(vert(last, 3, x0), vert(last, 3, x1), tip))
  }
}
flap(true)
flap(false)

const allVerts = () => Object.values(roles).flat().flatMap((t) => t.vs)

// ---------- cuerpo de hombre ----------
// Pecho plano entre 1.27 y 1.45 de alto; caderas estrechas (hasta un 12 % menos) y menos glúteo de 0.8 a 1.12.
for (const v of allVerts()) {
  if (weightOf(v, joints, 'Head') > 0.5) continue
  const [x, y, z] = v.POSITION
  // Por delante, todo el pecho va casi a un mismo plano, algo inclinado (sin busto ni pliegue debajo).
  const chestLow = smooth(1.15, 1.22, y) * (1 - smooth(1.42, 1.47, y)) * (1 - smooth(0.13, 0.17, Math.abs(x)))
  const plane = 0.125 + 0.03 * smooth(1.18, 1.36, y)
  let nz = z > 0.09 ? z + (plane - z) * 0.92 * chestLow : z
  const hips = smooth(0.75, 0.88, y) * (1 - smooth(1.06, 1.15, y))
  if (nz < 0.02) nz = 0.02 + (nz - 0.02) * (1 - 0.45 * hips)
  // La cintura de la skin es de mujer: el torso se ensancha entre la cadera y el pecho.
  const waist = smooth(0.98, 1.08, y) * (1 - smooth(1.34, 1.44, y)) * (1 - smooth(0.17, 0.22, Math.abs(x)))
  v.POSITION = [x * (1 - 0.12 * hips) * (1 + 0.14 * waist), y, nz * (1 + 0.06 * waist)]
}

// ---------- piernas algo más cortas: el esqueleto nuevo ----------
const LEGS = Number(process.env.PIERNAS ?? 0.88)
const rest = restPose(src)
const k = {}
for (const n of ['Body', 'Hips', 'UpperLeg.L', 'UpperLeg.R', 'LowerLeg.L', 'LowerLeg.R', 'Foot.L', 'Foot.R', 'PT.L', 'PT.R']) k[n] = LEGS
// Hombros más anchos: los brazos salen más afuera.
const SHOULDERS = Number(process.env.HOMBROS ?? 1.5)
k['UpperArm.L'] = k['UpperArm.R'] = SHOULDERS
const pos = scaledPositions(rest, k)
const LEG_BONE = /^(UpperLeg|LowerLeg|Foot)\./
/**
 * Cada hueso de la pierna se acorta en alto (no en grosor); lo de arriba de la cadera baja entero, y los brazos
 * además se corren con sus hombros.
 */
function shorten(v) {
  const out = [0, 0, 0]
  let total = 0
  for (let s = 0; s < 4; s++) {
    const w = v.WEIGHTS_0[s]
    if (!w) continue
    const b = joints[v.JOINTS_0[s]], p = v.POSITION
    const q = LEG_BONE.test(b)
      ? [pos[b][0] + p[0] - rest.pos[b][0], pos[b][1] + (p[1] - rest.pos[b][1]) * LEGS, pos[b][2] + p[2] - rest.pos[b][2]]
      : p.map((x, i) => x + pos[b][i] - rest.pos[b][i])
    for (let i = 0; i < 3; i++) out[i] += q[i] * w
    total += w
  }
  return out.map((x) => x / total)
}
for (const v of allVerts()) v.POSITION = shorten(v)

// ---------- menos polígonos en el pelo y la piel ----------
// Cada parte se simplifica por su cuenta con los bordes fijos, así las costuras con la pintura no se abren.
const { MeshoptSimplifier } = await import('meshoptimizer')
await MeshoptSimplifier.ready
function simplifyRole(list, ratio, error = 0.02) {
  const key = (p) => p.map((x) => x.toFixed(5)).join()
  const ids = new Map(), verts = [], index = []
  for (const t of list) for (const v of t.vs) {
    const id = key(v.POSITION)
    if (!ids.has(id)) { ids.set(id, verts.length); verts.push(v) }
    index.push(ids.get(id))
  }
  const positions = new Float32Array(verts.flatMap((v) => v.POSITION))
  const target = Math.floor((index.length * ratio) / 3) * 3
  const [kept] = MeshoptSimplifier.simplify(new Uint32Array(index), positions, 3, target, error, ['LockBorder'])
  const out = []
  for (let i = 0; i < kept.length; i += 3) out.push({ vs: [0, 1, 2].map((j) => ({ ...verts[kept[i + j]], POSITION: [...verts[kept[i + j]].POSITION] })) })
  return out
}
roles.Pelo = simplifyRole(roles.Pelo, Number(process.env.PELO ?? 0.3))
roles.Piel = simplifyRole(roles.Piel, Number(process.env.PIEL ?? 0.5))

// ---------- músculo: algo en la base, mucho en el totem ----------
const CHILD = {
  'Shoulder.L': 'UpperArm.L', 'Shoulder.R': 'UpperArm.R', 'UpperArm.L': 'LowerArm.L', 'UpperArm.R': 'LowerArm.R',
  'LowerArm.L': 'Wrist.L', 'LowerArm.R': 'Wrist.R', 'Wrist.L': 'Middle1.L', 'Wrist.R': 'Middle1.R',
  Chest: 'Neck', Torso: 'Chest', Abdomen: 'Torso', Neck: 'Head', 'UpperLeg.L': 'LowerLeg.L', 'UpperLeg.R': 'LowerLeg.R', 'LowerLeg.L': 'Foot.L', 'LowerLeg.R': 'Foot.R',
}
const both = (o) => Object.fromEntries(Object.entries(o).flatMap(([b, f]) => (b.includes('*') ? [[b.replace('*', 'L'), f], [b.replace('*', 'R'), f]] : [[b, f]])))
const MUSCLE_BASE = both({ 'Shoulder.*': 1.18, 'UpperArm.*': 1.2, 'LowerArm.*': 1.12, Neck: 1.15, Chest: 1.1, 'UpperLeg.*': 1.06 })
/** Aleja el vértice del eje de cada hueso que lo mueve, en la proporción de su peso: sin grietas. */
function muscled(v, table) {
  const p = v.POSITION, out = [0, 0, 0]
  let total = 0
  for (let s = 0; s < 4; s++) {
    const w = v.WEIGHTS_0[s]
    if (!w) continue
    const b = joints[v.JOINTS_0[s]], f = table[b] ?? 1
    let q = p
    if (f !== 1 && CHILD[b]) {
      const a0 = pos[b], ab = pos[CHILD[b]].map((x, i) => x - a0[i]), ap = p.map((x, i) => x - a0[i])
      const t = Math.max(0, Math.min(1, (ab[0] * ap[0] + ab[1] * ap[1] + ab[2] * ap[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2)))
      const c = a0.map((x, i) => x + ab[i] * t)
      q = c.map((x, i) => x + (p[i] - x) * f)
    }
    for (let i = 0; i < 3; i++) out[i] += q[i] * w
    total += w
  }
  return out.map((x) => x / total)
}

/** Sombreado suave: en cada punto, la normal es el promedio de las caras que lo tocan (de todos los colores). */
function smoothNormals(byRole) {
  const key = (p) => p.map((x) => x.toFixed(4)).join()
  const acc = new Map()
  const soft = Object.values(byRole).flat().filter((t) => !t.flat)
  for (const t of soft) {
    const [a, b, c] = t.vs.map((v) => v.POSITION)
    const u = b.map((x, i) => x - a[i]), w = c.map((x, i) => x - a[i])
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]
    for (const v of t.vs) {
      const s = acc.get(key(v.POSITION)) ?? [0, 0, 0]
      acc.set(key(v.POSITION), s.map((x, i) => x + n[i]))
    }
  }
  for (const t of soft) for (const v of t.vs) {
    const n = acc.get(key(v.POSITION)), l = Math.hypot(...n) || 1
    v.NORMAL = n.map((x) => x / l)
  }
  return byRole
}
const withMuscle = (table) => smoothNormals(Object.fromEntries(Object.entries(roles).map(([role, list]) => [role, list.map((t) => ({
  flat: t.flat || role.startsWith('Plumas') || role === 'PuntaPluma',
  vs: t.vs.map((v) => ({ ...v, POSITION: muscled(v, table) })),
}))])))
// El de noche y el de tótem: corpulento, de espalda ancha y brazos gruesos (como el hombre de muestras/trasgo), y
// más grande: el juego lo agranda con `extras.escala` de la escena.
const MUSCLE_BIG = both({
  'Shoulder.*': 1.5, 'UpperArm.*': 1.5, 'LowerArm.*': 1.4, 'Wrist.*': 1.15, Chest: 1.3, Torso: 1.3, Abdomen: 1.18,
  Neck: 1.45, 'UpperLeg.*': 1.12, 'LowerLeg.*': 1.2,
})
const BIG_SIZE = Number(process.env.GRANDE ?? 1.3)
const body = withMuscle(MUSCLE_BASE)
const big = withMuscle(MUSCLE_BIG)

// ---------- músculos marcados (el gigante): pectorales, hombros, bíceps, trapecios y dorsales, y la cintura en V ----------
if (JEFE === 'gigante') {
  const C = pos.Chest, N = pos.Neck, A = pos.Abdomen
  const g = (d) => Math.exp(-d * d)
  const front = Math.max(...Object.values(big).flat().flatMap((t) => t.vs).filter((v) => Math.abs(v.POSITION[0]) < 0.05 && Math.abs(v.POSITION[1] - C[1]) < 0.04).map((v) => v.POSITION[2]))
  const sculpt = (p) => {
    let [x, y, z] = p
    const ax = Math.abs(x), sx = Math.sign(x) || 1
    const torso = ax < 0.2 && y > A[1] - 0.12 && y < N[1] + 0.06
    if (torso && z > 0.02) {
      // Pectorales: el frente del pecho se rehace como dos placas anchas, de borde de abajo marcado y separadas en el
      // medio, sobre el plano del esternón (lo que sobresalga, como el busto de la skin, se aplana).
      const box = (v, a, b, soft) => Math.min(smooth(a - soft, a, v), 1 - smooth(b, b + soft, v))
      const pec = box(ax, 0.015, 0.14, 0.03) * box(y, C[1] - 0.06, C[1] + 0.06, 0.012) * (0.7 + 0.3 * smooth(C[1] - 0.06, C[1] + 0.04, y))
      const chest = box(y, C[1] - 0.1, C[1] + 0.09, 0.02) * (1 - smooth(0.15, 0.19, ax))
      if (chest > 0) z = Math.min(z, front + 0.004 - 0.02 * (ax / 0.15) ** 2 + 0.03 * pec) * chest + z * (1 - chest)
      // Abdominales: tres filas de dos, suaves.
      for (const ry of [A[1] - 0.02, A[1] + 0.05, A[1] + 0.12]) z += 0.01 * g((ax - 0.032) / 0.022) * g((y - ry) / 0.022)
    }
    if (torso) {
      // Dorsales: el torso se ensancha arriba (en V) y se estrecha en la cintura.
      const lat = g((y - (C[1] - 0.06)) / 0.08) * g((ax - 0.15) / 0.06)
      const waist = g((y - (A[1] - 0.05)) / 0.07) * (ax > 0.08 ? 1 : 0)
      x += sx * (0.025 * lat - 0.018 * waist)
      // Trapecios: suben la línea del cuello al hombro.
      y += 0.03 * g((ax - 0.08) / 0.05) * g((y - (N[1] - 0.03)) / 0.04) * (z < front ? 1 : 0.3)
    }
    // Hombros (deltoides) y bíceps, en el brazo en cruz: hacia afuera del eje del brazo.
    const S = pos[x > 0 ? 'UpperArm.L' : 'UpperArm.R'], E = pos[x > 0 ? 'LowerArm.L' : 'LowerArm.R']
    if (ax > Math.abs(S[0]) - 0.06 && ax < Math.abs(E[0]) + 0.02) {
      const dy = y - S[1], dz = z - S[2], r = Math.hypot(dy, dz) || 1
      const delt = g((ax - Math.abs(S[0]) - 0.01) / 0.05)
      const bicep = g((ax - (Math.abs(S[0]) * 0.45 + Math.abs(E[0]) * 0.55)) / 0.06) * Math.max(0, dz / r)
      const tricep = g((ax - (Math.abs(S[0]) * 0.5 + Math.abs(E[0]) * 0.5)) / 0.07) * Math.max(0, -dz / r)
      const push = 0.03 * delt + 0.025 * bicep + 0.015 * tricep
      y += (dy / r) * push; z += (dz / r) * push
    }
    return [x, y, z]
  }
  for (const list of Object.values(big)) for (const t of list) for (const v of t.vs) if (!(weightOf(v, joints, 'Head') > 0.5)) v.POSITION = sculpt(v.POSITION)
  smoothNormals(big)
}

// ---------- adornos de los jefes (piezas pegadas a un hueso, en la pose de reposo ya con sus proporciones) ----------
if (JEFE) {
  const { rock, flat } = await import('./rocas.mjs')
  const bigPts = Object.values(big).flat().flatMap((t) => t.vs.map((v) => v.POSITION))
  /** Lo más adelante (o atrás, `side` −1) del cuerpo cerca de (x, y). */
  const surfaceZ = (x, y, side = 1, r = 0.03) => Math.max(...bigPts.filter((p) => Math.abs(p[0] - x) < r && Math.abs(p[1] - y) < r).map((p) => p[2] * side)) * side
  const add3 = (a, b) => a.map((x, i) => x + b[i]), mul3 = (a, f) => a.map((x) => x * f)
  const norm3 = (a) => mul3(a, 1 / Math.hypot(...a)), cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  const put = (list) => { for (const t of list) (big[t.role] ??= []).push({ ...t, flat: true }) }
  /** Un prisma de `sides` caras de `a` a `b`, cerrado, pegado a `bone`. */
  const bar = (role, a, b, r0, r1, bone, sides = 6) => {
    const d = norm3(b.map((x, i) => x - a[i])), u = norm3(cross3(d, Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0])), v = cross3(d, u)
    const ring = (c, r) => [...Array(sides)].map((_, i) => add3(c, add3(mul3(u, Math.cos((i / sides) * 2 * Math.PI) * r), mul3(v, Math.sin((i / sides) * 2 * Math.PI) * r))))
    const A = ring(a, r0), B = ring(b, r1), j = J(bone), out = []
    for (let i = 0; i < sides; i++) {
      const i2 = (i + 1) % sides
      out.push(flat(role, A[i], A[i2], B[i2], j), flat(role, a, A[i2], A[i], j))
      if (r1) out.push(flat(role, A[i], B[i2], B[i], j), flat(role, b, B[i], B[i2], j))
    }
    put(out)
  }
  if (JEFE === 'gigante') {
    // Collar de colmillos (de mentira: dientes grandes de madera clara) colgando sobre el pecho.
    const y0 = pos.Neck[1] - 0.06
    for (let i = 0; i < 11; i++) {
      const a = ((-70 + 14 * i) * Math.PI) / 180
      const x = Math.sin(a) * 0.12
      const z = surfaceZ(x, y0 - 0.02) + 0.012
      const at = [x, y0 - 0.02 - Math.cos(a) * 0.03, z]
      bar('Dientes', at, add3(at, [Math.sin(a) * 0.01, -0.075 + Math.abs(i - 5) * 0.004, 0.012]), 0.013, 0, 'Chest', 5)
    }
    // Un carcaj de cuero a la espalda, cruzado (la boca sobre el hombro derecho), con flechas.
    const yc = pos.Chest[1], back = surfaceZ(0, yc, -1, 0.06)
    const q0 = [0.1, yc - 0.2, back - 0.07], q1 = [-0.12, yc + 0.17, back - 0.09]
    bar('Cuero', q0, q1, 0.05, 0.055, 'Chest', 7)
    bar('Amarre', add3(q0, mul3(q1.map((x, i) => x - q0[i]), 0.82)), add3(q0, mul3(q1.map((x, i) => x - q0[i]), 0.9)), 0.058, 0.058, 'Chest', 7)
    const dir = norm3(q1.map((x, i) => x - q0[i]))
    for (const [ox, oz] of [[0.02, 0.015], [-0.015, 0.02], [0.0, -0.02], [-0.025, -0.005]]) {
      const a = add3(q1, [ox, -0.04, oz]), b = add3(a, mul3(dir, 0.16))
      bar('Madera', a, b, 0.006, 0.006, 'Chest', 4)
      const side = norm3(cross3(dir, [0, 0, 1]))
      const t1 = add3(b, mul3(dir, -0.07))
      put([flat('Plumas', add3(t1, mul3(side, 0.02)), b, add3(t1, mul3(side, -0.02)), J('Chest')), flat('Plumas', add3(t1, mul3(side, -0.02)), b, add3(t1, mul3(side, 0.02)), J('Chest'))])
    }
  }
}

// ---------- armas, en el espacio del agarre de la mano (la hoja va por +Z) ----------
// Prisma de `n` lados a lo largo de Z, de z0 a z1, con radio r0 abajo y r1 arriba.
function prism(list, z0, z1, r0, r1, n = 6, sx = 1) {
  const ring = (z, r) => [...Array(n).keys()].map((i) => [Math.cos((i / n) * 2 * Math.PI) * r * sx, Math.sin((i / n) * 2 * Math.PI) * r, z])
  const a = ring(z0, r0), b = ring(z1, r1)
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    if (r0 && r1) list.push(flatTri(a[i], a[j], b[j], 0), flatTri(a[i], b[j], b[i], 0))
    else if (r1) list.push(flatTri([0, 0, z0], b[j], b[i], 0))
    else list.push(flatTri(a[i], a[j], [0, 0, z1], 0))
  }
  if (r0 && !r1) return
  if (r0) for (let i = 1; i < n - 1; i++) list.push(flatTri(a[0], a[i + 1], a[i], 0))
}
const WEAPONS = {
  Lanza: () => {
    const p = { Madera: [], Amarre: [], Piedra: [] }
    prism(p.Madera, -0.78, 1.0, 0.014, 0.014)
    prism(p.Amarre, 0.95, 1.03, 0.02, 0.018)
    prism(p.Piedra, 1.01, 1.08, 0.012, 0.035, 4, 0.4) // la punta de piedra, plana
    prism(p.Piedra, 1.08, 1.28, 0.035, 0, 4, 0.4)
    return p
  },
  Cuchillo: () => {
    const p = { Madera: [], Amarre: [], Piedra: [] }
    prism(p.Madera, -0.06, 0.065, 0.016, 0.016)
    prism(p.Amarre, 0.055, 0.085, 0.021, 0.021)
    prism(p.Piedra, 0.08, 0.16, 0.02, 0.04, 4, 0.35) // hoja de pedernal en forma de hoja
    prism(p.Piedra, 0.16, 0.36, 0.04, 0, 4, 0.35)
    return p
  },
}
/**
 * El arco, en su espacio: las palas a lo largo de Z (de −0,55 a 0,55), curvadas hacia +Y en el medio (el agarre, en el
 * origen); la cuerda va de punta a punta, detrás.
 */
function bow() {
  const p = { Madera: [], Amarre: [], Cuerda: [] }
  const L = 0.55, D = 0.11
  const at = (z) => [0, D * (1 - (z / L) ** 2) - D, z]
  const seg = (list, a, b, r, n = 5) => {
    const d = b.map((x, i) => x - a[i]), l = Math.hypot(...d), u = d.map((x) => x / l)
    const ref = Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
    const v1 = [u[1] * ref[2] - u[2] * ref[1], u[2] * ref[0] - u[0] * ref[2], u[0] * ref[1] - u[1] * ref[0]], n1 = Math.hypot(...v1)
    const e1 = v1.map((x) => x / n1), e2 = [u[1] * e1[2] - u[2] * e1[1], u[2] * e1[0] - u[0] * e1[2], u[0] * e1[1] - u[1] * e1[0]]
    const ring = (c) => [...Array(n).keys()].map((i) => c.map((x, k) => x + (e1[k] * Math.cos((i / n) * 2 * Math.PI) + e2[k] * Math.sin((i / n) * 2 * Math.PI)) * r))
    const A = ring(a), B = ring(b)
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; list.push(flatTri(A[i], A[j], B[j], 0), flatTri(A[i], B[j], B[i], 0)) }
  }
  const STEPS = 10
  for (let i = 0; i < STEPS; i++) {
    const z0 = -L + (2 * L * i) / STEPS, z1 = -L + (2 * L * (i + 1)) / STEPS
    const r = 0.018 - 0.008 * Math.abs((z0 + z1) / 2) / L
    seg(p.Madera, at(z0), at(z1), r)
  }
  seg(p.Amarre, at(-0.07), at(0.07), 0.024, 6)
  seg(p.Cuerda, at(-L + 0.01), at(L - 0.01), 0.004, 3)
  return p
}
/** El cuaternión de la base (columnas X, Y, Z). */
function quatOfBasis(X, Y, Z) {
  const [m00, m10, m20] = X, [m01, m11, m21] = Y, [m02, m12, m22] = Z
  const tr = m00 + m11 + m22
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; return [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4] }
  if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; return [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s] }
  if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; return [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s] }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2; return [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s]
}

// Donde el juego pone lo que se lleva en la mano (src/view/CharacterRig.ts).
const HAND_BONE = 'Middle1.R'
const GRIP_POSITION = [-0.0004, 0.091, -0.025]
const GRIP_ROTATION = [0.497, -0.503, -0.503, 0.496]
// La lanza no va como la espada: en reposo, con el brazo colgando, queda parada junto al cuerpo.
const SPEAR_ROTATION = [0.467, 0.4799, -0.6546, 0.3508]

// ---------- apariencias ----------
const BASE_LOOK = {
  Piel: { color: '#8a5634' }, Pintura: { color: '#b3261e' }, Adorno: { color: '#2f63c4' }, Taparrabo: { color: '#ddd0b0' },
  Pelo: { color: '#1a1412' }, Ojos: { color: '#1c1410' }, Cejas: { color: '#1a1412' }, Plumas: { color: '#f2b62c' }, PuntaPluma: { color: '#c8341e' },
  Madera: { color: '#7a5230' }, Amarre: { color: '#c9a66b' }, Piedra: { color: '#8f9396' },
}
const BOSS_LOOKS = {
  // El jefe de la tribu: pintura blanca de guerra, adornos de oro, taparrabo rojo oscuro y un tocado de plumas rojas y
  // blancas con punta amarilla.
  gigante: {
    ...BASE_LOOK, Piel: { color: '#7a4a2c' }, Pintura: { color: '#f2ede0' }, Adorno: { color: '#e0a82a', metalness: 0.7, roughness: 0.35 },
    Taparrabo: { color: '#8a2418' }, Plumas: { color: '#e0402a' }, Madera: { color: '#6a4426' }, PlumasB: { color: '#f4efe2' }, PuntaPluma: { color: '#f2b62c' },
    Dientes: { color: '#efe6d0' }, Cuero: { color: '#6b4a2a' }, Cuerda: { color: '#efe4c8' },
  },

}
const LOOKS = JEFE ? { base: BOSS_LOOKS[JEFE] } : {
  // La base: piel morena, pintura roja, collar y brazaletes azules, taparrabo claro y plumas amarillas con punta roja.
  base: BASE_LOOK,
  // La Noche Eterna: los mismos colores, pero corpulento y más grande.
  noche: BASE_LOOK,
  // El tótem: del tamaño del de noche, con oro: adornos y amarres dorados, pintura y piedra que brillan como brasa.
  totem: {
    Piel: { color: '#7a4428' }, Pintura: { color: '#ffd27a', emissive: '#ff8a1a' }, Adorno: { color: '#ffc93a', metalness: 0.8, roughness: 0.3, emissive: '#3a2400' },
    Taparrabo: { color: '#b0261a' }, Pelo: { color: '#140c08' }, Ojos: { color: '#ffe08a', emissive: '#ffae2a' }, Cejas: { color: '#140c08' },
    Plumas: { color: '#ff3a1e', emissive: '#4a0a00' }, PuntaPluma: { color: '#ffd24a', emissive: '#ffa21a' },
    Madera: { color: '#4a2a14' }, Amarre: { color: '#ffc93a', metalness: 0.8, roughness: 0.3 }, Piedra: { color: '#ffd27a', emissive: '#ff8a1a' },
  },
}

// ---------- la animación de lanzar la lanza ----------
// Carga con el brazo atrás y el torso girado, suelta hacia adelante y arriba, sigue con el brazo cruzando el cuerpo y
// vuelve a la pose quieta. La lanza se ve hasta que se suelta (`extras.soltar`, en segundos): desde ahí la pone el
// juego volando, y vuelve a la mano al final.
const THROW = { carga: 0.32, sosten: 0.46, soltar: 0.62, sigue: 0.9, fin: 1.35 }
function throwClip(doc, spear) {
  const idle = new Pose(doc)
  const X = [1, 0, 0], Y = [0, 1, 0]
  const pose = ({ twistLow, twist, lean, upperR, lowerR, upperL, lowerL }) => idle.clone()
    .turn('Abdomen', qaxis(Y, twistLow)).turn('Torso', qaxis(Y, twist)).turn('Torso', qaxis(X, lean))
    .aim('UpperArm.R', 'LowerArm.R', upperR).aim('LowerArm.R', 'Wrist.R', lowerR)
    .aim('UpperArm.L', 'LowerArm.L', upperL).aim('LowerArm.L', 'Wrist.L', lowerL)
  // Ángulos en grados: giro a la izquierda positivo (el hombro derecho va adelante), inclinación adelante positiva.
  const carga = pose({ twistLow: -12, twist: -28, lean: -8, upperR: [-0.8, 0.15, -0.55], lowerR: [-0.1, 0.9, -0.42], upperL: [0.4, 0.3, 0.86], lowerL: [0.2, 0.35, 0.92] })
  const sosten = pose({ twistLow: -14, twist: -32, lean: -10, upperR: [-0.82, 0.18, -0.55], lowerR: [-0.12, 0.88, -0.46], upperL: [0.42, 0.32, 0.85], lowerL: [0.22, 0.38, 0.9] })
  const suelta = pose({ twistLow: 10, twist: 24, lean: 12, upperR: [-0.25, 0.55, 0.8], lowerR: [-0.1, 0.4, 0.91], upperL: [0.55, -0.6, -0.3], lowerL: [0.35, -0.8, -0.1] })
  const sigue = pose({ twistLow: 14, twist: 30, lean: 18, upperR: [0.2, -0.45, 0.87], lowerR: [0.4, -0.6, 0.7], upperL: [0.5, -0.7, -0.3], lowerL: [0.3, -0.9, -0.1] })
  const keys = [[0, idle], [THROW.carga, carga], [THROW.sosten, sosten], [THROW.soltar, suelta], [THROW.sigue, sigue], [THROW.fin, idle]]
  // La lanza: de parada a apuntando adelante (un poco arriba) mientras carga; se esconde al soltarla.
  const ahead = [0, 0.12, 1]
  const spearRot = [SPEAR_ROTATION, carga.pointChild(HAND_BONE, ahead), sosten.pointChild(HAND_BONE, ahead), suelta.pointChild(HAND_BONE, [0, 0.25, 1]), SPEAR_ROTATION, SPEAR_ROTATION]
  for (let i = 1; i < spearRot.length; i++) if (spearRot[i].reduce((a, x, j) => a + x * spearRot[i - 1][j], 0) < 0) spearRot[i] = spearRot[i].map((x) => -x)
  const anim = addClip(doc, 'Lanzar', keys, [
    { node: spear, path: 'rotation', times: keys.map(([t]) => t), values: spearRot },
    { node: spear, path: 'scale', times: [0, THROW.soltar + 0.01, THROW.fin], values: [[1, 1, 1], [0, 0, 0], [1, 1, 1]], interpolation: 'STEP' },
  ])
  anim.setExtras({ soltar: THROW.soltar })
}

// ---------- escribir (sobre animations.glb: esqueleto + animaciones) ----------
for (const [weapon, build] of Object.entries(JEFE ? { [JEFE]: null } : WEAPONS)) {
  const doc = await io.read(animPath)
  const root = doc.getRoot()
  const byName = Object.fromEntries(root.listNodes().map((n) => [n.getName(), n]))
  const skin = doc.createSkin('Trasgo')
  for (const n of rest.names) skin.addJoint(byName[n])
  const ibm = new Float32Array(rest.names.length * 16)
  rest.names.forEach((n, i) => {
    const m = [...rest.world[n]]
    m[12] = pos[n][0]; m[13] = pos[n][1]; m[14] = pos[n][2]
    ibm.set(invert4(m), i * 16)
  })
  skin.setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(ibm).setBuffer(root.listBuffers()[0]))

  const variantsExt = doc.createExtension(KHRMaterialsVariants)
  const variants = Object.fromEntries(Object.keys(LOOKS).map((v) => [v, variantsExt.createVariant(v)]))
  const mats = new Map()
  const material = (role, v) => {
    const key = `${role}_${v}`
    if (!mats.has(key)) {
      const look = LOOKS[v][role]
      mats.set(key, doc.createMaterial(key).setDoubleSided(true).setMetallicFactor(look.metalness ?? 0).setRoughnessFactor(look.roughness ?? 0.8)
        .setBaseColorFactor([...lin(look.color), 1]).setEmissiveFactor(look.emissive ? lin(look.emissive) : [0, 0, 0]))
    }
    return mats.get(key)
  }
  function buildMesh(name, byRole, skinned = true) {
    const mesh = doc.createMesh(name)
    for (const [role, list] of Object.entries(byRole)) {
      if (!list.length) continue
      const prim = primitive(doc, list, material(role, 'base'), { colors: false })
      if (!skinned) for (const s of ['JOINTS_0', 'WEIGHTS_0']) { const a = prim.getAttribute(s); prim.setAttribute(s, null); a.dispose() }
      const mapping = variantsExt.createMappingList()
      for (const v of Object.keys(LOOKS)) mapping.addMapping(variantsExt.createMapping().setMaterial(material(role, v)).addVariant(variants[v]))
      prim.setExtension('KHR_materials_variants', mapping)
      mesh.addPrimitive(prim)
    }
    return mesh
  }
  const armature = root.listScenes()[0].listChildren()[0]
  if (JEFE) {
    const name = 'TrasgoGigante'
    armature.addChild(doc.createNode(name).setMesh(buildMesh(name, big)).setSkin(skin))
    // La lanza en la mano derecha, parada como la del trasgo; el arco en la izquierda, parado y con la panza hacia adelante.
    byName[HAND_BONE].addChild(doc.createNode('Lanza').setTranslation(GRIP_POSITION).setRotation(SPEAR_ROTATION).setMesh(buildMesh('Lanza', WEAPONS.Lanza(), false)))
    const handL = new Pose(doc).world(byName['Middle1.L']).q
    const bowRotation = qmul(qinv(handL), quatOfBasis([-1, 0, 0], [0, 0, 1], [0, 1, 0]))
    byName['Middle1.L'].addChild(doc.createNode('Arco').setTranslation([-GRIP_POSITION[0], GRIP_POSITION[1], GRIP_POSITION[2]]).setRotation(bowRotation).setMesh(buildMesh('Arco', bow(), false)))
    scaleSkeleton(doc, k)
    await io.write(`${outDir}/${name}.glb`, doc)
    console.log(`${outDir}/${name}.glb · ${Object.values(big).reduce((s, l) => s + l.length, 0)} triángulos`)
    continue
  }
  armature.addChild(doc.createNode('Trasgo').setMesh(buildMesh('Trasgo', body)).setSkin(skin))
  // Noche y tótem comparten la malla corpulenta (se guarda una sola vez).
  const bigMesh = buildMesh('Trasgo_corpulento', big)
  for (const v of ['noche', 'totem']) armature.addChild(doc.createNode(`${v}_Trasgo`).setMesh(bigMesh).setSkin(skin))
  root.listScenes()[0].setExtras({ escala: { noche: BIG_SIZE, totem: BIG_SIZE } })
  const weaponNode = doc.createNode(weapon).setTranslation(GRIP_POSITION).setRotation(weapon === 'Lanza' ? SPEAR_ROTATION : GRIP_ROTATION).setMesh(buildMesh(weapon, build(), false))
  byName[HAND_BONE].addChild(weaponNode)
  if (weapon === 'Lanza') throwClip(doc, weaponNode)
  scaleSkeleton(doc, k)

  const out = `${outDir}/Trasgo${weapon}.glb`
  await io.write(out, doc)
  console.log(out)
}
const count = (r) => Object.values(r).reduce((s, l) => s + l.length, 0)
console.log(`piernas ×${LEGS} · ${count(body)} triángulos · ` + Object.entries(roles).map(([r, l]) => `${r} ${l.length}`).join(' · '))
