#!/usr/bin/env node
// Convierte la naturaleza de los packs de Quaternius (CC0) en lo que dibuja el juego: public/models/nature/nature.glb,
// con una malla por pieza de cada variante (`tree_leaves_0`, `rock_2`…) y, si la pieza es grande, otra simplificada
// para lejos (`<nombre>_far`). Los colores van en los vértices y se multiplican por el material de cada tipo
// (src/view/PropView.ts): casi blancos en lo que se tiñe (troncos, copas, rocas, cristales) y de verdad en la
// decoración y el árbol muerto. Las formas se ajustan a las hitboxes de siempre (src/sim/aim.ts), que no cambian:
// scripts/nature.test.ts lo comprueba.
//   - Simple Nature Pack: árboles 1 y 3 (los otros no caben en la hitbox), rocas, arbustos y hierba.
//   - Stylized Nature MegaKit: árboles muertos y guijarros (estos con los colores de su textura). Sus hojas, su hierba y
//     sus flores son planos con transparencia y en colores lisos no se ven bien, y sus setas pesan demasiado: no se usan.
//   - Ultimate RPG Items Pack: los cristales de las menas.
//   - El pino oscuro, las setas y las flores se hacen aquí, en el mismo estilo.
// Uso: node scripts/build-nature.mjs "<Simple Nature Pack/OBJ>" "<Stylized Nature MegaKit/OBJ>" "<Ultimate RPG Items Pack/OBJ>"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'

const OUT = 'public/models/nature'
const [simpleDir, megaDir, rpgDir] = process.argv.slice(2)
if (!rpgDir) {
  console.error('Uso: node scripts/build-nature.mjs "<Simple Nature Pack/OBJ>" "<Stylized Nature MegaKit/OBJ>" "<Ultimate RPG Items Pack/OBJ>"')
  process.exit(1)
}

// Las medidas de las hitboxes (src/sim/props.ts; scripts/nature.test.ts comprueba que coinciden).
const TRUNK_BOTTOM_RADIUS = 0.35
const FOLIAGE_BASE = 2.4
const FOLIAGE_HEIGHT = 3.4
const FOLIAGE_RADIUS = 1.5
const TREE_TOP = FOLIAGE_BASE + FOLIAGE_HEIGHT
const ROCK_RADIUS = 1
const BUSH_RADIUS = 0.75
const BUSH_TOP = 1.0
/** Lo que se simplifica para lejos: lo que pasa de tantos triángulos, a esta parte. */
const FAR_FROM = 60
const FAR_RATIO = 0.35

// --- Leer los OBJ ---

/** Un triángulo: sus tres vértices, su color (lineal) y el material del que viene. */
const tri = (p, color, material) => ({ p, color, material })

function readMtl(dir, file) {
  const materials = new Map()
  let current = null
  for (const line of readFileSync(join(dir, file), 'utf8').split(/\r?\n/)) {
    const [key, ...rest] = line.trim().split(/\s+/)
    if (key === 'newmtl') materials.set((current = rest.join(' ')), { kd: [1, 1, 1], map: null })
    else if (key === 'Kd' && current) materials.get(current).kd = rest.map(Number)
    else if (key === 'map_Kd' && current) materials.get(current).map = rest.join(' ')
  }
  return materials
}

/** Los triángulos de un OBJ, con la UV del centro de cada uno (si tiene) para muestrear su textura. */
function readObj(dir, file) {
  const v = []
  const vt = []
  const faces = []
  let material = null
  let mtl = null
  for (const line of readFileSync(join(dir, file), 'utf8').split(/\r?\n/)) {
    const [key, ...rest] = line.trim().split(/\s+/)
    if (key === 'v') v.push(rest.slice(0, 3).map(Number))
    else if (key === 'vt') vt.push(rest.slice(0, 2).map(Number))
    else if (key === 'usemtl') material = rest.join(' ')
    else if (key === 'mtllib') mtl = rest.join(' ')
    else if (key === 'f') {
      const corners = rest.map((c) => {
        const [pi, ti] = c.split('/').map((n) => (n ? Number(n) : null))
        return { p: v[pi < 0 ? v.length + pi : pi - 1], t: ti === null ? null : vt[ti < 0 ? vt.length + ti : ti - 1] }
      })
      for (let i = 1; i + 1 < corners.length; i++) faces.push({ corners: [corners[0], corners[i], corners[i + 1]], material })
    }
  }
  return { faces, materials: mtl ? readMtl(dir, mtl) : new Map(), dir }
}

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const hex = (h) => [1, 3, 5].map((i) => srgbToLinear(parseInt(h.slice(i, i + 2), 16) / 255))

