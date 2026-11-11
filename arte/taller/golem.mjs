// Arma Golem.glb, el gólem de piedra, hecho de cero sobre el esqueleto del jugador (trae sus animaciones adaptadas):
// un montón de rocas partidas, cada una pegada a un hueso, con hombros enormes, brazos largos de puños gordos,
// piernas cortas, la cabeza hundida entre los hombros y musgo encima.
// Tres apariencias: base (piedra gris con musgo), noche (piedra oscura con cristales violeta que brillan) y totem
// (piedra rojiza con cristales y musgo de lava). Los cristales solo salen de noche y en el tótem
// (`noche_Cristales` y `totem_Cristales`, la misma malla).
// Con JEFE=lanzarrocas arma el jefe Lanzarrocas: el mismo gólem, más grande (2,8 m) y de una sola apariencia, de
// granito con musgo, ojos y cristales azules que brillan (corona en la cabeza y en la espalda), un montón de rocas en
// la joroba y una roca en la mano derecha (`RocaMano`, escondida: la muestra la animación de tirarla).
// node golem.mjs <Casual.glb> <animations.glb> <salida.glb>
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { byRole, nuevoCuerpo } from './esqueleto.mjs'
import { crystal, rock } from './rocas.mjs'

const [skinPath, animPath, outPath] = process.argv.slice(2)
const JEFE = process.env.JEFE === 'lanzarrocas'
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)

// ---------- proporciones: piernas cortas, hombros anchos, brazos largos, cuello hundido ----------
const LEGS = 0.78
const k = { Body: LEGS, Hips: LEGS, Neck: 0.5 }
for (const s of ['L', 'R']) {
  for (const n of ['UpperLeg', 'LowerLeg', 'Foot', 'PT']) k[`${n}.${s}`] = LEGS
  Object.assign(k, { [`Shoulder.${s}`]: 1.6, [`UpperArm.${s}`]: 3, [`LowerArm.${s}`]: 1.2, [`Wrist.${s}`]: 1.25, [`Middle1.${s}`]: 1.4 })
}

const GOLEM_LOOKS = {
  base: {
    Piedra: { color: '#8f8b82', roughness: 0.95 }, PiedraOscura: { color: '#6f6b64', roughness: 0.95 },
    Musgo: { color: '#5d8c3a' }, Ojos: { color: '#ffc04a', emissive: '#ff8a1a' }, Cristal: { color: '#9fd8ff' },
  },
  noche: {
    Piedra: { color: '#3e3b47', roughness: 0.95 }, PiedraOscura: { color: '#2c2a33', roughness: 0.95 },
    Musgo: { color: '#2c3a4a' }, Ojos: { color: '#e2d4ff', emissive: '#b48cff' },
    Cristal: { color: '#b48cff', emissive: '#6a2fd0', roughness: 0.3 },
  },
  totem: {
    Piedra: { color: '#5e3c31', roughness: 0.95 }, PiedraOscura: { color: '#402822', roughness: 0.95 },
    Musgo: { color: '#ff7a2f', emissive: '#e0480f' }, Ojos: { color: '#ffd27a', emissive: '#ff6a1f' },
    Cristal: { color: '#ffb36b', emissive: '#ff5a1f', roughness: 0.3 },
  },
}

const BOSS_LOOK = {
  Piedra: { color: '#7d776c', roughness: 0.95 }, PiedraOscura: { color: '#5a554d', roughness: 0.95 },
  Musgo: { color: '#4f7f34' }, Ojos: { color: '#bff0ff', emissive: '#2ab0ff' }, Cristal: { color: '#7fd8ff', emissive: '#1a8ad0', roughness: 0.3 },
}
const LOOKS = JEFE ? { base: BOSS_LOOK } : GOLEM_LOOKS

