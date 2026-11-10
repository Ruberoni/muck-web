// Arma el trasgo gigante con el hombre musculoso de Universal Base Characters de Quaternius (CC0) TAL CUAL: su malla,
// su esqueleto y su textura, sin deformarlo. Lo que se le agrega:
//  - las animaciones del trasgo gigante (las del jugador y sus ataques, ver `ataques.mjs`), pasadas a su esqueleto:
//    cada hueso gira en el mundo lo mismo que el suyo en el esqueleto del jugador (los dos están en cruz en reposo);
//  - pintura: zonas de la piel con otro material (blanco, oro), y el short oscuro de la textura teñido de rojo, sin
//    mover ningún vértice;
//  - el pelo largo del mismo paquete, en negro, el tocado de plumas, un collar de oro y uno de colmillos, el carcaj, el
//    taparrabo (faja y paños) y las armas del trasgo (lanza en la mano derecha, arco en la izquierda).
// Las texturas se bajan a 1024 px.
// node gigante.mjs <Superhero_Male_FullBody.gltf> <Hair_Long.gltf> <trasgo gigante con animaciones.glb> <salida.glb>
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { PNG } from 'pngjs'
import { bindPositions, lin } from './lib.mjs'
import { qinv, qrot } from './anim.mjs'
import { restQ, retarget } from './retarget.mjs'
import { flat } from './rocas.mjs'

const [uePath, hairPath, srcPath, outPath] = process.argv.slice(2)
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const [doc, hairDoc, src] = await Promise.all([uePath, hairPath, srcPath].map((p) => io.read(p)))
const root = doc.getRoot()
const buffer = root.listBuffers()[0]

const add = (a, b) => a.map((x, i) => x + b[i])
const sub = (a, b) => a.map((x, i) => x - b[i])
const mul = (a, s) => a.map((x) => x * s)
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const len = (a) => Math.hypot(...a)
const norm = (a) => mul(a, 1 / (len(a) || 1))
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const lerp = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t)
// ---------- los dos esqueletos ----------
const skin = root.listSkins()[0]
const joints = skin.listJoints(), jointNames = joints.map((j) => j.getName())
const J = (n) => { const i = jointNames.indexOf(n); if (i < 0) throw new Error(`no hay ${n}`); return i }
const U = bindPositions(skin)
const uNode = Object.fromEntries(root.listNodes().map((n) => [n.getName(), n]))
const parentOf = new Map()
for (const n of root.listNodes()) for (const c of n.listChildren()) parentOf.set(c, n)
const sByName = Object.fromEntries(src.getRoot().listNodes().map((n) => [n.getName(), n]))

/** Hueso del superhéroe → hueso del jugador que lo mueve. */
const MAP = { pelvis: 'Hips', spine_01: 'Abdomen', spine_02: 'Torso', spine_03: 'Chest', neck_01: 'Neck', Head: 'Head' }
for (const [s, S2] of [['l', 'L'], ['r', 'R']]) Object.assign(MAP, {
  [`clavicle_${s}`]: `Shoulder.${S2}`, [`upperarm_${s}`]: `UpperArm.${S2}`, [`lowerarm_${s}`]: `LowerArm.${S2}`, [`hand_${s}`]: `Wrist.${S2}`,
  [`thigh_${s}`]: `UpperLeg.${S2}`, [`calf_${s}`]: `LowerLeg.${S2}`, [`foot_${s}`]: `Foot.${S2}`,
})
const uRest = Object.fromEntries(Object.keys(MAP).map((u) => [u, restQ(doc, u)]))

