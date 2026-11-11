// Las animaciones de los ataques especiales de los jefes (src/sim/constants.ts, `specials`), para cualquier modelo
// sobre el esqueleto del jugador. Cada una se llama como el ataque (`fireRing`, `stomp`…) y dura lo que el juego:
// avisa `windup` segundos (la carga), golpea justo en `extras.golpe` (= windup, cuando el juego hace el ataque), queda
// agotado `recover` segundos (`extras.agotado`) respirando encorvado, y vuelve a la pose quieta.
// La embestida del gigante (`charge`) avisa `extras.aviso` s, corre y pega en `extras.golpe`.
// node ataques.mjs <entrada.glb> <salida.glb> <jefe: guardian | coloso | gigante | lanzarrocas>
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { Pose, addClip, qaxis, qinv, qmul } from './anim.mjs'

const X = [1, 0, 0], Y = [0, 1, 0]
/** El brazo izquierdo, en espejo del derecho. */
const mirror = (d) => d && [-d[0], d[1], d[2]]

/**
 * Una pose a partir de la quieta. Ángulos en grados; `body` baja (−) o sube el cuerpo y `root` todo el modelo (saltar),
 * en fracciones del alto de la cadera; `lean` inclina adelante, `twist` gira a la izquierda (el hombro derecho
 * adelante), `head` mira abajo. Los brazos van hacia direcciones del modelo (+x izquierda, +y arriba, +z adelante):
 * `arm` el brazo y `fore` el antebrazo del derecho; el izquierdo, en espejo, salvo que se den `armL`/`foreL`.
 */
function posed(idle, { body = 0, root = 0, lean = 0, twist = 0, head = 0, arm, fore, armL, foreL, footL, footR }) {
  const p = idle.clone()
  const hip = idle.world(idle.byName.Hips).p[1]
  if (root) p.move('Root', [0, root * hip, 0])
  // Pasos (correr): [alto, adelante] del pie, en fracciones del alto de la cadera.
  if (footL) p.move('Foot.L', [0, footL[0] * hip, footL[1] * hip])
  if (footR) p.move('Foot.R', [0, footR[0] * hip, footR[1] * hip])
  if (body) p.move('Body', [0, body * hip, 0])
  p.legIK('L').legIK('R')
  for (const b of ['Abdomen', 'Torso', 'Chest']) {
    if (twist) p.turn(b, qaxis(Y, twist / 3))
    if (lean) p.turn(b, qaxis(X, lean / 3))
  }
  if (head) p.turn('Head', qaxis(X, head))
  const ownL = armL !== undefined
  armL ??= mirror(arm); foreL ??= ownL ? armL : mirror(fore ?? arm)
  if (arm) p.aim('UpperArm.R', 'LowerArm.R', arm).aim('LowerArm.R', 'Wrist.R', fore ?? arm)
  if (armL) p.aim('UpperArm.L', 'LowerArm.L', armL).aim('LowerArm.L', 'Wrist.L', foreL)
  return p
}

/** Agotado tras el ataque: encorvado, con los brazos colgando adelante; `deep` respira más hondo. */
const tired = (deep) => ({ body: deep ? -0.1 : -0.07, lean: deep ? 26 : 20, head: deep ? 18 : 12, arm: [-0.2, -0.85, 0.45], fore: [-0.1, -0.75, 0.65] })

