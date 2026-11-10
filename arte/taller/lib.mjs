// Utilidades comunes de los scripts del taller.

// ---------- colores (glTF guarda colores lineales; aquí se escriben en hex sRGB) ----------
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)
export const lin = (hex) => [1, 3, 5].map((i) => toLin(parseInt(hex.slice(i, i + 2), 16) / 255))
export const hexOf = (c) => '#' + c.slice(0, 3).map((x) => Math.round(255 * toSrgb(x)).toString(16).padStart(2, '0')).join('')

/** Pseudoazar con semilla fija: los bordes rotos y demás detalles salen siempre iguales. */
export function random(seed = 7) {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
}

// ---------- triángulos ----------
/**
 * Los triángulos de la primera malla de `doc`, cada uno con sus 3 vértices completos (copias: se pueden tocar),
 * el hueso que más lo mueve, su altura media, su color y la componente conexa a la que pertenece (`part`).
 */
export function triangles(doc) {
  const joints = doc.getRoot().listSkins()[0].listJoints().map((j) => j.getName())
  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0]
  const A = Object.fromEntries(['POSITION', 'NORMAL', 'COLOR_0', 'JOINTS_0', 'WEIGHTS_0'].map((k) => [k, prim.getAttribute(k)]).filter(([, a]) => a))
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
    const tri = { vs, bone, y, color: vs[0].COLOR_0 ? hexOf(vs[0].COLOR_0) : null, comp: find(idx[t]) }
    tris.push(tri)
    if (!comps.has(tri.comp)) comps.set(tri.comp, [])
    comps.get(tri.comp).push(tri)
  }
  for (const list of comps.values()) {
    const ys = list.flatMap((t) => t.vs.map((v) => v.POSITION[1]))
    const info = { size: list.length, minY: Math.min(...ys), maxY: Math.max(...ys), colors: new Set(list.map((t) => t.color)) }
    for (const t of list) t.part = info
  }
  return { tris, joints }
}

/** Peso del hueso `name` en el vértice `v`. */
export function weightOf(v, joints, name) {
  let w = 0
  for (let k = 0; k < 4; k++) if (joints[v.JOINTS_0[k]] === name) w += v.WEIGHTS_0[k]
  return w
}

/** Dónde está cada hueso en la pose de reposo, en el espacio de la malla (la inversa de su matriz de bind). */
export function bindPositions(skin) {
  const ibm = skin.getInverseBindMatrices()
  const out = {}
  skin.listJoints().forEach((j, i) => {
    const a = ibm.getElement(i, [])
    const R = [[a[0], a[4], a[8]], [a[1], a[5], a[9]], [a[2], a[6], a[10]]]
    const t = [a[12], a[13], a[14]]
    const det = R[0][0] * (R[1][1] * R[2][2] - R[1][2] * R[2][1]) - R[0][1] * (R[1][0] * R[2][2] - R[1][2] * R[2][0]) + R[0][2] * (R[1][0] * R[2][1] - R[1][1] * R[2][0])
    const cof = (r, c) => {
      const rr = [0, 1, 2].filter((x) => x !== r), cc = [0, 1, 2].filter((x) => x !== c)
      return ((r + c) % 2 ? -1 : 1) * (R[rr[0]][cc[0]] * R[rr[1]][cc[1]] - R[rr[0]][cc[1]] * R[rr[1]][cc[0]])
    }
    const inv = [0, 1, 2].map((r) => [0, 1, 2].map((c) => cof(c, r) / det))
    out[j.getName()] = [0, 1, 2].map((r) => -(inv[r][0] * t[0] + inv[r][1] * t[1] + inv[r][2] * t[2]))
  })
  return out
}

// ---------- geometría nueva ----------
const sub = (a, b) => a.map((x, i) => x - b[i])
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l) }

/** Triángulo plano pegado entero al hueso `joint` (índice), en el formato de `triangles`. */
export function flatTri(a, b, c, joint, color = [1, 1, 1]) {
  const n = norm(cross(sub(b, a), sub(c, a)))
  return { vs: [a, b, c].map((p) => ({ POSITION: [...p], NORMAL: n, COLOR_0: [...color], JOINTS_0: [joint, 0, 0, 0], WEIGHTS_0: [1, 0, 0, 0] })) }
}

/** Pincho de 4 caras: base cuadrada alrededor de `at`, punta en `at + dir * h`. */
export function spike(at, dir, h, w, joint, up = [0, 1, 0]) {
  const d = norm(dir)
  let side = norm(cross(d, up))
  if (!Number.isFinite(side[0]) || Math.hypot(...cross(d, up)) < 1e-6) side = [1, 0, 0]
  const fwd = norm(cross(side, d))
  const tip = at.map((x, i) => x + d[i] * h)
  const ring = [[1, 0], [0, 1], [-1, 0], [0, -1]].map(([s, f]) => at.map((x, i) => x + (side[i] * s + fwd[i] * f) * w))
  return ring.map((a, k) => flatTri(a, ring[(k + 1) % 4], tip, joint))
}

