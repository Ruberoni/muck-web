#!/usr/bin/env node
// Convierte los personajes del pack Ultimate Modular Women (Quaternius, CC0) en lo que carga el juego:
//   public/models/skins/<Nombre>.glb   el cuerpo, sin animaciones, en una sola malla con los colores en los vértices
//   public/models/animations.glb       las animaciones que se usan, una vez para todos: comparten esqueleto
// Una malla por personaje son 2 draw calls (con su sombra) en vez de unas 26. Sin dependencias.
// Uso: node scripts/build-models.mjs "<carpeta Individual Characters/glTF del pack>"
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

const OUT = 'public/models'
/** Las que usa `src/view/CharacterRig.ts`. */
const CLIPS = ['Idle', 'Walk', 'Run', 'Run_Back', 'Run_Left', 'Run_Right', 'Sword_Slash', 'Punch_Right', 'Interact', 'HitRecieve', 'Death']
const ARRAY_BUFFER = 34962
const ELEMENT_ARRAY_BUFFER = 34963
const FLOAT = 5126
const SIZES = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }
const COMPONENT_BYTES = { 5121: 1, 5123: 2, 5126: 4 }

const source = process.argv[2]
if (!source) {
  console.error('Uso: node scripts/build-models.mjs "<carpeta con los .gltf>"')
  process.exit(1)
}

/** Lee un `.gltf` con el buffer incrustado. */
function readGltf(path) {
  const gltf = JSON.parse(readFileSync(path, 'utf8'))
  return { gltf, bin: Buffer.from(gltf.buffers[0].uri.split(',')[1], 'base64') }
}

/** Los bytes de un accessor. Los exporta Blender sin intercalar, así que son seguidos. */
function bytesOf({ gltf, bin }, index) {
  const accessor = gltf.accessors[index]
  const view = gltf.bufferViews[accessor.bufferView]
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
  return bin.subarray(start, start + accessor.count * SIZES[accessor.type] * COMPONENT_BYTES[accessor.componentType])
}

/** Lo que se va escribiendo en un `.glb`: accessors, vistas y binario. */
class Writer {
  accessors = []
  bufferViews = []
  parts = []
  length = 0

  add(bytes, { count, type, componentType, target, min, max }) {
    const padding = (4 - (this.length % 4)) % 4
    if (padding) this.parts.push(Buffer.alloc(padding))
    this.length += padding
    this.bufferViews.push({ buffer: 0, byteOffset: this.length, byteLength: bytes.length, ...(target ? { target } : {}) })
    this.parts.push(bytes)
    this.length += bytes.length
    this.accessors.push({ bufferView: this.bufferViews.length - 1, componentType, count, type, ...(min ? { min, max } : {}) })
    return this.accessors.length - 1
  }

  /** Copia un accessor de `file` tal cual. */
  copy(file, index, target) {
    const { componentType, count, type, min, max } = file.gltf.accessors[index]
    return this.add(bytesOf(file, index), { componentType, count, type, target, min, max })
  }

  /** El `.glb` con estos datos. */
  glb(json) {
    const body = Buffer.concat(this.parts)
    const text = Buffer.from(JSON.stringify({ ...json, accessors: this.accessors, bufferViews: this.bufferViews, buffers: [{ byteLength: body.length }] }))
    const jsonChunk = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)])
    const binChunk = Buffer.concat([body, Buffer.alloc((4 - (body.length % 4)) % 4)])
    const header = Buffer.alloc(20)
    header.writeUInt32LE(0x46546c67, 0)
    header.writeUInt32LE(2, 4)
    header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8)
    header.writeUInt32LE(jsonChunk.length, 12)
    header.writeUInt32LE(0x4e4f534a, 16)
    const binHeader = Buffer.alloc(8)
    binHeader.writeUInt32LE(binChunk.length, 0)
    binHeader.writeUInt32LE(0x004e4942, 4)
    return Buffer.concat([header, jsonChunk, binHeader, binChunk])
  }
}

/** Los nodos sin las mallas (la armadura y los huesos), y de cada índice viejo, el nuevo. */
function skeletonNodes(gltf) {
  const kept = gltf.nodes.map((node, index) => ({ node, index })).filter(({ node }) => node.mesh === undefined)
  const remap = new Map(kept.map(({ index }, i) => [index, i]))
  const nodes = kept.map(({ node }) => {
    const { mesh: _mesh, skin: _skin, children, ...rest } = node
    const inside = children?.filter((child) => remap.has(child)).map((child) => remap.get(child))
    return { ...rest, ...(inside?.length ? { children: inside } : {}) }
  })
  return { nodes, remap, root: remap.get(gltf.scenes[0].nodes[0]) }
}

/**
 * Las mallas con piel en una sola: mismo esqueleto, y el color de cada material pasa a los vértices. Los UV sobran: no hay
 * texturas. Las armas de algunos personajes (la espada de Medieval, la pistola de SciFi) van aparte y no entran: en la mano
 * se lleva lo que diga el juego.
 */
