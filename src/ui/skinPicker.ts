import * as THREE from 'three'
import { isSkin, SKINS } from '../net/skins'
import type { CharacterRig } from '../view/CharacterRig'
import type { LoadCharacter } from '../view/characters'

const SKIN_KEY = 'muck-web:skin'
const AUTOMATIC = 'auto'
const PREVIEW_WIDTH = 120
const PREVIEW_HEIGHT = 170
/** Radianes por segundo que gira en la vista previa. */
const PREVIEW_TURN = 0.7

function loadSkin(): number | undefined {
  try {
    const saved = Number(localStorage.getItem(SKIN_KEY) ?? NaN)
    return isSkin(saved) ? saved : undefined
  } catch {
    return undefined
  }
}

function saveSkin(skin: number | undefined) {
  try {
    if (skin === undefined) localStorage.removeItem(SKIN_KEY)
    else localStorage.setItem(SKIN_KEY, String(skin))
  } catch {
    // Sin almacenamiento: se elegirá otra vez la próxima vez.
  }
}

/** Una escena pequeña con el personaje elegido, que solo se dibuja mientras se ve. */
function skinPreview(canvas: HTMLCanvasElement, load: LoadCharacter) {
  let renderer: THREE.WebGLRenderer | null = null
  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight('#d6ecff', '#5d7a3a', 1.6))
  const sun = new THREE.DirectionalLight('#fff4dd', 2)
  sun.position.set(2, 4, -3)
  scene.add(sun)
  const camera = new THREE.PerspectiveCamera(32, PREVIEW_WIDTH / PREVIEW_HEIGHT, 0.1, 20)
  camera.position.set(0, 1, -4)
  camera.lookAt(0, 0.95, 0)
  let rig: CharacterRig | null = null
  let wanted: number | null = null
  let last = 0

  const frame = (time: number) => {
    requestAnimationFrame(frame)
    const dt = Math.min((time - last) / 1000, 0.1)
    last = time
    // `offsetParent`: oculto (en partida o sin elegir ninguna), no gasta nada.
    if (!rig || !renderer || !canvas.offsetParent) return
    rig.object.rotation.y += PREVIEW_TURN * dt
    rig.update(dt, 0, 0, 0, true)
    renderer.render(scene, camera)
  }

  return (skin: number | undefined) => {
    canvas.hidden = skin === undefined
    wanted = skin ?? null
    if (skin === undefined) return
    if (!renderer) {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.setSize(PREVIEW_WIDTH, PREVIEW_HEIGHT, false)
      requestAnimationFrame(frame)
    }
    load(skin).then(
      (next) => {
        if (wanted !== skin) return
        if (rig) scene.remove(rig.object)
        rig = next
        scene.add(rig.object)
      },
      () => (canvas.hidden = true),
    )
  }
}

/** Elegir personaje: se guarda en el navegador y se manda al entrar en una sala. Sin elegir, toca uno según el número. */
export function skinField(parent: HTMLElement, load: LoadCharacter) {
  const canvas = document.createElement('canvas')
  canvas.className = 'skin-preview'
  canvas.width = PREVIEW_WIDTH
  canvas.height = PREVIEW_HEIGHT
  const show = skinPreview(canvas, load)

  // Con una sola skin no hay nada que elegir: se enseña el personaje y basta, sin un desplegable que la repite.
  if (SKINS.length < 2) {
    parent.appendChild(canvas)
    show(0)
    return { value: () => 0 }
  }

  const row = document.createElement('label')
  row.className = 'field'
  row.append('Tu personaje (te ven tus amigos)')
  const select = document.createElement('select')
  select.add(new Option('Automático', AUTOMATIC))
  SKINS.forEach(({ name }, i) => select.add(new Option(name, String(i))))
  row.appendChild(select)
  parent.appendChild(row)
  parent.appendChild(canvas)

  const value = () => (select.value === AUTOMATIC ? undefined : Number(select.value))
  select.value = String(loadSkin() ?? AUTOMATIC)
  show(value())
  select.addEventListener('change', () => {
    saveSkin(value())
    show(value())
  })
  return { value }
}
