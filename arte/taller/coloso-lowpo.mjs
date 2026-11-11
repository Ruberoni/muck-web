// Arma el Coloso de Cristal con el gólem de hierro de LOWPO Golem Pack (Standout 7, versión gratis) TAL CUAL: su malla y
// su esqueleto. Lo que cambia: su paleta de colores pasa a cristal (el cuerpo celeste, las placas y los ojos blancos que
// brillan) y trae las animaciones del Coloso de antes (las del jugador y las de sus ataques especiales, `ataques.mjs`),
// pasadas a su esqueleto con `retarget.mjs`. Mide 2,8 m.
// node coloso-lowpo.mjs <Iron_Golem.glb> <coloso sobre el esqueleto del jugador, con animaciones.glb> <salida.glb>
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { PNG } from 'pngjs'
import { bindPositions } from './lib.mjs'
import { retarget } from './retarget.mjs'

const [golemPath, srcPath, outPath] = process.argv.slice(2)
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const [doc, src] = await Promise.all([golemPath, srcPath].map((p) => io.read(p)))
const root = doc.getRoot()

// ---------- de hierro a cristal: cada color de su paleta, por otro (y lo que brilla) ----------
/** [color del gólem, color nuevo, brillo] */
const SWAP = [
  [[68, 68, 68], [104, 160, 214], [0, 0, 0]], // piedra oscura
  [[85, 85, 85], [150, 206, 242], [0, 0, 0]], // cuerpo
  [[102, 102, 102], [196, 232, 252], [0, 0, 0]], // partes claras
  [[185, 116, 56], [226, 250, 255], [70, 180, 255]], // placas: cristal que brilla
  [[249, 156, 71], [226, 250, 255], [70, 180, 255]],
  [[246, 142, 43], [226, 250, 255], [70, 180, 255]],
  [[246, 215, 39], [255, 255, 255], [190, 240, 255]], // ojos
]
const mat = root.listMaterials()[0]
const tex = mat.getBaseColorTexture()
const png = PNG.sync.read(Buffer.from(tex.getImage()))
const glow = new PNG({ width: png.width, height: png.height })
for (let i = 0; i < png.data.length; i += 4) {
  const c = [png.data[i], png.data[i + 1], png.data[i + 2]]
  const hit = SWAP.find(([from]) => Math.hypot(from[0] - c[0], from[1] - c[1], from[2] - c[2]) < 24)
  if (hit) png.data.set(hit[1], i)
  glow.data.set(hit ? hit[2] : [0, 0, 0], i)
  glow.data[i + 3] = 255
}
tex.setImage(new Uint8Array(PNG.sync.write(png))).setURI('Coloso_paleta.png')
mat.setName('Cristal').setEmissiveTexture(doc.createTexture('Coloso_brillo').setImage(new Uint8Array(PNG.sync.write(glow))).setMimeType('image/png').setURI('Coloso_brillo.png'))
  .setEmissiveFactor([1, 1, 1]).setMetallicFactor(0.1).setRoughnessFactor(0.35)
// La textura es una paleta: sin mezclar colores vecinos.
for (const info of [mat.getBaseColorTextureInfo(), mat.getEmissiveTextureInfo()]) info.setMagFilter(9728).setMinFilter(9728)

// ---------- animaciones: las del Coloso de antes, en su esqueleto ----------
const MAP = { spine: 'Hips', 'spine.001': 'Abdomen', 'spine.002': 'Torso', 'spine.003': 'Chest', 'spine.004': 'Neck', 'spine.006': 'Head' }
for (const S of ['L', 'R']) Object.assign(MAP, {
  [`shoulder.${S}`]: `Shoulder.${S}`, [`upper_arm.${S}`]: `UpperArm.${S}`, [`forearm.${S}`]: `LowerArm.${S}`, [`hand.${S}`]: `Wrist.${S}`,
  [`thigh.${S}`]: `UpperLeg.${S}`, [`shin.${S}`]: `LowerLeg.${S}`, [`foot.${S}`]: `Foot.${S}`,
})
retarget({ doc, src, MAP, pelvis: 'spine' })

// ---------- a su altura ----------
const top = Math.max(...Object.values(bindPositions(root.listSkins()[0])).map((p) => p[1])) + 0.25 // la coronilla, sobre el último hueso
const armature = root.listScenes()[0].listChildren()[0]
armature.setName('Coloso').setScale(Array(3).fill(2.8 / top))
await io.write(outPath, doc)
console.log(`coloso (LOWPO hierro → cristal) · ${root.listAnimations().map((a) => a.getName()).join(', ')} · ×${(2.8 / top).toFixed(2)}`)
