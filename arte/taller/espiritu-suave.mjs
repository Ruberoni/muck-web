// Genera Espiritu.glb, el espíritu del bosque, hecho de cero sobre el esqueleto del jugador (usa sus animaciones
// de public/models/animations.glb): tronco de corteza, cabeza de tocón con ojos que brillan, brazos de rama con
// dedos de ramita, piernas de tronco con raíces por pies y copas de hojas en la cabeza y los hombros.
// Tres apariencias como variantes de material: base, noche y totem; en totem le salen astas de rama en la cabeza y
// espinas en los brazos (`totem_Ramas`) y se le ven grietas de fuego en el pecho.
// node espiritu-suave.mjs <Casual.glb> <salida.glb> (la segunda versión, suave; quedó en muestras/espiritu/pruebas)
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, KHRMaterialsVariants } from '@gltf-transform/extensions'
import { bindPositions, dropOriginalMesh, lin, random } from './lib.mjs'
import { icosphere } from './rocas.mjs'

const [inPath, outPath] = process.argv.slice(2)
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const doc = await io.read(inPath)
const root = doc.getRoot()
const skin = root.listSkins()[0]
const joints = skin.listJoints().map((j) => j.getName())
const B = bindPositions(skin)
const rnd = random(23)
const jit = (a) => (rnd() * 2 - 1) * a

// ---------- vectores ----------
const add = (a, b) => a.map((x, i) => x + b[i])
const sub = (a, b) => a.map((x, i) => x - b[i])
const mul = (a, s) => a.map((x) => x * s)
const lerp = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t)
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a) => mul(a, 1 / (Math.hypot(...a) || 1))
const one = (b) => [{ b, w: 1 }]
const mix = (a, b, t) => (t <= 0 ? one(a) : t >= 1 ? one(b) : [{ b: a, w: 1 - t }, { b, w: t }])

// ---------- piezas ----------
/** Triángulo de un papel, con los pesos de cada vértice. */
const tri = (role, pts, ws) => ({ role, pts, ws })

/** Mezcla dos listas de pesos [{ b, w }] (t = cuánto de la segunda). */
function blend(wa, wb, t) {
  const m = new Map()
  for (const { b, w } of wa) m.set(b, (m.get(b) ?? 0) + w * (1 - t))
  for (const { b, w } of wb) m.set(b, (m.get(b) ?? 0) + w * t)
  return [...m].map(([b, w]) => ({ b, w })).filter((x) => x.w > 0.01).sort((x, y) => y.w - x.w).slice(0, 4)
}
/** Catmull-Rom entre p1 y p2. */
const spline = (p0, p1, p2, p3, t) => p1.map((_, i) => 0.5 * (2 * p1[i] + (-p0[i] + p2[i]) * t + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t * t + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t * t * t))

/**
 * Un tubo por los puntos `pts` (radios `radii`, pesos `ws` por anillo), redondeado: el camino se curva entre los puntos
 * (`steps` anillos por tramo) y los extremos se cierran con una cúpula (o con una tapa plana de otro papel si
 * `capEnd` es un nombre).
 */
