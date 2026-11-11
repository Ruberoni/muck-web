// Arma Espiritu.glb, el espíritu del bosque, como el gólem: piezas facetadas pegadas a los huesos del jugador (trae sus
// animaciones adaptadas). Formas (FORMA=tocon, la elegida para el espíritu del bosque, tronco, o anciano):
//  - tronco: un ent de troncos, alto, con la cara tallada en el tronco, brazos largos de rama y una copa de hojas.
//  - tocon: un tocón ancho y bajo con cara, piernas de cono, un solo brazo de rama que crece hacia arriba (con él ataca),
//    hongos y un arbolito creciéndole arriba. Trae animaciones propias (ver `tocon.mjs`): camina a saltitos.
//  - anciano: el Espíritu anciano (jefe, 3,2 m, una sola apariencia): tronco viejo y encorvado con cara tallada, barba
//    de musgo, runas verdes que brillan, una copa enorme con ramas, brazos larguísimos de rama y hongos (algunos brillan).
// Tres apariencias: base (corteza marrón, hojas verdes, hongos rojos), noche (madera oscura, hojas moradas, hongos
// violeta que brillan) y totem (madera quemada, hojas y grietas de brasa).
// node espiritu.mjs <Casual.glb> <animations.glb> <salida.glb>
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { random } from './lib.mjs'
import { byRole, nuevoCuerpo } from './esqueleto.mjs'
import { flat, rock } from './rocas.mjs'
import { animarTocon } from './tocon.mjs'

const [skinPath, animPath, outPath] = process.argv.slice(2)
const FORMA = process.env.FORMA ?? 'tocon'
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)

// ---------- proporciones ----------
const FORMAS = {
  tronco: { legs: 0.75, neck: 0.3, arm: { Shoulder: 1.3, UpperArm: 2.2, LowerArm: 1.3, Wrist: 1.3 } },
  tocon: { legs: 0.55, neck: 0.2, arm: { Shoulder: 1.8, UpperArm: 2.6, LowerArm: 1.6, Wrist: 1.6 } },
  // El Espíritu anciano (jefe): alto, encorvado, de brazos larguísimos.
  anciano: { legs: 0.8, neck: 0.3, arm: { Shoulder: 1.6, UpperArm: 2.6, LowerArm: 1.55, Wrist: 1.55 } },
}
const F = FORMAS[FORMA]
const k = { Body: F.legs, Hips: F.legs, Neck: F.neck }
for (const s of ['L', 'R']) {
  for (const n of ['UpperLeg', 'LowerLeg', 'Foot', 'PT']) k[`${n}.${s}`] = F.legs
  for (const [n, f] of Object.entries(F.arm)) k[`${n}.${s}`] = f
}

const LOOKS = {
  base: {
    Corteza: { color: '#6e4a2c', roughness: 0.95 }, CortezaOscura: { color: '#54371f', roughness: 0.95 }, Madera: { color: '#c49a62' },
    Grietas: { color: '#54371f' }, Hojas: { color: '#4f9a3f' }, HojasClaras: { color: '#7bbf4a' }, Musgo: { color: '#5d8c3a' },
    Ojos: { color: '#ffd23f', emissive: '#c08000' }, Boca: { color: '#1e140b' }, Hongo: { color: '#d8402a' }, Tallo: { color: '#efe4cf' },
  },
  noche: {
    Corteza: { color: '#2a221d', roughness: 0.95 }, CortezaOscura: { color: '#1c1714', roughness: 0.95 }, Madera: { color: '#4a3a2e' },
    Grietas: { color: '#1c1714' }, Hojas: { color: '#3a2a48' }, HojasClaras: { color: '#4e3a62' }, Musgo: { color: '#2c3a4a' },
    Ojos: { color: '#e2d4ff', emissive: '#b48cff' }, Boca: { color: '#08060a' }, Hongo: { color: '#b48cff', emissive: '#7a3ae0' }, Tallo: { color: '#cfc2ef', emissive: '#3a2a60' },
  },
  totem: {
    Corteza: { color: '#2e1c14', roughness: 0.95 }, CortezaOscura: { color: '#1e120c', roughness: 0.95 }, Madera: { color: '#5a2a14' },
    Grietas: { color: '#ff7a2f', emissive: '#e0480f' }, Hojas: { color: '#ff6a1f', emissive: '#a8320a' }, HojasClaras: { color: '#ffb03a', emissive: '#c06010' },
    Musgo: { color: '#ff7a2f', emissive: '#e0480f' }, Ojos: { color: '#ffd27a', emissive: '#ff6a1f' }, Boca: { color: '#3a0a02', emissive: '#5a1404' },
    Hongo: { color: '#ffb36b', emissive: '#ff5a1f' }, Tallo: { color: '#3a2018' },
  },
}

