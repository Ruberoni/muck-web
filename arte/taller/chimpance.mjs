// Monta el chimpancé (malla suelta, sin esqueleto) sobre el esqueleto del jugador, con sus brazos largos y
// piernas cortas, y le copia las animaciones del jugador adaptadas a esas proporciones.
// node chimpance.mjs <Chimpanzee.glb> <Casual.glb> <animations.glb> <salida.glb> [cabeza]
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { PNG } from 'pngjs'
import { add, lerp, mul, norm, sub } from './rig.mjs'
import { montar } from './montar.mjs'
import { HEADS } from './cabezas.mjs'

const [chimpPath, skinPath, animPath, outPath, headName = 'chimpance'] = process.argv.slice(2)
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const [chimp, skinDoc, doc] = await Promise.all([chimpPath, skinPath, animPath].map((p) => io.read(p)))

// ---------- la malla del chimpancé, en metros y con un papel por triángulo ----------
const HEIGHT = 1.72
const prim0 = chimp.getRoot().listMeshes()[0].listPrimitives()[0]
const P = prim0.getAttribute('POSITION'), UV = prim0.getAttribute('TEXCOORD_0'), I = prim0.getIndices()
const png = PNG.sync.read(Buffer.from(chimp.getRoot().listTextures()[0].getImage()))
const texel = (u, v) => {
  const x = Math.min(png.width - 1, Math.floor(u * png.width)), y = Math.min(png.height - 1, Math.floor(v * png.height))
  const o = (y * png.width + x) * 4
  return '#' + [0, 1, 2].map((k) => png.data[o + k].toString(16).padStart(2, '0')).join('')
}
const ROLE_OF = { '#222421': 'Pelaje', '#e6b686': 'Piel', '#e3ae86': 'Piel', '#a16425': 'Ojos' }
const orig = [...Array(P.getCount())].map((_, i) => P.getElement(i, []))
const minY = Math.min(...orig.map((p) => p[1])), maxY = Math.max(...orig.map((p) => p[1]))
const S = HEIGHT / (maxY - minY)
/** Las coordenadas del archivo (y de -58,8 a 58,8) a metros con los pies en el suelo. */
/** Las piernas (por debajo de la cadera, y = -6 en el archivo) se acortan a esta parte; el resto baja con ellas. */
const LEGS = Number(process.env.PIERNAS ?? 0.85)
const HIP_ORIG = -6
const Y = (yOrig) => {
  const y = (yOrig - minY) * S, hip = (HIP_ORIG - minY) * S
  return (yOrig < HIP_ORIG ? hip - (hip - y) * LEGS : y) - hip * (1 - LEGS)
}
/** Los brazos (|x| > 21 en el archivo) cuelgan por debajo de la cadera, pero no se acortan: solo bajan. */
const meters = (p) => [p[0] * S, Math.abs(p[0]) > 21 ? (p[1] - minY) * S - (HIP_ORIG - minY) * S * (1 - LEGS) : Y(p[1]), p[2] * S]
let verts = orig.map(meters)

const faces = []
for (let t = 0; t < I.getCount(); t += 3) {
  const ids = [I.getScalar(t), I.getScalar(t + 1), I.getScalar(t + 2)]
  const uv = ids.map((i) => UV.getElement(i, [])).reduce((a, b) => [a[0] + b[0] / 3, a[1] + b[1] / 3], [0, 0])
  const color = texel(uv[0], uv[1])
  faces.push({ ids, color, role: ROLE_OF[color] ?? 'Pelaje' })
}
const vertsOf = (pred) => [...new Set(faces.filter(pred).flatMap((f) => f.ids))]
const centroid = (ids) => mul(ids.reduce((a, i) => add(a, verts[i]), [0, 0, 0]), 1 / ids.length)
const origY = (i) => orig[i][1]
const origX = (i) => orig[i][0]

