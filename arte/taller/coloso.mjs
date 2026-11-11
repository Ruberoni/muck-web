// Monta el coloso de Darwin Yamamoto (40 piezas de piedra sueltas, sin esqueleto, con menos polígonos) sobre el
// esqueleto del jugador para dos jefes: JEFE=guardian (Guardián del meteorito: roca negra, bandas de brasa y un
// meteorito en la espalda) o JEFE=cristal (Coloso de Cristal: cristal celeste con puntas de cristal).
// Cada pieza va pegada a su hueso; las que cruzan una articulación (el brazo derecho entero con su maza, los
// muslos, el pecho) se reparten entre varios.
// node coloso.mjs <Colossus.glb> <Casual.glb> <animations.glb> <salida.glb>
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { montar } from './montar.mjs'
import { reducir } from './lib.mjs'
import { cone } from './cabezas.mjs'
import { rock } from './rocas.mjs'

const [golemPath, skinPath, animPath, outPath] = process.argv.slice(2)
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const [golem, skinDoc, doc] = await Promise.all([golemPath, skinPath, animPath].map((p) => io.read(p)))
const [before, after] = await reducir(golem, { ratio: Number(process.env.RATIO ?? 0.3), error: 0.05 })

// ---------- piezas ----------
/** Qué huesos mueven cada pieza (por el número de su nombre) y qué papel tiene su color. */
const PIECES = {
  1505187548: { bones: ['Head'] }, // cabeza, adelantada y baja
  1432582451: { bones: ['Chest'] }, // la joroba
  1025350427: { bones: ['Chest'], role: 'Bandas' }, 1844137050: { bones: ['Chest'], role: 'Bandas' }, // rejillas de la espalda
  627975218: { bones: ['Abdomen', 'Torso', 'Chest'] }, // pecho y vientre
  415330036: { bones: ['Torso'], role: 'Bandas' }, // espalda baja
  546903737: { bones: ['Hips', 'UpperLeg.R'] },
  // Brazo izquierdo, por piezas.
  740456392: { bones: ['UpperArm.L'] }, 975551858: { bones: ['UpperArm.L'], role: 'Bandas' },
  541585894: { bones: ['UpperArm.L'], role: 'Bandas' }, 1786630716: { bones: ['UpperArm.L'], role: 'Bandas' },
  1816892251: { bones: ['UpperArm.L', 'LowerArm.L'] }, 94822774: { bones: ['LowerArm.L'] },
  1710370891: { bones: ['LowerArm.L'], role: 'Bandas' }, 313211233: { bones: ['LowerArm.L'], role: 'Bandas' },
  428382034: { bones: ['Wrist.L'] },
  250151743: { bones: ['Wrist.L'] }, 1592894111: { bones: ['Wrist.L'] }, 1868199034: { bones: ['Wrist.L'] }, 103002108: { bones: ['Wrist.L'] },
  // Brazo derecho: una sola pieza del hombro a la maza.
  1710813611: { bones: ['Shoulder.R', 'UpperArm.R', 'LowerArm.R', 'Wrist.R'] },
  // Piernas.
  1335542576: { bones: ['UpperLeg.L', 'LowerLeg.L'] }, 1968350401: { bones: ['UpperLeg.R', 'LowerLeg.R'] },
  432810711: { bones: ['UpperLeg.L'], role: 'Bandas' }, 1825562682: { bones: ['UpperLeg.L'], role: 'Bandas' },
  1038540472: { bones: ['UpperLeg.L'], role: 'Bandas' }, 1939655708: { bones: ['UpperLeg.L'], role: 'Bandas' },
  1259693801: { bones: ['UpperLeg.L'], role: 'Bandas' }, 331857831: { bones: ['UpperLeg.R'], role: 'Bandas' },
  1568332678: { bones: ['UpperLeg.R'], role: 'Bandas' },
  418819236: { bones: ['UpperLeg.L', 'LowerLeg.L'] }, 148425628: { bones: ['UpperLeg.L', 'LowerLeg.L'] }, 1792373952: { bones: ['UpperLeg.L', 'LowerLeg.L'] },
  1861432759: { bones: ['UpperLeg.R', 'LowerLeg.R'] }, 92014611: { bones: ['UpperLeg.R', 'LowerLeg.R'] }, 2108311412: { bones: ['UpperLeg.R', 'LowerLeg.R'] },
  1101539931: { bones: ['LowerLeg.L'] }, 607156469: { bones: ['LowerLeg.R'] },
  168052419: { bones: ['Foot.L'] }, 1877000184: { bones: ['Foot.R'] },
}

