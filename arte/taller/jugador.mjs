// Arma Jugador.glb: la náufraga (base de Casual) en piezas + la armadura de Medieval en piezas teñibles.
// node build.mjs <Casual.glb> <Medieval.glb> <salida.glb>
import { NodeIO } from '@gltf-transform/core'

const [casualPath, medievalPath, outPath] = process.argv.slice(2)
const io = new NodeIO()
const base = await io.read(casualPath)
const med = await io.read(medievalPath)

// ---------- colores ----------
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)
const lin = (hex) => [1, 3, 5].map((i) => toLin(parseInt(hex.slice(i, i + 2), 16) / 255))
const hexOf = (c) => '#' + c.map((x) => Math.round(255 * toSrgb(x)).toString(16).padStart(2, '0')).join('')
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

// Pseudoazar fijo, para que los bordes rotos salgan siempre iguales.
let seed = 7
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)

// ---------- triángulos ----------
/** Saca los triángulos de un documento, cada uno con sus 3 vértices completos y su componente conexa. */
function triangles(doc) {
  const joints = doc.getRoot().listSkins()[0].listJoints().map((j) => j.getName())
  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0]
  const A = Object.fromEntries(['POSITION', 'NORMAL', 'COLOR_0', 'JOINTS_0', 'WEIGHTS_0'].map((k) => [k, prim.getAttribute(k)]))
  const idx = prim.getIndices().getArray()
  const n = A.POSITION.getCount()
  const parent = [...Array(n).keys()]
  const find = (a) => { while (parent[a] !== a) a = parent[a] = parent[parent[a]]; return a }
  const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b }
  const seen = new Map()
  const p = [0, 0, 0]
  for (let i = 0; i < n; i++) {
    A.POSITION.getElement(i, p)
    const k = p.map((x) => x.toFixed(4)).join()
    seen.has(k) ? uni(i, seen.get(k)) : seen.set(k, i)
  }
  for (let t = 0; t < idx.length; t += 3) { uni(idx[t], idx[t + 1]); uni(idx[t], idx[t + 2]) }
  const vert = (i) => {
    const v = {}
    for (const k in A) v[k] = A[k].getElement(i, [])
    return v
  }
  const tris = []
  const comps = new Map()
  for (let t = 0; t < idx.length; t += 3) {
    const vs = [idx[t], idx[t + 1], idx[t + 2]].map(vert)
    const bones = {}
    for (const v of vs) for (let k = 0; k < 4; k++) if (v.WEIGHTS_0[k] > 0) bones[joints[v.JOINTS_0[k]]] = (bones[joints[v.JOINTS_0[k]]] || 0) + v.WEIGHTS_0[k]
    const bone = Object.entries(bones).sort((a, b) => b[1] - a[1])[0][0]
    const y = (vs[0].POSITION[1] + vs[1].POSITION[1] + vs[2].POSITION[1]) / 3
    const tri = { vs, bone, y, color: hexOf(vs[0].COLOR_0), comp: find(idx[t]) }
    tris.push(tri)
    if (!comps.has(tri.comp)) comps.set(tri.comp, [])
    comps.get(tri.comp).push(tri)
  }
  // Etiqueta cada componente por tamaño, para poder decir "el cuerpo de arriba", "las piernas"...
  for (const list of comps.values()) {
    const ys = list.flatMap((t) => t.vs.map((v) => v.POSITION[1]))
    const info = { size: list.length, minY: Math.min(...ys), maxY: Math.max(...ys), colors: new Set(list.map((t) => t.color)) }
    for (const t of list) t.part = info
  }
  return { tris, joints }
}

const B = triangles(base)
const M = triangles(med)
if (B.joints.join() !== M.joints.join()) throw new Error('los esqueletos no coinciden')

const HEAD_BONES = new Set(['Neck', 'Head'])
const isUpper = (t) => t.part.size > 2000
const isLegs = (t) => t.part.size > 500 && t.part.maxY < 1.2 && t.part.minY < 0.4

// ---------- la náufraga ----------
const SKIN = lin('#cead86')
const SHIRT = lin('#d9cfb4') // camiseta clara, gastada por el sol
const SHORTS = lin('#7d8fa3') // short de mezclilla desteñido
const SHIRT_OLD = '#b4b4b4'
const PANTS_OLD = '#9e6238'
const SHOES_OLD = '#3f3f3f'

const paint = (t, c) => t.vs.forEach((v) => (v.COLOR_0 = [...c]))