/** El anciano es un jefe: una sola apariencia, corteza vieja con musgo, runas verdes que brillan y hongos. */
const ANCIANO = {
  base: {
    Corteza: { color: '#5a4030', roughness: 0.95 }, CortezaOscura: { color: '#3e2c20', roughness: 0.95 }, Madera: { color: '#b08a5a' },
    Grietas: { color: '#9dffb0', emissive: '#2acc5a' }, Hojas: { color: '#3f7d34' }, HojasClaras: { color: '#6fae45' }, Musgo: { color: '#5d8c3a' },
    Ojos: { color: '#e6ff8a', emissive: '#9ad42a' }, Boca: { color: '#140c06' }, Hongo: { color: '#d8402a' }, Tallo: { color: '#efe4cf' },
    HongoLuz: { color: '#9fe8ff', emissive: '#2a9fd0' },
  },
}
const NAME = FORMA === 'anciano' ? 'EspirituAnciano' : 'Espiritu'
const body = await nuevoCuerpo({ io, skinPath, animPath, k, looks: FORMA === 'anciano' ? ANCIANO : LOOKS, name: NAME })
const { pos: P, J } = body
const rnd = random({ tronco: 31, tocon: 47, anciano: 61 }[FORMA])
const jit = (a) => (rnd() * 2 - 1) * a
const add = (a, b) => a.map((x, i) => x + b[i])
const sub = (a, b) => a.map((x, i) => x - b[i])
const mul = (a, s) => a.map((x) => x * s)
const lerp = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t)
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a) => mul(a, 1 / (Math.hypot(...a) || 1))

const tris = []
let seed = 1

/**
 * Un tronco facetado de `a` a `b` (radios r0 → r1) pegado a `bone`: anillos irregulares con un nudo en el medio y tapas
 * planas de madera clara (o del mismo papel si `cap` es null).
 */