function tube(role, pts0, radii0, ws0, { sides = 8, rough = 0.06, steps = 2, capStart = true, capEnd = true, ridge = 0.1, twist = 0.22 } = {}) {
  const pts = [], radii = [], ws = []
  for (let k = 0; k < pts0.length - 1; k++) {
    const p0 = pts0[Math.max(k - 1, 0)], p1 = pts0[k], p2 = pts0[k + 1], p3 = pts0[Math.min(k + 2, pts0.length - 1)]
    for (let s = 0; s < steps; s++) {
      const t = s / steps
      pts.push(spline(p0, p1, p2, p3, t)); radii.push(radii0[k] + (radii0[k + 1] - radii0[k]) * t); ws.push(blend(ws0[k], ws0[k + 1], t))
    }
  }
  pts.push(pts0.at(-1)); radii.push(radii0.at(-1)); ws.push(ws0.at(-1))
  const frame = (k) => {
    const t = norm(sub(pts[Math.min(k + 1, pts.length - 1)], pts[Math.max(k - 1, 0)]))
    const ref = Math.abs(t[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]
    const u = norm(cross(t, ref))
    return [t, u, cross(t, u)]
  }
  // Las vetas de la corteza: un vértice sí y uno no más afuera (`ridge`), girando un poco a lo largo (`twist`).
  const ringAt = (c, r, [, u, v], k = 0, rid = ridge) => [...Array(sides)].map((_, s) => {
    const a = (s / sides) * Math.PI * 2 + k * twist, rr = r * (1 + jit(rough) + (s % 2 ? -rid : rid))
    return add(c, add(mul(u, Math.cos(a) * rr), mul(v, Math.sin(a) * rr)))
  })
  const rings = pts.map((p, k) => ringAt(p, radii[k], frame(k), k))
  const out = []
  const band = (A, B, wa, wb) => {
    for (let s = 0; s < sides; s++) {
      const s2 = (s + 1) % sides, a = A[s], b = A[s2], c = B[s2], d = B[s]
      out.push(tri(role, [a, b, c], [wa, wa, wb]), tri(role, [a, c, d], [wa, wb, wb]))
    }
  }
  for (let k = 0; k < rings.length - 1; k++) band(rings[k], rings[k + 1], ws[k], ws[k + 1])
  const cap = (k, flip, capRole) => {
    const f = frame(k), out1 = mul(f[0], flip ? -1 : 1)
    if (capRole !== role) { // tapa plana (el corte del tocón)
      const c = rings[k].reduce((acc, p) => add(acc, mul(p, 1 / sides)), [0, 0, 0])
      for (let s = 0; s < sides; s++) {
        const a = rings[k][s], b = rings[k][(s + 1) % sides]
        out.push(tri(capRole, flip ? [b, a, c] : [a, b, c], [ws[k], ws[k], ws[k]]))
      }
      return
    }
    // Cúpula: un anillo más chico un poco afuera y la punta.
    const mid = ringAt(add(pts[k], mul(out1, radii[k] * 0.45)), radii[k] * 0.72, f, k, ridge * 0.5)
    const tip = add(pts[k], mul(out1, radii[k] * 0.62))
    if (flip) band(mid, rings[k], ws[k], ws[k]); else band(rings[k], mid, ws[k], ws[k])
    for (let s = 0; s < sides; s++) {
      const a = mid[s], b = mid[(s + 1) % sides]
      out.push(tri(role, flip ? [b, a, tip] : [a, b, tip], [ws[k], ws[k], ws[k]]))
    }
  }
  if (capStart) cap(0, true, role)
  if (capEnd) cap(rings.length - 1, false, typeof capEnd === 'string' ? capEnd : role)
  return out
}

/** Un cono de 4 o 5 caras de `base` a `tip`. */
function cone(role, base, tip, w, ws, sides = 5) {
  return tube(role, [base, tip], [w, 0.002], [ws, ws], { sides, rough: 0.05, steps: 1, capEnd: false, ridge: 0, twist: 0 })
}

/** Una mata de hojas (o un ojo): una esfera algo deformada alrededor de `c`. */
function blob(role, c, r, ws, { lumps = 0.12, squash = [1, 1, 1] } = {}) {
  const { V, F } = icosphere(1)
  const P = V.map((v) => add(c, v.map((x, i) => x * r * squash[i] * (1 + jit(lumps)))))
  return F.map(([a, b, d]) => tri(role, [P[a], P[b], P[d]], [ws, ws, ws]))
}

const body = [], extra = []

// Tronco: de la cadera al cuello, algo más ancho arriba, con una curva de corteza.
const spine = [
  [B.Hips, 0.19, one('Hips')], [lerp(B.Hips, B.Abdomen, 1), 0.185, one('Abdomen')], [B.Torso, 0.19, mix('Abdomen', 'Torso', 0.7)],
  [B.Chest, 0.215, one('Chest')], [lerp(B.Chest, B.Neck, 0.6), 0.2, one('Chest')], [B.Neck, 0.11, mix('Chest', 'Neck', 0.6)],
]
body.push(...tube('Corteza', spine.map((s) => add(s[0], [0, 0, -0.01])), spine.map((s) => s[1]), spine.map((s) => s[2]), { sides: 10, rough: 0.05 }))
// Grietas en el pecho: solo se notan en el totem (en el resto tienen el color de la corteza).
for (const [x, y0, y1] of [[0.05, 1.18, 1.36], [-0.04, 1.22, 1.42], [0.0, 1.05, 1.2]]) {
  const z = y0 > 1.15 ? 0.255 : 0.235
  const a = [x - 0.012, y0, z], b = [x + 0.012, y0, z], c = [x + 0.02 * Math.sign(x || 1), y1, z - 0.01], d = [x - 0.006, y1, z - 0.01]
  const w = (y) => (y > 1.3 ? one('Chest') : one('Torso'))
  body.push(tri('Grietas', [a, b, c], [w(y0), w(y0), w(y1)]), tri('Grietas', [a, c, d], [w(y0), w(y1), w(y1)]))
}

// Cabeza: un tocón con el corte de arriba en bisel, dos ojos y un agujero de nudo por boca.
const neck = B.Neck, headTop = add(B.Head, [0, 0.27, 0])
body.push(...tube('Corteza', [add(neck, [0, 0.03, 0.01]), add(B.Head, [0, 0.08, 0.02]), add(headTop, [0, -0.02, 0.01])], [0.14, 0.15, 0.135],
  [mix('Neck', 'Head', 0.5), one('Head'), one('Head')], { sides: 10, rough: 0.04, capEnd: 'Madera', ridge: 0.06, twist: 0.1 }))
for (const s of [1, -1]) {
  const c = add(B.Head, [s * 0.055, 0.13, 0.16])
  body.push(...blob('Ojos', c, 0.032, one('Head'), { lumps: 0.02, squash: [1, 1.1, 0.6] }))
}
body.push(...blob('Boca', add(B.Head, [0, 0.045, 0.155]), 0.034, one('Head'), { lumps: 0.05, squash: [1.2, 0.8, 0.5] }))

// Brazos de rama y manos de tres ramitas.
for (const s of ['L', 'R']) {
  const sg = s === 'L' ? 1 : -1
  const sh = B[`Shoulder.${s}`], ua = B[`UpperArm.${s}`], la = B[`LowerArm.${s}`], wr = B[`Wrist.${s}`]
  body.push(...tube('Corteza', [lerp(sh, ua, 0.2), ua, lerp(ua, la, 0.5), la, lerp(la, wr, 0.5), wr],
    [0.085, 0.078, 0.07, 0.062, 0.054, 0.047],
    [mix('Chest', `Shoulder.${s}`, 0.6), one(`UpperArm.${s}`), one(`UpperArm.${s}`), mix(`UpperArm.${s}`, `LowerArm.${s}`, 0.5), one(`LowerArm.${s}`), mix(`LowerArm.${s}`, `Wrist.${s}`, 0.6)],
    { sides: 8, rough: 0.05 }))
  for (const [dy, dz, len] of [[0.03, 0.03, 0.17], [-0.01, 0.0, 0.2], [-0.04, -0.03, 0.15]]) {
    body.push(...cone('Corteza', wr, add(wr, [sg * len, dy - 0.03, dz + 0.02]), 0.026, one(`Wrist.${s}`)))
  }
  // Un brote con hojas en el codo.
  body.push(...blob('Hojas', add(la, [0, 0.08, -0.02]), 0.075, one(`UpperArm.${s}`)))
}

// Piernas de tronco y raíces por pies.
for (const s of ['L', 'R']) {
  const sg = s === 'L' ? 1 : -1
  const ul = B[`UpperLeg.${s}`], ll = B[`LowerLeg.${s}`], ft = B[`Foot.${s}`]
  body.push(...tube('Corteza', [add(ul, [0, 0.04, 0]), lerp(ul, ll, 0.5), ll, lerp(ll, ft, 0.5), add(ft, [0, 0.05, 0])],
    [0.108, 0.097, 0.086, 0.08, 0.096],
    [mix('Hips', `UpperLeg.${s}`, 0.7), one(`UpperLeg.${s}`), mix(`UpperLeg.${s}`, `LowerLeg.${s}`, 0.5), one(`LowerLeg.${s}`), mix(`LowerLeg.${s}`, `Foot.${s}`, 0.8)],
    { sides: 8, rough: 0.05 }))
  const base = add(ft, [0, 0.04, 0])
  for (const [dx, dz, len] of [[0.03, 1, 0.2], [0.8, 0.4, 0.16], [-0.6, 0.6, 0.15], [0.1, -0.9, 0.12]]) {
    const dir = norm([sg * dx, -0.25, dz])
    body.push(...cone('Corteza', base, add(base, mul(dir, len)), 0.042, one(`Foot.${s}`)))
  }
}

// Copas de hojas: sobre la cabeza y en los hombros.
body.push(...blob('Hojas', add(headTop, [0, 0.08, -0.04]), 0.19, one('Head'), { squash: [1.1, 0.85, 1] }))
body.push(...blob('Hojas', add(headTop, [0.13, 0.01, -0.07]), 0.12, one('Head')))
body.push(...blob('Hojas', add(headTop, [-0.14, -0.01, -0.05]), 0.13, one('Head')))
for (const s of ['L', 'R']) body.push(...blob('Hojas', add(B[`Shoulder.${s}`], [(s === 'L' ? 1 : -1) * 0.08, 0.15, -0.05]), 0.13, one('Chest'), { squash: [1.1, 0.85, 1] }))

// Dos ramas que le salen de la espalda, con hojas en la punta.
for (const sg of [1, -1]) {
  const p0 = add(B.Chest, [sg * 0.08, 0.06, -0.16]), p1 = add(p0, [sg * 0.12, 0.16, -0.08]), p2 = add(p1, [sg * 0.1, 0.14, 0.0])
  body.push(...tube('Corteza', [p0, p1, p2], [0.04, 0.028, 0.016], [one('Chest'), one('Chest'), one('Chest')], { sides: 6, rough: 0.03, ridge: 0.05, twist: 0.1 }))
  body.push(...blob('Hojas', add(p2, [sg * 0.02, 0.05, 0]), 0.1, one('Chest')))
}

// ---------- totem: astas de rama en la cabeza y espinas en los brazos ----------
for (const sg of [1, -1]) {
  const h = 'Head'
  const p0 = add(B.Head, [sg * 0.08, 0.2, 0]), p1 = add(p0, [sg * 0.1, 0.16, -0.04]), p2 = add(p1, [sg * 0.06, 0.16, -0.08])
  extra.push(...tube('Corteza', [p0, p1, p2], [0.035, 0.025, 0.008], [one(h), one(h), one(h)], { sides: 6, rough: 0.04 }))
  extra.push(...cone('Corteza', p1, add(p1, [sg * 0.14, 0.05, 0.02]), 0.016, one(h)))
  extra.push(...cone('Corteza', lerp(p1, p2, 0.6), add(p2, [-sg * 0.04, 0.08, 0.06]), 0.012, one(h)))
}
for (const s of ['L', 'R']) {
  const ua = B[`UpperArm.${s}`], la = B[`LowerArm.${s}`], wr = B[`Wrist.${s}`]
  for (const [a, b, t, bone] of [[ua, la, 0.35, `UpperArm.${s}`], [ua, la, 0.75, `UpperArm.${s}`], [la, wr, 0.4, `LowerArm.${s}`], [la, wr, 0.8, `LowerArm.${s}`]]) {
    const p = lerp(a, b, t)
    extra.push(...cone('Corteza', add(p, [0, 0.04, 0]), add(p, [0, 0.13, -0.03]), 0.016, one(bone), 4))
    extra.push(...cone('Corteza', add(p, [0, 0, -0.04]), add(p, [0, -0.02, -0.12]), 0.014, one(bone), 4))
  }
}

// ---------- apariencias ----------
const LOOKS = {
  base: {
    Corteza: { color: '#6e4c2f' }, Madera: { color: '#b08a5a' }, Grietas: { color: '#6e4c2f' },
    Hojas: { color: '#4f9a3f' }, Ojos: { color: '#ffd23f', emissive: '#a86a00' }, Boca: { color: '#1e140b' },
  },
  noche: {
    Corteza: { color: '#1c1714' }, Madera: { color: '#3a2e26' }, Grietas: { color: '#1c1714' },
    Hojas: { color: '#2a2030' }, Ojos: { color: '#d4c2ff', emissive: '#b48cff' }, Boca: { color: '#08060a' },
  },
  totem: {
    Corteza: { color: '#2a1a12' }, Madera: { color: '#5a2a14' }, Grietas: { color: '#ff7a2f', emissive: '#e0480f' },
    Hojas: { color: '#ff6a1f', emissive: '#a8320a' }, Ojos: { color: '#ffb36b', emissive: '#ff5a1f' }, Boca: { color: '#3a0a02', emissive: '#5a1404' },
  },
}

// ---------- escribir ----------
dropOriginalMesh(doc)
const buffer = root.listBuffers()[0]
const variantsExt = doc.createExtension(KHRMaterialsVariants)
const variants = Object.fromEntries(Object.keys(LOOKS).map((v) => [v, variantsExt.createVariant(v)]))
const material = (name, look) => doc.createMaterial(name).setDoubleSided(true).setMetallicFactor(0).setRoughnessFactor(0.9)
  .setBaseColorFactor([...lin(look.color), 1]).setEmissiveFactor(look.emissive ? lin(look.emissive) : [0, 0, 0])
const J = (b) => { const i = joints.indexOf(b); if (i < 0) throw new Error(`no hay hueso ${b}`); return i }

function buildMesh(name, list0) {
  const mesh = doc.createMesh(name)
  for (const role of [...new Set(list0.map((t) => t.role))]) {
    const list = list0.filter((t) => t.role === role)
    const n = list.length * 3
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3), Jo = new Uint8Array(n * 4), W = new Float32Array(n * 4)
    // Sombreado suave: cada vértice con la normal media de las caras que lo tocan (dentro del mismo papel).
    const key = (p) => p.map((x) => x.toFixed(4)).join()
    const acc = new Map()
    for (const t of list) {
      const n = cross(sub(t.pts[1], t.pts[0]), sub(t.pts[2], t.pts[0]))
      for (const p of t.pts) acc.set(key(p), add(acc.get(key(p)) ?? [0, 0, 0], n))
    }
    list.forEach((t, ti) => {
      t.pts.forEach((p, k) => {
        const o = ti * 3 + k
        P.set(p, o * 3); N.set(norm(acc.get(key(p))), o * 3)
        t.ws[k].forEach(({ b, w }, slot) => { Jo[o * 4 + slot] = J(b); W[o * 4 + slot] = w })
      })
    })
    const accessor = (type, a) => doc.createAccessor().setType(type).setArray(a).setBuffer(buffer)
    const mats = Object.fromEntries(Object.entries(LOOKS).map(([v, look]) => [v, material(`${role}_${v}`, look[role])]))
    const prim = doc.createPrimitive().setAttribute('POSITION', accessor('VEC3', P)).setAttribute('NORMAL', accessor('VEC3', N))
      .setAttribute('JOINTS_0', accessor('VEC4', Jo)).setAttribute('WEIGHTS_0', accessor('VEC4', W)).setMaterial(mats.base)
    const mapping = variantsExt.createMappingList()
    for (const v of Object.keys(LOOKS)) mapping.addMapping(variantsExt.createMapping().setMaterial(mats[v]).addVariant(variants[v]))
    prim.setExtension('KHR_materials_variants', mapping)
    mesh.addPrimitive(prim)
  }
  return mesh
}
const armature = root.listNodes().find((n) => n.getName() === 'CharacterArmature')
armature.addChild(doc.createNode('Espiritu').setMesh(buildMesh('Espiritu', body)).setSkin(skin))
armature.addChild(doc.createNode('totem_Ramas').setMesh(buildMesh('totem_Ramas', extra)).setSkin(skin))

await io.write(outPath, doc)
console.log(`espíritu · ${body.length} triángulos + ${extra.length} del totem`)
