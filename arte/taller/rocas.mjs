// Piedras y cristales low poly hechos por código, pegados entero a un hueso (para gólems, colosos, montones de rocas).
import { random } from './lib.mjs'

const add = (a, b) => a.map((x, i) => x + b[i])
const sub = (a, b) => a.map((x, i) => x - b[i])
const mul = (a, s) => a.map((x) => x * s)
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a) => mul(a, 1 / (Math.hypot(...a) || 1))

/** Una esfera de icosaedro: 20 caras, ×4 por cada `detail`. */
export function icosphere(detail = 1) {
  const t = (1 + Math.sqrt(5)) / 2
  let V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(norm)
  let F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]]
  for (let d = 0; d < detail; d++) {
    const mid = new Map()
    const m = (a, b) => {
      const key = a < b ? `${a},${b}` : `${b},${a}`
      if (!mid.has(key)) { mid.set(key, V.length); V.push(norm(mul(add(V[a], V[b]), 0.5))) }
      return mid.get(key)
    }
    F = F.flatMap(([a, b, c]) => { const ab = m(a, b), bc = m(b, c), ca = m(c, a); return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]] })
  }
  return { V, F }
}

/** Una base ortonormal con `axis` como su eje x (el largo de la piedra). */
function basis(axis, up = [0, 1, 0]) {
  const x = norm(axis)
  let z = cross(x, up)
  if (Math.hypot(...z) < 1e-4) z = cross(x, [0, 0, 1])
  z = norm(z)
  return [x, cross(z, x), z]
}

/** Triángulo plano pegado entero a un hueso (índice `j`), con su papel. */
export function flat(role, a, b, c, j) {
  const n = norm(cross(sub(b, a), sub(c, a)))
  return { role, vs: [a, b, c].map((p) => ({ POSITION: p, NORMAL: n, JOINTS_0: [j, 0, 0, 0], WEIGHTS_0: [1, 0, 0, 0] })) }
}

/**
 * Una piedra: una esfera deformada, con unos cortes planos (las caras lisas de la roca), con radios `r` = [largo, alto,
 * ancho] a lo largo de `axis`, en `c`. `seed` cambia su forma; `cuts` cuántos cortes; `detail` 0 (20 caras) o 1 (80).
 * `flatBottom` la corta por debajo (para pies y bases).
 */
export function rock(role, c, r, j, { axis = [1, 0, 0], up = [0, 1, 0], seed = 1, cuts = 5, detail = 1, bump = 0.12, depth = [0.72, 0.9], flatBottom = false } = {}) {
  const rnd = random(seed * 7919 + 13)
  const { V, F } = icosphere(detail)
  let P = V.map((v) => mul(v, 1 + (rnd() * 2 - 1) * bump))
  const planes = []
  for (let i = 0; i < cuts; i++) {
    const n = norm([rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1])
    planes.push([n, depth[0] + rnd() * (depth[1] - depth[0])])
  }
  if (flatBottom) planes.push([[0, -1, 0], 0.55])
  // Lo que se pasa de un plano se aplasta contra él: quedan caras planas, como de piedra partida.
  P = P.map((p) => {
    for (const [n, d] of planes) { const e = dot(p, n) - d; if (e > 0) p = sub(p, mul(n, e)) }
    return p
  })
  const [bx, by, bz] = basis(axis, up)
  const world = (p) => add(c, add(add(mul(bx, p[0] * r[0]), mul(by, p[1] * r[1])), mul(bz, p[2] * r[2])))
  const W = P.map(world)
  return F.map(([a, b, d]) => flat(role, W[a], W[b], W[d], j))
}

/** Un cristal: un prisma de `sides` caras de `at` hacia `dir`, de largo `h` y ancho `w`, con punta. */
export function crystal(role, at, dir, h, w, j, { sides = 5, tip = 0.3, seed = 1 } = {}) {
  const rnd = random(seed * 104729 + 7)
  const [d, u, v] = basis(dir, Math.abs(norm(dir)[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0])
  const turn = rnd() * Math.PI
  const ring = (along, s) => [...Array(sides)].map((_, i) => {
    const a = turn + (i / sides) * Math.PI * 2
    return add(at, add(mul(d, along), add(mul(u, Math.cos(a) * w * s), mul(v, Math.sin(a) * w * s))))
  })
  const r0 = ring(-w * 0.5, 0.85), r1 = ring(h * (1 - tip), 1), top = add(at, mul(d, h))
  const out = []
  for (let i = 0; i < sides; i++) {
    const i2 = (i + 1) % sides
    out.push(flat(role, r0[i], r0[i2], r1[i2], j), flat(role, r0[i], r1[i2], r1[i], j), flat(role, r1[i], r1[i2], top, j))
  }
  return out
}
