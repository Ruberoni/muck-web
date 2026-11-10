// Arma EspirituAnciano.glb, un jefe del bosque, desde el Treant de la comunidad de Gobkit (CC0): con menos
// polígonos, a su altura y sin la copia rota de la malla que trae su escena. Conserva su textura y sus
// animaciones (idle, move, roar, attack).
// node treant.mjs <Treant.glb> <salida.glb> (la primera versión; ahora en muestras/espiritu/pruebas)
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { aLaAltura, reducir } from './lib.mjs'

const [inPath, outPath] = process.argv.slice(2)
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const doc = await io.read(inPath)

// La malla está en la escena dos veces: como hija de `root` y suelta (esa copia se queda sin huesos). Se deja
// una sola, dentro de `root`.
const scene = doc.getRoot().listScenes()[0]
const rootNode = doc.getRoot().listNodes().find((n) => n.getName() === 'root')
for (const node of doc.getRoot().listNodes().filter((n) => n.getMesh())) {
  scene.removeChild(node)
  rootNode.addChild(node)
}

const [before, after] = await reducir(doc, { ratio: Number(process.env.RATIO ?? 0.35), error: 0.05 })
// Mide 5,9 unidades: a 3 m, un jefe que le saca casi el doble al jugador.
aLaAltura(doc, 'EspirituAnciano', 3, 5.92)

await io.write(outPath, doc)
console.log(`espíritu anciano · ${before} → ${after} triángulos`)