const textures = new Map()
/** Una textura como píxeles RGBA, para muestrearla. */
async function texture(path) {
  if (!textures.has(path)) {
    const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    textures.set(path, { data, width: info.width, height: info.height })
  }
  return textures.get(path)
}

/** El color de la textura en la UV (u, v), en lineal; repetida fuera de [0, 1]. */
function sample({ data, width, height }, [u, v]) {
  const x = Math.min(width - 1, Math.floor((((u % 1) + 1) % 1) * width))
  const y = Math.min(height - 1, Math.floor((1 - (((v % 1) + 1) % 1)) * height))
  const i = (y * width + x) * 4
  return [data[i], data[i + 1], data[i + 2]].map((c) => srgbToLinear(c / 255))
}

/**
 * Los triángulos del OBJ con sus colores: el de su material (Kd) o, si tiene textura, el de la textura en el centro de
 * sus UV. `paint` puede cambiar el color de un material por otro (en lineal), o quitarlo (null).
 */
async function load(dir, file, paint = {}) {
  const { faces, materials } = readObj(dir, file)
  const tris = []
  for (const { corners, material } of faces) {
    if (paint[material] === null) continue
    const def = materials.get(material) ?? { kd: [1, 1, 1], map: null }
    let color = paint[material] ?? def.kd
    if (!paint[material] && def.map) {
      const t = await texture(join(dir, def.map.replace(/^.*[\\/]/, ''))).catch(() => texture(join(dir, '..', 'Textures', def.map.replace(/^.*[\\/]/, ''))))
      const uv = corners[0].t && [0, 1].map((k) => (corners[0].t[k] + corners[1].t[k] + corners[2].t[k]) / 3)
      color = uv ? sample(t, uv).map((c, k) => c * def.kd[k]) : def.kd
    }
    tris.push(tri(corners.map((c) => [...c.p]), color, material))
  }
  return tris
}

// --- Retocar los triángulos ---

const each = (tris, f) => tris.map((t) => ({ ...t, p: t.p.map((q) => f([...q])) }))
const translate = (tris, [dx, dy, dz]) => each(tris, ([x, y, z]) => [x + dx, y + dy, z + dz])
const scale = (tris, [sx, sy, sz]) => each(tris, ([x, y, z]) => [x * sx, y * sy, z * sz])
const rotateY = (tris, a) => each(tris, ([x, y, z]) => [x * Math.cos(a) + z * Math.sin(a), y, -x * Math.sin(a) + z * Math.cos(a)])
const recolor = (tris, color) => tris.map((t) => ({ ...t, color }))
const only = (tris, material) => tris.filter((t) => t.material === material)

function bounds(tris) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const { p } of tris) for (const q of p) for (let i = 0; i < 3; i++) (min[i] = Math.min(min[i], q[i])), (max[i] = Math.max(max[i], q[i]))
  return { min, max }
}

/** Un ruido fijo de un punto, de 0 a 1: el mismo en todas las ejecuciones. */
function noise([x, y, z], seed = 0) {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed * 4.1) * 43758.5453
  return s - Math.floor(s)
}

/**
 * Casi blanco, con algo de variación por vértice (la misma en los vértices compartidos: no corta la malla al
 * simplificar): lo tiñe el material de cada tipo.
 */
const tintable = (tris, low = 0.86) => tris.map((t) => ({ ...t, color: null, shade: low }))

/** Mueve la base del tronco (lo de `trunk` por debajo de `height`) al origen y apoya el modelo en y = 0. */
function standOnTrunk(tris, trunk, height = 0.4) {
  const { min } = bounds(tris)
  const base = tris.filter((t) => t.material === trunk).flatMap((t) => t.p).filter((q) => q[1] < min[1] + height)
  const cx = base.reduce((s, q) => s + q[0], 0) / base.length
  const cz = base.reduce((s, q) => s + q[2], 0) / base.length
  return translate(tris, [-cx, -min[1], -cz])
}

/** Escala para que mida `height` de alto y, a lo ancho (desde el eje), no pase de `radius`. */
function fitHeight(tris, height, radius) {
  const { max } = bounds(tris)
  const sy = height / max[1]
  const reach = Math.max(...tris.flatMap((t) => t.p).map(([x, , z]) => Math.hypot(x, z)))
  const sxz = Math.min(sy, radius / reach)
  return scale(tris, [sxz, sy, sxz])
}