// ---------- los ataques: las poses de la carga y del golpe ----------
// Cada uno: windup y recover como en constants.ts, y [segundo, pose] hasta un poco después del golpe.
const ATAQUES = {
  // Guardián del meteorito
  fireRing: { // Anillo de fuego: alza los puños y golpea el suelo con los dos.
    windup: 0.9, recover: 1.4, keys: [
      [0.45, { body: 0.03, lean: -12, head: -15, arm: [-0.25, 1, 0.15], fore: [-0.1, 1, 0.2] }],
      [0.8, { body: 0.05, lean: -18, head: -18, arm: [-0.15, 1, -0.15], fore: [0, 1, -0.1] }],
      [0.9, { body: -0.2, lean: 38, head: 8, arm: [-0.25, -0.6, 0.75], fore: [-0.1, -0.95, 0.3] }],
      [1.08, { body: -0.22, lean: 40, head: 10, arm: [-0.28, -0.62, 0.72], fore: [-0.1, -0.97, 0.25] }],
    ],
  },
  burningGround: { // Suelo ardiente: junta fuego en la mano izquierda, atrás, y lo arroja adelante y abajo.
    windup: 1, recover: 1.3, keys: [
      [0.6, { twist: 25, lean: -8, armL: [0.6, 0.5, -0.6], foreL: [0.3, 0.9, -0.3], arm: [-0.5, -0.6, 0.5] }],
      [0.9, { twist: 30, lean: -10, armL: [0.55, 0.6, -0.6], foreL: [0.25, 0.95, -0.2], arm: [-0.5, -0.6, 0.5] }],
      [1.0, { twist: -25, lean: 15, armL: [0.1, 0, 1], foreL: [0, -0.25, 1], arm: [-0.6, -0.4, -0.5] }],
      [1.15, { twist: -30, lean: 18, armL: [-0.15, -0.3, 0.95], foreL: [-0.1, -0.45, 0.9], arm: [-0.6, -0.45, -0.5] }],
    ],
  },
  lightning: { // Rayo: levanta la maza al cielo, apunta con la otra mano y baja la maza hacia el jugador.
    windup: 0.8, recover: 1, keys: [
      [0.4, { lean: -10, head: -20, arm: [-0.15, 1, 0.05], fore: [0, 1, 0.1], armL: [0.5, 0.1, 0.85], foreL: [0.3, 0.1, 0.95] }],
      [0.7, { lean: -14, head: -25, arm: [-0.05, 1, -0.05], fore: [0, 1, 0], armL: [0.45, 0.12, 0.88], foreL: [0.25, 0.12, 0.96] }],
      [0.8, { body: -0.1, lean: 20, arm: [-0.15, -0.2, 1], fore: [-0.1, -0.45, 0.9], armL: [0.5, -0.6, 0.3] }],
      [0.95, { body: -0.12, lean: 24, arm: [-0.15, -0.4, 0.9], fore: [-0.1, -0.6, 0.8], armL: [0.5, -0.65, 0.3] }],
    ],
  },
  // Coloso de Cristal
  pulse: { // Pulso: se encoge con los brazos cruzados y estalla abriéndolos.
    windup: 0.7, recover: 1.2, keys: [
      [0.45, { body: -0.15, lean: 25, head: 20, arm: [0.5, -0.3, 0.8], fore: [0.9, 0.1, 0.4] }],
      [0.65, { body: -0.18, lean: 30, head: 24, arm: [0.55, -0.25, 0.8], fore: [0.95, 0.15, 0.3] }],
      [0.7, { body: 0.06, lean: -15, head: -15, arm: [-0.85, 0.45, 0.25], fore: [-0.8, 0.6, 0.1] }],
      [0.85, { body: 0.04, lean: -18, head: -18, arm: [-0.85, 0.5, 0.2], fore: [-0.75, 0.65, 0.05] }],
    ],
  },
  pillars: { // Pilares: alza el puño derecho y golpea el suelo adelante.
    windup: 0.9, recover: 1.3, keys: [
      [0.55, { twist: -20, lean: -10, arm: [-0.3, 1, -0.3], fore: [-0.1, 1, -0.2], armL: [0.6, -0.2, 0.6] }],
      [0.85, { twist: -25, lean: -14, arm: [-0.25, 1, -0.45], fore: [-0.1, 1, -0.35], armL: [0.6, -0.2, 0.6] }],
      [0.9, { body: -0.28, lean: 45, twist: 10, arm: [-0.15, -0.75, 0.65], fore: [-0.05, -0.95, 0.3], armL: [0.6, -0.3, 0.4] }],
      [1.05, { body: -0.3, lean: 48, twist: 10, arm: [-0.15, -0.77, 0.62], fore: [-0.05, -0.97, 0.25], armL: [0.6, -0.3, 0.4] }],
    ],
  },
  shardFan: { // Abanico de esquirlas: lleva los brazos atrás y los barre adelante, abiertos.
    windup: 0.9, recover: 1.1, keys: [
      [0.55, { lean: -12, arm: [-0.6, 0.2, -0.75], fore: [-0.4, 0.3, -0.85] }],
      [0.85, { lean: -15, arm: [-0.55, 0.3, -0.8], fore: [-0.35, 0.35, -0.85] }],
      [0.9, { body: -0.05, lean: 15, arm: [-0.55, 0.05, 0.85], fore: [-0.6, 0, 0.8] }],
      [1.05, { body: -0.06, lean: 18, arm: [-0.75, 0, 0.65], fore: [-0.8, -0.05, 0.6] }],
    ],
  },
  lightBeam: { // Haz de luz: junta las manos adelante y arriba, apunta temblando y las baja de golpe.
    windup: 2, recover: 1.6, keys: [
      [0.5, { lean: -10, head: -12, arm: [-0.25, 0.75, 0.6], fore: [0.25, 0.6, 0.75] }],
      [1.0, { body: -0.03, lean: -11, head: -12, arm: [-0.24, 0.77, 0.58], fore: [0.24, 0.62, 0.74] }],
      [1.5, { lean: -12, head: -13, arm: [-0.22, 0.8, 0.55], fore: [0.24, 0.64, 0.72] }],
      [1.9, { body: 0.02, lean: -14, head: -14, arm: [-0.2, 0.85, 0.5], fore: [0.22, 0.68, 0.7] }],
      [2.0, { body: -0.1, lean: 20, arm: [-0.15, 0, 1], fore: [0.2, -0.1, 1] }],
      [2.2, { body: -0.11, lean: 22, arm: [-0.15, -0.05, 1], fore: [0.2, -0.15, 1] }],
    ],
  },
  // Trasgo gigante (lanza en la mano derecha, arco en la izquierda)
  stomp: { // Pisotón: se agacha, salta y cae con todo el peso, clavando la lanza en el suelo con las dos manos.
    windup: 0.8, recover: 1.4, keys: [
      [0.3, { body: -0.22, lean: 20, arm: [-0.6, -0.5, 0.6] }],
      [0.55, { root: 0.5, lean: -5, arm: [-0.3, 0.9, 0.3], fore: [-0.1, 1, 0.2], armL: [0.3, 0.8, 0.4], foreL: [0.1, 0.9, 0.3], spear: [0, 1, 0.15] }],
      [0.8, { body: -0.3, lean: 35, arm: [-0.15, -0.55, 0.82], fore: [0, -0.9, 0.45], armL: [0.2, -0.5, 0.85], foreL: [-0.05, -0.85, 0.5], spear: [0, -1, 0.3] }],
      [0.95, { body: -0.32, lean: 37, head: 8, arm: [-0.15, -0.57, 0.8], fore: [0, -0.92, 0.4], armL: [0.2, -0.52, 0.83], foreL: [-0.05, -0.87, 0.48], spear: [0, -1, 0.28] }],
    ],
  },
  arrowVolley: { // Tres flechas: levanta el arco, tensa y suelta tres veces seguidas (en 0,9, 1,2 y 1,5 s); la lanza se guarda.
    windup: 0.9, recover: 1.2, keys: (() => {
      const aim = { twist: -30, armL: [0.2, 0.12, 1], foreL: [0.05, 0.1, 1], bow: true, spear: false }
      const draw = { ...aim, arm: [-0.8, 0.12, -0.55], fore: [0.8, 0.12, 0.6] }
      const loose = { ...aim, arm: [-0.75, 0.2, -0.6], fore: [-0.2, 0.3, -0.95] }
      const nock = { ...aim, arm: [-0.35, 0, 0.94], fore: [0.35, 0.05, 0.94] }
      return [
        [0.15, { spear: false }],
        [0.4, { ...aim, lean: -4, arm: [-0.3, 0.9, -0.3], fore: [0.1, 0.8, -0.5] }],
        [0.6, nock], [0.82, draw], [0.9, loose],
        [1.02, nock], [1.14, draw], [1.2, loose],
        [1.32, nock], [1.44, draw], [1.5, loose],
        [1.7, { ...loose, twist: -20 }],
      ]
    })(),
    end: { spear: false },
  },
  charge: { // Embestida (la de `charge` en constants.ts): baja la lanza, corre y da el golpe con ella; luego queda aturdido.
    windup: 0.8, recover: 2.5, carrera: 0.6, keys: (() => {
      const lance = { arm: [-0.3, -0.25, 0.92], fore: [-0.05, -0.1, 1], armL: [0.45, -0.6, -0.65], spear: [0, -0.06, 1] }
      return [
        [0.35, { ...lance, body: -0.12, lean: 22, head: -10, footR: [0.08, -0.15] }],
        [0.75, { ...lance, body: -0.16, lean: 28, head: -14 }],
        [0.95, { ...lance, body: -0.08, lean: 32, footL: [0.25, 0.35], footR: [0, -0.3] }],
        [1.1, { ...lance, body: -0.14, lean: 32, footL: [0, 0.1], footR: [0.25, 0.3] }],
        [1.25, { ...lance, body: -0.08, lean: 32, footL: [0.25, 0.35], footR: [0, -0.3] }],
        [1.4, { body: -0.12, lean: 30, twist: 18, arm: [-0.1, 0, 1], fore: [0, 0.02, 1], armL: [0.5, -0.6, -0.6], spear: [0, 0, 1], footL: [0, 0.3] }],
        [1.55, { body: -0.13, lean: 32, twist: 20, arm: [-0.1, -0.02, 1], fore: [0, 0, 1], armL: [0.5, -0.6, -0.6], spear: [0, -0.02, 1], footL: [0, 0.3] }],
      ]
    })(),
  },
  // Lanzarrocas (el gólem grande)
  smash: { // Golpe fuerte: alza los dos puños y los baja de golpe contra el suelo, delante.
    windup: 0.7, recover: 1.2, keys: [
      [0.35, { body: 0.03, lean: -12, head: -10, arm: [-0.25, 1, 0.15], fore: [-0.1, 1, 0.2] }],
      [0.62, { body: 0.05, lean: -18, head: -14, arm: [-0.15, 1, -0.15], fore: [0, 1, -0.1] }],
      [0.7, { body: -0.22, lean: 40, head: 8, arm: [-0.2, -0.55, 0.8], fore: [-0.1, -0.95, 0.3] }],
      [0.85, { body: -0.24, lean: 42, head: 10, arm: [-0.22, -0.58, 0.78], fore: [-0.1, -0.97, 0.25] }],
    ],
  },
  summonGolems: { // Llamar gólems: abre los brazos al cielo rugiendo, y planta las manos en el suelo a los lados.
    windup: 1.2, recover: 1.5, keys: [
      [0.45, { lean: -14, head: -25, arm: [-0.65, 0.75, 0.1], fore: [-0.5, 0.85, 0.1] }],
      [0.8, { body: 0.03, lean: -18, head: -30, arm: [-0.6, 0.8, 0.05], fore: [-0.45, 0.9, 0.05] }],
      [1.05, { body: 0.04, lean: -20, head: -30, arm: [-0.58, 0.82, 0.02], fore: [-0.42, 0.9, 0] }],
      [1.2, { body: -0.25, lean: 30, head: 5, arm: [-0.55, -0.75, 0.35], fore: [-0.35, -0.9, 0.25] }],
      [1.4, { body: -0.27, lean: 32, head: 8, arm: [-0.56, -0.77, 0.32], fore: [-0.36, -0.92, 0.2] }],
    ],
  },
  fastRock: { // Roca rápida: saca una roca, la lleva atrás y la arroja con fuerza.
    windup: 0.6, recover: 0.8, keys: [
      [0.3, { twist: -30, lean: -6, arm: [-0.45, 0.55, -0.7], fore: [-0.1, 0.9, -0.4], armL: [0.6, 0.1, 0.75], rock: true }],
      [0.55, { twist: -34, lean: -8, arm: [-0.45, 0.5, -0.75], fore: [-0.1, 0.85, -0.5], armL: [0.6, 0.1, 0.75], rock: true }],
      [0.6, { twist: 25, lean: 15, arm: [-0.2, 0.3, 0.95], fore: [0, 0.1, 1], armL: [0.5, -0.5, -0.4] }],
      [0.75, { twist: 30, lean: 20, arm: [0.2, -0.4, 0.9], fore: [0.3, -0.55, 0.8], armL: [0.5, -0.55, -0.4] }],
    ],
  },
}

