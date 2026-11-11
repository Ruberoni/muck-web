// Pasa los modelos aprobados (arte/listas) al juego (public/models/mobs).
//
// Un mob sale a la vez en grupos de veinte o más, así que cada apariencia (base, noche, tótem) se hornea en una malla de
// una o dos piezas: el color de cada material va a los vértices (COLOR_0) y las piezas se juntan en `Cuerpo` (con luz)
// y `Brillo` (sin luz: ojos, brasas, cristales). Los nodos quedan con el nombre `<apariencia>__<pieza>`, y el juego
// enseña los de la suya. Las armas que no van en la piel (colgadas de un hueso) se hornean igual, como hijos de su nodo,
// que es el que animan los clips (la lanza se esconde al lanzarla).
//
// Los modelos con texturas (el Coloso, el trasgo gigante) salen tal cual: hay uno solo a la vez.
//
// Uso: node exportar.mjs [salida]   (por defecto ../../public/models/mobs)
import { mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, KHRMaterialsUnlit } from '@gltf-transform/extensions'
import { prune, quantize } from '@gltf-transform/functions'

const MODELOS = [
  ['trasgo/TrasgoCuchillo.glb', 'Trasgo.glb'],
  ['trasgo/TrasgoLanza.glb', 'TrasgoLanza.glb'],
  ['golem/Golem.glb', 'Golem.glb'],
  ['espiritu/Espiritu.glb', 'Espiritu.glb'],
  ['perro/Perro.glb', 'Perro.glb'],
  ['trasgo-gigante/TrasgoGigante.glb', 'TrasgoGigante.glb'],
  ['lanzarrocas/Lanzarrocas.glb', 'Lanzarrocas.glb'],
  ['guardian/Guardian.glb', 'Guardian.glb'],
  ['coloso/Coloso.glb', 'Coloso.glb'],
]
const APARIENCIAS = ['base', 'noche', 'totem']
/** Clips que el juego no usa en ningún mob (EnemyRig): fuera, para que pesen menos. */
const SOBRAN = new Set(['Run_Back', 'Run_Left', 'Run_Right', 'Interact', 'Eating', 'Gallop_Jump', 'Jump_ToIdle', 'Idle_2_HeadLow', 'Idle_2', 'Idle_HitReact_Right'])

/** La geometría ya juntada de cada lista de piezas: las apariencias la comparten y solo cambia el color. */
const juntadas = new Map()
const ids = new Map()
const idDe = (a) => (ids.has(a) ? ids.get(a) : (ids.set(a, ids.size), ids.size - 1))

const salida = process.argv[2] ?? '../../public/models/mobs'
mkdirSync(salida, { recursive: true })
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)

// La náufraga: el único personaje, con sus cuatro piezas de armadura (el juego enseña las que lleva puestas).
{
  const doc = await io.read('../listas/personaje/Jugador.glb')
  await doc.transform(prune(), quantize())
  const archivo = '../../public/models/skins/Naufraga.glb'
  await io.write(archivo, doc)
  console.log(`Naufraga.glb: ${(statSync(archivo).size / 1024).toFixed(0)} KB`)
}

for (const [desde, hacia] of MODELOS) {
  const doc = await io.read(join('../listas', desde))
  const root = doc.getRoot()
  const texturas = root.listMaterials().some((m) => m.getBaseColorTexture())
  if (!texturas) hornear(doc)
  for (const clip of root.listAnimations()) if (SOBRAN.has(clip.getName())) clip.dispose()
  await doc.transform(prune(), quantize())
  const archivo = join(salida, hacia)
  await io.write(archivo, doc)
  const tris = root.listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + (p.getIndices()?.getCount() ?? 0) / 3, 0), 0)
  const nodos = root.listNodes().filter((n) => n.getMesh()).map((n) => n.getName())
  console.log(`${hacia}: ${(statSync(archivo).size / 1024).toFixed(0)} KB, ${tris} triángulos${texturas ? ' (con texturas, tal cual)' : ''}: ${nodos.join(', ')}`)
}