/** Centra la caja en el origen y la ajusta a ±`half` en cada eje. */
function fitBox(tris, half) {
  const { min, max } = bounds(tris)
  const centered = translate(tris, min.map((m, i) => -(m + max[i]) / 2))
  return scale(centered, min.map((m, i) => (half[i] * 2) / (max[i] - m)))
}

// --- Lo que se hace aquí ---

/** Un cono (o tronco de cono) de `sides` caras, de `r0` abajo a `r1` arriba, entre `y0` e `y1`, sin tapa de arriba si acaba en punta. */
function cone(sides, r0, r1, y0, y1, turn = 0) {
  const tris = []
  for (let i = 0; i < sides; i++) {
    const a = turn + (i / sides) * Math.PI * 2
    const b = turn + ((i + 1) / sides) * Math.PI * 2
    const p = (r, y, t) => [Math.sin(t) * r, y, Math.cos(t) * r]
    if (r1 > 0) tris.push(tri([p(r0, y0, a), p(r0, y0, b), p(r1, y1, b)], null), tri([p(r0, y0, a), p(r1, y1, b), p(r1, y1, a)], null))
    else tris.push(tri([p(r0, y0, a), p(r0, y0, b), [0, y1, 0]], null))
    // La base, hacia abajo.
    tris.push(tri([[0, y0, 0], p(r0, y0, b), p(r0, y0, a)], null))
  }
  return tris
}

/** Pino de pisos: el tronco y la copa por separado. `tiers`: [base, alto, radio] de cada piso, de abajo arriba. */
function pine(tiers, turn) {
  const trunk = cone(6, TRUNK_BOTTOM_RADIUS * 0.9, 0.18, 0, FOLIAGE_BASE + 0.6)
  const leaves = tiers.flatMap(([y, h, r], i) => cone(7, r, 0, y, y + h, turn + i * 0.7).map((t) => ({ ...t, shade: 0.8 + 0.08 * i })))
  return { trunk: tintable(trunk), leaves: leaves.map((t) => ({ ...t, color: null })) }
}

/** Una flor: tallo y cinco pétalos alrededor de un centro. Colores de verdad (decoración). */
function flower(petal, seed) {
  const stem = recolor(cone(4, 0.015, 0.01, 0, 0.28, seed), hex('#3d7d35'))
  const petals = []
  for (let i = 0; i < 5; i++) {
    const a = seed + (i / 5) * Math.PI * 2
    const c = [Math.sin(a) * 0.05, 0.3, Math.cos(a) * 0.05]
    const side = [Math.cos(a) * 0.035, 0, -Math.sin(a) * 0.035]
    const tip = [Math.sin(a) * 0.11, 0.32, Math.cos(a) * 0.11]
    petals.push(tri([[c[0] - side[0], c[1], c[2] - side[2]], tip, [c[0] + side[0], c[1], c[2] + side[2]]], hex(petal)))
    petals.push(tri([[c[0] + side[0], c[1], c[2] + side[2]], tip, [c[0] - side[0], c[1], c[2] - side[2]]], hex(petal)))
  }
  const center = recolor(cone(5, 0.035, 0, 0.29, 0.35, seed), hex('#f2c94c'))
  return [...stem, ...petals, ...center]
}

/** Una seta: el pie y el sombrero. Colores de verdad (decoración). */
function mushroom(cap, seed) {
  const stem = recolor(cone(5, 0.035, 0.028, 0, 0.14, seed), hex('#efe6d2'))
  const top = recolor(cone(7, 0.11, 0, 0.12, 0.22, seed), hex(cap))
  return [...stem, ...top]
}

/** Dónde corta un rayo desde el origen en `dir` a la malla, lo más lejos (la superficie de fuera). */
function surface(tris, dir) {
  let best = 0
  for (const { p } of tris) {
    const [a, b, c] = p
    const e1 = b.map((x, i) => x - a[i])
    const e2 = c.map((x, i) => x - a[i])
    const h = [dir[1] * e2[2] - dir[2] * e2[1], dir[2] * e2[0] - dir[0] * e2[2], dir[0] * e2[1] - dir[1] * e2[0]]
    const det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2]
    if (Math.abs(det) < 1e-9) continue
    const s = a.map((x) => -x)
    const u = (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]) / det
    if (u < 0 || u > 1) continue
    const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]]
    const w = (dir[0] * q[0] + dir[1] * q[1] + dir[2] * q[2]) / det
    if (w < 0 || u + w > 1) continue
    const t = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det
    if (t > best) best = t
  }
  return best
}