/** El cuaternión de la base (columnas X, Y, Z). */
function quatOfBasis([m00, m10, m20], [m01, m11, m21], [m02, m12, m22]) {
  const tr = m00 + m11 + m22
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; return [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4] }
  if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; return [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s] }
  if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; return [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s] }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2; return [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s]
}
const continuous = (qs) => { for (let i = 1; i < qs.length; i++) if (qs[i].reduce((a, x, j) => a + x * qs[i - 1][j], 0) < 0) qs[i] = qs[i].map((x) => -x); return qs }

/**
 * Las armas y lo que se lleva en la mano, si el modelo las tiene: la lanza (`Lanza`, en la mano derecha) apunta con su
 * punta hacia `spear` o se guarda (`spear: false`, escondida); el arco (`Arco`, mano izquierda) se para con la panza
 * hacia adelante con `bow`; la roca de la mano (`RocaMano`, escondida si no) se ve con `rock`.
 */
function weaponTracks(doc, specs, poses) {
  const byName = Object.fromEntries(doc.getRoot().listNodes().map((n) => [n.getName(), n]))
  const times = specs.map(([t]) => t), out = []
  const show = (name, visible) => {
    const vals = specs.map(([, s]) => (visible(s) ? [1, 1, 1] : [0, 0, 0]))
    if (vals.some((v, i) => v[0] !== vals[0][0] || v[0] !== byName[name].getScale()[0])) out.push({ node: byName[name], path: 'scale', times, values: vals, interpolation: 'STEP' })
  }
  if (byName.Lanza && specs.some(([, s]) => s.spear !== undefined)) {
    const base = byName.Lanza.getRotation()
    out.push({ node: byName.Lanza, path: 'rotation', times, values: continuous(specs.map(([, s], i) => (Array.isArray(s.spear) ? poses[i][1].pointChild('Middle1.R', s.spear) : base))) })
    show('Lanza', (s) => s.spear !== false)
  }
  if (byName.Arco && specs.some(([, s]) => s.bow)) {
    const base = byName.Arco.getRotation(), up = quatOfBasis([-1, 0, 0], [0, 0, 1], [0, 1, 0])
    out.push({ node: byName.Arco, path: 'rotation', times, values: continuous(specs.map(([, s], i) => (s.bow ? qmul(qinv(poses[i][1].world(byName['Middle1.L']).q), up) : base))) })
  }
  if (byName.RocaMano && specs.some(([, s]) => s.rock)) show('RocaMano', (s) => !!s.rock)
  return out
}