// ---------- las armas: copiadas del trasgo, en la palma de cada mano ----------
function copyMesh(srcMesh, name) {
  const mesh = doc.createMesh(name)
  for (const p of srcMesh.listPrimitives()) {
    const prim = doc.createPrimitive().setMaterial(material(p.getMaterial().getName().replace(/_base$/, '')))
    for (const sem of ['POSITION', 'NORMAL']) prim.setAttribute(sem, doc.createAccessor().setType('VEC3').setArray(p.getAttribute(sem).getArray().slice()).setBuffer(buffer))
    mesh.addPrimitive(prim)
  }
  return mesh
}
const LOOK = {
  Pintura: { color: '#f2ede0' }, Adorno: { color: '#e0a82a', metalness: 0.7, roughness: 0.35 }, Taparrabo: { color: '#8a2418' },
  Plumas: { color: '#e0402a' }, PlumasB: { color: '#f4efe2' }, PuntaPluma: { color: '#f2b62c' }, Dientes: { color: '#efe6d0' },
  Cuero: { color: '#6b4a2a' }, Madera: { color: '#6a4426' }, Amarre: { color: '#c9a66b' }, Piedra: { color: '#8f9396' }, Cuerda: { color: '#efe4c8' },
}
const mats = new Map()
/** Material liso de un papel; con `normal`, conserva el relieve de la piel (el mapa de normales del cuerpo). */
function material(role, normal = null) {
  const key = role + (normal ? '+n' : '')
  if (!mats.has(key)) {
    const l = LOOK[role]
    const m = doc.createMaterial(role).setBaseColorFactor([...lin(l.color), 1]).setMetallicFactor(l.metalness ?? 0).setRoughnessFactor(l.roughness ?? 0.75)
    if (normal) m.setNormalTexture(normal)
    mats.set(key, m)
  }
  return mats.get(key)
}

/** Dónde agarra cada mano: en la palma, entre la muñeca y los nudillos, un poco hacia la palma. */
const palm = (s) => {
  const h = U[`hand_${s}`], m = U[`middle_01_${s}`]
  return add(lerp(h, m, 0.55), [0, -0.025, 0])
}
const weapons = []
for (const [name, hand, s] of [['Lanza', 'hand_r', 'r'], ['Arco', 'hand_l', 'l']]) {
  const sNode = sByName[name]
  const node = doc.createNode(name).setMesh(copyMesh(sNode.getMesh(), name))
  uNode[hand].addChild(node)
  // En reposo (en cruz) la mano está en su bind: el agarre, en su espacio.
  const hq = uRest[hand]
  node.setTranslation(qrot(qinv(hq), sub(palm(s), U[hand])))
  weapons.push({ name, node, hand, sNode })
}

// ---------- las animaciones, pasadas a su esqueleto (retarget.mjs) ----------
retarget({ doc, src, MAP, pelvis: 'pelvis', weapons: weapons.map((w) => ({ node: w.node, hand: w.hand, from: w.name })) })