/** Gira `tris` para que su +Y apunte a `to` (normalizado). */
function alignUp(tris, to) {
  const axis = [to[2], 0, -to[0]]
  const sin = Math.hypot(axis[0], axis[2])
  if (sin < 1e-6) return tris
  const [kx, , kz] = [axis[0] / sin, 0, axis[2] / sin]
  const cos = to[1]
  // Rodrigues, con el eje en el plano XZ.
  return each(tris, ([x, y, z]) => {
    const dot = kx * x + kz * z
    const cross = [-kz * y, kz * x - kx * z, kx * y]
    return [x * cos + cross[0] * sin + kx * dot * (1 - cos), y * cos + cross[1] * sin, z * cos + cross[2] * sin + kz * dot * (1 - cos)]
  })
}

/** Cristales que asoman de la roca `rock` (ya ajustada), donde estaban los de siempre. Adorno: sin hitbox. */
function crystalsOn(rock, crystal) {
  const spots = [
    [0.55, 0.62, 0.2, 1],
    [-0.5, 0.55, 0.45, 0.8],
    [0.05, 0.85, -0.45, 1.1],
    [-0.35, 0.4, -0.75, 0.7],
    [0.7, 0.3, -0.45, 0.75],
  ]
  return spots.flatMap(([x, y, z, size], i) => {
    const len = Math.hypot(x, y, z)
    const dir = [x / len, y / len, z / len]
    const at = surface(rock, dir)
    const up = [dir[0] * 0.7, dir[1] * 0.7 + 0.5, dir[2] * 0.7]
    const n = Math.hypot(...up)
    const piece = alignUp(rotateY(scale(crystal, [size, size, size]), i * 1.3), up.map((c) => c / n))
    return translate(piece, dir.map((c) => c * (at - 0.08)))
  })
}

// --- Escribir el .glb ---

/** Los triángulos como malla con índices: junta los vértices iguales (posición y color). */
function indexed(tris) {
  const positions = []
  const colors = []
  const indices = []
  const seen = new Map()
  for (const t of tris) {
    for (const q of t.p) {
      const color = t.color ?? Array(3).fill((t.shade ?? 0.86) + (1 - (t.shade ?? 0.86)) * noise(q))
      const key = `${q.map((c) => c.toFixed(4))}|${color.map((c) => c.toFixed(3))}`
      let index = seen.get(key)
      if (index === undefined) {
        index = positions.length / 3
        seen.set(key, index)
        positions.push(...q)
        colors.push(...color.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255)), 255)
      }
      indices.push(index)
    }
  }
  return { positions: new Float32Array(positions), colors: new Uint8Array(colors), indices: new Uint32Array(indices) }
}

/** La misma malla con unos `ratio` de sus triángulos, sin vértices sueltos. */
function simplified({ positions, colors, indices }, ratio) {
  const target = Math.max(3, Math.floor((indices.length * ratio) / 3) * 3)
  const [kept] = MeshoptSimplifier.simplify(indices, positions, 3, target, 0.05)
  const remap = new Map()
  const p = []
  const c = []
  const out = new Uint32Array(kept.length)
  kept.forEach((old, i) => {
    if (!remap.has(old)) {
      remap.set(old, p.length / 3)
      p.push(positions[old * 3], positions[old * 3 + 1], positions[old * 3 + 2])
      c.push(...colors.subarray(old * 4, old * 4 + 4))
    }
    out[i] = remap.get(old)
  })
  return { positions: new Float32Array(p), colors: new Uint8Array(c), indices: out }
}

/** Lo que se va escribiendo en un `.glb`: accessors, vistas y binario (como scripts/build-models.mjs). */
class Writer {
  accessors = []
  bufferViews = []
  parts = []
  length = 0

  add(bytes, { count, type, componentType, target, min, max, normalized }) {
    const padding = (4 - (this.length % 4)) % 4
    if (padding) this.parts.push(Buffer.alloc(padding))
    this.length += padding
    this.bufferViews.push({ buffer: 0, byteOffset: this.length, byteLength: bytes.length, target })
    this.parts.push(bytes)
    this.length += bytes.length
    this.accessors.push({ bufferView: this.bufferViews.length - 1, componentType, count, type, ...(min ? { min, max } : {}), ...(normalized ? { normalized } : {}) })
    return this.accessors.length - 1
  }