function mergedBody(file) {
  const { gltf } = file
  const primitives = gltf.nodes.filter((node) => node.skin !== undefined).flatMap((node) => gltf.meshes[node.mesh].primitives)
  const vertices = primitives.reduce((sum, p) => sum + gltf.accessors[p.attributes.POSITION].count, 0)
  if (vertices > 0xffff) throw new Error('Demasiados vértices para índices de 16 bits')
  const colors = Buffer.alloc(vertices * 12)
  const indices = []
  const attributes = { POSITION: [], NORMAL: [], JOINTS_0: [], WEIGHTS_0: [] }
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  let base = 0
  for (const primitive of primitives) {
    const { count, min: lo, max: hi } = gltf.accessors[primitive.attributes.POSITION]
    for (const name of Object.keys(attributes)) attributes[name].push(bytesOf(file, primitive.attributes[name]))
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], lo[axis])
      max[axis] = Math.max(max[axis], hi[axis])
    }
    const [r, g, b] = gltf.materials[primitive.material].pbrMetallicRoughness.baseColorFactor
    for (let i = 0; i < count; i++) {
      colors.writeFloatLE(r, (base + i) * 12)
      colors.writeFloatLE(g, (base + i) * 12 + 4)
      colors.writeFloatLE(b, (base + i) * 12 + 8)
    }
    const source = bytesOf(file, primitive.indices)
    for (let i = 0; i < source.length; i += 2) indices.push(source.readUInt16LE(i) + base)
    base += count
  }
  const indexBytes = Buffer.alloc(indices.length * 2)
  indices.forEach((value, i) => indexBytes.writeUInt16LE(value, i * 2))
  return { vertices, colors, indices: indexBytes, count: indices.length, attributes, min, max }
}

function skinGlb(file) {
  const { gltf } = file
  const { nodes, remap, root } = skeletonNodes(gltf)
  const body = mergedBody(file)
  const writer = new Writer()
  const count = body.vertices
  const attributes = {
    POSITION: writer.add(Buffer.concat(body.attributes.POSITION), { componentType: FLOAT, count, type: 'VEC3', target: ARRAY_BUFFER, min: body.min, max: body.max }),
    NORMAL: writer.add(Buffer.concat(body.attributes.NORMAL), { componentType: FLOAT, count, type: 'VEC3', target: ARRAY_BUFFER }),
    COLOR_0: writer.add(body.colors, { componentType: FLOAT, count, type: 'VEC3', target: ARRAY_BUFFER }),
    JOINTS_0: writer.add(Buffer.concat(body.attributes.JOINTS_0), { componentType: 5121, count, type: 'VEC4', target: ARRAY_BUFFER }),
    WEIGHTS_0: writer.add(Buffer.concat(body.attributes.WEIGHTS_0), { componentType: FLOAT, count, type: 'VEC4', target: ARRAY_BUFFER }),
  }
  const indices = writer.add(body.indices, { componentType: 5123, count: body.count, type: 'SCALAR', target: ELEMENT_ARRAY_BUFFER })
  const [skin] = gltf.skins
  const inverseBindMatrices = writer.copy(file, skin.inverseBindMatrices)
  const character = nodes.length
  nodes.push({ name: 'Character', mesh: 0, skin: 0 })
  nodes[root].children = [character, ...(nodes[root].children ?? [])]
  return writer.glb({
    asset: { version: '2.0', generator: 'muck-web scripts/build-models.mjs' },
    scene: 0,
    scenes: [{ nodes: [root] }],
    nodes,
    meshes: [{ name: 'Character', primitives: [{ attributes, indices, material: 0 }] }],
    materials: [{ name: 'Character', doubleSided: true, pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 0.6 } }],
    skins: [{ name: skin.name, inverseBindMatrices, joints: skin.joints.map((joint) => remap.get(joint)) }],
  })
}

function animationsGlb(file) {
  const { gltf } = file
  const { nodes, remap, root } = skeletonNodes(gltf)
  const writer = new Writer()
  const seen = new Map()
  const accessor = (index) => {
    if (!seen.has(index)) seen.set(index, writer.copy(file, index))
    return seen.get(index)
  }
  const animations = CLIPS.map((name) => {
    const clip = gltf.animations.find((a) => a.name === name)
    if (!clip) throw new Error(`Falta la animación ${name}`)
    return {
      name,
      channels: clip.channels.map(({ sampler, target }) => ({ sampler, target: { ...target, node: remap.get(target.node) } })),
      samplers: clip.samplers.map(({ input, output, interpolation }) => ({ input: accessor(input), output: accessor(output), interpolation })),
    }
  })
  return writer.glb({ asset: { version: '2.0', generator: 'muck-web scripts/build-models.mjs' }, scene: 0, scenes: [{ nodes: [root] }], nodes, animations })
}

mkdirSync(join(OUT, 'skins'), { recursive: true })
const names = readdirSync(source).filter((name) => name.endsWith('.gltf')).sort()
if (!names.length) throw new Error(`No hay .gltf en ${source}`)
const files = names.map((name) => ({ name: basename(name, '.gltf'), ...readGltf(join(source, name)) }))
const bones = (file) => file.gltf.skins[0].joints.map((joint) => file.gltf.nodes[joint].name).join()
if (new Set(files.map(bones)).size !== 1) throw new Error('Los personajes no comparten esqueleto')
for (const file of files) {
  const glb = skinGlb(file)
  writeFileSync(join(OUT, 'skins', `${file.name}.glb`), glb)
  console.log(`${file.name}.glb`, (glb.length / 1024).toFixed(0), 'KB')
}
const animations = animationsGlb(files[0])
writeFileSync(join(OUT, 'animations.glb'), animations)
console.log('animations.glb', (animations.length / 1024).toFixed(0), 'KB')