/** Escribe una primitiva sin índices con los triángulos de `list` (cada uno con sus propios vértices). */
export function primitive(doc, list, material, { colors = true } = {}) {
  const buffer = doc.getRoot().listBuffers()[0]
  const n = list.length * 3
  const arr = { POSITION: [3, Float32Array], NORMAL: [3, Float32Array], JOINTS_0: [4, Uint8Array], WEIGHTS_0: [4, Float32Array] }
  if (colors) arr.COLOR_0 = [3, Float32Array]
  const prim = doc.createPrimitive().setMaterial(material)
  for (const [k, [size, T]] of Object.entries(arr)) {
    const data = new T(n * size)
    list.forEach((t, i) => t.vs.forEach((v, j) => data.set(v[k].slice(0, size), (i * 3 + j) * size)))
    prim.setAttribute(k, doc.createAccessor().setType(size === 3 ? 'VEC3' : 'VEC4').setArray(data).setBuffer(buffer))
  }
  return prim
}

/** Quita la malla original (nodo, malla, accesores y materiales) para armar otra sobre el mismo esqueleto. */
export function dropOriginalMesh(doc) {
  const root = doc.getRoot()
  const node = root.listNodes().find((n) => n.getMesh())
  const mesh = node.getMesh()
  node.setMesh(null)
  for (const p of mesh.listPrimitives()) for (const a of [...p.listAttributes(), p.getIndices()]) a?.dispose()
  mesh.dispose()
  node.dispose()
  root.listMaterials().forEach((m) => m.dispose())
}

// ---------- bajar polígonos ----------
/**
 * Deja cada malla de `doc` en más o menos `ratio` de sus triángulos (meshoptimizer) y con normales planas, como
 * el resto del low poly del juego. Devuelve [antes, después].
 */
export async function reducir(doc, { ratio = 0.35, error = 0.02, lockBorder = false } = {}) {
  const { weld, simplify, prune, unweld } = await import('@gltf-transform/functions')
  const { MeshoptSimplifier } = await import('meshoptimizer')
  await MeshoptSimplifier.ready
  const prims = () => doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives())
  const count = () => prims().reduce((s, p) => s + (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3, 0)
  const before = count()
  // Las normales planas separan cada triángulo de sus vecinos: sin ellas se pueden soldar y simplificar.
  for (const p of prims()) {
    const n = p.getAttribute('NORMAL')
    if (n) { p.setAttribute('NORMAL', null); n.dispose() }
    // Sin textura, las coordenadas de textura sobran y también impiden soldar.
    const mat = p.getMaterial()
    if (!mat?.getBaseColorTexture() && !mat?.getEmissiveTexture()) for (const sem of p.listSemantics().filter((x) => x.startsWith('TEXCOORD'))) p.setAttribute(sem, null)
  }
  await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio, error, lockBorder }), unweld(), prune())
  for (const p of prims()) p.setAttribute('NORMAL', flatNormals(doc, p.getAttribute('POSITION')))
  return [before, count()]
}

/** Normales planas para una malla sin índices (cada tres vértices, un triángulo). */
function flatNormals(doc, P) {
  const n = new Float32Array(P.getCount() * 3), a = [], b = [], c = []
  for (let i = 0; i < P.getCount(); i += 3) {
    P.getElement(i, a); P.getElement(i + 1, b); P.getElement(i + 2, c)
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    let x = u[1] * v[2] - u[2] * v[1], y = u[2] * v[0] - u[0] * v[2], z = u[0] * v[1] - u[1] * v[0]
    const l = Math.hypot(x, y, z) || 1
    x /= l; y /= l; z /= l
    for (let k = 0; k < 3; k++) n.set([x, y, z], (i + k) * 3)
  }
  return doc.createAccessor().setType('VEC3').setArray(n).setBuffer(doc.getRoot().listBuffers()[0])
}

// ---------- apariencias por material ----------
/**
 * Variantes (KHR_materials_variants) hechas tiñendo los materiales que ya trae el modelo (su textura se
 * multiplica por el color). `looks[variante][nombreDelMaterial] = { color, emissive }`; lo que no se nombra
 * queda como estaba. La primera variante también se queda como material por defecto.
 */
export async function variantesPorMaterial(doc, looks) {
  const { KHRMaterialsVariants } = await import('@gltf-transform/extensions')
  const ext = doc.createExtension(KHRMaterialsVariants)
  const variants = Object.fromEntries(Object.keys(looks).map((v) => [v, ext.createVariant(v)]))
  const first = Object.keys(looks)[0]
  const made = new Map()
  const tinted = (mat, v) => {
    const key = `${mat.getName()}|${v}`
    if (!made.has(key)) {
      const look = looks[v][mat.getName()]
      const m = look ? mat.clone().setName(`${mat.getName()}_${v}`) : mat
      if (look?.color) m.setBaseColorFactor([...lin(look.color), 1])
      if (look?.emissive) m.setEmissiveFactor(lin(look.emissive))
      made.set(key, m)
    }
    return made.get(key)
  }
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const mat = prim.getMaterial()
    if (!mat) continue
    const mapping = ext.createMappingList()
    for (const v of Object.keys(looks)) mapping.addMapping(ext.createMapping().setMaterial(tinted(mat, v)).addVariant(variants[v]))
    prim.setExtension('KHR_materials_variants', mapping)
    prim.setMaterial(tinted(mat, first))
  }
}

/** Mete todo lo que cuelga de la escena en un nodo `name` escalado para que el modelo mida `height` de alto. */
export function aLaAltura(doc, name, height, currentHeight) {
  const scene = doc.getRoot().listScenes()[0]
  const holder = doc.createNode(name).setScale(Array(3).fill(height / currentHeight))
  for (const child of scene.listChildren()) holder.addChild(child)
  scene.addChild(holder)
  return holder
}
