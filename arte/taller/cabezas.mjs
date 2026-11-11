// Cabezas para el cuerpo del chimpancé. Cada una recibe la malla ya en la pose del esqueleto (metros, mirando
// hacia +z) y puede mover vértices de la cabeza (`posed`), quitar caras (`face.drop = true`) y devolver
// triángulos nuevos ({ role, pts, ws }) pegados al hueso Head.
//
// Medidas de la cabeza del chimpancé ya montado: centro (0, 1.72, 0.16), orejas en x ±0.12…0.16 a la altura
// 1.75–1.81, ojos en z 0.25–0.27 a 1.76–1.78, hocico hasta z 0.34, coronilla a 1.88.

const HEAD = [{ b: 'Head', w: 1 }, { b: 'Head', w: 0 }]
const tri = (role, a, b, c, ws = HEAD) => ({ role, pts: [a, b, c], ws: [ws, ws, ws] })
const add = (a, b) => a.map((x, i) => x + b[i])
const mul = (a, s) => a.map((x) => x * s)
const sub = (a, b) => a.map((x, i) => x - b[i])
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a) => mul(a, 1 / (Math.hypot(...a) || 1))

/** Un cono de 4 caras de `base` a `tip`, de ancho `w`, pegado a `ws` (por defecto, la cabeza). */
export function cone(role, base, tip, w, ws = HEAD) {
  const d = norm(sub(tip, base))
  const s = norm(Math.abs(d[1]) < 0.9 ? cross(d, [0, 1, 0]) : cross(d, [1, 0, 0]))
  const f = cross(s, d)
  const ring = [[1, 0], [0, 1], [-1, 0], [0, -1]].map(([a, b]) => add(base, add(mul(s, a * w), mul(f, b * w))))
  return ring.map((p, k) => tri(role, p, ring[(k + 1) % 4], tip, ws))
}

/** Un cuerno curvo: varios conos truncados seguidos que se van afinando. */
function horn(role, points, w) {
  const out = []
  for (let k = 0; k < points.length - 1; k++) {
    const a = points[k], b = points[k + 1]
    const wa = w * (1 - k / (points.length - 1)), wb = w * (1 - (k + 1) / (points.length - 1))
    if (k === points.length - 2) { out.push(...cone(role, a, b, wa)); break }
    const d = norm(sub(b, a))
    const s = norm(cross(d, [0, 0, 1])), f = cross(s, d)
    const ring = (c, r) => [[1, 0], [0, 1], [-1, 0], [0, -1]].map(([x, y]) => add(c, add(mul(s, x * r), mul(f, y * r))))
    const ra = ring(a, wa), rb = ring(b, wb)
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4
      out.push(tri(role, ra[i], ra[j], rb[j]), tri(role, ra[i], rb[j], rb[i]))
    }
  }
  return out
}

const headVerts = (ctx, pred) => [...ctx.headIds].filter((i) => pred(ctx.posed[i], i))

/** Orejas largas de trasgo (estirando las del chimpancé), cara plana y nariz larga y ganchuda. */
function orejon(ctx) {
  const { posed } = ctx
  // Orejas: lo que sobresale de x ±0.12 se estira hacia fuera, arriba y atrás.
  const skin = new Set(ctx.faces.filter((f) => f.role === 'Piel').flatMap((f) => f.ids))
  const fur = new Set(ctx.faces.filter((f) => f.role !== 'Piel').flatMap((f) => f.ids))
  for (const i of headVerts(ctx, (p, i) => skin.has(i) && !fur.has(i) && Math.abs(p[0]) > 0.115 && p[1] > 1.7)) {
    const p = posed[i], s = Math.sign(p[0]), d = Math.abs(p[0]) - 0.115
    posed[i] = [s * (0.115 + d * 5), p[1] + d * 2.4, p[2] - d * 2.2]
  }
  // Hocico: lo que sale por delante de los ojos se aplasta.
  for (const i of headVerts(ctx, (p) => p[2] > 0.25 && p[1] < 1.76)) posed[i] = [posed[i][0], posed[i][1], 0.25 + (posed[i][2] - 0.25) * 0.35]
  // Ojos más grandes y un poco salidos, para que se vean de lejos.
  const eyes = ctx.faces.filter((f) => f.role === 'Ojos')
  for (const side of [1, -1]) {
    const ids = [...new Set(eyes.flatMap((f) => f.ids))].filter((i) => Math.sign(posed[i][0]) === side)
    const c = ids.reduce((a, i) => add(a, mul(posed[i], 1 / ids.length)), [0, 0, 0])
    for (const i of ids) posed[i] = add(add(c, mul(sub(posed[i], c), 1.7)), [0, 0, 0.008])
  }
  // Nariz: de entre los ojos hacia delante y abajo, con la punta caída.
  return [
    ...cone('Piel', [0, 1.75, 0.265], [0, 1.705, 0.385], 0.024),
  ]
}