function log(role, a, b, r0, r1, bone, { sides = 7, knots = 1, capA = 'Madera', capB = 'Madera', wobble = 0.1 } = {}) {
  const j = J(bone), d = norm(sub(b, a))
  const ref = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]
  const u = norm(cross(d, ref)), v = cross(d, u)
  const turn = rnd() * Math.PI
  const ring = (c, r, wob) => [...Array(sides)].map((_, i) => {
    const ang = turn + (i / sides) * Math.PI * 2, rr = r * (1 + jit(wob))
    return add(c, add(mul(u, Math.cos(ang) * rr), mul(v, Math.sin(ang) * rr)))
  })
  const rings = [ring(a, r0, wobble * 0.5)]
  for (let i = 1; i <= knots; i++) {
    const t = i / (knots + 1)
    rings.push(ring(add(lerp(a, b, t), [jit(r0 * 0.12), jit(r0 * 0.12), jit(r0 * 0.12)]), (r0 + (r1 - r0) * t) * 1.06, wobble))
  }
  rings.push(ring(b, r1, wobble * 0.5))
  for (let k = 0; k < rings.length - 1; k++) for (let i = 0; i < sides; i++) {
    const i2 = (i + 1) % sides, A = rings[k], B = rings[k + 1]
    tris.push(flat(role, A[i], A[i2], B[i2], j), flat(role, A[i], B[i2], B[i], j))
  }
  const fan = (R, c, flip, capRole) => {
    for (let i = 0; i < sides; i++) {
      const i2 = (i + 1) % sides
      tris.push(flip ? flat(capRole, c, R[i2], R[i], j) : flat(capRole, c, R[i], R[i2], j))
    }
  }
  fan(rings[0], a, true, capA ?? role)
  fan(rings.at(-1), b, false, capB ?? role)
}
/** Una mata de hojas facetada. */
const leaves = (c, r, bone, o = {}) => tris.push(...rock(o.role ?? (seed % 3 ? 'Hojas' : 'HojasClaras'), c, r, J(bone), { seed: seed++, bump: 0.18, cuts: 3, depth: [0.8, 0.95], ...o }))
/** Un hongo: tallo claro y sombrero achatado. */
function mushroom(at, h, r, bone, tilt = [0, 1, 0], capRole = 'Hongo') {
  const top = add(at, mul(norm(tilt), h))
  log('Tallo', at, top, r * 0.35, r * 0.3, bone, { sides: 5, knots: 0, capA: null, capB: null, wobble: 0 })
  tris.push(...rock(capRole, add(top, mul(norm(tilt), r * 0.15)), [r, r * 0.6, r], J(bone), { seed: seed++, detail: 0, cuts: 0, bump: 0.05, flatBottom: true, up: norm(tilt), axis: cross(norm(tilt), [0, 0, 1]).some(Math.abs) ? cross(norm(tilt), [0, 0, 1]) : [1, 0, 0] }))
}
/** La cara: cuencas oscuras con ojos que brillan, una ceja de corteza y la boca de nudo, mirando a +z en `c`. */
function face(c, bone, w) {
  for (const s of [1, -1]) {
    tris.push(...rock('Boca', add(c, [s * w * 0.42, 0, -0.01]), [w * 0.3, w * 0.24, w * 0.12], J(bone), { seed: seed++, detail: 0, cuts: 1, bump: 0.05 }))
    tris.push(...rock('Ojos', add(c, [s * w * 0.42, 0, w * 0.06]), [w * 0.2, w * 0.2, w * 0.1], J(bone), { seed: seed++, detail: 0, cuts: 0, bump: 0.02 }))
  }
  log('CortezaOscura', add(c, [-w * 0.85, w * 0.32, w * 0.02]), add(c, [w * 0.85, w * 0.32, w * 0.02]), w * 0.12, w * 0.12, bone, { sides: 5, knots: 1, capA: null, capB: null })
  tris.push(...rock('Boca', add(c, [0, -w * 0.55, -0.005]), [w * 0.32, w * 0.14, w * 0.1], J(bone), { seed: seed++, detail: 0, cuts: 1, bump: 0.1 }))
}
/** Grietas de brasa (solo se ven en el tótem): rajas finas sobre la corteza, mirando a +z. */
function crack(c, h, bone) {
  const w = 0.012, a = add(c, [-w, -h / 2, 0]), b = add(c, [w, -h / 2, 0]), t1 = add(c, [w * 2 + 0.01, h / 2, -0.005]), t0 = add(c, [0.01, h / 2, -0.005])
  tris.push(flat('Grietas', a, b, t1, J(bone)), flat('Grietas', a, t1, t0, J(bone)))
}