// El archivo mira hacia -x: se gira para que mire hacia +z, como el esqueleto.
const turn = (p) => [p[2], p[1], -p[0]]
const orig = [], faces = [], bonesOf = []
for (const node of golem.getRoot().listNodes()) {
  const mesh = node.getMesh()
  if (!mesh) continue
  const id = node.getName().replace('group', '')
  const piece = PIECES[id]
  if (!piece) throw new Error(`pieza sin hueso: ${id}`)
  const W = node.getWorldMatrix()
  for (const prim of mesh.listPrimitives()) {
    const P = prim.getAttribute('POSITION'), I = prim.getIndices()
    const base = orig.length
    for (let i = 0; i < P.getCount(); i++) {
      const v = P.getElement(i, [])
      orig.push(turn([0, 1, 2].map((r) => W[r] * v[0] + W[4 + r] * v[1] + W[8 + r] * v[2] + W[12 + r])))
      bonesOf.push(piece.bones)
    }
    const n = I ? I.getCount() : P.getCount()
    for (let t = 0; t < n; t += 3) faces.push({ role: piece.role ?? 'Piedra', ids: [0, 1, 2].map((k) => base + (I ? I.getScalar(t + k) : t + k)) })
  }
}

// ---------- en metros, con los pies en el suelo ----------
const HEIGHT = 2.2
const minY = Math.min(...orig.map((p) => p[1])), maxY = Math.max(...orig.map((p) => p[1]))
const S = HEIGHT / (maxY - minY)
const m = (p) => [p[0] * S, (p[1] - minY) * S, p[2] * S]
const verts = orig.map(m)
const ground = (p) => { const q = m(p); q[1] = 0.02; return q }

// Puntos medidos en el archivo ya girado (ver `npm run analizar`): el brazo derecho es más grande y lleva la maza.
const L = {
  Sh: m([0.55, 0.78, 0.32]), E: m([0.88, 0.08, 0.28]), W: m([0.89, -0.58, 0.38]), F: m([0.82, -0.82, 0.48]),
  H: m([0.25, -0.1, 0.05]), K: m([0.3, -0.75, 0.12]), A: ground([0.31, 0, 0.06]), Toe: ground([0.31, 0, 0.32]),
}
const R = {
  Sh: m([-0.62, 0.85, 0.1]), E: m([-0.8, 0.2, -0.2]), W: m([-0.9, -0.3, -0.2]), F: m([-1.1, -0.62, -0.1]),
  H: m([-0.25, -0.1, -0.05]), K: m([-0.26, -0.72, -0.1]), A: ground([-0.21, 0, -0.42]), Toe: ground([-0.21, 0, -0.18]),
}
let N = m([0, 0.6, 0.62])
let HC = m([0, -0.1, 0])
const headIds = verts.map((_, i) => i).filter((i) => bonesOf[i][0] === 'Head')