/** Qué ataques hace cada jefe (como en constants.ts). */
export const JEFES = {
  guardian: ['fireRing', 'burningGround', 'lightning'],
  coloso: ['pulse', 'pillars', 'shardFan', 'lightBeam'],
  gigante: ['stomp', 'arrowVolley', 'charge'],
  lanzarrocas: ['smash', 'summonGolems', 'fastRock'],
}

/** Agrega a `doc` las animaciones de los ataques `ids` (reemplaza las que ya estén). */
export function agregarAtaques(doc, ids) {
  const idle = new Pose(doc)
  for (const id of ids) {
    const { windup, recover, keys, carrera } = ATAQUES[id]
    for (const a of doc.getRoot().listAnimations()) if (a.getName() === id) {
      for (const c of a.listChannels()) c.dispose()
      for (const s of a.listSamplers()) { s.getInput()?.dispose(); s.getOutput()?.dispose(); s.dispose() }
      a.dispose()
    }
    const last = keys.at(-1)[0]
    const end = (carrera ?? 0) + windup
    const keep = ATAQUES[id].end ?? {}
    const rest = [[last + 0.3, { ...tired(true), ...keep }], [end + recover * 0.6, { ...tired(false), ...keep }], [end + recover, { ...tired(true), ...keep }]].filter(([t]) => t > last)
    // La embestida: el golpe es al final de la carrera.
    const hit = windup + (carrera ?? 0)
    const specs = [[0, {}], ...keys, ...rest, [hit + recover + 0.4, {}]]
    const all = specs.map(([t, spec]) => [t, t === 0 || t === hit + recover + 0.4 ? idle : posed(idle, spec)])
    addClip(doc, id, all, weaponTracks(doc, specs, all)).setExtras(carrera ? { aviso: windup, golpe: hit, agotado: recover } : { golpe: windup, agotado: recover })
  }
}

if (process.argv[1]?.endsWith('ataques.mjs')) {
  const [inPath, outPath, jefe] = process.argv.slice(2)
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  const doc = await io.read(inPath)
  agregarAtaques(doc, JEFES[jefe])
  await io.write(outPath, doc)
  console.log(`${jefe}: ${JEFES[jefe].join(', ')}`)
}
