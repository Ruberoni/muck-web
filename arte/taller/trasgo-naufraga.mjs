// Arma Trasgo.glb sobre el cuerpo de la skin Casual (el mismo esqueleto del jugador: usa animations.glb):
// piel verde, calvo, cabeza más grande, orejas puntiagudas, ropa rota y descalzo. Tres apariencias como
// variantes de material: base, noche (Noche Eterna) y totem (tótem activado), con pinchos de hueso en
// hombros y espalda (`totem_Pinchos`) y pintura de guerra que solo se ve en totem.
// node trasgo.mjs <Casual.glb> <salida.glb>
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, KHRMaterialsVariants } from '@gltf-transform/extensions'
import { bindPositions, dropOriginalMesh, flatTri, lin, primitive, random, spike, triangles, weightOf } from './lib.mjs'

const [inPath, outPath] = process.argv.slice(2)
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const doc = await io.read(inPath)
const root = doc.getRoot()
const skin = root.listSkins()[0]
const bind = bindPositions(skin)
const { tris, joints } = triangles(doc)
const J = (name) => joints.indexOf(name)
const rnd = random(11)

// ---------- qué es cada triángulo ----------
const isUpper = (t) => t.part.size > 2000
const isLegs = (t) => t.part.size > 500 && t.part.maxY < 1.2 && t.part.minY < 0.4
const isHair = (t) => !isUpper(t) && !isLegs(t) && t.color === '#8b7547'

/** Cada triángulo acaba con un papel; cada papel es una primitiva con su material en cada variante. */
const roles = { Piel: [], Ropa: [], Ropa2: [], Ojos: [], Cejas: [], Pintura: [] }
for (const t of tris) {
  if (isHair(t)) continue // calvo
  let role = 'Piel'
  if (t.color === '#31251c') role = 'Ojos'
  else if (t.color === '#3e3429') role = 'Cejas'
  else if (t.color === '#8b7547') role = 'Piel' // el borde del pelo: calvo del todo
  else if (t.color === '#b4b4b4') {
    // Una camisa rota: sin mangas y con el borde de abajo deshilachado.
    const arm = /Arm/.test(t.bone)
    role = arm || t.y < 1.2 + rnd() * 0.06 ? 'Piel' : 'Ropa'
  } else if (t.color === '#9e6238') role = t.y < 0.7 + rnd() * 0.08 ? 'Piel' : 'Ropa2' // taparrabos de pantalón cortado
  // Pintura de guerra (solo se nota en totem): rayas en los antebrazos y bajo los ojos.
  if (role === 'Piel') {
    const forearm = /LowerArm/.test(t.bone) && Math.abs(Math.sin(t.y * 90)) > 0.55
    const cheek = t.bone === 'Head' && t.y > 1.645 && t.y < 1.69 && t.vs[0].POSITION[2] > 0.11
    if (forearm || cheek) role = 'Pintura'
  }
  roles[role].push(t)
}

// ---------- cabeza más grande ----------
const HEAD_GROW = 0.22
const pivot = bind.Head
for (const t of tris) for (const v of t.vs) {
  const w = weightOf(v, joints, 'Head')
  if (!w) continue
  const s = 1 + HEAD_GROW * w
  v.POSITION = v.POSITION.map((x, i) => pivot[i] + (x - pivot[i]) * s)
}

// ---------- ojos más grandes, para que se vean de lejos ----------
for (const comp of new Set(roles.Ojos.map((t) => t.comp))) {
  const vs = tris.filter((t) => t.comp === comp).flatMap((t) => t.vs)
  const c = [0, 1, 2].map((i) => vs.reduce((a, v) => a + v.POSITION[i], 0) / vs.length)
  for (const v of vs) v.POSITION = v.POSITION.map((x, i) => c[i] + (x - c[i]) * (i === 2 ? 1 : 1.45))
}

// ---------- orejas ----------
const skull = Object.values(roles).flat().filter((t) => t.bone === 'Head').flatMap((t) => t.vs.map((v) => v.POSITION))
const earY = 1.7
const band = skull.filter((p) => Math.abs(p[1] - earY) < 0.03)
const halfWidth = Math.max(...band.map((p) => Math.abs(p[0])))
const earZ = (Math.min(...band.map((p) => p[2])) + Math.max(...band.map((p) => p[2]))) / 2 - 0.01
for (const side of [1, -1]) {
  const x0 = side * (halfWidth - 0.012)
  const top = [x0, earY + 0.035, earZ + 0.02]
  const bottom = [x0, earY - 0.04, earZ + 0.025]
  const back = [x0, earY - 0.005, earZ - 0.035]
  const tip = [x0 + side * 0.19, earY + 0.085, earZ - 0.07]
  const mid = [x0 + side * 0.06, earY + 0.01, earZ - 0.005] // un poco de grosor en la base
  for (const [a, b, c] of [[top, bottom, tip], [bottom, back, tip], [back, top, tip], [top, mid, bottom]]) roles.Piel.push(flatTri(a, b, c, J('Head')))
}