// ---------- la piel: zonas pintadas (otro material, mismos vértices) ----------
const bodyNode = uNode.SuperHero_Male
const bodyPrim = bodyNode.getMesh().listPrimitives()[0]
const skinMat = bodyPrim.getMaterial()
const P = bodyPrim.getAttribute('POSITION'), UV = bodyPrim.getAttribute('TEXCOORD_0'), Jo = bodyPrim.getAttribute('JOINTS_0'), We = bodyPrim.getAttribute('WEIGHTS_0')
const color = PNG.sync.read(Buffer.from(skinMat.getBaseColorTexture().getImage()))
const texel = (uv) => {
  const x = Math.min(color.width - 1, Math.max(0, Math.floor(uv[0] * color.width))), y = Math.min(color.height - 1, Math.max(0, Math.floor(uv[1] * color.height)))
  const i = (y * color.width + x) * 4
  return (0.299 * color.data[i] + 0.587 * color.data[i + 1] + 0.114 * color.data[i + 2]) / 255
}
const headW = (i) => { const j = Jo.getElement(i, []), w = We.getElement(i, []); let h = 0; for (let k = 0; k < 4; k++) if (jointNames[j[k]] === 'Head') h += w[k]; return h }
const along = (p, a, b) => { const ab = sub(b, a); return dot(sub(p, a), ab) / dot(ab, ab) }
// Los ojos: el centro de cada uno, para la pintura de las mejillas.
const eyeAcc = uNode.Eyes.getMesh().listPrimitives()[0].getAttribute('POSITION')
const eyePts = [...Array(eyeAcc.getCount()).keys()].map((i) => eyeAcc.getElement(i, []))
const eye = [0, 1, 2].map((k) => eyePts.reduce((s, p) => s + (k === 0 ? Math.abs(p[0]) : p[k]), 0) / eyePts.length)
function roleOf(ids) {
  const c = mul(ids.reduce((s, i) => add(s, P.getElement(i, [])), [0, 0, 0]), 1 / 3)
  const ax = Math.abs(c[0]), side = c[0] > 0 ? 'l' : 'r'
  if (ids.every((i) => headW(i) > 0.5)) {
    // Dos rayas blancas en cada mejilla, debajo del ojo.
    const dy = eye[1] - c[1]
    if (ax > eye[0] - 0.015 && ax < eye[0] + 0.03 && c[2] > eye[2] - 0.04 && ((dy > 0.03 && dy < 0.042) || (dy > 0.052 && dy < 0.064))) return 'Pintura'
    return null
  }
  if (ax > U[`upperarm_${side}`][0] - 0.02) {
    const t1 = along(c, U[`upperarm_${side}`], U[`lowerarm_${side}`]), t2 = along(c, U[`lowerarm_${side}`], U[`hand_${side}`])
    if ((t1 > 0.55 && t1 < 0.66) || (t2 > 0.84 && t2 < 0.96)) return 'Adorno' // brazalete en el bíceps y en la muñeca
    if ((t2 > 0.3 && t2 < 0.37) || (t2 > 0.46 && t2 < 0.53)) return 'Pintura'
    return null
  }
  // El short oscuro de la textura: teñido de rojo, como el taparrabo.
  if (c[1] > U.calf_l[1] + 0.15 && c[1] < U.spine_01[1] && ids.reduce((s, i) => s + texel(UV.getElement(i, [])), 0) / 3 < 0.3) return 'Taparrabo'
  if (c[1] < U[`thigh_${side}`][1] - 0.05 && ax > 0.03) {
    const t1 = along(c, U[`thigh_${side}`], U[`calf_${side}`]), t2 = along(c, U[`calf_${side}`], U[`foot_${side}`])
    if ((t1 > 0.62 && t1 < 0.69) || (t1 > 0.75 && t1 < 0.82)) return 'Pintura'
    if (t2 > 0.08 && t2 < 0.17) return 'Adorno'
    if (t2 > 0.74 && t2 < 0.81) return 'Pintura'
  }
  // Dos rayas en el pecho, sobre los pectorales.
  if (c[2] > 0.04 && ax < 0.17) {
    const y = c[1] - U.spine_03[1]
    if ((y > 0.02 && y < 0.045 && ax > 0.03) || (y > 0.065 && y < 0.09 && ax > 0.045)) return 'Pintura'
  }
  return null
}
{
  const index = bodyPrim.getIndices().getArray()
  const parts = { Piel: [] }
  for (let t = 0; t < index.length; t += 3) {
    const ids = [index[t], index[t + 1], index[t + 2]]
    ;(parts[roleOf(ids) ?? 'Piel'] ??= []).push(...ids)
  }
  const IndexType = index.constructor
  bodyPrim.setIndices(doc.createAccessor().setType('SCALAR').setArray(new IndexType(parts.Piel)).setBuffer(buffer))
  for (const [role, ids] of Object.entries(parts)) {
    if (role === 'Piel' || !ids.length) continue
    const prim = doc.createPrimitive().setMaterial(material(role, skinMat.getNormalTexture())).setIndices(doc.createAccessor().setType('SCALAR').setArray(new IndexType(ids)).setBuffer(buffer))
    for (const sem of bodyPrim.listSemantics()) prim.setAttribute(sem, bodyPrim.getAttribute(sem))
    bodyNode.getMesh().addPrimitive(prim)
  }
}

