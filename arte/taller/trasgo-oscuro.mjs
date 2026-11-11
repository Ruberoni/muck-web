// Arma Trasgo.glb sobre el cuerpo de la skin Casual (el esqueleto del jugador), al estilo del goblin de la imagen
// del Animated Monster Pack de Quaternius: calvo, orejas largas hacia arriba, nariz grande, chaleco abierto sobre
// una camisa, cinturón, pantalón largo y botas. Cuerpo de hombre (pecho plano, caderas estrechas, brazos más
// gruesos) y piernas más cortas: el esqueleto cambia, así que trae dentro las animaciones del jugador adaptadas.
// Tres apariencias como variantes de material: base, noche y totem; en totem el cuerpo es más musculoso
// (`totem_Trasgo` reemplaza a `Trasgo`).
// node trasgo-oscuro.mjs <Casual.glb> <animations.glb> <salida.glb>
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, KHRMaterialsVariants } from '@gltf-transform/extensions'
import { bindPositions, flatTri, lin, primitive, triangles, weightOf } from './lib.mjs'
import { invert4, restPose, scaledPositions, scaleSkeleton } from './rig.mjs'

const [skinPath, animPath, outPath] = process.argv.slice(2)
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const [src, doc] = await Promise.all([skinPath, animPath].map((p) => io.read(p)))
const bind = bindPositions(src.getRoot().listSkins()[0])
const { tris, joints } = triangles(src)
const J = (name) => joints.indexOf(name)
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

// ---------- qué es cada triángulo ----------
const isUpper = (t) => t.part.size > 2000
const isLegs = (t) => t.part.size > 500 && t.part.maxY < 1.2 && t.part.minY < 0.4
const isHair = (t) => !isUpper(t) && !isLegs(t) && t.color === '#8b7547'
const centerOf = (t) => [0, 1, 2].map((k) => (t.vs[0].POSITION[k] + t.vs[1].POSITION[k] + t.vs[2].POSITION[k]) / 3)

const roles = { Piel: [], Chaleco: [], Camisa: [], Cinturon: [], Pantalon: [], Botas: [], Ojos: [], Cejas: [] }
for (const t of tris) {
  if (isHair(t)) continue // calvo
  const c = centerOf(t)
  let role = 'Piel'
  if (t.color === '#31251c') role = 'Ojos'
  else if (t.color === '#3e3429') role = 'Cejas'
  else if (t.color === '#b4b4b4') {
    // La camiseta: sin mangas; por delante, una franja abierta (la camisa); el resto, chaleco.
    if (/Arm/.test(t.bone)) role = 'Piel'
    else role = c[2] > 0.05 && Math.abs(c[0]) < 0.075 ? 'Camisa' : 'Chaleco'
  } else if (t.color === '#9e6238') role = t.y > 0.99 ? 'Cinturon' : t.y < 0.3 ? 'Botas' : 'Pantalon'
  else if (t.color === '#3f3f3f') role = 'Botas'
  else if (isLegs(t) && t.y < 0.35) role = 'Botas' // los tobillos, dentro de la caña
  roles[role].push(t) // el resto (piel y el borde del pelo) queda como Piel
}

// ---------- cabeza algo más grande ----------
const HEAD_GROW = 0.14
for (const t of tris) for (const v of t.vs) {
  const w = weightOf(v, joints, 'Head')
  if (w) v.POSITION = v.POSITION.map((x, i) => bind.Head[i] + (x - bind.Head[i]) * (1 + HEAD_GROW * w))
}

// ---------- orejas largas hacia arriba y atrás, y nariz ----------
const skull = Object.values(roles).flat().filter((t) => t.bone === 'Head').flatMap((t) => t.vs.map((v) => v.POSITION))
const earY = 1.71
const band = skull.filter((p) => Math.abs(p[1] - earY) < 0.03)
const halfWidth = Math.max(...band.map((p) => Math.abs(p[0])))
const earZ = (Math.min(...band.map((p) => p[2])) + Math.max(...band.map((p) => p[2]))) / 2 - 0.015
for (const side of [1, -1]) {
  const x0 = side * (halfWidth - 0.012)
  const top = [x0, earY + 0.05, earZ + 0.035]
  const bottom = [x0, earY - 0.06, earZ + 0.03]
  const back = [x0, earY - 0.01, earZ - 0.05]
  const tip = [x0 + side * 0.11, earY + 0.21, earZ - 0.08]
  const mid = [x0 + side * 0.05, earY + 0.03, earZ - 0.01]
  for (const [a, b, c] of [[top, bottom, tip], [bottom, back, tip], [back, top, tip], [top, mid, bottom]]) roles.Piel.push(flatTri(a, b, c, J('Head')))
}
const faceZ = Math.max(...skull.filter((p) => Math.abs(p[0]) < 0.02 && Math.abs(p[1] - 1.66) < 0.03).map((p) => p[2]))
const noseTip = [0, 1.64, faceZ + 0.06]
const ring = [[-0.024, 1.685], [0.024, 1.685], [0.018, 1.635], [-0.018, 1.635]].map(([x, y]) => [x, y, faceZ - 0.015])
for (let k = 0; k < 4; k++) roles.Piel.push(flatTri(ring[k], ring[(k + 1) % 4], noseTip, J('Head')))

