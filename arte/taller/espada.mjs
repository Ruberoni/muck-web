// Le pone al Guardián del meteorito su espadón: hoja de obsidiana con un alma de brasa que brilla, guarda del color
// del meteorito y empuñadura de cuero. Va en la mano derecha (nodo `Espada`, hijo de `Middle1.R`), en el agarre que usa
// el juego para las espadas (src/view/CharacterRig.ts): la hoja va por +Z.
// node espada.mjs <Guardian.glb> (se reescribe)
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { lin } from './lib.mjs'
import { qaxis, qmul } from './anim.mjs'

const [path] = process.argv.slice(2)
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const doc = await io.read(path)
const root = doc.getRoot()
const buffer = root.listBuffers()[0]

const GRIP_ROTATION = [0.497, -0.503, -0.503, 0.496]
// Girada un cuarto de vuelta sobre su largo: la cara ancha de la hoja mira al costado, no al cielo.
const ROTATION = qmul(GRIP_ROTATION, qaxis([0, 0, 1], 90))

/** Un prisma de `n` lados a lo largo de Z (de z0 a z1), con medias anchuras (ancho en Y, grueso en X) abajo y arriba. */
function prism(list, z0, z1, w0, t0, w1, t1, n = 4) {
  const ring = (z, w, t) => [...Array(n).keys()].map((i) => { const a = (i / n) * 2 * Math.PI; return [Math.sin(a) * t, Math.cos(a) * w, z] })
  const A = ring(z0, w0, t0), B = ring(z1, w1, t1)
  const tri = (a, b, c) => list.push([a, b, c])
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    if (w1 || t1) { tri(A[i], B[i], B[j]); tri(A[i], B[j], A[j]) } else tri(A[i], [0, 0, z1], A[j])
  }
  for (let i = 1; i < n - 1; i++) tri(A[0], A[i + 1], A[i])
  if (w1 || t1) for (let i = 1; i < n - 1; i++) tri(B[0], B[i], B[i + 1])
}

const parts = { Obsidiana: [], Brasa: [], Guarda: [], Cuero: [] }
// Hoja: ancha, con un bisel hacia la punta, y el alma de brasa que asoma por las dos caras.
prism(parts.Obsidiana, 0.08, 1.3, 0.15, 0.035, 0.12, 0.03)
prism(parts.Obsidiana, 1.3, 1.65, 0.12, 0.03, 0, 0)
prism(parts.Brasa, 0.1, 1.45, 0.03, 0.04, 0.016, 0.036)
// Guarda en cruz, con los extremos hacia la hoja, y un rubí de meteorito en el medio.
prism(parts.Guarda, 0.02, 0.09, 0.3, 0.055, 0.3, 0.055)
prism(parts.Guarda, 0.09, 0.17, 0.05, 0.052, 0.035, 0.05, 6)
prism(parts.Brasa, 0.035, 0.075, 0.045, 0.06, 0.045, 0.06, 6)
// Empuñadura de cuero y pomo.
prism(parts.Cuero, -0.3, 0.02, 0.03, 0.03, 0.03, 0.03, 6)
prism(parts.Guarda, -0.38, -0.3, 0.05, 0.05, 0.04, 0.04, 6)

const LOOK = {
  Obsidiana: { color: '#1b1820', metalness: 0.4, roughness: 0.3 },
  Brasa: { color: '#ffb36b', emissive: '#ff5a1f' },
  Guarda: { color: '#c9763a', metalness: 0.6, roughness: 0.4, emissive: '#3a1204' },
  Cuero: { color: '#3a2a20' },
}
const mesh = doc.createMesh('Espada')
for (const [role, tris] of Object.entries(parts)) {
  const P = new Float32Array(tris.length * 9), N = new Float32Array(tris.length * 9)
  tris.forEach(([a, b, c], i) => {
    const u = b.map((x, k) => x - a[k]), v = c.map((x, k) => x - a[k])
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    const l = Math.hypot(...n) || 1
    n = n.map((x) => x / l)
    ;[a, b, c].forEach((p, k) => { P.set(p, i * 9 + k * 3); N.set(n, i * 9 + k * 3) })
  })
  const l = LOOK[role]
  const mat = doc.createMaterial(role).setBaseColorFactor([...lin(l.color), 1]).setMetallicFactor(l.metalness ?? 0).setRoughnessFactor(l.roughness ?? 0.7)
    .setEmissiveFactor(l.emissive ? lin(l.emissive) : [0, 0, 0])
  mesh.addPrimitive(doc.createPrimitive().setMaterial(mat)
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(P).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(N).setBuffer(buffer)))
}
const hand = root.listNodes().find((n) => n.getName() === 'Middle1.R')
for (const old of hand.listChildren().filter((n) => n.getName() === 'Espada')) old.dispose()
hand.addChild(doc.createNode('Espada').setRotation(ROTATION).setTranslation([0, 0.02, 0]).setMesh(mesh))
await io.write(path, doc)
console.log('espada: ' + Object.entries(parts).map(([r, t]) => `${r} ${t.length}`).join(' · '))