const body = await nuevoCuerpo({ io, skinPath, animPath, k, looks: LOOKS, name: JEFE ? 'Lanzarrocas' : 'Golem' })
const { pos: P, J } = body
const add = (a, b) => a.map((x, i) => x + b[i])
const sub = (a, b) => a.map((x, i) => x - b[i])
const lerp = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t)
const len = (a) => Math.hypot(...a)
const mirror = (p, s) => [p[0] * s, p[1], p[2]]

const tris = [], crystals = []
let seed = 1
/** Una roca; la mitad de las veces en el tono oscuro, para que no se vea toda igual. */
const stone = (c, r, bone, o = {}) => tris.push(...rock(o.role ?? (seed % 3 === 0 ? 'PiedraOscura' : 'Piedra'), c, r, J(bone), { seed: seed++, ...o }))

// Tronco: cadera, vientre, un pecho enorme y la joroba de la espalda.
stone(add(P.Hips, [0, -0.02, -0.01]), [0.2, 0.13, 0.16], 'Hips', { cuts: 6 })
stone(lerp(P.Abdomen, P.Torso, 0.5), [0.21, 0.13, 0.17], 'Abdomen')
stone(add(P.Chest, [0, 0.0, 0.0]), [0.33, 0.2, 0.22], 'Chest', { cuts: 7 })
stone(add(P.Chest, [0, 0.13, -0.13]), [0.24, 0.16, 0.15], 'Chest', { axis: [1, 0, 0.2] })
stone(add(P.Chest, [0, -0.06, 0.17]), [0.17, 0.1, 0.07], 'Torso', { detail: 0, role: 'PiedraOscura' }) // placa del pecho

// Cabeza: chica, adelantada y hundida, con una ceja de piedra y dos ojos que brillan.
const H = add(P.Head, [0, 0.03, 0.15])
stone(add(H, [0, 0.05, 0]), [0.13, 0.11, 0.12], 'Head', { cuts: 6 })
stone(add(H, [0, 0.11, 0.08]), [0.14, 0.04, 0.06], 'Head', { detail: 0, role: 'PiedraOscura' })
stone(add(H, [0, -0.02, 0.07]), [0.1, 0.05, 0.06], 'Head', { detail: 0 }) // mandíbula
for (const s of [1, -1]) tris.push(...rock('Ojos', add(H, [s * 0.055, 0.07, 0.115]), [0.03, 0.022, 0.015], J('Head'), { seed: 90 + s, detail: 0, cuts: 2, bump: 0.05 }))
tris.push(...rock('Musgo', add(H, [0, 0.15, -0.02]), [0.12, 0.04, 0.1], J('Head'), { seed: 70, cuts: 3 }))