const allVerts = () => Object.values(roles).flat().flatMap((t) => t.vs)

// ---------- cuerpo de hombre ----------
// Pecho plano entre 1.27 y 1.45 de alto; caderas estrechas (hasta un 12 % menos) y menos glúteo de 0.8 a 1.12.
for (const v of allVerts()) {
  if (weightOf(v, joints, 'Head') > 0.5) continue
  const [x, y, z] = v.POSITION
  const chest = smooth(1.25, 1.31, y) * (1 - smooth(1.42, 1.47, y)) * (1 - smooth(0.13, 0.17, Math.abs(x)))
  // Por delante, todo el pecho va casi a un mismo plano (sin busto ni pliegue debajo).
  let nz = z > 0.11 ? z + (0.152 - z) * 0.85 * chest : z
  const hips = smooth(0.75, 0.88, y) * (1 - smooth(1.06, 1.15, y))
  // Por detrás, menos glúteo.
  if (nz < 0.02) nz = 0.02 + (nz - 0.02) * (1 - 0.45 * hips)
  v.POSITION = [x * (1 - 0.12 * hips), y, nz]
}

// ---------- piernas más cortas: el esqueleto nuevo ----------
const LEGS = Number(process.env.PIERNAS ?? 0.8)
const rest = restPose(src)
const k = {}
for (const n of ['Body', 'Hips', 'UpperLeg.L', 'UpperLeg.R', 'LowerLeg.L', 'LowerLeg.R', 'Foot.L', 'Foot.R', 'PT.L', 'PT.R']) k[n] = LEGS
const pos = scaledPositions(rest, k)
const LEG_BONE = /^(UpperLeg|LowerLeg|Foot)\./
const drop = pos.Hips.map((x, i) => x - rest.pos.Hips[i])
/** Cada hueso de la pierna se acorta en alto (no en grosor); lo de arriba de la cadera baja entero. */
function shorten(v) {
  const out = [0, 0, 0]
  let total = 0
  for (let s = 0; s < 4; s++) {
    const w = v.WEIGHTS_0[s]
    if (!w) continue
    const b = joints[v.JOINTS_0[s]], p = v.POSITION
    const q = LEG_BONE.test(b)
      ? [pos[b][0] + p[0] - rest.pos[b][0], pos[b][1] + (p[1] - rest.pos[b][1]) * LEGS, pos[b][2] + p[2] - rest.pos[b][2]]
      : p.map((x, i) => x + drop[i])
    for (let i = 0; i < 3; i++) out[i] += q[i] * w
    total += w
  }
  return out.map((x) => x / total)
}
for (const v of allVerts()) v.POSITION = shorten(v)

