// Arma Golem.glb, el gólem básico, desde el Mountain Man de la comunidad de Gobkit (CC0): con menos polígonos,
// a su altura y con tres apariencias que tiñen sus materiales (cuerpo, panza, cabeza, placas, púas, garras, ojos).
// Trae sus propias animaciones: idle, move y attack.
// node golem-montana.mjs <Mountain Man.glb> <salida.glb> (la primera versión, ahora en muestras/golem/pruebas)
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { aLaAltura, reducir, variantesPorMaterial } from './lib.mjs'

const [inPath, outPath] = process.argv.slice(2)
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const doc = await io.read(inPath)

const [before, after] = await reducir(doc, { ratio: Number(process.env.RATIO ?? 0.25), error: Number(process.env.ERROR ?? 0.08) })

// Mide 6,5 unidades: a 2,2 m, algo más alto que el jugador (el juego lo escala igual).
aLaAltura(doc, 'Golem', 2.2, 6.53)

const STONE = (body, belly, plate) => ({ body: { color: body }, head: { color: body }, belly: { color: belly }, plate: { color: plate } })
await variantesPorMaterial(doc, {
  base: {},
  noche: { ...STONE('#3a3442', '#2a2530', '#4a4256'), spike: { color: '#5a3a8a', emissive: '#4a1f8a' }, claw: { color: '#2a2530' }, eye: { color: '#d4c2ff', emissive: '#b48cff' } },
  totem: { ...STONE('#6a4a3a', '#7a3a24', '#5a3a2e'), spike: { color: '#ff7a2f', emissive: '#e0480f' }, claw: { color: '#3a2018' }, eye: { color: '#ffb36b', emissive: '#ff5a1f' } },
})

await io.write(outPath, doc)
console.log(`gólem básico · ${before} → ${after} triángulos`)
