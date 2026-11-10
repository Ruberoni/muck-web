// Montar una malla sin esqueleto sobre el esqueleto del jugador (el de las skins y animations.glb),
// con sus propias proporciones: cada hueso se alarga o acorta (`k`) sin cambiar de dirección, y las
// animaciones se adaptan escalando sus pistas de traslación igual. Lo usa chimpance.mjs.

// ---------- vectores y matrices (4×4 en columnas, como glTF) ----------
export const add = (a, b) => a.map((x, i) => x + b[i])
export const sub = (a, b) => a.map((x, i) => x - b[i])
export const mul = (a, s) => a.map((x) => x * s)
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const len = (a) => Math.hypot(a[0], a[1], a[2])
export const norm = (a) => mul(a, 1 / (len(a) || 1))
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const lerp = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t)

export function invert4(m) {
  const inv = new Array(16)
  inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10]
  inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10]
  inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9]
  inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9]
  inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10]
  inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10]
  inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9]
  inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9]
  inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6]
  inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6]
  inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5]
  inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5]
  inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6]
  inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6]
  inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5]
  inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5]
  const det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12]
  return inv.map((x) => x / det)
}

/** Matriz 3×3 (filas) que gira la dirección `a` hasta `b` por el camino más corto. */
export function rotFromTo(a, b) {
  a = norm(a); b = norm(b)
  const v = cross(a, b), c = dot(a, b)
  if (c < -0.9999) { // opuestos: media vuelta sobre cualquier perpendicular
    const p = norm(Math.abs(a[0]) < 0.9 ? cross(a, [1, 0, 0]) : cross(a, [0, 1, 0]))
    return [0, 1, 2].map((i) => [0, 1, 2].map((j) => 2 * p[i] * p[j] - (i === j ? 1 : 0)))
  }
  const k = 1 / (1 + c)
  const vx = [[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]]
  return [0, 1, 2].map((i) => [0, 1, 2].map((j) => (i === j ? 1 : 0) + vx[i][j] + k * (vx[i][0] * vx[0][j] + vx[i][1] * vx[1][j] + vx[i][2] * vx[2][j])))
}
export const apply3 = (R, v) => R.map((row) => dot(row, v))

/** Distancia de `p` al segmento a–b, y en qué punto de él (0–1) cae. */
export function segDist(p, a, b) {
  const ab = sub(b, a)
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1)))
  return { d: len(sub(p, lerp(a, b, t))), t }
}

// ---------- esqueleto ----------
/**
 * La pose de reposo del esqueleto de `skinDoc` (posición y matriz del mundo de cada hueso) y sus padres.
 * Las matrices salen de las inversas de bind: los nodos del archivo no están en reposo.
 */
export function restPose(skinDoc) {
  const skin = skinDoc.getRoot().listSkins()[0]
  const ibm = skin.getInverseBindMatrices()
  const joints = skin.listJoints()
  const names = joints.map((j) => j.getName())
  const world = {}, pos = {}, parent = {}
  joints.forEach((j, i) => {
    const m = invert4(ibm.getElement(i, []))
    world[names[i]] = m
    pos[names[i]] = [m[12], m[13], m[14]]
    const p = j.getParentNode()
    parent[names[i]] = p && names.includes(p.getName()) ? p.getName() : null
  })
  return { names, world, pos, parent }
}

/** Posiciones de reposo con cada hueso alargado por `k[nombre]` (1 si no está) respecto de su padre. */
export function scaledPositions(rest, k) {
  const out = {}
  for (const n of rest.names) {
    const p = rest.parent[n]
    out[n] = p ? add(out[p], mul(sub(rest.pos[n], rest.pos[p]), k[n] ?? 1)) : [...rest.pos[n]]
  }
  return out
}

/**
 * Aplica `k` a un documento con los nodos del esqueleto y sus animaciones (animations.glb): alarga las
 * traslaciones de los nodos y las pistas de traslación de cada hueso.
 */
export function scaleSkeleton(doc, k) {
  const byName = Object.fromEntries(doc.getRoot().listNodes().map((n) => [n.getName(), n]))
  for (const [name, f] of Object.entries(k)) if (byName[name]) byName[name].setTranslation(mul(byName[name].getTranslation(), f))
  const done = new Set()
  for (const anim of doc.getRoot().listAnimations()) for (const ch of anim.listChannels()) {
    const f = k[ch.getTargetNode()?.getName()]
    if (ch.getTargetPath() !== 'translation' || f === undefined) continue
    const out = ch.getSampler().getOutput()
    if (done.has(out)) continue
    done.add(out)
    out.setArray(out.getArray().map((x) => x * f))
  }
}