  /** Una primitiva: posiciones, colores (RGBA de 8 bits) e índices. */
  mesh({ positions, colors, indices }) {
    const min = [0, 1, 2].map((i) => Math.min(...positions.filter((_, k) => k % 3 === i)))
    const max = [0, 1, 2].map((i) => Math.max(...positions.filter((_, k) => k % 3 === i)))
    const count = positions.length / 3
    const small = count < 65536
    const attributes = {
      POSITION: this.add(Buffer.from(positions.buffer), { count, type: 'VEC3', componentType: 5126, target: 34962, min, max }),
      COLOR_0: this.add(Buffer.from(colors.buffer), { count, type: 'VEC4', componentType: 5121, target: 34962, normalized: true }),
    }
    return {
      attributes,
      indices: this.add(Buffer.from((small ? Uint16Array.from(indices) : indices).buffer), { count: indices.length, type: 'SCALAR', componentType: small ? 5123 : 5125, target: 34963 }),
    }
  }

  glb(json) {
    const body = Buffer.concat(this.parts)
    const text = Buffer.from(JSON.stringify({ ...json, accessors: this.accessors, bufferViews: this.bufferViews, buffers: [{ byteLength: body.length }] }))
    const jsonChunk = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)])
    const binChunk = Buffer.concat([body, Buffer.alloc((4 - (body.length % 4)) % 4)])
    const header = Buffer.alloc(20)
    header.writeUInt32LE(0x46546c67, 0)
    header.writeUInt32LE(2, 4)
    header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8)
    header.writeUInt32LE(jsonChunk.length, 12)
    header.writeUInt32LE(0x4e4f534a, 16)
    const binHeader = Buffer.alloc(8)
    binHeader.writeUInt32LE(binChunk.length, 0)
    binHeader.writeUInt32LE(0x004e4942, 4)
    return Buffer.concat([header, jsonChunk, binHeader, binChunk])
  }
}

// --- Los modelos ---

await MeshoptSimplifier.ready
const models = new Map()
const put = (name, tris) => models.set(name, tris)

// Árbol y abedul: el tronco y la copa por separado, como las piezas de siempre.
for (const [i, file] of ['Tree1.obj', 'Tree3.obj'].entries()) {
  const tree = fitHeight(standOnTrunk(await load(simpleDir, file), 'Tree'), TREE_TOP, FOLIAGE_RADIUS * 1.2)
  put(`tree_trunk_${i}`, tintable(only(tree, 'Tree'), 0.8))
  put(`tree_leaves_${i}`, tintable(only(tree, 'Leaves')))
  // El abedul, con marcas oscuras en algunas caras del tronco.
  put(
    `birch_trunk_${i}`,
    only(tree, 'Tree').map((t, k) => ({ ...t, color: noise(t.p[0], k) < 0.18 ? hex('#2f2c28') : hex('#ece8dc') })),
  )
}

// Pino oscuro: pisos de conos, más alto que ancho.
put('pine_trunk_0', pine([[2, 1.8, 1.7], [3, 1.6, 1.35], [3.9, 1.3, 1], [4.7, 1.1, 0.65]], 0).trunk)
put('pine_leaves_0', pine([[2, 1.8, 1.7], [3, 1.6, 1.35], [3.9, 1.3, 1], [4.7, 1.1, 0.65]], 0).leaves)
put('pine_trunk_1', pine([[2.2, 2, 1.6], [3.4, 1.7, 1.2], [4.5, 1.3, 0.75]], 0.4).trunk)
put('pine_leaves_1', pine([[2.2, 2, 1.6], [3.4, 1.7, 1.2], [4.5, 1.3, 0.75]], 0.4).leaves)

// Rocas (también las de las menas) y los cristales de cada una.
const crystal = fitHeight(standOnTrunk(await load(rpgDir, 'Crystal3.obj'), 'Green', 10), 0.45, 0.12)
for (const [i, file] of ['Rock1.obj', 'Rock2.obj', 'Rock3.obj'].entries()) {
  const rock = fitBox(await load(simpleDir, file), [ROCK_RADIUS * 0.95, ROCK_RADIUS * 0.9, ROCK_RADIUS * 0.95])
  put(`rock_${i}`, tintable(rock, 0.82))
  put(`crystals_${i}`, tintable(crystalsOn(rock, crystal), 0.85))
}