// ---------- músculo: algo en la base (brazos y cuello de hombre), mucho en el totem ----------
const CHILD = {
  'Shoulder.L': 'UpperArm.L', 'Shoulder.R': 'UpperArm.R', 'UpperArm.L': 'LowerArm.L', 'UpperArm.R': 'LowerArm.R',
  'LowerArm.L': 'Wrist.L', 'LowerArm.R': 'Wrist.R', 'Wrist.L': 'Middle1.L', 'Wrist.R': 'Middle1.R',
  Chest: 'Neck', Torso: 'Chest', Neck: 'Head', 'UpperLeg.L': 'LowerLeg.L', 'UpperLeg.R': 'LowerLeg.R', 'LowerLeg.L': 'Foot.L', 'LowerLeg.R': 'Foot.R',
}
const both = (o) => Object.fromEntries(Object.entries(o).flatMap(([b, f]) => (b.includes('*') ? [[b.replace('*', 'L'), f], [b.replace('*', 'R'), f]] : [[b, f]])))
const MUSCLE_BASE = both({ 'Shoulder.*': 1.12, 'UpperArm.*': 1.14, 'LowerArm.*': 1.1, Neck: 1.15, Chest: 1.04 })
const MUSCLE_TOTEM = both({ 'Shoulder.*': 1.3, 'UpperArm.*': 1.3, 'LowerArm.*': 1.2, 'Wrist.*': 1.12, Chest: 1.14, Torso: 1.08, Neck: 1.2, 'UpperLeg.*': 1.14, 'LowerLeg.*': 1.1 })
/** Aleja el vértice del eje de cada hueso que lo mueve, en la proporción de su peso: sin grietas. */
function muscled(v, table) {
  const p = v.POSITION, out = [0, 0, 0]
  let total = 0
  for (let s = 0; s < 4; s++) {
    const w = v.WEIGHTS_0[s]
    if (!w) continue
    const b = joints[v.JOINTS_0[s]], f = table[b] ?? 1
    let q = p
    if (f !== 1 && CHILD[b]) {
      const a0 = pos[b], ab = pos[CHILD[b]].map((x, i) => x - a0[i]), ap = p.map((x, i) => x - a0[i])
      const t = Math.max(0, Math.min(1, (ab[0] * ap[0] + ab[1] * ap[1] + ab[2] * ap[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2)))
      const c = a0.map((x, i) => x + ab[i] * t)
      q = c.map((x, i) => x + (p[i] - x) * f)
    }
    for (let i = 0; i < 3; i++) out[i] += q[i] * w
    total += w
  }
  return out.map((x) => x / total)
}
const withMuscle = (table) => Object.fromEntries(Object.entries(roles).map(([role, list]) => [role, list.map((t) => ({
  vs: t.vs.map((v) => ({ ...v, POSITION: muscled(v, table) })),
}))]))
const body = withMuscle(MUSCLE_BASE)
const strong = withMuscle(both({ ...MUSCLE_TOTEM }))

// ---------- apariencias ----------
const LOOKS = {
  // La base: piel verde muy oscura, ropa casi negra y ojos violeta.
  base: {
    Piel: { color: '#2b3326' }, Chaleco: { color: '#1e1a1c' }, Camisa: { color: '#141318' }, Cinturon: { color: '#0e0c0e' },
    Pantalon: { color: '#111014' }, Botas: { color: '#17131a' }, Ojos: { color: '#d4c2ff', emissive: '#b48cff' }, Cejas: { color: '#0a0a0c' },
  },
  // La Noche Eterna: más negro todavía, con la piel brillando apenas en violeta y los ojos encendidos.
  noche: {
    Piel: { color: '#14161d', emissive: '#170b26' }, Chaleco: { color: '#0b0a0d' }, Camisa: { color: '#08080a' }, Cinturon: { color: '#060508' },
    Pantalon: { color: '#08070a' }, Botas: { color: '#0a090c' }, Ojos: { color: '#f1e6ff', emissive: '#d9b8ff' }, Cejas: { color: '#050506' },
  },
  // El tótem: más musculoso, chaleco rojo y ojos de brasa.
  totem: {
    Piel: { color: '#3a4126' }, Chaleco: { color: '#6b2414' }, Camisa: { color: '#2a120c' }, Cinturon: { color: '#2a1408' },
    Pantalon: { color: '#2b1c16' }, Botas: { color: '#3a1e12' }, Ojos: { color: '#ffb36b', emissive: '#ff5a1f' }, Cejas: { color: '#120a06' },
  },
}

// ---------- escribir (sobre animations.glb: esqueleto + animaciones) ----------
const root = doc.getRoot()
const byName = Object.fromEntries(root.listNodes().map((n) => [n.getName(), n]))
const skin = doc.createSkin('Trasgo')
for (const n of rest.names) skin.addJoint(byName[n])
const ibm = new Float32Array(rest.names.length * 16)
rest.names.forEach((n, i) => {
  const m = [...rest.world[n]]
  m[12] = pos[n][0]; m[13] = pos[n][1]; m[14] = pos[n][2]
  ibm.set(invert4(m), i * 16)
})
skin.setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(ibm).setBuffer(root.listBuffers()[0]))

const variantsExt = doc.createExtension(KHRMaterialsVariants)
const variants = Object.fromEntries(Object.keys(LOOKS).map((v) => [v, variantsExt.createVariant(v)]))
const material = (name, look) => doc.createMaterial(name).setDoubleSided(true).setMetallicFactor(0).setRoughnessFactor(0.8)
  .setBaseColorFactor([...lin(look.color), 1]).setEmissiveFactor(look.emissive ? lin(look.emissive) : [0, 0, 0])
function buildMesh(name, byRole) {
  const mesh = doc.createMesh(name)
  for (const [role, list] of Object.entries(byRole)) {
    if (!list.length) continue
    const mats = Object.fromEntries(Object.entries(LOOKS).map(([v, look]) => [v, material(`${role}_${v}`, look[role])]))
    const prim = primitive(doc, list, mats.base, { colors: false })
    const mapping = variantsExt.createMappingList()
    for (const v of Object.keys(LOOKS)) mapping.addMapping(variantsExt.createMapping().setMaterial(mats[v]).addVariant(variants[v]))
    prim.setExtension('KHR_materials_variants', mapping)
    mesh.addPrimitive(prim)
  }
  return mesh
}
const armature = root.listScenes()[0].listChildren()[0]
armature.addChild(doc.createNode('Trasgo').setMesh(buildMesh('Trasgo', body)).setSkin(skin))
armature.addChild(doc.createNode('totem_Trasgo').setMesh(buildMesh('totem_Trasgo', strong)).setSkin(skin))
scaleSkeleton(doc, k)

await io.write(outPath, doc)
console.log(`piernas ×${LEGS} · ` + Object.entries(roles).map(([r, l]) => `${r} ${l.length}`).join(' · '))