// ---------- el pelo largo, en negro, sobre el mismo esqueleto ----------
let hairPts = []
{
  const hNode = hairDoc.getRoot().listNodes().find((n) => n.getMesh())
  const hp = hNode.getMesh().listPrimitives()[0]
  const hJoints = hNode.getSkin().listJoints().map((j) => j.getName())
  const remap = hJoints.map((n) => J(n))
  const prim = doc.createPrimitive()
  for (const sem of ['POSITION', 'NORMAL', 'TEXCOORD_0', 'WEIGHTS_0']) prim.setAttribute(sem, doc.createAccessor().setType(hp.getAttribute(sem).getType()).setArray(hp.getAttribute(sem).getArray().slice()).setBuffer(buffer))
  const hj = hp.getAttribute('JOINTS_0').getArray()
  prim.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(new Uint8Array(hj.length).map((_, i) => remap[hj[i]])).setBuffer(buffer))
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(hp.getIndices().getArray().slice()).setBuffer(buffer))
  const hm = hp.getMaterial()
  const tex = (t) => t && doc.createTexture(t.getName()).setImage(t.getImage().slice()).setMimeType(t.getMimeType()).setURI(t.getURI())
  prim.setMaterial(doc.createMaterial('Pelo').setDoubleSided(true).setBaseColorTexture(tex(hm.getBaseColorTexture())).setNormalTexture(tex(hm.getNormalTexture()))
    .setBaseColorFactor([0.13, 0.11, 0.1, 1]).setMetallicFactor(0).setRoughnessFactor(0.7))
  const hpos = hp.getAttribute('POSITION')
  hairPts = [...Array(hpos.getCount()).keys()].map((i) => hpos.getElement(i, []))
  const node = doc.createNode('Pelo').setMesh(doc.createMesh('Pelo').addPrimitive(prim)).setSkin(skin)
  parentOf.get(bodyNode).addChild(node)
}

