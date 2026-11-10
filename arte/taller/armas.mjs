// Pasa las armas de arte/muestras/armas (hechas con Rollpoly, con una textura pequeña) al juego:
// public/models/weapons.glb, con tres piezas (Hacha, Espada, Espadon). Cada una:
//
// - en dos partes: `Metal` (la hoja o la cabeza, gris: el juego la tiñe del material de su nivel) y `Mango` (lo demás,
//   con su color), con el color de la textura en los vértices (COLOR_0) y sin texturas;
// - con el origen en su agarre (`Socket_Grip`), hacia +Y, del largo de las del juego.
//
// Uso: node armas.mjs [salida]   (por defecto ../../public/models/weapons.glb)
import { statSync } from 'node:fs'
import { Document, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { PNG } from 'pngjs'

const ARMAS = [
  // [archivo, nombre, escala, si se gira media vuelta (la cabeza del hacha, hacia -X como la del juego)]
  ['prop_1ay0k0r.glb', 'Hacha', 0.85, true],
  ['prop_xrqhot.glb', 'Espada', 1, false],
  ['prop_vho72w.glb', 'Espadon', 0.9, false],
]
/** Un color de la textura es metal si es casi gris (en 0–255, lo que va del canal mayor al menor). */
const GRIS = 16
/** El metal se guarda como luz relativa a este gris (lineal): el material de su nivel pone el color. */
const GRIS_MEDIO = 0.4

const salida = process.argv[2] ?? '../../public/models/weapons.glb'
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const lineal = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

const out = new Document()
const buffer = out.createBuffer()
const scene = out.createScene('Armas')
const metal = out.createMaterial('Metal').setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.4).setMetallicFactor(0.25)
const mango = out.createMaterial('Mango').setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.8).setMetallicFactor(0)

for (const [archivo, nombre, escala, girar] of ARMAS) {
  const doc = await io.read(`../muestras/armas/${archivo}`)
  const root = doc.getRoot()
  const png = PNG.sync.read(Buffer.from(root.listTextures()[0].getImage()))
  const grip = root.listNodes().find((n) => n.getName() === 'Socket_Grip')?.getTranslation() ?? [0, 0, 0]
  const prim = root.listMeshes()[0].listPrimitives()[0]
  const P = prim.getAttribute('POSITION')
  const N = prim.getAttribute('NORMAL')
  const UV = prim.getAttribute('TEXCOORD_0')
  const I = prim.getIndices()
  const color = (i) => {
    const uv = UV.getElement(i, [0, 0])
    const x = Math.min(png.width - 1, Math.floor(uv[0] * png.width))
    const y = Math.min(png.height - 1, Math.floor(uv[1] * png.height))
    const k = (y * png.width + x) * 4
    return [png.data[k], png.data[k + 1], png.data[k + 2]]
  }
  const partes = { Metal: { pos: [], nor: [], col: [] }, Mango: { pos: [], nor: [], col: [] } }
  const caras = I ? I.getCount() : P.getCount()
  for (let t = 0; t < caras; t += 3) {
    const vs = [0, 1, 2].map((k) => (I ? I.getScalar(t + k) : t + k))
    const c0 = color(vs[0])
    const esMetal = Math.max(...c0) - Math.min(...c0) <= GRIS
    const parte = partes[esMetal ? 'Metal' : 'Mango']
    for (const v of vs) {
      const [px, py, pz] = P.getElement(v, [0, 0, 0])
      const [nx, ny, nz] = N ? N.getElement(v, [0, 0, 0]) : [0, 1, 0]
      const s = girar ? -1 : 1
      parte.pos.push(s * (px - grip[0]) * escala, (py - grip[1]) * escala, s * (pz - grip[2]) * escala)
      parte.nor.push(s * nx, ny, s * nz)
      const [r, g, b] = color(v).map((c) => lineal(c / 255))
      if (esMetal) {
        const luz = Math.min(1, (0.2126 * r + 0.7152 * g + 0.0722 * b) / GRIS_MEDIO)
        parte.col.push(luz, luz, luz)
      } else parte.col.push(r, g, b)
    }
  }
  const malla = out.createMesh(nombre)
  for (const [clave, parte] of Object.entries(partes)) {
    if (!parte.pos.length) continue
    const acc = (tipo, arr) => out.createAccessor().setType(tipo).setArray(new Float32Array(arr)).setBuffer(buffer)
    malla.addPrimitive(
      out
        .createPrimitive()
        .setMaterial(clave === 'Metal' ? metal : mango)
        .setAttribute('POSITION', acc('VEC3', parte.pos))
        .setAttribute('NORMAL', acc('VEC3', parte.nor))
        .setAttribute('COLOR_0', acc('VEC3', parte.col)),
    )
  }
  scene.addChild(out.createNode(nombre).setMesh(malla))
  const alto = Math.max(...partes.Metal.pos.filter((_, i) => i % 3 === 1), ...partes.Mango.pos.filter((_, i) => i % 3 === 1))
  console.log(`${nombre}: ${caras / 3} triángulos (${partes.Metal.pos.length / 9} de metal), ${alto.toFixed(2)} m sobre el agarre`)
}

await io.write(salida, out)
console.log(`${salida}: ${(statSync(salida).size / 1024).toFixed(0)} KB`)