// ---------- jefes ----------
const back = (y, z) => m([0, y, z])
/** Sube un punto lo mismo que el cuerpo (el Guardián tiene las piernas más largas). */
const lifted = (p) => [p[0], p[1] + (JEFES[process.env.JEFE ?? 'guardian'].lift ?? 0), p[2]]
const crystal = (role, at, dir, h, w, bone) => cone(role, at, at.map((x, i) => x + dir[i] * h), w, [{ b: bone, w: 1 }, { b: bone, w: 0 }])
const JEFES = {
  guardian: {
    name: 'Guardian',
    looks: { base: { Piedra: { color: '#2b2522', roughness: 0.9 }, PiedraOscura: { color: '#1e1a18', roughness: 0.9 }, Bandas: { color: '#ff7a2f', emissive: '#e0480f' }, Meteorito: { color: '#ffb36b', emissive: '#ff5a1f' } } },
    // Piernas más largas que las del coloso: todo lo de arriba sube `lift` metros, y sus piernas se cambian por
    // columnas de roca (abajo).
    lift: 0.32,
    extra: ({ posed, faces, pos }) => {
      // Fuera las piernas del coloso (cortas y raras) y la maza del brazo derecho: en esa mano va la espada (espada.mjs).
      const w = pos['Wrist.R']
      for (const f of faces) {
        const b = bonesOf[f.ids[0]]
        if (/^(UpperLeg|LowerLeg|Foot)/.test(b[0])) f.drop = true
        else if (b.length === 4 && f.ids.every((i) => w[0] - posed[i][0] > 0.28 || (w[0] - posed[i][0] > 0.05 && posed[i][2] > 0.5))) f.drop = true
      }
      const out = [
        // Un trozo de meteorito clavado en la joroba, hacia arriba y atrás.
        ...crystal('Meteorito', lifted(back(0.85, -0.25)), [0.15, 0.8, -0.55], 0.55, 0.16, 'Chest'),
        ...crystal('Meteorito', lifted(back(0.75, -0.3)), [-0.5, 0.6, -0.6], 0.35, 0.1, 'Chest'),
        ...crystal('Meteorito', lifted(back(0.7, -0.2)), [0.6, 0.5, -0.5], 0.3, 0.09, 'Chest'),
      ]
      // Piernas de roca volcánica: muslo, rodilla con una grieta de brasa, canilla y un pie ancho y plano.
      let seed = 300
      const stone = (role, c, r, bone, o = {}) => out.push(...rock(role, c, r, 0, { seed: seed++, ...o }).map((t) => ({ role: t.role, pts: t.vs.map((v) => v.POSITION), ws: [0, 1, 2].map(() => [{ b: bone, w: 1 }]) })))
      for (const [S, s] of [['L', 1], ['R', -1]]) {
        const ul = pos[`UpperLeg.${S}`], ll = pos[`LowerLeg.${S}`], ft = pos[`Foot.${S}`]
        const thigh = Math.hypot(...ll.map((x, i) => x - ul[i])), shin = ll[1] - ft[1]
        const mid = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t)
        stone('Piedra', mid(ul, ll, 0.45).map((x, i) => x + [s * 0.03, 0, 0][i]), [thigh * 0.55, 0.3, 0.27], `UpperLeg.${S}`, { axis: [0, -1, 0], up: [0, 0, 1], cuts: 6 })
        stone('Bandas', mid(ul, ll, 0.95).map((x, i) => x + [0, 0, 0.12][i]), [0.13, 0.12, 0.1], `LowerLeg.${S}`, { detail: 0, cuts: 2 })
        stone('PiedraOscura', mid(ul, ll, 1).map((x, i) => x + [0, 0, 0.1][i]), [0.17, 0.16, 0.15], `LowerLeg.${S}`, { detail: 0 })
        stone('Piedra', [ll[0], ll[1] - shin * 0.48, ll[2]], [shin * 0.5, 0.25, 0.25], `LowerLeg.${S}`, { axis: [0, -1, 0], up: [0, 0, 1], cuts: 6 })
        stone('Bandas', [ll[0], ll[1] - shin * 0.48, ll[2] + 0.2], [0.05, shin * 0.28, 0.04], `LowerLeg.${S}`, { detail: 0, cuts: 1 })
        stone('PiedraOscura', [ft[0] + s * 0.02, ft[1] + 0.09, ft[2] + 0.12], [0.28, 0.13, 0.4], `Foot.${S}`, { axis: [0, 0, 1], flatBottom: true, detail: 0, cuts: 5 })
      }
      return out
    },
  },
  cristal: {
    name: 'Coloso',
    looks: { base: { Piedra: { color: '#9fd8ff', roughness: 0.35, metalness: 0.1 }, Bandas: { color: '#ffffff', emissive: '#bfe8ff' }, Cristal: { color: '#d6efff', emissive: '#4aa8e0', roughness: 0.2 } } },
    // Puntas de cristal en la joroba y en los hombros.
    extra: () => [
      ...crystal('Cristal', back(1.0, 0.0), [0, 1, -0.3], 0.5, 0.12, 'Chest'),
      ...crystal('Cristal', back(0.95, -0.25), [0.3, 0.8, -0.5], 0.4, 0.1, 'Chest'),
      ...crystal('Cristal', back(0.95, -0.25), [-0.3, 0.8, -0.5], 0.4, 0.1, 'Chest'),
      ...crystal('Cristal', m([0.75, 0.85, 0.3]), [0.4, 1, 0], 0.35, 0.08, 'UpperArm.L'),
      ...crystal('Cristal', m([-0.75, 1.0, 0.1]), [-0.4, 1, 0], 0.45, 0.1, 'Shoulder.R'),
    ],
  },
}
const jefe = JEFES[process.env.JEFE ?? 'guardian']
if (jefe.lift) {
  // Sube el cuerpo (no los pies): la cadera, los hombros, los brazos y el cuello; la rodilla queda a mitad de pierna.
  const up = (p) => [p[0], p[1] + jefe.lift, p[2]]
  for (let i = 0; i < verts.length; i++) if (!/^(UpperLeg|LowerLeg|Foot)/.test(bonesOf[i][0])) verts[i] = up(verts[i])
  for (const o of [L, R]) {
    for (const key of ['Sh', 'E', 'W', 'F', 'H']) o[key] = up(o[key])
    o.K = o.H.map((x, i) => x + (o.A[i] - x) * 0.5)
  }
  N = up(N); HC = up(HC)
}

await montar({
  io, doc, skinDoc, verts, faces, L, R, N, HC, top: (maxY - minY) * S + (jefe.lift ?? 0), candidates: (i) => bonesOf[i], headIds,
  head: (ctx) => jefe.extra(ctx), looks: jefe.looks, muscle: false, name: jefe.name, label: `${jefe.name} · ${before} → ${after} triángulos`, outPath,
})