// ---------- pinchos del tótem ----------
const spikes = []
for (const side of ['L', 'R']) {
  const arm = tris.flatMap((t) => t.vs).filter((v) => weightOf(v, joints, `UpperArm.${side}`) > 0.6).map((v) => v.POSITION)
  const s = side === 'L' ? 1 : -1
  // El hombro: lo más alto del brazo, cerca del cuerpo.
  const near = arm.filter((p) => Math.abs(p[0]) < Math.abs(bind[`UpperArm.${side}`][0]) + 0.08)
  const top = near.reduce((a, b) => (b[1] > a[1] ? b : a))
  const j = J(`UpperArm.${side}`)
  spikes.push(...spike([top[0], top[1] - 0.01, top[2]], [s * 0.35, 1, 0], 0.13, 0.03, j))
  spikes.push(...spike([top[0] + s * 0.035, top[1] - 0.025, top[2] - 0.035], [s * 0.6, 0.8, -0.35], 0.1, 0.024, j))
  spikes.push(...spike([top[0] + s * 0.035, top[1] - 0.025, top[2] + 0.035], [s * 0.6, 0.8, 0.35], 0.08, 0.02, j))
}
// Espalda: una fila entre los omóplatos, hacia atrás y arriba.
const backZ = Math.min(...tris.filter((t) => t.bone === 'Chest' || t.bone === 'Torso').flatMap((t) => t.vs.map((v) => v.POSITION[2])))
for (const [y, h] of [[1.43, 0.17], [1.34, 0.14], [1.25, 0.11]]) spikes.push(...spike([0, y, backZ + 0.03], [0, 0.6, -1], h, 0.032, J('Chest')))

// ---------- variantes ----------
const LOOKS = {
  base: {
    Piel: { color: '#7d9a45' }, Pintura: { color: '#7d9a45' },
    Ropa: { color: '#6a5034' }, Ropa2: { color: '#4a3826' },
    Ojos: { color: '#ffe066', emissive: '#7a5c00' }, Cejas: { color: '#2f3a18' },
  },
  noche: {
    Piel: { color: '#28302a' }, Pintura: { color: '#28302a' },
    Ropa: { color: '#17151c' }, Ropa2: { color: '#121116' },
    Ojos: { color: '#d4c2ff', emissive: '#b48cff' }, Cejas: { color: '#0c0d0c' },
  },
  totem: {
    Piel: { color: '#56602f' }, Pintura: { color: '#b3261a', emissive: '#3a0802' },
    Ropa: { color: '#3a1610' }, Ropa2: { color: '#2a120c' },
    Ojos: { color: '#ffb36b', emissive: '#ff5a1f' }, Cejas: { color: '#1a0c06' },
  },
}

dropOriginalMesh(doc)
const variantsExt = doc.createExtension(KHRMaterialsVariants)
const variants = Object.fromEntries(Object.keys(LOOKS).map((v) => [v, variantsExt.createVariant(v)]))
const material = (name, look) => doc.createMaterial(name).setDoubleSided(true).setMetallicFactor(0).setRoughnessFactor(0.75)
  .setBaseColorFactor([...lin(look.color), 1]).setEmissiveFactor(look.emissive ? lin(look.emissive) : [0, 0, 0])

const mesh = doc.createMesh('Trasgo')
for (const [role, list] of Object.entries(roles)) {
  if (!list.length) continue
  const mats = Object.fromEntries(Object.entries(LOOKS).map(([v, look]) => [v, material(`${role}_${v}`, look[role])]))
  const prim = primitive(doc, list, mats.base, { colors: false })
  const mapping = variantsExt.createMappingList()
  for (const v of Object.keys(LOOKS)) mapping.addMapping(variantsExt.createMapping().setMaterial(mats[v]).addVariant(variants[v]))
  prim.setExtension('KHR_materials_variants', mapping)
  mesh.addPrimitive(prim)
}
const armature = root.listNodes().find((n) => n.getName() === 'CharacterArmature')
armature.addChild(doc.createNode('Trasgo').setMesh(mesh).setSkin(skin))

const bone = doc.createMaterial('Pinchos').setBaseColorFactor([...lin('#d9ccb0'), 1]).setMetallicFactor(0).setRoughnessFactor(0.7)
armature.addChild(doc.createNode('totem_Pinchos').setMesh(doc.createMesh('totem_Pinchos').addPrimitive(primitive(doc, spikes, bone, { colors: false }))).setSkin(skin))

await io.write(outPath, doc)
console.log(Object.entries(roles).map(([r, l]) => `${r} ${l.length}`).join(' · '), `· pinchos ${spikes.length / 4}`)