const naufraga = { Pelo: [], Cabeza: [], Torso: [], Piernas: [], Pies: [] }
for (const t of B.tris) {
  if (isUpper(t)) {
    if (HEAD_BONES.has(t.bone)) { naufraga.Cabeza.push(t); continue }
    if (t.color === SHIRT_OLD) {
      const arm = /Arm|Shoulder/.test(t.bone)
      // Sin mangas, y el borde de abajo deshilachado.
      if (arm && (t.bone !== 'Shoulder.L' && t.bone !== 'Shoulder.R')) paint(t, SKIN)
      else if (t.y < 1.17 + rnd() * 0.05) paint(t, SKIN)
      else paint(t, SHIRT)
    }
    naufraga.Torso.push(t)
  } else if (isLegs(t)) {
    if (t.color === PANTS_OLD) paint(t, t.y < 0.66 + rnd() * 0.07 ? SKIN : SHORTS)
    else if (t.color === SHOES_OLD) paint(t, SKIN)
    ;(t.y < 0.4 ? naufraga.Pies : naufraga.Piernas).push(t)
  } else if (t.color === '#8b7547') naufraga.Pelo.push(t)
  else naufraga.Cabeza.push(t)
}

// ---------- la armadura ----------
// En cada pieza, los colores que cambian con el material (el resto queda fijo: piel, hebillas, suelas).
const armadura = { Casco: [], Peto: [], Pantalon: [], Botas: [] }
for (const t of M.tris) {
  if (isUpper(t)) { if (!HEAD_BONES.has(t.bone)) armadura.Peto.push(t) }
  else if (t.part.size === 112) armadura.Peto.push(t) // hombreras
  else if (t.part.size === 552) armadura.Casco.push(t)
  else if (t.part.size === 598) armadura.Pantalon.push(t)
  else if (t.part.size === 285) armadura.Botas.push(t)
}
const TINT = {
  Casco: ['#492e18'],
  Peto: ['#6e4624', '#747474', '#b4b4b4'],
  Pantalon: ['#312e2b'],
  Botas: ['#6e4624'],
}

// ---------- escribir ----------
const root = base.getRoot()
const buffer = root.listBuffers()[0]
const skin = root.listSkins()[0]
const scene = root.listScenes()[0]
const oldNode = root.listNodes().find((n) => n.getMesh())
const oldMesh = oldNode.getMesh()
oldNode.setMesh(null)
oldNode.detach?.()
scene.removeChild?.(oldNode)
for (const p of oldMesh.listPrimitives()) for (const a of [...p.listAttributes(), p.getIndices()]) a?.dispose()
oldMesh.dispose()
oldNode.dispose()
root.listMaterials().forEach((m) => m.dispose())

const fixedMat = base.createMaterial('Personaje').setRoughnessFactor(0.6).setMetallicFactor(0).setDoubleSided(true)

function primitive(list, material) {
  const n = list.length * 3
  const arr = { POSITION: [3, Float32Array], NORMAL: [3, Float32Array], COLOR_0: [3, Float32Array], JOINTS_0: [4, Uint8Array], WEIGHTS_0: [4, Float32Array] }
  const prim = base.createPrimitive().setMaterial(material)
  for (const [k, [size, T]] of Object.entries(arr)) {
    const data = new T(n * size)
    list.forEach((t, i) => t.vs.forEach((v, j) => data.set(v[k], (i * 3 + j) * size)))
    prim.setAttribute(k, base.createAccessor().setType(size === 3 ? 'VEC3' : 'VEC4').setArray(data).setBuffer(buffer))
  }
  return prim
}

function addMesh(name, list, tintColors, defaultTint) {
  const mesh = base.createMesh(name)
  const tinted = tintColors ? list.filter((t) => tintColors.includes(t.color)) : []
  const fixed = list.filter((t) => !tinted.includes(t))
  if (fixed.length) mesh.addPrimitive(primitive(fixed, fixedMat))
  if (tinted.length) {
    // Gris relativo al color más claro de los teñibles: con el tinte del material queda ese color, con sus sombras.
    const ref = Math.max(...tinted.map((t) => lum(lin(t.color))))
    for (const t of tinted) { const g = Math.min(1, lum(lin(t.color)) / ref); paint(t, [g, g, g]) }
    const mat = base.createMaterial(`${name}_Tinte`).setRoughnessFactor(0.6).setMetallicFactor(0).setDoubleSided(true)
      .setBaseColorFactor([...lin(defaultTint), 1])
    mesh.addPrimitive(primitive(tinted, mat))
  }
  const node = base.createNode(name).setMesh(mesh).setSkin(skin)
  scene.addChild(node)
  return { name, tris: list.length, tinted: tinted.length }
}

const report = []
for (const [name, list] of Object.entries(naufraga)) report.push(addMesh(`Naufraga_${name}`, list))
const DEFAULT = { Casco: '#492e18', Peto: '#6e4624', Pantalon: '#312e2b', Botas: '#6e4624' }
for (const [name, list] of Object.entries(armadura)) report.push(addMesh(`Armadura_${name}`, list, TINT[name], DEFAULT[name]))
console.table(report)
await io.write(outPath, base)
