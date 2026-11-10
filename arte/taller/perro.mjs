// Arma Perro.glb desde el lobo de Quaternius: a su tamaño, sin animaciones repetidas, y con tres apariencias
// (variantes de material KHR_materials_variants): base, noche (Noche Eterna) y totem (tótem activado).
// El del tótem es 1,2 veces más grande (`extras.escala` de la escena: lo aplica el juego).
// node perro.mjs <Wolf.glb> <salida.glb>
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, KHRMaterialsVariants } from '@gltf-transform/extensions'

const [inPath, outPath] = process.argv.slice(2)
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const doc = await io.read(inPath)
const root = doc.getRoot()

// ---------- limpieza y tamaño ----------
// Las animaciones vienen dos veces (con y sin "AnimalArmature|"): se quedan las cortas.
for (const a of root.listAnimations()) if (a.getName().includes('|')) {
  for (const c of a.listChannels()) c.dispose()
  for (const s of a.listSamplers()) { s.getInput()?.dispose(); s.getOutput()?.dispose(); s.dispose() }
  a.dispose()
}
// Sin quitar más: los accesores sueltos se borran al final.
for (const acc of root.listAccessors()) if (!acc.listParents().some((p) => p.propertyType !== 'Root')) acc.dispose()

/** Alto hasta la cruz (los hombros), en metros: un perro grande, por debajo de la cadera del jugador. */
const WITHERS = 0.7
const ROOT_SCALE = WITHERS / (0.0198 * 100) // la cruz del lobo está a 0,0198 (×100 de su armadura)
const top = root.listScenes()[0].listChildren()[0]
top.setName('Perro').setScale([ROOT_SCALE, ROOT_SCALE, ROOT_SCALE])

// ---------- colores ----------
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const lin = (hex) => [1, 3, 5].map((i) => toLin(parseInt(hex.slice(i, i + 2), 16) / 255))
const mats = Object.fromEntries(root.listMaterials().map((m) => [m.getName(), m]))

/** Cada variante: color de cada material y, si brilla, su brillo. */
const BASE = {
  Main: { color: '#7b5233' },
  Main_Light: { color: '#c9a77c' },
  Eyes_Black: { color: '#140c08' },
  Nose: { color: '#1c1512' },
}
const NOCHE = {
  Main: { color: '#141318' },
  Main_Light: { color: '#2e2b38' },
  Eyes_Black: { color: '#d4c2ff', emissive: '#b48cff' },
  Nose: { color: '#0b0a0d' },
}
/** Opciones para el tótem (TOTEM=oro|fuego|blanco; con OPCIONES=1 salen las tres juntas para elegir). */
const TOTEMS = {
  // Lobo de oro: pelaje dorado y vientre que brilla.
  oro: {
    Main: { color: '#c48a2c', metalness: 0.35, roughness: 0.45 },
    Main_Light: { color: '#ffe08a', emissive: '#a86a10' },
    Eyes_Black: { color: '#ffe08a', emissive: '#ffae2a' },
    Nose: { color: '#2a1808' },
  },
  // Lobo de brasa: pelaje oscuro con el vientre encendido.
  fuego: {
    Main: { color: '#3a2620' },
    Main_Light: { color: '#ff8a2f', emissive: '#e0540f' },
    Eyes_Black: { color: '#ffd27a', emissive: '#ff6a1f' },
    Nose: { color: '#140806' },
  },
  // Lobo blanco ancestral: pelaje claro y vientre de oro que brilla.
  blanco: {
    Main: { color: '#ece4d4' },
    Main_Light: { color: '#ffd27a', emissive: '#c07a10' },
    Eyes_Black: { color: '#ffd27a', emissive: '#ff9a1a' },
    Nose: { color: '#2a2018' },
  },
}
const LOOKS = process.env.OPCIONES
  ? { base: BASE, ...Object.fromEntries(Object.entries(TOTEMS).map(([k, v]) => [`totem${k[0].toUpperCase()}${k.slice(1)}`, v])) }
  : { base: BASE, noche: NOCHE, totem: TOTEMS[process.env.TOTEM ?? 'oro'] }
/** Las variantes del tótem, más grandes. */
const BIG = Object.keys(LOOKS).filter((v) => v.startsWith('totem'))
const TOTEM_SIZE = 1.2

const variantsExt = doc.createExtension(KHRMaterialsVariants)
const variants = Object.fromEntries(Object.keys(LOOKS).map((v) => [v, variantsExt.createVariant(v)]))

function makeMaterial(base, name, look) {
  const m = base.clone().setName(name).setMetallicFactor(look.metalness ?? 0).setRoughnessFactor(look.roughness ?? 0.8)
  m.setBaseColorFactor([...lin(look.color), 1])
  m.setEmissiveFactor(look.emissive ? lin(look.emissive) : [0, 0, 0])
  return m
}

const built = {} // built[variante][material]
for (const [v, look] of Object.entries(LOOKS)) {
  built[v] = {}
  for (const [name, l] of Object.entries(look)) if (mats[name]) built[v][name] = makeMaterial(mats[name], `${name}_${v}`, l)
}

// La base va como material por defecto; cada primitiva sabe qué material usar en cada variante.
for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) {
  const name = prim.getMaterial().getName()
  prim.setMaterial(built.base[name])
  const mapping = variantsExt.createMappingList()
  for (const v of Object.keys(LOOKS)) mapping.addMapping(variantsExt.createMapping().setMaterial(built[v][name]).addVariant(variants[v]))
  prim.setExtension('KHR_materials_variants', mapping)
}
for (const m of Object.values(mats)) m.dispose()

// El del tótem es más grande: lo escala el juego al elegir esa variante.
root.listScenes()[0].setExtras({ escala: Object.fromEntries(BIG.map((v) => [v, TOTEM_SIZE])) })
for (const m of root.listMaterials()) if (!m.listParents().some((p) => p.propertyType !== 'Root')) m.dispose()
await io.write(outPath, doc)
console.log('animaciones:', root.listAnimations().map((a) => a.getName()).join(', '))
console.log('escala', ROOT_SCALE.toFixed(4), '· tótem', process.env.OPCIONES ? 'opciones' : (process.env.TOTEM ?? 'oro'))