/** Brazos de rama con tres dedos de ramita y un brote en el codo. */
function arms(r) {
  for (const [S, s] of [['L', 1], ['R', -1]]) {
    const sh = P[`Shoulder.${S}`], ua = P[`UpperArm.${S}`], la = P[`LowerArm.${S}`], wr = P[`Wrist.${S}`]
    log('Corteza', lerp(sh, ua, 0.3), add(la, [s * 0.02, 0, 0]), r, r * 0.85, `UpperArm.${S}`, { knots: 1 })
    log('CortezaOscura', la, wr, r * 0.85, r * 0.7, `LowerArm.${S}`, { knots: 1, capA: null })
    for (const [dy, dz, len] of [[0.04, 0.05, 0.17], [0, 0, 0.21], [-0.04, -0.05, 0.16]]) {
      log('Corteza', wr, add(wr, [s * len, dy - 0.03, dz]), r * 0.4, r * 0.15, `Wrist.${S}`, { sides: 5, knots: 0, capA: null })
    }
    leaves(add(la, [0, r * 1.4, -0.02]), [0.07, 0.06, 0.07], `UpperArm.${S}`, { detail: 0 })
  }
}

if (FORMA === 'anciano') {
  // El tronco: grueso, encorvado hacia adelante, con la cara tallada arriba, una barba de musgo y runas que brillan.
  const top = add(P.Head, [0, 0.36, -0.05])
  log('Corteza', add(P.Hips, [0, -0.14, 0]), add(P.Abdomen, [0, 0.03, 0]), 0.3, 0.29, 'Hips', { capA: 'CortezaOscura', capB: null, sides: 9 })
  log('CortezaOscura', add(P.Abdomen, [0, -0.02, 0]), add(P.Torso, [0, 0.03, 0]), 0.29, 0.3, 'Abdomen', { capA: null, capB: null, sides: 9 })
  log('Corteza', add(P.Torso, [0, -0.02, 0]), add(P.Chest, [0, 0.03, 0.01]), 0.31, 0.34, 'Torso', { capA: null, capB: null, sides: 9 })
  log('Corteza', add(P.Chest, [0, -0.02, 0.01]), add(P.Head, [0, 0.0, 0.04]), 0.35, 0.3, 'Chest', { capA: null, capB: null, sides: 9 })
  log('Corteza', add(P.Head, [0, -0.04, 0.04]), top, 0.29, 0.22, 'Head', { capA: null, sides: 9 })
  face(add(P.Head, [0, 0.15, 0.32]), 'Head', 0.17)
  // Barba de musgo colgando de la boca y el mentón.
  for (const [x, len, i] of [[0, 0.32, 0], [0.1, 0.24, 1], [-0.1, 0.26, 2], [0.18, 0.16, 3], [-0.18, 0.18, 4]]) {
    tris.push(...rock('Musgo', add(P.Head, [x, 0.02 - len / 2, 0.3 - Math.abs(x) * 0.3]), [0.06, len / 2, 0.04], J('Head'), { seed: 400 + i, axis: [0, -1, 0], up: [0, 0, 1], detail: 0, cuts: 2 }))
  }
  // Runas: rajas verdes que brillan en el pecho y la panza.
  for (const [x, y, h, bone] of [[0.12, 0.0, 0.2, 'Chest'], [-0.1, 0.06, 0.16, 'Chest'], [0.02, -0.08, 0.14, 'Torso'], [-0.14, 0.02, 0.12, 'Abdomen'], [0.14, -0.02, 0.12, 'Abdomen']]) {
    crack(add(P[bone], [x, y, 0.33]), h, bone)
  }
  // La copa: un bosque en la coronilla, con ramas que salen y hongos que brillan.
  leaves(add(top, [0, 0.22, -0.05]), [0.45, 0.28, 0.4], 'Head', { cuts: 6 })
  leaves(add(top, [0.36, 0.08, -0.1]), [0.26, 0.2, 0.24], 'Head')
  leaves(add(top, [-0.36, 0.1, -0.08]), [0.27, 0.21, 0.24], 'Head')
  leaves(add(top, [0.05, 0.12, -0.38]), [0.28, 0.22, 0.22], 'Head')
  leaves(add(top, [0.0, 0.42, -0.1]), [0.24, 0.18, 0.22], 'Head')
  for (const [d, len] of [[[0.7, 0.6, 0.1], 0.5], [[-0.7, 0.55, 0.05], 0.48], [[0.2, 0.8, -0.5], 0.45], [[-0.3, 0.85, -0.4], 0.42]]) {
    const a = add(top, [d[0] * 0.15, 0, d[2] * 0.15]), b = add(a, mul(norm(d), len))
    log('Corteza', a, b, 0.06, 0.02, 'Head', { sides: 5, capA: null })
    leaves(b, [0.14, 0.11, 0.13], 'Head', { detail: 0 })
  }
  // Ramas que le salen de los hombros y la espalda, con hojas.
  for (const s of [1, -1]) {
    const p0 = add(P.Chest, [s * 0.22, 0.18, -0.2]), p1 = add(p0, [s * 0.25, 0.35, -0.15]), p2 = add(p1, [s * 0.15, 0.25, 0.05])
    log('Corteza', p0, p1, 0.07, 0.045, 'Chest', { capA: null, capB: null, sides: 6 })
    log('Corteza', p1, p2, 0.045, 0.015, 'Chest', { capA: null, sides: 5 })
    leaves(add(p2, [0, 0.06, 0]), [0.18, 0.14, 0.16], 'Chest')
    tris.push(...rock('Musgo', add(P.Chest, [s * 0.26, 0.28, 0.02]), [0.18, 0.05, 0.16], J('Chest'), { seed: 420 + s, cuts: 2, detail: 0 }))
  }
  // Hongos: rojos en un hombro y en la panza, y unos que brillan en el otro hombro.
  mushroom(add(P.Chest, [0.33, 0.22, 0.08]), 0.06, 0.07, 'Chest', [0.6, 1, 0.2])
  mushroom(add(P.Chest, [0.38, 0.17, -0.06]), 0.04, 0.05, 'Chest', [1, 0.6, 0])
  mushroom(add(P.Abdomen, [0.3, 0.02, 0.1]), 0.05, 0.055, 'Abdomen', [1, 0.4, 0.2])
  mushroom(add(P.Chest, [-0.33, 0.24, 0.05]), 0.07, 0.07, 'Chest', [-0.5, 1, 0.1], 'HongoLuz')
  mushroom(add(P.Chest, [-0.38, 0.16, -0.08]), 0.05, 0.05, 'Chest', [-1, 0.5, 0], 'HongoLuz')
  mushroom(add(P.Torso, [-0.32, -0.04, 0.12]), 0.04, 0.045, 'Torso', [-1, 0.3, 0.3], 'HongoLuz')
  // Brazos larguísimos de rama, con ramitas y hojas, y manos de cuatro dedos como garras.
  for (const [S, s] of [['L', 1], ['R', -1]]) {
    const sh = P[`Shoulder.${S}`], ua = P[`UpperArm.${S}`], la = P[`LowerArm.${S}`], wr = P[`Wrist.${S}`]
    log('Corteza', lerp(sh, ua, 0.2), add(la, [s * 0.03, 0, 0]), 0.14, 0.11, `UpperArm.${S}`, { knots: 2, capA: null })
    log('CortezaOscura', la, wr, 0.11, 0.085, `LowerArm.${S}`, { knots: 2, capA: null })
    for (const [dy, dz, len] of [[0.05, 0.07, 0.3], [0.01, 0.02, 0.36], [-0.03, -0.04, 0.32], [-0.06, 0.09, 0.22]]) {
      log('Corteza', wr, add(wr, [s * len, dy - 0.06, dz]), 0.035, 0.008, `Wrist.${S}`, { sides: 5, knots: 1, capA: null })
    }
    log('Corteza', lerp(ua, la, 0.5), add(lerp(ua, la, 0.6), [0, 0.22, -0.08]), 0.035, 0.01, `UpperArm.${S}`, { sides: 5, capA: null })
    leaves(add(lerp(ua, la, 0.62), [0, 0.26, -0.1]), [0.12, 0.1, 0.11], `UpperArm.${S}`, { detail: 0 })
    leaves(add(lerp(la, wr, 0.4), [0, 0.13, -0.04]), [0.1, 0.08, 0.1], `LowerArm.${S}`, { detail: 0 })
    tris.push(...rock('Musgo', add(lerp(la, wr, 0.6), [0, 0.09, 0]), [0.12, 0.03, 0.08], J(`LowerArm.${S}`), { seed: 430 + s, cuts: 2, detail: 0 }))
  }
  // Piernas de tronco y pies de raíces gruesas.
  for (const [S, s] of [['L', 1], ['R', -1]]) {
    const ul = P[`UpperLeg.${S}`], ll = P[`LowerLeg.${S}`], ft = P[`Foot.${S}`]
    log('CortezaOscura', add(ul, [s * 0.04, 0.03, 0]), ll, 0.17, 0.15, `UpperLeg.${S}`, { capA: null, knots: 1 })
    log('Corteza', ll, add(ft, [0, 0.08, 0]), 0.15, 0.17, `LowerLeg.${S}`, { capA: null, capB: null, knots: 1 })
    roots(add(ft, [0, 0.08, 0.03]), s, `Foot.${S}`, 0.07)
    roots(add(ft, [s * 0.04, 0.12, -0.02]), -s, `Foot.${S}`, 0.05)
  }
} else if (FORMA === 'tronco') {
  // El tronco: de la cadera a la coronilla, en tramos (cada uno de su hueso), con la cara tallada arriba.
  const top = add(P.Head, [0, 0.3, 0])
  log('Corteza', add(P.Hips, [0, -0.1, 0]), add(P.Abdomen, [0, 0.03, 0]), 0.2, 0.2, 'Hips', { capA: 'CortezaOscura', capB: null })
  log('CortezaOscura', add(P.Abdomen, [0, -0.02, 0]), add(P.Torso, [0, 0.03, 0]), 0.21, 0.215, 'Abdomen', { capA: null, capB: null })
  log('Corteza', add(P.Torso, [0, -0.02, 0]), add(P.Chest, [0, 0.03, 0]), 0.22, 0.235, 'Torso', { capA: null, capB: null })
  log('Corteza', add(P.Chest, [0, -0.02, 0]), add(P.Head, [0, 0.02, 0]), 0.24, 0.23, 'Chest', { capA: null, capB: null })
  log('Corteza', add(P.Head, [0, -0.03, 0]), top, 0.225, 0.2, 'Head', { capA: null })
  face(add(P.Head, [0, 0.13, 0.235]), 'Head', 0.13)
  crack(add(P.Chest, [0.06, -0.02, 0.245]), 0.16, 'Chest'); crack(add(P.Torso, [-0.07, 0.02, 0.225]), 0.14, 'Torso'); crack(add(P.Abdomen, [0.03, 0.04, 0.21]), 0.1, 'Abdomen')
  // La copa: una mata grande y otras alrededor, y ramas cortas que salen de la coronilla.
  leaves(add(top, [0, 0.13, -0.03]), [0.3, 0.2, 0.27], 'Head', { cuts: 5 })
  leaves(add(top, [0.22, 0.02, -0.04]), [0.15, 0.13, 0.15], 'Head')
  leaves(add(top, [-0.22, 0.04, -0.06]), [0.16, 0.13, 0.15], 'Head')
  leaves(add(top, [0.02, 0.06, -0.22]), [0.17, 0.14, 0.14], 'Head')
  for (const s of [1, -1]) log('Corteza', add(top, [s * 0.08, -0.02, 0.02]), add(top, [s * 0.3, 0.12, 0.1]), 0.04, 0.02, 'Head', { sides: 5, capA: null })
  // Hombros con musgo y hongos.
  for (const [S, s] of [['L', 1], ['R', -1]]) {
    const ua = P[`UpperArm.${S}`]
    tris.push(...rock('Musgo', add(P.Chest, [s * 0.2, 0.21, 0]), [0.12, 0.04, 0.12], J('Chest'), { seed: seed++, cuts: 2, detail: 0 }))
    leaves(add(ua, [s * 0.02, 0.12, -0.04]), [0.12, 0.1, 0.12], `UpperArm.${S}`)
  }
  mushroom(add(P.Chest, [-0.2, -0.04, 0.12]), 0.04, 0.045, 'Chest', [-0.8, 0.5, 0.3])
  mushroom(add(P.Chest, [-0.2, -0.1, 0.1]), 0.03, 0.03, 'Chest', [-0.9, 0.3, 0.3])
  mushroom(add(P.Abdomen, [0.2, 0.0, 0.08]), 0.035, 0.035, 'Abdomen', [0.9, 0.4, 0.2])
  arms(0.075)
  // Piernas cortas de tronco y pies de raíces.
  for (const [S, s] of [['L', 1], ['R', -1]]) {
    const ul = P[`UpperLeg.${S}`], ll = P[`LowerLeg.${S}`], ft = P[`Foot.${S}`]
    log('CortezaOscura', add(ul, [0, 0.02, 0]), ll, 0.11, 0.1, `UpperLeg.${S}`, { capA: null })
    log('Corteza', ll, add(ft, [0, 0.07, 0]), 0.1, 0.11, `LowerLeg.${S}`, { capA: null, capB: null })
    roots(add(ft, [0, 0.07, 0.02]), s, `Foot.${S}`, 0.045)
  }
} else {
  // El tocón: un cuerpo ancho de la cadera a la coronilla, con el corte de arriba a la vista, y la cara en el pecho.
  const top = add(P.Head, [0, 0.12, 0])
  log('Corteza', add(P.Hips, [0, -0.12, 0]), add(P.Abdomen, [0, 0.03, 0]), 0.32, 0.31, 'Hips', { capA: 'CortezaOscura', capB: null, sides: 8 })
  log('CortezaOscura', add(P.Abdomen, [0, -0.02, 0]), add(P.Torso, [0, 0.03, 0]), 0.31, 0.3, 'Abdomen', { capA: null, capB: null, sides: 8 })
  log('Corteza', add(P.Torso, [0, -0.02, 0]), add(P.Chest, [0, 0.03, 0]), 0.3, 0.29, 'Torso', { capA: null, capB: null, sides: 8 })
  log('Corteza', add(P.Chest, [0, -0.02, 0]), top, 0.29, 0.27, 'Chest', { capA: null, sides: 8 })
  face(add(P.Torso, [0, 0.12, 0.3]), 'Torso', 0.16)
  crack(add(P.Chest, [-0.12, 0.0, 0.29]), 0.12, 'Chest'); crack(add(P.Abdomen, [0.13, 0.0, 0.29]), 0.14, 'Abdomen')
  // Del corte de arriba crece un arbolito con su copa, y hay musgo y hongos en el borde.
  log('Corteza', add(top, [0.02, -0.02, -0.02]), add(top, [0.05, 0.3, -0.04]), 0.045, 0.03, 'Head', { capA: null, sides: 5 })
  leaves(add(top, [0.05, 0.4, -0.04]), [0.2, 0.16, 0.19], 'Head', { cuts: 4 })
  leaves(add(top, [0.17, 0.3, -0.06]), [0.1, 0.09, 0.1], 'Head')
  leaves(add(top, [-0.09, 0.3, 0.0]), [0.11, 0.09, 0.1], 'Head')
  tris.push(...rock('Musgo', add(top, [-0.12, 0.01, -0.05]), [0.13, 0.03, 0.12], J('Chest'), { seed: seed++, cuts: 2, detail: 0 }))
  mushroom(add(top, [0.17, 0.0, 0.1]), 0.05, 0.05, 'Chest')
  mushroom(add(top, [0.22, -0.01, 0.0]), 0.035, 0.035, 'Chest', [0.4, 1, 0])
  mushroom(add(P.Abdomen, [-0.29, 0.02, 0.08]), 0.04, 0.045, 'Abdomen', [-1, 0.4, 0.2])
  mushroom(add(P.Abdomen, [-0.29, -0.06, 0.12]), 0.03, 0.03, 'Abdomen', [-1, 0.2, 0.3])
  // Un solo brazo: una rama que le sale del costado derecho y crece hacia arriba (en reposo; con ella ataca), con
  // ramitas y hojas. Se arma en la pose de reposo del esqueleto (brazo en cruz, hacia −x); las animaciones la levantan.
  const ua = P['UpperArm.R'], la = P['LowerArm.R'], wr = P['Wrist.R'], hand = P['Middle1.R']
  const tip = add(wr, mul(norm(sub(hand, wr)), 0.24))
  log('Corteza', add(ua, [0.06, 0, 0]), la, 0.09, 0.07, 'UpperArm.R', { capA: null, knots: 1 })
  log('CortezaOscura', la, wr, 0.07, 0.052, 'LowerArm.R', { capA: null, capB: null, knots: 1 })
  log('Corteza', wr, tip, 0.052, 0.014, 'Wrist.R', { capA: null, knots: 1 })
  log('Corteza', lerp(la, wr, 0.4), add(lerp(la, wr, 0.75), [0, 0.12, 0.05]), 0.025, 0.008, 'LowerArm.R', { sides: 5, knots: 0, capA: null })
  log('Corteza', lerp(ua, la, 0.6), add(lerp(ua, la, 0.95), [0, -0.1, -0.06]), 0.022, 0.008, 'UpperArm.R', { sides: 5, knots: 0, capA: null })
  for (const [dy, dz] of [[0.09, 0.05], [-0.08, 0.04], [0.02, -0.1]]) log('Corteza', lerp(wr, tip, 0.35), add(lerp(wr, tip, 0.8), [0, dy, dz]), 0.02, 0.006, 'Wrist.R', { sides: 5, knots: 0, capA: null })
  leaves(add(tip, [-0.04, 0.0, 0.0]), [0.11, 0.09, 0.1], 'Wrist.R')
  leaves(add(lerp(wr, tip, 0.6), [0, 0.1, 0.06]), [0.07, 0.06, 0.07], 'Wrist.R', { detail: 0 })
  leaves(add(lerp(la, wr, 0.75), [0, 0.13, 0.06]), [0.06, 0.05, 0.06], 'LowerArm.R', { detail: 0 })
  // Piernas: dos conos con la punta abajo, sin dedos, de la cadera al suelo (cada una entera de su muslo).
  for (const [S, s] of [['L', 1], ['R', -1]]) {
    const ul = P[`UpperLeg.${S}`]
    log('CortezaOscura', add(ul, [s * 0.06, 0.02, 0]), [ul[0] + s * 0.07, 0.0, ul[2]], 0.13, 0.012, `UpperLeg.${S}`, { capA: null, capB: null, knots: 1, sides: 7 })
  }
}

/** Pies de raíces: cuatro que se abren hacia el suelo. */
function roots(at, s, bone, r) {
  for (const [dx, dz, len] of [[0.1, 1, 0.2], [0.85, 0.35, 0.15], [-0.7, 0.55, 0.14], [0.1, -0.9, 0.12]]) {
    const end = add(at, mul(norm([s * dx, -0.3, dz]), len))
    end[1] = Math.max(end[1], 0.01)
    log('Corteza', at, end, r, r * 0.25, bone, { sides: 5, knots: 0, capA: null })
  }
}

body.add(NAME, body.buildMesh(NAME, byRole(tris)))
if (FORMA === 'tocon') animarTocon(body.doc)
body.finish()
// Alto: el ent de 2 m, el tocón de 1,5 m (el juego lo escala igual).
const height = { tronco: 2, tocon: 1.5, anciano: 3.2 }[FORMA]
const topY = Math.max(...tris.flatMap((t) => t.vs.map((v) => v.POSITION[1])))
body.armature.setScale(Array(3).fill(height / topY))
await io.write(outPath, body.doc)
console.log(`espíritu (${FORMA}) · ${tris.length} triángulos · alto ${topY.toFixed(2)} → ${height} m`)