for (const [S, s] of [['L', 1], ['R', -1]]) {
  const ua = P[`UpperArm.${S}`], la = P[`LowerArm.${S}`], wr = P[`Wrist.${S}`], hand = P[`Middle1.${S}`]
  const arm = [s, 0, 0]
  // Hombrera: una roca grande sobre el hombro, con musgo arriba.
  stone(add(ua, [0, 0.06, 0]), [0.19, 0.16, 0.17], `UpperArm.${S}`, { cuts: 6, axis: [s, 0.3, 0] })
  tris.push(...rock('Musgo', add(ua, [s * 0.01, 0.19, -0.01]), [0.13, 0.04, 0.12], J(`UpperArm.${S}`), { seed: 71 + s, cuts: 3 }))
  // Brazo: una roca larga; codo; antebrazo gordo que se ensancha hacia el puño.
  stone(lerp(ua, la, 0.6), [len(sub(la, ua)) * 0.42, 0.115, 0.115], `UpperArm.${S}`, { axis: arm })
  stone(la, [0.075, 0.07, 0.07], `LowerArm.${S}`, { detail: 0, role: 'PiedraOscura' })
  stone(lerp(la, wr, 0.55), [len(sub(wr, la)) * 0.52, 0.15, 0.15], `LowerArm.${S}`, { axis: arm, cuts: 6 })
  // Puño: un bloque grande y unos nudillos.
  const fist = lerp(wr, hand, 3.4)
  stone(fist, [0.18, 0.17, 0.18], `Wrist.${S}`, { cuts: 6, axis: arm })
  for (const dz of [-0.07, 0, 0.07]) stone(add(fist, [s * 0.16, 0.03, dz * 1.3]), [0.055, 0.055, 0.05], `Wrist.${S}`, { detail: 0, role: 'PiedraOscura' })

  // Piernas: muslo, rodilla, canilla y un pie plano y ancho.
  const ul = P[`UpperLeg.${S}`], ll = P[`LowerLeg.${S}`], ft = P[`Foot.${S}`]
  const down = [0, -1, 0]
  stone(add(lerp(ul, ll, 0.5), [s * 0.02, 0, 0]), [len(sub(ll, ul)) * 0.5, 0.15, 0.14], `UpperLeg.${S}`, { axis: down, up: [0, 0, 1] })
  stone(add(ll, [0, 0, 0.06]), [0.07, 0.07, 0.06], `LowerLeg.${S}`, { detail: 0, role: 'PiedraOscura' })
  const ankle = [ll[0], ft[1] + 0.1, ft[2]]
  stone(lerp(ll, ankle, 0.5), [len(sub(ankle, ll)) * 0.5, 0.13, 0.13], `LowerLeg.${S}`, { axis: down, up: [0, 0, 1] })
  stone(add(ft, [s * 0.01, 0.06, 0.07]), [0.15, 0.08, 0.21], `Foot.${S}`, { axis: [0, 0, 1], cuts: 6, flatBottom: true, detail: 0 })

  // Cristales de noche y del tótem: en el hombro y el antebrazo.
  crystals.push(...crystal('Cristal', add(ua, [s * 0.04, 0.2, -0.06]), [s * 0.4, 1, -0.4], 0.24, 0.045, J(`UpperArm.${S}`), { seed: 5 + s }))
  crystals.push(...crystal('Cristal', add(ua, [s * 0.12, 0.16, -0.02]), [s * 0.9, 0.8, 0], 0.16, 0.035, J(`UpperArm.${S}`), { seed: 8 + s }))
  crystals.push(...crystal('Cristal', add(lerp(la, wr, 0.5), [0, 0.11, -0.04]), [0, 1, -0.5], 0.13, 0.03, J(`LowerArm.${S}`), { seed: 11 + s }))
}
// Y en la joroba: un racimo.
const back = add(P.Chest, [0, 0.22, -0.2])
for (const [d, h, w, i] of [[[0, 1, -0.6], 0.34, 0.06, 1], [[0.5, 0.9, -0.5], 0.26, 0.05, 2], [[-0.5, 0.9, -0.5], 0.28, 0.05, 3], [[0.2, 0.5, -1], 0.2, 0.04, 4], [[-0.25, 0.6, -1], 0.18, 0.04, 5]]) {
  crystals.push(...crystal('Cristal', add(back, [d[0] * 0.06, 0, 0]), d, h, w, J('Chest'), { seed: 20 + i }))
}