/** Hornea cada apariencia en una malla de Cuerpo y Brillo con el color en los vértices, y quita las variantes. */
function hornear(doc) {
  const root = doc.getRoot()
  const buffer = root.listBuffers()[0]
  const variantes = root.listExtensionsUsed().find((e) => e.extensionName === 'KHR_materials_variants')
  const nombres = variantes ? variantes.listVariants().map((v) => v.getName()).filter((v) => APARIENCIAS.includes(v)) : ['base']
  const unlit = doc.createExtension(KHRMaterialsUnlit)
  const cuerpo = doc.createMaterial('Cuerpo').setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.85).setMetallicFactor(0)
  const brillo = doc.createMaterial('Brillo').setBaseColorFactor([1, 1, 1, 1]).setExtension('KHR_materials_unlit', unlit.createUnlit())
  const nodos = root.listNodes().filter((n) => n.getMesh())
  const presentes = new Set(nodos.map((n) => n.getName()))
  for (const nodo of nodos) {
    const nombre = nodo.getName()
    const propio = nombre.match(/^(base|noche|totem)_(.+)$/)
    const pieza = propio ? propio[2] : nombre
    // Uno de una apariencia solo es suyo; los demás, de todas las que no tienen el suyo propio.
    const duenos = propio ? [propio[1]] : nombres.filter((v) => !presentes.has(`${v}_${nombre}`))
    const malla = nodo.getMesh()
    for (const v of duenos.filter((d) => nombres.includes(d))) {
      const horneada = doc.createMesh(`${v}__${pieza}`)
      for (const p of hornearMalla(doc, buffer, malla, v, cuerpo, brillo)) horneada.addPrimitive(p)
      const nuevo = doc.createNode(`${v}__${pieza}`).setMesh(horneada)
      if (nodo.getSkin()) {
        nuevo.setSkin(nodo.getSkin()).setTranslation(nodo.getTranslation()).setRotation(nodo.getRotation()).setScale(nodo.getScale())
        const padre = nodo.getParentNode()
        if (padre) padre.addChild(nuevo)
        else for (const escena of root.listScenes()) if (escena.listChildren().includes(nodo)) escena.addChild(nuevo)
      } else {
        // Un arma colgada de un hueso: el nodo que animan los clips se queda, con las horneadas dentro.
        nodo.addChild(nuevo)
      }
    }
    if (nodo.getSkin()) nodo.dispose()
    else nodo.setMesh(null)
  }
  variantes?.dispose()
}

/** El material de una pieza en la apariencia `v`. */
function materialDe(primitiva, v) {
  const mapeo = primitiva.getExtension('KHR_materials_variants')
  const propio = mapeo?.listMappings().find((m) => m.listVariants().some((x) => x.getName() === v))
  return propio?.getMaterial() ?? primitiva.getMaterial()
}

/** Las piezas de `malla` en la apariencia `v`, juntas en una de Cuerpo y otra de Brillo, con su color en los vértices. */
function hornearMalla(doc, buffer, malla, v, cuerpo, brillo) {
  const grupos = { cuerpo: [], brillo: [] }
  for (const p of malla.listPrimitives()) {
    const m = materialDe(p, v)
    const base = m?.getBaseColorFactor() ?? [1, 1, 1, 1]
    const fuerza = m?.getExtension('KHR_materials_emissive_strength')?.getEmissiveStrength() ?? 1
    const emisivo = (m?.getEmissiveFactor() ?? [0, 0, 0]).map((c) => c * fuerza)
    const brilla = emisivo.some((c) => c > 0.02)
    const color = brilla ? emisivo.map((c, i) => Math.min(1, Math.max(c, base[i]))) : base.slice(0, 3)
    grupos[brilla ? 'brillo' : 'cuerpo'].push({ p, color })
  }
  const piezas = []
  for (const [clave, lista] of Object.entries(grupos)) {
    if (!lista.length) continue
    piezas.push(juntar(doc, buffer, lista, clave === 'brillo' ? brillo : cuerpo))
  }
  return piezas
}