/** El orejón con colmillos que salen de la mandíbula y el ceño marcado. */
function colmillos(ctx) {
  const out = orejon(ctx)
  for (const s of [1, -1]) out.push(...cone('Dientes', [s * 0.032, 1.64, 0.258], [s * 0.042, 1.7, 0.29], 0.012))
  // Ceño: la frente sobre los ojos baja y sale un poco.
  for (const i of headVerts(ctx, (p) => p[1] > 1.785 && p[1] < 1.83 && p[2] > 0.2)) ctx.posed[i] = [ctx.posed[i][0], ctx.posed[i][1] - 0.006, ctx.posed[i][2] + 0.015]
  return out
}

/** El orejón con dos cuernos curvos hacia atrás. */
function cuernos(ctx) {
  const out = orejon(ctx)
  for (const s of [1, -1]) out.push(...horn('Cuernos', [
    [s * 0.06, 1.84, 0.16], [s * 0.1, 1.93, 0.12], [s * 0.12, 1.99, 0.04], [s * 0.115, 2.01, -0.05],
  ], 0.032))
  return out
}

/**
 * La cabeza del goblin de joney_lol (muestras/trasgo/Goblin…glb, ruta en GOBLIN) en lugar de la del chimpancé:
 * todo lo que en su archivo queda por encima del cuello (y > 0,15), a la altura y el tamaño de la cabeza quitada.
 */
async function goblin(ctx) {
  const doc = await ctx.io.read(process.env.GOBLIN)
  const ROLE = { 'Material.005': 'Piel', 'Material.001': 'Ojos', 'Material.006': 'Dientes', 'Material.004': 'Pelaje' }
  const src = []
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh()
    if (!mesh) continue
    for (const prim of mesh.listPrimitives()) {
      const P = prim.getAttribute('POSITION'), I = prim.getIndices()
      const n = I ? I.getCount() : P.getCount()
      const role = ROLE[prim.getMaterial()?.getName()] ?? 'Piel'
      for (let t = 0; t < n; t += 3) {
        const pts = [0, 1, 2].map((k) => P.getElement(I ? I.getScalar(t + k) : t + k, []))
        if ((pts[0][1] + pts[1][1] + pts[2][1]) / 3 > 0.15) src.push({ role, pts })
      }
    }
  }
  // Fuera la cabeza del chimpancé (queda su cuello).
  for (const f of ctx.faces) if (f.ids.every((i) => ctx.headIds.has(i))) f.drop = true
  const hp = [...ctx.headIds].map((i) => ctx.posed[i])
  const bottom = Math.min(...hp.map((p) => p[1])), top = Math.max(...hp.map((p) => p[1]))
  const SRC_BOTTOM = 0.151, SRC_TOP = 0.419
  const sc = ((top - bottom) / (SRC_TOP - SRC_BOTTOM)) * 1.2
  const place = (p) => [p[0] * sc, bottom - 0.02 + (p[1] - SRC_BOTTOM) * sc, ctx.center[2] - 0.03 + p[2] * sc]
  return src.map(({ role, pts }) => tri(role, ...pts.map(place)))
}

/** La del modelo original, sin tocar. */
const chimpance = () => []

export const HEADS = { chimpance, orejon, colmillos, cuernos, goblin }