if (JEFE) {
  // Lo que dice "soy el jefe": una corona alta de cristales alrededor de la cabeza, hombreras de cristales grandes, un
  // corazón de cristal en el pecho, una cresta de cristales por la espalda y nudillos de cristal; además, rocas
  // amontonadas en la joroba (las que tira) y más musgo.
  for (let i = 0; i < 7; i++) {
    const a = ((i - 3) / 3) * 1.25 // de un lado al otro, por delante y por los costados
    const at = add(H, [Math.sin(a) * 0.12, 0.13, Math.cos(a) * 0.08 - 0.03])
    const h = i === 3 ? 0.36 : i % 2 ? 0.24 : 0.3
    crystals.push(...crystal('Cristal', at, [Math.sin(a) * 0.35, 1, Math.cos(a) * 0.1 - 0.15], h, i === 3 ? 0.05 : 0.038, J('Head'), { seed: 60 + i }))
  }
  for (const [S, s] of [['L', 1], ['R', -1]]) {
    const ua = P[`UpperArm.${S}`]
    for (const [d, h, w, i] of [[[s * 0.5, 1, -0.1], 0.42, 0.07, 1], [[s * 0.9, 0.7, 0.1], 0.32, 0.055, 2], [[s * 0.2, 0.9, -0.6], 0.3, 0.05, 3], [[s * 0.8, 0.5, -0.5], 0.24, 0.045, 4]]) {
      crystals.push(...crystal('Cristal', add(ua, [s * 0.03, 0.17, -0.03]), d, h, w, J(`UpperArm.${S}`), { seed: 70 + i + (s > 0 ? 10 : 0) }))
    }
    const wr = P[`Wrist.${S}`], hand = P[`Middle1.${S}`], fist = lerp(wr, hand, 3.4)
    for (const dz of [-0.08, 0, 0.08]) crystals.push(...crystal('Cristal', add(fist, [s * 0.17, 0.08, dz]), [s * 0.6, 1, dz * 3], 0.1, 0.025, J(`Wrist.${S}`), { seed: 90 + Math.round(dz * 100) + s, sides: 4 }))
  }
  crystals.push(...crystal('Cristal', add(P.Chest, [0, -0.04, 0.2]), [0, 0.2, 1], 0.14, 0.075, J('Chest'), { seed: 101, sides: 6, tip: 0.5 }))
  for (const [y, z, h, i] of [[0.05, -0.27, 0.3, 1], [-0.08, -0.25, 0.26, 2], [-0.2, -0.22, 0.2, 3], [0.17, -0.26, 0.26, 4]]) {
    crystals.push(...crystal('Cristal', add(P.Chest, [0, y, z]), [0, 0.6, -1], h, 0.05, J(y < -0.1 ? 'Torso' : 'Chest'), { seed: 110 + i }))
  }
  for (const [dx, dy, dz, r, i] of [[0, 0.3, -0.24, 0.13, 1], [0.15, 0.25, -0.2, 0.1, 2], [-0.14, 0.27, -0.22, 0.11, 3], [0.06, 0.4, -0.3, 0.09, 4]]) {
    tris.push(...rock('PiedraOscura', add(P.Chest, [dx, dy, dz]), [r, r * 0.9, r], J('Chest'), { seed: 80 + i, detail: 0, cuts: 3 }))
  }
  tris.push(...rock('Musgo', add(P.Chest, [0, 0.2, 0.1]), [0.22, 0.04, 0.12], J('Chest'), { seed: 95, cuts: 3 }))
}
body.add(JEFE ? 'Lanzarrocas' : 'Golem', body.buildMesh(JEFE ? 'Lanzarrocas' : 'Golem', byRole(tris)))
const crystalMesh = body.buildMesh('Cristales', byRole(crystals))
if (JEFE) body.add('Cristales', crystalMesh)
else for (const v of ['noche', 'totem']) body.add(`${v}_Cristales`, crystalMesh)
if (JEFE) {
  // La roca que tira: en la mano derecha, escondida hasta que la saca.
  const hand = rock('PiedraOscura', [0, 0.12, 0], [0.17, 0.15, 0.16], 0, { seed: 99, detail: 0, cuts: 3 })
  body.byName['Middle1.R'].addChild(body.doc.createNode('RocaMano').setScale([0, 0, 0]).setMesh(body.buildMesh('RocaMano', byRole(hand))))
}
body.finish()
// El esqueleto del jugador mide 1,8 m; el gólem, hundido y de piernas cortas, queda en ~1,7: a 2,2 m (el jefe, a 2,8).
const top = Math.max(...tris.flatMap((t) => t.vs.map((v) => v.POSITION[1])))
body.armature.setScale(Array(3).fill((JEFE ? 2.8 : 2.2) / top))
await io.write(outPath, body.doc)
console.log(`${JEFE ? 'lanzarrocas' : 'gólem'} · ${tris.length} triángulos + ${crystals.length} de cristales · alto ${top.toFixed(2)} → ${JEFE ? 2.8 : 2.2} m`)
