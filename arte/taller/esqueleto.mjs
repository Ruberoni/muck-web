// Armar un modelo nuevo sobre el esqueleto del jugador (animations.glb trae los huesos y las animaciones; la skin
// Casual, la pose de reposo), con sus propias proporciones (`k`, ver rig.mjs) y sus apariencias como variantes de
// material. Lo usan golem.mjs y espiritu.mjs.
import { KHRMaterialsVariants } from '@gltf-transform/extensions'
import { lin, primitive } from './lib.mjs'
import { invert4, restPose, scaledPositions, scaleSkeleton } from './rig.mjs'

/**
 * Devuelve el documento (con el esqueleto y las animaciones), la posición de reposo de cada hueso ya con sus
 * proporciones (`pos`), `J(hueso)` para los pesos, `buildMesh(nombre, {papel: triángulos})` y `add(nodo, malla)`.
 * `finish()` adapta las animaciones a las proporciones: llamarlo después de agregar animaciones nuevas.
 */
export async function nuevoCuerpo({ io, skinPath, animPath, k = {}, looks, name }) {
  const rest = restPose(await io.read(skinPath))
  const pos = scaledPositions(rest, k)
  const doc = await io.read(animPath)
  const root = doc.getRoot()
  const byName = Object.fromEntries(root.listNodes().map((n) => [n.getName(), n]))
  const skin = doc.createSkin(name)
  for (const n of rest.names) skin.addJoint(byName[n])
  const ibm = new Float32Array(rest.names.length * 16)
  rest.names.forEach((n, i) => {
    const m = [...rest.world[n]]
    m[12] = pos[n][0]; m[13] = pos[n][1]; m[14] = pos[n][2]
    ibm.set(invert4(m), i * 16)
  })
  skin.setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(ibm).setBuffer(root.listBuffers()[0]))
  const J = (b) => { const i = rest.names.indexOf(b); if (i < 0) throw new Error(`no hay hueso ${b}`); return i }

  const variantsExt = doc.createExtension(KHRMaterialsVariants)
  const variants = Object.fromEntries(Object.keys(looks).map((v) => [v, variantsExt.createVariant(v)]))
  const mats = new Map()
  const material = (role, v) => {
    const key = `${role}_${v}`
    if (!mats.has(key)) {
      const look = looks[v][role] ?? looks.base[role]
      mats.set(key, doc.createMaterial(key).setDoubleSided(look.doubleSided ?? false).setMetallicFactor(look.metalness ?? 0).setRoughnessFactor(look.roughness ?? 0.85)
        .setBaseColorFactor([...lin(look.color), 1]).setEmissiveFactor(look.emissive ? lin(look.emissive) : [0, 0, 0]))
    }
    return mats.get(key)
  }
  function buildMesh(meshName, byRole) {
    const mesh = doc.createMesh(meshName)
    for (const [role, list] of Object.entries(byRole)) {
      if (!list.length) continue
      const prim = primitive(doc, list, material(role, 'base'), { colors: false })
      const mapping = variantsExt.createMappingList()
      for (const v of Object.keys(looks)) mapping.addMapping(variantsExt.createMapping().setMaterial(material(role, v)).addVariant(variants[v]))
      prim.setExtension('KHR_materials_variants', mapping)
      mesh.addPrimitive(prim)
    }
    return mesh
  }
  const armature = root.listScenes()[0].listChildren()[0]
  const add = (nodeName, mesh) => { const n = doc.createNode(nodeName).setMesh(mesh).setSkin(skin); armature.addChild(n); return n }
  return { doc, root, byName, skin, rest, pos, J, buildMesh, add, armature, finish: () => scaleSkeleton(doc, k) }
}

/** Agrupa triángulos por papel: { papel: [triángulos] }. */
export const byRole = (list) => list.reduce((acc, t) => ((acc[t.role] ??= []).push(t), acc), {})
