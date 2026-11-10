// Monta una malla suelta (sin esqueleto) sobre el esqueleto del jugador con sus propias proporciones, le adapta las
// animaciones del jugador y la escribe con sus apariencias (KHR_materials_variants). Lo usan chimpance.mjs y goblin.mjs.
//
// Quien llama da la malla en metros (pies en el suelo, mirando a +z), sus caras con un papel cada una (Piel, Ropa…),
// los puntos de cada lado (L y R: hombro Sh, codo E, muñeca W, centro de la mano F, cadera H, rodilla K, tobillo en el
// suelo A y punta del pie Toe), el cuello N, el centro de la cadera HC, la altura de la coronilla `top`, qué huesos
// pueden mover cada vértice (`candidates(i)`) y qué vértices son la cabeza.
import { KHRMaterialsVariants } from '@gltf-transform/extensions'
import { lin } from './lib.mjs'
import { add, apply3, cross, len, lerp, mul, norm, restPose, rotFromTo, scaledPositions, scaleSkeleton, segDist, sub, invert4 } from './rig.mjs'

export async function montar({ io, doc, skinDoc, verts, faces, L, R, N, HC, top, candidates, headIds, head = null, looks, defaults = {}, muscle = true, name = 'Trasgo', label = name, outPath, legScale = 1 }) {
  // ---------- el esqueleto con sus proporciones ----------
  const rest = restPose(skinDoc)
  const lenOf = (a, b) => len(sub(rest.pos[b], rest.pos[a]))
  const k = {}
  const kLeg = (L.H[1] / rest.pos['UpperLeg.L'][1]) * legScale // `legScale`: piernas más largas que las del modelo
  for (const n of ['Body', 'Hips', 'UpperLeg.L', 'UpperLeg.R', 'LowerLeg.L', 'LowerLeg.R', 'Foot.L', 'Foot.R', 'PT.L', 'PT.R']) k[n] = kLeg
  const hips1 = scaledPositions(rest, k).Hips
  const kSpine = (N[1] - hips1[1]) / (rest.pos.Neck[1] - rest.pos.Hips[1])
  for (const n of ['Abdomen', 'Torso', 'Chest', 'Neck', 'Head']) k[n] = kSpine
  const kShoulder = Math.abs(L.Sh[0]) / rest.pos['UpperArm.L'][0]
  const kUpper = len(sub(L.E, L.Sh)) / lenOf('UpperArm.L', 'LowerArm.L')
  const kFore = len(sub(L.W, L.E)) / lenOf('LowerArm.L', 'Wrist.L')
  const kHand = len(sub(L.F, L.W)) / lenOf('Wrist.L', 'Middle1.L')
  for (const s of ['L', 'R']) {
    k[`Shoulder.${s}`] = k[`UpperArm.${s}`] = kShoulder
    k[`LowerArm.${s}`] = kUpper
    k[`Wrist.${s}`] = kFore
    for (const n of rest.names) if (/^(Index|Middle|Ring|Pinky|Thumb)\d/.test(n) && n.endsWith(s)) k[n] = kHand
  }
  const pos = scaledPositions(rest, k)

  // El chimpancé, movido en z para que sus hombros caigan donde los del esqueleto.
  const dz = (pos['UpperArm.L'][2] + pos['UpperArm.R'][2]) / 2 - (L.Sh[2] + R.Sh[2]) / 2
  const shift = (p) => [p[0], p[1], p[2] + dz]
  verts = verts.map(shift)
  for (const o of [L, R]) for (const key in o) o[key] = shift(o[key])
  N = shift(N); HC = shift(HC)

  // ---------- pesos (en la pose del chimpancé, brazos abajo) ----------
  const P_ = (t) => lerp(HC, N, t)
  const headTop = [0, top, N[2]]
  const SEG = {
    Hips: [HC, P_(0.2)], Abdomen: [P_(0.2), P_(0.45)], Torso: [P_(0.45), P_(0.7)], Chest: [P_(0.7), N],
    Neck: [N, add(N, [0, 0.05, 0])], Head: [add(N, [0, 0.05, 0]), headTop],
  }
  for (const [s, o] of [['L', L], ['R', R]]) Object.assign(SEG, {
    [`Shoulder.${s}`]: [[o.Sh[0] * 0.35, o.Sh[1], o.Sh[2]], o.Sh], [`UpperArm.${s}`]: [o.Sh, o.E], [`LowerArm.${s}`]: [o.E, o.W], [`Wrist.${s}`]: [o.W, o.F],
    [`UpperLeg.${s}`]: [o.H, o.K], [`LowerLeg.${s}`]: [o.K, o.A], [`Foot.${s}`]: [o.A, o.Toe],
  })
  const weights = verts.map((p, i) => {
    const ranked = candidates(i).map((b) => ({ b, w: 1 / (segDist(p, ...SEG[b]).d + 0.015) ** 4 })).sort((a, b) => b.w - a.w).slice(0, 2)
    const total = ranked.reduce((a, r) => a + r.w, 0)
    return ranked.map((r) => ({ b: r.b, w: r.w / total }))
  })

  // ---------- a la pose del esqueleto (brazos en cruz) ----------
  /** Lleva el segmento c0–c1 del chimpancé al t0–t1 del esqueleto: gira, estira y mueve. */
  function segmentMap(c0, c1, t0, t1) {
    const Rm = rotFromTo(sub(c1, c0), sub(t1, t0))
    const sc = len(sub(t1, t0)) / len(sub(c1, c0))
    return (v) => add(t0, mul(apply3(Rm, sub(v, c0)), sc))
  }
  const moveBy = (d) => (v) => add(v, d)
  const T = {}
  for (const [s, o] of [['L', L], ['R', R]]) {
    const ua = pos[`UpperArm.${s}`], la = pos[`LowerArm.${s}`], wr = pos[`Wrist.${s}`]
    const handEnd = add(wr, mul(norm(sub(wr, la)), len(sub(o.F, o.W))))
    T[`UpperArm.${s}`] = segmentMap(o.Sh, o.E, ua, la)
    T[`LowerArm.${s}`] = segmentMap(o.E, o.W, la, wr)
    T[`Wrist.${s}`] = segmentMap(o.W, o.F, wr, handEnd)
    T[`Shoulder.${s}`] = moveBy(sub(ua, o.Sh))
    T[`UpperLeg.${s}`] = segmentMap(o.H, o.K, pos[`UpperLeg.${s}`], pos[`LowerLeg.${s}`])
    T[`LowerLeg.${s}`] = segmentMap(o.K, o.A, pos[`LowerLeg.${s}`], pos[`Foot.${s}`])
    T[`Foot.${s}`] = moveBy(sub(pos[`Foot.${s}`], o.A))
  }
  const dChest = mul(add(sub(pos['UpperArm.L'], L.Sh), sub(pos['UpperArm.R'], R.Sh)), 0.5)
  const dHips = [0, pos['UpperLeg.L'][1] - L.H[1], 0]
  T.Hips = moveBy(dHips)
  T.Abdomen = moveBy(lerp(dHips, dChest, 0.33))
  T.Torso = moveBy(lerp(dHips, dChest, 0.66))
  T.Chest = moveBy(dChest)
  T.Neck = T.Head = moveBy(dChest)
  const posed = verts.map((v, i) => weights[i].reduce((a, { b, w }) => add(a, mul(T[b](v), w)), [0, 0, 0]))

  // ---------- cabeza (opcional: la puede cambiar quien llama) ----------
  const headCenter = mul(headIds.reduce((a, i) => add(a, posed[i]), [0, 0, 0]), 1 / headIds.length)
  const extra = head ? await head({ io, posed, faces, headIds: new Set(headIds), center: headCenter, neck: add(N, dChest), pos, J: (b) => rest.names.indexOf(b) }) : []

  // ---------- escribir ----------
  const root = doc.getRoot()
  const buffer = root.listBuffers()[0] ?? doc.createBuffer()
  const byName = Object.fromEntries(root.listNodes().map((n) => [n.getName(), n]))
  const skin = doc.createSkin(name)
  for (const n of rest.names) skin.addJoint(byName[n])
  const ibm = new Float32Array(rest.names.length * 16)
  rest.names.forEach((n, i) => {
    const m = [...rest.world[n]]
    m[12] = pos[n][0]; m[13] = pos[n][1]; m[14] = pos[n][2]
    ibm.set(invert4(m), i * 16)
  })
  skin.setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(ibm).setBuffer(buffer))
  const J = (b) => rest.names.indexOf(b)

  /** Triángulos sueltos (cada uno sus vértices) con normales planas, pesos y un papel. */
  const tris = faces.filter((f) => !f.drop).map((f) => ({ role: f.role, pts: f.ids.map((i) => posed[i]), ws: f.ids.map((i) => weights[i]) }))
  tris.push(...extra)

  // ---------- tótem: el mismo cuerpo, más musculoso ----------
  /** Cuánto se ensancha la malla alrededor de cada hueso (1: nada). */
  const MUSCLE = muscle === true ? {
    'Shoulder.L': 1.3, 'Shoulder.R': 1.3, 'UpperArm.L': 1.32, 'UpperArm.R': 1.32, 'LowerArm.L': 1.22, 'LowerArm.R': 1.22,
    'Wrist.L': 1.12, 'Wrist.R': 1.12, Chest: 1.18, Torso: 1.1, Neck: 1.25, 'UpperLeg.L': 1.15, 'UpperLeg.R': 1.15, 'LowerLeg.L': 1.1, 'LowerLeg.R': 1.1,
  } : (muscle || {})
  const AXIS = {
    'Shoulder.L': ['Shoulder.L', 'UpperArm.L'], 'Shoulder.R': ['Shoulder.R', 'UpperArm.R'],
    'UpperArm.L': ['UpperArm.L', 'LowerArm.L'], 'UpperArm.R': ['UpperArm.R', 'LowerArm.R'],
    'LowerArm.L': ['LowerArm.L', 'Wrist.L'], 'LowerArm.R': ['LowerArm.R', 'Wrist.R'],
    'Wrist.L': ['Wrist.L', 'Middle1.L'], 'Wrist.R': ['Wrist.R', 'Middle1.R'],
    Chest: ['Chest', 'Neck'], Torso: ['Torso', 'Chest'], Neck: ['Neck', 'Head'],
    'UpperLeg.L': ['UpperLeg.L', 'LowerLeg.L'], 'UpperLeg.R': ['UpperLeg.R', 'LowerLeg.R'],
    'LowerLeg.L': ['LowerLeg.L', 'Foot.L'], 'LowerLeg.R': ['LowerLeg.R', 'Foot.R'],
  }
  /** Cada vértice se aleja del eje de sus huesos, mezclado según los pesos: sin grietas entre partes. */
  const muscled = posed.map((p, i) => weights[i].reduce((acc, { b, w }) => {
    const f = MUSCLE[b] ?? 1
    if (f === 1 || !AXIS[b]) return add(acc, mul(p, w))
    const [a0, a1] = AXIS[b].map((n) => pos[n])
    const c = lerp(a0, a1, segDist(p, a0, a1).t)
    return add(acc, mul(add(c, mul(sub(p, c), f)), w))
  }, [0, 0, 0]))
  const strongTris = faces.filter((f) => !f.drop).map((f) => ({ role: f.role, pts: f.ids.map((i) => muscled[i]), ws: f.ids.map((i) => weights[i]) }))
  strongTris.push(...extra)

  // ---------- apariencias ----------
  const LOOKS = looks
  const FIRST = Object.values(LOOKS)[0]
  const lookOf = (look, role) => look[role] ?? FIRST[role] ?? defaults[role] ?? { color: '#ff00ff' }
  const variantsExt = doc.createExtension(KHRMaterialsVariants)
  const variants = Object.fromEntries(Object.keys(LOOKS).map((v) => [v, variantsExt.createVariant(v)]))

  function buildMesh(name, list0) {
    const mesh = doc.createMesh(name)
    for (const role of [...new Set(list0.map((t) => t.role))]) {
      const list = list0.filter((t) => t.role === role)
      const n = list.length * 3
      const P3 = new Float32Array(n * 3), N3 = new Float32Array(n * 3), J4 = new Uint8Array(n * 4), W4 = new Float32Array(n * 4)
      list.forEach((t, ti) => {
        const nrm = norm(cross(sub(t.pts[1], t.pts[0]), sub(t.pts[2], t.pts[0])))
        t.pts.forEach((p, k2) => {
          const o = ti * 3 + k2
          P3.set(p, o * 3); N3.set(nrm, o * 3)
          t.ws[k2].forEach(({ b, w }, slot) => { J4[o * 4 + slot] = J(b); W4[o * 4 + slot] = w })
        })
      })
      const acc = (type, a) => doc.createAccessor().setType(type).setArray(a).setBuffer(buffer)
      const material = (mname, look) => doc.createMaterial(mname).setDoubleSided(true).setMetallicFactor(look.metalness ?? 0).setRoughnessFactor(look.roughness ?? 0.85)
        .setBaseColorFactor([...lin(look.color), 1]).setEmissiveFactor(look.emissive ? lin(look.emissive) : [0, 0, 0])
      const prim = doc.createPrimitive().setAttribute('POSITION', acc('VEC3', P3)).setAttribute('NORMAL', acc('VEC3', N3))
        .setAttribute('JOINTS_0', acc('VEC4', J4)).setAttribute('WEIGHTS_0', acc('VEC4', W4))
        .setMaterial(material(role, lookOf(FIRST, role)))
      const mapping = variantsExt.createMappingList()
      for (const [v, look] of Object.entries(LOOKS)) mapping.addMapping(variantsExt.createMapping().setMaterial(material(`${role}_${v}`, lookOf(look, role))).addVariant(variants[v]))
      prim.setExtension('KHR_materials_variants', mapping)
      mesh.addPrimitive(prim)
    }
    return mesh
  }
  const armature = root.listScenes()[0].listChildren()[0]
  armature.addChild(doc.createNode(name).setMesh(buildMesh(name, tris)).setSkin(skin))
  // `totem_<nombre>` reemplaza al cuerpo normal en la apariencia totem.
  if (LOOKS.totem && muscle) armature.addChild(doc.createNode(`totem_${name}`).setMesh(buildMesh(`totem_${name}`, strongTris)).setSkin(skin))

  scaleSkeleton(doc, k)
  await io.write(outPath, doc)
  const f2 = (v) => v.toFixed(2)
  console.log(`${label} · ${tris.length} triángulos · piernas ×${f2(kLeg)} columna ×${f2(kSpine)} hombros ×${f2(kShoulder)} brazo ×${f2(kUpper)} antebrazo ×${f2(kFore)} mano ×${f2(kHand)}`)
}