// ---------- puntos del chimpancé ----------
const side = (s) => {
  const fist = vertsOf((f) => f.color === '#e6b686' && f.ids.every((i) => s * origX(i) > 25))
  const F = centroid(fist)
  const fistTop = Math.max(...fist.map(origY))
  const W = centroid(fist.filter((i) => origY(i) > fistTop - 3))
  const all = [...Array(orig.length).keys()]
  // Hombro: el centro de lo más alto del brazo; codo: el centro del brazo a media altura.
  const top = centroid(all.filter((i) => s * origX(i) > 16 && origY(i) > 20 && origY(i) < 32))
  const Sh = [top[0] * 0.8, top[1], top[2]] // la articulación va por dentro del hombro, no en su superficie
  const E = centroid(all.filter((i) => s * origX(i) > 22 && origY(i) > 6 && origY(i) < 18))
  const leg = all.filter((i) => s * origX(i) > 1 && s * origX(i) < 22 && origY(i) < -12)
  const slice = (lo, hi) => centroid(leg.filter((i) => origY(i) >= lo && origY(i) < hi))
  const hipXZ = slice(-20, -12), kneeXZ = slice(-44, -28), ankleXZ = slice(-56, -46)
  const H = [hipXZ[0], Y(-6), hipXZ[2]]
  const K = [kneeXZ[0], Y(-35), kneeXZ[2]]
  const A = [ankleXZ[0], 0.02, ankleXZ[2]]
  const foot = vertsOf((f) => f.color === '#e3ae86' && f.ids.every((i) => s * origX(i) > 0))
  const toe = foot.reduce((a, i) => (verts[i][2] > verts[a][2] ? i : a), foot[0])
  return { F, W, Sh, E, H, K, A, Toe: [A[0], 0.02, verts[toe][2]] }
}
let L = side(1), R = side(-1)
const neckXZ = centroid([...Array(orig.length).keys()].filter((i) => origY(i) > 34 && origY(i) < 40))
let N = [0, Y(37), neckXZ[2]]
const headIds = [...Array(orig.length).keys()].filter((i) => origY(i) > 40)
let HC = [0, Y(-6), (L.H[2] + R.H[2]) / 2]

if (process.env.DEBUG) console.log(JSON.stringify({ L, R, N, HC }, (k2, v) => (typeof v === "number" ? +v.toFixed(3) : v)))
const fistVerts = new Set(vertsOf((f) => f.color === '#e6b686' && f.ids.every((i) => Math.abs(origX(i)) > 25)))
/** Los huesos que pueden mover cada vértice, según la zona del cuerpo en que está. */
function candidates(i) {
  const x = origX(i), y = origY(i), s = x >= 0 ? 'L' : 'R'
  if (fistVerts.has(i) || (Math.abs(x) > 21 && y > -25 && y < 27)) return [`UpperArm.${s}`, `LowerArm.${s}`, `Wrist.${s}`]
  if (Math.abs(x) > 15 && y >= 24 && y < 36) return [`Shoulder.${s}`, `UpperArm.${s}`, 'Chest']
  if (y > 40) return ['Head']
  if (y > 33) return ['Neck', 'Head', 'Chest']
  if (y < -14) return [`UpperLeg.${s}`, `LowerLeg.${s}`, `Foot.${s}`]
  if (y < -4) return ['Hips', `UpperLeg.${s}`]
  return ['Hips', 'Abdomen', 'Torso', 'Chest', `Shoulder.${s}`]
}

/** Por papel: color y, si brilla, brillo. "tonos" es la prueba de colores de piel; "apariencias", las del juego. */
const PRESETS = {
  // Pieles humanas, como de neandertal; el pelaje, castaño muy oscuro.
  tonos: {
    claro: { Piel: { color: '#e0b48e' } }, trigueno: { Piel: { color: '#c38a5c' } },
    moreno: { Piel: { color: '#8e5b3a' } }, oscuro: { Piel: { color: '#5b3b28' } },
  },
  apariencias: {
    base: {
      Pelaje: { color: '#33261d' }, Piel: { color: process.env.PIEL ?? '#8e5b3a' }, Ojos: { color: '#ffe066', emissive: '#5a4400' },
      Dientes: { color: '#e8dcc0' }, Cuernos: { color: '#d9ccb0' },
    },
    noche: {
      Pelaje: { color: '#111014' }, Piel: { color: '#3b3533' }, Ojos: { color: '#d4c2ff', emissive: '#b48cff' },
      Dientes: { color: '#8f8a99' }, Cuernos: { color: '#2e2a36' },
    },
    totem: {
      Pelaje: { color: '#2b1712' }, Piel: { color: '#8c4a30' }, Ojos: { color: '#ffb36b', emissive: '#ff5a1f' },
      Dientes: { color: '#d9ccb0' }, Cuernos: { color: '#6b2414', emissive: '#4a0f02' },
    },
  },
}
const DEFAULTS = { Pelaje: { color: '#33261d' }, Piel: { color: '#8e5b3a' }, Ojos: { color: '#ffe066', emissive: '#5a4400' }, Dientes: { color: '#e8dcc0' }, Cuernos: { color: '#d9ccb0' } }
const head = HEADS[headName]
if (!head) throw new Error(`no hay cabeza "${headName}": ${Object.keys(HEADS).join(', ')}`)
await montar({
  io, doc, skinDoc, verts, faces, L, R, N, HC, top: Y(maxY), candidates, headIds, head,
  looks: PRESETS[process.env.APARIENCIAS ?? 'tonos'], defaults: DEFAULTS, label: `cabeza ${headName}`, outPath,
})
