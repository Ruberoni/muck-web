// Las animaciones del espíritu tocón (espiritu.mjs, FORMA=tocon): no usa las del jugador, porque tiene un solo brazo
// de rama que en reposo apunta hacia arriba y piernas de cono sin rodillas. Camina y corre a saltitos, balanceándose de
// un lado a otro, y ataca azotando con la rama (`extras.golpe`, el segundo en que pega).
import { Pose, addClip, qaxis } from './anim.mjs'

const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1]
/** Gira la dirección `v` sobre el eje z (rolar a la derecha es positivo: lo de arriba va hacia −x). */
const rotZ = (v, deg) => { const a = (deg * Math.PI) / 180; return [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a), v[2]] }

/** La rama en reposo: sale del costado y sube, curvándose un poco hacia adentro en la punta. */
const ARM = { arm: [-0.5, 1, 0.05], fore: [-0.12, 1, 0.12], hand: [0.25, 1, 0.12] }

export function animarTocon(doc) {
  const idle = new Pose(doc)
  /**
   * `root` sube todo (saltar), `body` baja el cuerpo (aplastarse al caer); `roll` lo ladea, `lean` lo inclina adelante y
   * `twist` lo gira, en grados; `legL`/`legR` adelantan cada pierna; la rama sigue al cuerpo (`follow`) salvo que se
   * den sus direcciones.
   */
  const pose = ({ root = 0, body = 0, roll = 0, lean = 0, twist = 0, legL = 0, legR = 0, arm, fore, hand, follow = 0.8, sway = 0 } = {}) => {
    const p = idle.clone()
    if (root) p.move('Root', [0, root, 0])
    if (body) p.move('Body', [0, body, 0])
    if (twist) p.turn('Body', qaxis(Y, twist))
    if (lean) p.turn('Body', qaxis(X, lean))
    if (roll) p.turn('Body', qaxis(Z, roll))
    if (legL) p.turn('UpperLeg.L', qaxis(X, -legL))
    if (legR) p.turn('UpperLeg.R', qaxis(X, -legR))
    const bend = roll * follow + sway
    p.aim('UpperArm.R', 'LowerArm.R', arm ?? rotZ(ARM.arm, bend))
    p.aim('LowerArm.R', 'Wrist.R', fore ?? rotZ(ARM.fore, bend * 1.3))
    p.aim('Wrist.R', 'Middle1.R', hand ?? rotZ(ARM.hand, bend * 1.6))
    return p
  }

  // Un saltito: cae aplastado, sube ladeado a un lado con una pierna adelante, cae, y lo mismo al otro lado.
  const hop = (T, h, roll, lean) => [
    [0, pose({ body: -0.06, lean, sway: 6 })],
    [T * 0.25, pose({ root: h, roll, lean, legL: 14, legR: -8, sway: -4 })],
    [T * 0.5, pose({ body: -0.06, lean, sway: -6 })],
    [T * 0.75, pose({ root: h, roll: -roll, lean, legL: -8, legR: 14, sway: 4 })],
    [T, pose({ body: -0.06, lean, sway: 6 })],
  ]
  const clips = {
    Idle: [[0, pose()], [1.2, pose({ body: -0.025, roll: 3, sway: 5 })], [2.4, pose()]],
    Walk: hop(0.7, 0.12, 9, 4),
    Run: hop(0.5, 0.2, 12, 12),
    // Atrás la rama por encima de la cabeza, y la azota adelante y abajo.
    Attack: [
      [0, pose()],
      [0.35, pose({ lean: -10, twist: -15, body: 0.02, arm: [-0.25, 0.85, -0.5], fore: [0, 0.55, -0.85], hand: [0.1, 0.1, -1] })],
      [0.5, pose({ lean: 15, twist: 15, body: -0.05, arm: [-0.3, 0.35, 0.9], fore: [-0.1, -0.3, 0.95], hand: [0, -0.8, 0.6] })],
      [0.65, pose({ lean: 17, twist: 17, body: -0.06, arm: [-0.3, 0.3, 0.9], fore: [-0.1, -0.35, 0.93], hand: [0, -0.85, 0.5] })],
      [1.0, pose()],
    ],
    HitRecieve: [[0, pose()], [0.12, pose({ lean: -15, root: 0.03, sway: 18 })], [0.5, pose()]],
    // Da un saltito y se cae de costado.
    Death: [[0, pose()], [0.3, pose({ root: 0.1, roll: -10 })], [0.9, pose({ root: -0.15, roll: 85, follow: 1 })], [1.0, pose({ root: -0.2, roll: 84, follow: 1 })], [1.3, pose({ root: -0.2, roll: 84, follow: 1 })]],
  }

  // Fuera las del jugador: con un brazo para arriba y piernas sin rodillas no le quedan bien.
  for (const a of doc.getRoot().listAnimations()) {
    for (const c of a.listChannels()) c.dispose()
    for (const s of a.listSamplers()) { s.getInput()?.dispose(); s.getOutput()?.dispose(); s.dispose() }
    a.dispose()
  }
  for (const [name, keys] of Object.entries(clips)) {
    const anim = addClip(doc, name, keys)
    if (name === 'Attack') anim.setExtras({ golpe: 0.5 })
  }
}