// ---------- lo del jefe: tocado, collares, carcaj y taparrabo (piezas pegadas a sus huesos) ----------
const extra = {}
const put = (list) => { for (const t of list) (extra[t.role] ??= []).push(t) }
const bodyPts = [...Array(P.getCount()).keys()].map((i) => P.getElement(i, []))
const surfaceZ = (x, y, side = 1, r = 0.03) => Math.max(...bodyPts.filter((p) => Math.abs(p[0] - x) < r && Math.abs(p[1] - y) < r).map((p) => p[2] * side)) * side
function bar(role, a, b, r0, r1, bone, sides = 6) {
  const d = norm(sub(b, a)), u = norm(cross(d, Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0])), v = cross(d, u)
  const ring = (c, r) => [...Array(sides)].map((_, i) => add(c, add(mul(u, Math.cos((i / sides) * 2 * Math.PI) * r), mul(v, Math.sin((i / sides) * 2 * Math.PI) * r))))
  const A1 = ring(a, r0), B1 = ring(b, r1), j = J(bone), out = []
  for (let i = 0; i < sides; i++) {
    const i2 = (i + 1) % sides
    out.push(flat(role, A1[i], A1[i2], B1[i2], j), flat(role, a, A1[i2], A1[i], j))
    if (r1) out.push(flat(role, A1[i], B1[i2], B1[i], j), flat(role, b, B1[i], B1[i2], j))
  }
  put(out)
}
// Tocado: una vincha de oro por la frente (por encima del pelo) y un abanico de plumas detrás de la cabeza.
{
  const H = J('Head')
  const bandY = eye[1] + 0.06
  const pts = [...bodyPts.filter((p, i) => headW(i) > 0.5), ...hairPts].filter((p) => Math.abs(p[1] - bandY) < 0.015)
  const half = Math.max(...pts.map((p) => Math.abs(p[0]))) + 0.008
  const zMin = Math.min(...pts.map((p) => p[2])) - 0.008, zMax = Math.max(...pts.map((p) => p[2])) + 0.008
  const zMid = (zMin + zMax) / 2, zHalf = (zMax - zMin) / 2
  const at = (a, y) => [Math.sin(a) * half, y, zMid + Math.cos(a) * zHalf]
  const SEG = 18
  for (let s = 0; s < SEG; s++) {
    const a0 = (s / SEG) * 2 * Math.PI, a1 = ((s + 1) / SEG) * 2 * Math.PI
    const [p, q, r, u] = [at(a0, bandY - 0.016), at(a1, bandY - 0.016), at(a1, bandY + 0.016), at(a0, bandY + 0.016)]
    put([flat('Adorno', p, q, r, H), flat('Adorno', p, r, u, H)])
  }
  const top = Math.max(...bodyPts.filter((p, i) => headW(i) > 0.5).map((p) => p[1]))
  const center = [0, bandY + 0.01, zMid - 0.04]
  const rx = half, ry = top - center[1] + 0.01
  const N = 19
  for (let f = 0; f < N; f++) {
    const a = (-125 + (250 * f) / (N - 1)) * (Math.PI / 180)
    const dir = [Math.sin(a), Math.cos(a), 0], side = [Math.cos(a), -Math.sin(a), 0]
    const r0 = Math.hypot(Math.sin(a) * rx, Math.cos(a) * ry) * 0.85
    const length = 0.3 + 0.05 * Math.cos(a)
    const pt = (d, w, back) => [0, 1, 2].map((i) => center[i] + dir[i] * (r0 + d * length) + side[i] * w - (i === 2 ? back : 0))
    const B = pt(0, 0, 0), L1 = pt(0.45, 0.026, 0.02), R1 = pt(0.45, -0.026, 0.02), L2 = pt(0.72, 0.02, 0.03), R2 = pt(0.72, -0.02, 0.03), T = pt(1, 0, 0.045)
    const role = f % 2 ? 'PlumasB' : 'Plumas'
    // Las dos caras, para que se vea de adelante y de atrás.
    put([flat(role, B, R1, L1, H), flat(role, L1, R1, R2, H), flat(role, L1, R2, L2, H), flat('PuntaPluma', L2, R2, T, H)])
    put([flat(role, B, L1, R1, H), flat(role, L1, R2, R1, H), flat(role, L1, L2, R2, H), flat('PuntaPluma', L2, T, R2, H)])
  }
}
// Collar de oro en la base del cuello y collar de colmillos sobre el pecho.
{
  const y = U.neck_01[1] - 0.02
  const ring = bodyPts.filter((p) => Math.abs(p[1] - y) < 0.02 && Math.abs(p[0]) < 0.16)
  const cz = ring.reduce((s, p) => s + p[2], 0) / ring.length
  const radius = (a) => Math.max(...ring.map((p) => p[0] * Math.sin(a) + (p[2] - cz) * Math.cos(a))) + 0.012
  const N2 = 16, pts = [...Array(N2)].map((_, i) => { const a = (i / N2) * 2 * Math.PI; return [Math.sin(a) * radius(a), y, cz + Math.cos(a) * radius(a)] })
  for (let i = 0; i < N2; i++) bar('Adorno', pts[i], pts[(i + 1) % N2], 0.013, 0.013, 'neck_01', 5)
  const y0 = U.spine_03[1] + 0.12
  for (let i = 0; i < 11; i++) {
    const a = ((-70 + 14 * i) * Math.PI) / 180, x = Math.sin(a) * 0.13
    const p = [x, y0 - Math.cos(a) * 0.035, surfaceZ(x, y0 - 0.02) + 0.012]
    bar('Dientes', p, add(p, [Math.sin(a) * 0.01, -0.08 + Math.abs(i - 5) * 0.004, 0.012]), 0.014, 0, 'spine_03', 5)
  }
}
// El carcaj cruzado en la espalda, con flechas.
{
  const yc = U.spine_03[1], back = surfaceZ(0, yc, -1, 0.06)
  const q0 = [0.12, yc - 0.2, back - 0.06], q1 = [-0.15, yc + 0.22, back - 0.08]
  bar('Cuero', q0, q1, 0.055, 0.06, 'spine_03', 7)
  bar('Amarre', lerp(q0, q1, 0.82), lerp(q0, q1, 0.9), 0.064, 0.064, 'spine_03', 7)
  const dir = norm(sub(q1, q0))
  for (const [ox, oz] of [[0.02, 0.015], [-0.015, 0.02], [0.0, -0.02], [-0.025, -0.005]]) {
    const a = add(q1, [ox, -0.04, oz]), b = add(a, mul(dir, 0.17))
    bar('Madera', a, b, 0.006, 0.006, 'spine_03', 4)
    const side = norm(cross(dir, [0, 0, 1])), t1 = add(b, mul(dir, -0.07)), j = J('spine_03')
    put([flat('Plumas', add(t1, mul(side, 0.02)), b, add(t1, mul(side, -0.02)), j), flat('Plumas', add(t1, mul(side, -0.02)), b, add(t1, mul(side, 0.02)), j)])
  }
}
// El taparrabo: faja enrollada en la cintura y un paño por delante y otro por detrás, con flecos.
{
  const hy = U.pelvis[1] + 0.03
  const BELT = [[-0.06, 0.004], [-0.045, 0.02], [-0.015, 0.032], [0.02, 0.034], [0.05, 0.026], [0.07, 0.006]]
  const SEG = 28
  const ids = [...Array(P.getCount()).keys()].filter((i) => Math.abs(bodyPts[i][1] - hy) < 0.12 && Math.abs(bodyPts[i][0]) < 0.25)
  const cz = ids.reduce((s, i) => s + bodyPts[i][2], 0) / ids.length
  const vertex = (y, a, off) => {
    let best = -1, r = -Infinity
    for (const i of ids) {
      const p = bodyPts[i]
      if (Math.abs(p[1] - y) > 0.03) continue
      const d = p[0] * Math.sin(a) + (p[2] - cz) * Math.cos(a)
      if (d > r) { r = d; best = i }
    }
    return { POSITION: [Math.sin(a) * (r + off), y, cz + Math.cos(a) * (r + off)], JOINTS_0: Jo.getElement(best, []), WEIGHTS_0: We.getElement(best, []) }
  }
  const grid = BELT.map(([dy, off]) => [...Array(SEG).keys()].map((s) => vertex(hy + dy, (s / SEG) * 2 * Math.PI, off)))
  const tri = (a, b, c) => {
    const n = norm(cross(sub(b.POSITION, a.POSITION), sub(c.POSITION, a.POSITION)))
    const [x, y, z] = n[0] * a.POSITION[0] + n[2] * (a.POSITION[2] - cz) > 0 ? [a, b, c] : [a, c, b]
    const nn = norm(cross(sub(y.POSITION, x.POSITION), sub(z.POSITION, x.POSITION)))
    return { role: 'Taparrabo', vs: [x, y, z].map((v) => ({ ...v, POSITION: [...v.POSITION], NORMAL: nn })) }
  }
  for (let r = 0; r < BELT.length - 1; r++) for (let s = 0; s < SEG; s++) {
    const t = (s + 1) % SEG, [p, q, u, w] = [grid[r][s], grid[r][t], grid[r + 1][t], grid[r + 1][s]]
    put([tri(p, q, u), tri(p, u, w)])
  }
  const HIPS = J('pelvis'), TL = J('thigh_l'), TR = J('thigh_r')
  for (const front of [true, false]) {
    const sign = front ? 1 : -1
    const rows = [-0.05, -0.19, -0.32, -0.43].map((dy, r) => ({ y: hy + dy, w: [0.12, 0.115, 0.11, 0.105][r] }))
    let out = -Infinity
    for (const row of rows) {
      const near = bodyPts.filter((p) => Math.abs(p[0]) < row.w + 0.03 && p[1] > row.y - 0.04 && p[1] < hy + 0.03)
      out = Math.max(out, ...near.map((p) => sign * p[2]))
      row.z = sign * (out + 0.035)
    }
    const weights = [[1, 0, 0], [0.7, 0.15, 0.15], [0.45, 0.275, 0.275], [0.4, 0.3, 0.3]]
    const v = (row, r, x) => ({ POSITION: [x, row.y, row.z], JOINTS_0: [HIPS, TL, TR, 0], WEIGHTS_0: [...weights[r], 0] })
    const two = (a, b, c) => {
      const n = norm(cross(sub(b.POSITION, a.POSITION), sub(c.POSITION, a.POSITION)))
      put([{ role: 'Taparrabo', vs: [a, b, c].map((x) => ({ ...x, NORMAL: n })) }, { role: 'Taparrabo', vs: [a, c, b].map((x) => ({ ...x, NORMAL: mul(n, -1) })) }])
    }
    for (let r = 0; r < rows.length - 1; r++) {
      const a = rows[r], b = rows[r + 1], cols = [-1, 0, 1]
      for (let c = 0; c < 2; c++) {
        const p = v(a, r, cols[c] * a.w), q = v(a, r, cols[c + 1] * a.w), s = v(b, r + 1, cols[c] * b.w), u = v(b, r + 1, cols[c + 1] * b.w)
        two(p, u, q); two(p, s, u)
      }
    }
    const last = rows.at(-1)
    for (let i = 0; i < 7; i++) {
      const x0 = -last.w + (2 * last.w * i) / 7, x1 = x0 + (2 * last.w) / 7
      two(v(last, 3, x1), v(last, 3, x0), { ...v(last, 3, (x0 + x1) / 2), POSITION: [(x0 + x1) / 2, last.y - 0.05 - (i % 2) * 0.015, last.z] })
    }
  }
}
{
  const mesh = doc.createMesh('Adornos')
  for (const [role, list] of Object.entries(extra)) {
    const n = list.length * 3
    const prim = doc.createPrimitive().setMaterial(material(role))
    for (const [sem, size, Ty] of [['POSITION', 3, Float32Array], ['NORMAL', 3, Float32Array], ['JOINTS_0', 4, Uint8Array], ['WEIGHTS_0', 4, Float32Array]]) {
      const arr = new Ty(n * size)
      list.forEach((t, i) => t.vs.forEach((v, j) => arr.set(v[sem].slice(0, size), (i * 3 + j) * size)))
      prim.setAttribute(sem, doc.createAccessor().setType(size === 3 ? 'VEC3' : 'VEC4').setArray(arr).setBuffer(buffer))
    }
    mesh.addPrimitive(prim)
  }
  parentOf.get(bodyNode).addChild(doc.createNode('Adornos').setMesh(mesh).setSkin(skin))
}
// Las cejas del paquete se dejan: son las de su cara.