/** Junta primitivas en una sola, con el color de cada una (por su color de vértice, si lo tiene) en COLOR_0. */
function juntar(doc, buffer, lista, material) {
  const acc = (tipo, arr) => doc.createAccessor().setType(tipo).setArray(arr).setBuffer(buffer)
  const clave = lista.map(({ p }) => `${idDe(p.getAttribute('POSITION'))}/${idDe(p.getIndices())}`).join(',')
  let geo = juntadas.get(clave)
  if (!geo) {
    geo = geometria(lista, acc)
    juntadas.set(clave, geo)
  }
  const prim = doc.createPrimitive().setMaterial(material).setIndices(geo.ind).setAttribute('POSITION', geo.pos).setAttribute('NORMAL', geo.nor)
  if (geo.jun) prim.setAttribute('JOINTS_0', geo.jun).setAttribute('WEIGHTS_0', geo.pes)
  return prim.setAttribute('COLOR_0', acc('VEC3', colores(lista, geo.total)))
}

/** Lo que no cambia con la apariencia: posiciones, normales, huesos e índices. */
function geometria(lista, acc) {
  const total = lista.reduce((n, { p }) => n + p.getAttribute('POSITION').getCount(), 0)
  const caras = lista.reduce((n, { p }) => n + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()), 0)
  const piel = lista.every(({ p }) => p.getAttribute('JOINTS_0') && p.getAttribute('WEIGHTS_0'))
  const pos = new Float32Array(total * 3)
  const nor = new Float32Array(total * 3)
  const jun = piel ? new Uint16Array(total * 4) : null
  const pes = piel ? new Float32Array(total * 4) : null
  const ind = total > 65535 ? new Uint32Array(caras) : new Uint16Array(caras)
  let base = 0
  let k = 0
  const e3 = [0, 0, 0]
  const e4 = [0, 0, 0, 0]
  for (const { p } of lista) {
    const P = p.getAttribute('POSITION')
    const N = p.getAttribute('NORMAL')
    const J = p.getAttribute('JOINTS_0')
    const W = p.getAttribute('WEIGHTS_0')
    const n = P.getCount()
    for (let i = 0; i < n; i++) {
      pos.set(P.getElement(i, e3), (base + i) * 3)
      if (N) nor.set(N.getElement(i, e3), (base + i) * 3)
      if (piel) {
        jun.set(J.getElement(i, e4), (base + i) * 4)
        pes.set(W.getElement(i, e4), (base + i) * 4)
      }
    }
    const I = p.getIndices()
    if (I) for (let t = 0; t < I.getCount(); t++) ind[k++] = I.getScalar(t) + base
    else for (let t = 0; t < n; t++) ind[k++] = t + base
    base += n
  }
  return {
    total,
    pos: acc('VEC3', pos),
    nor: acc('VEC3', nor),
    ind: acc('SCALAR', ind),
    jun: piel ? acc('VEC4', jun) : null,
    pes: piel ? acc('VEC4', pes) : null,
  }
}

/** El color de cada vértice en esta apariencia: el de su material por su color de vértice, si lo tiene. */
function colores(lista, total) {
  const col = new Float32Array(total * 3)
  const e4 = [0, 0, 0, 0]
  let base = 0
  for (const { p, color } of lista) {
    const C = p.getAttribute('COLOR_0')
    const n = p.getAttribute('POSITION').getCount()
    for (let i = 0; i < n; i++) {
      let [r, g, b] = color
      if (C) {
        C.getElement(i, e4)
        r *= e4[0]
        g *= e4[1]
        b *= e4[2]
      }
      col.set([r, g, b], (base + i) * 3)
    }
    base += n
  }
  return col
}