// Arbustos: las ramas, más oscuras que las hojas.
for (const [i, file] of ['Bush1.obj', 'Bush2.obj', 'Bush3.obj'].entries()) {
  const bush = translate(fitBox(await load(simpleDir, file), [BUSH_RADIUS * 1.05, (BUSH_TOP + 0.05) / 2, BUSH_RADIUS * 1.05]), [0, (BUSH_TOP - 0.05) / 2, 0])
  put(`bush_${i}`, bush.map((t) => (t.material === 'Tree' ? { ...t, color: [0.32, 0.22, 0.14] } : { ...t, color: null, shade: 0.85 })))
}

// Árbol muerto (para el paso del mapa grande): denso, se simplifica ya aquí; lo tiñe su material.
for (const [i, file] of ['DeadTree_1.obj', 'DeadTree_2.obj', 'DeadTree_3.obj'].entries()) {
  const tree = fitHeight(standOnTrunk(await load(megaDir, file), 'Bark_DeadTree', 0.6), TREE_TOP * 1.15, FOLIAGE_RADIUS * 1.4)
  put(`dead_tree_${i}`, tintable(tree, 0.78))
}

// Decoración, sin hitbox: hierba (la tiñe el color del suelo), guijarros, setas y flores.
for (const [i, file] of ['Grass1.obj', 'Grass2.obj', 'Grass3.obj'].entries()) {
  const grass = await load(simpleDir, file)
  const { max } = bounds(grass)
  put(`grass_${i}`, tintable(scale(grass, Array(3).fill(0.45 / max[1])), 0.75))
}
for (const [i, file] of ['Pebble_Round_1.obj', 'Pebble_Round_3.obj', 'Pebble_Square_2.obj', 'Pebble_Square_4.obj'].entries()) {
  put(`pebble_${i}`, scale(await load(megaDir, file), [0.8, 0.8, 0.8]))
}
for (const [i, cap] of ['#c0392b', '#9a6a3a'].entries()) put(`mushroom_${i}`, mushroom(cap, i * 1.7))
for (const [i, petal] of ['#f4f1e8', '#f2c94c', '#b48be0'].entries()) put(`flower_${i}`, flower(petal, i * 0.9))

// --- Escribir ---

const writer = new Writer()
const meshes = []
const nodes = []
for (const [name, tris] of models) {
  const mesh = indexed(tris)
  const versions = [[name, mesh]]
  // El árbol muerto es denso: se simplifica también de cerca.
  if (name.startsWith('dead_tree')) versions[0][1] = simplified(mesh, 900 / (mesh.indices.length / 3))
  const near = versions[0][1]
  if (near.indices.length / 3 > FAR_FROM && !/^(grass|pebble|mushroom|flower)/.test(name)) versions.push([`${name}_far`, simplified(near, FAR_RATIO)])
  for (const [n, m] of versions) {
    meshes.push({ name: n, primitives: [{ ...writer.mesh(m), material: 0 }] })
    nodes.push({ name: n, mesh: meshes.length - 1 })
    console.log(n.padEnd(20), String(m.indices.length / 3).padStart(5), 'triángulos')
  }
}
const glb = writer.glb({
  asset: { version: '2.0', generator: 'muck-web scripts/build-nature.mjs' },
  scene: 0,
  scenes: [{ nodes: nodes.map((_, i) => i) }],
  nodes,
  meshes,
  materials: [{ name: 'nature', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 } }],
})
mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, 'nature.glb'), glb)
console.log('nature.glb', (glb.length / 1024).toFixed(0), 'KB')

// Las licencias de los packs, junto al modelo.
const licenses = [join(megaDir, '..', 'License_Standard.txt'), join(rpgDir, '..', 'License.txt')].filter(existsSync)
writeFileSync(
  join(OUT, 'LICENSE.txt'),
  [
    'Modelos de naturaleza: Simple Nature Pack, Stylized Nature MegaKit y Ultimate RPG Items Pack, de Quaternius',
    '(https://quaternius.com), CC0 1.0 Universal (dominio público). Convertidos con scripts/build-nature.mjs.',
    '',
    ...licenses.map((path) => readFileSync(path, 'utf8')),
  ].join('\n'),
)