// ---------- texturas a 1024 px, sin la de rugosidad ----------
function half(png) {
  const w = png.width >> 1, h = png.height >> 1, out = new PNG({ width: w, height: h })
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) {
    let s = 0
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) s += png.data[((2 * y + dy) * png.width + 2 * x + dx) * 4 + c]
    out.data[(y * w + x) * 4 + c] = s >> 2
  }
  return out
}
for (const m of root.listMaterials()) { const t = m.getMetallicRoughnessTexture(); if (t) { m.setMetallicRoughnessTexture(null).setRoughnessFactor(0.75).setMetallicFactor(0) } }
for (const t of root.listTextures()) {
  if (!t.listParents().some((p) => p.propertyType === 'Material')) { t.dispose(); continue }
  let png = PNG.sync.read(Buffer.from(t.getImage()))
  while (png.width > 1024) png = half(png)
  t.setImage(new Uint8Array(PNG.sync.write(png))).setMimeType('image/png').setURI(t.getURI().replace(/\.png$/, '') + '.png')
}
for (const a of root.listAccessors()) if (!a.listParents().some((p) => p.propertyType !== 'Root')) a.dispose()
root.listScenes()[0].listChildren()[0].setName('TrasgoGigante')

await io.write(outPath, doc)
const tris = root.listMeshes().reduce((s, m) => s + m.listPrimitives().reduce((a, p) => a + (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3, 0), 0)
console.log(`trasgo gigante (superhéroe de Quaternius) · ${Math.round(tris)} triángulos · animaciones: ${root.listAnimations().map((a) => a.getName()).join(', ')}`)
