import './style.css'
import './ui/hud.css'
import { Game } from './game/Game'

const container = document.querySelector<HTMLDivElement>('#app')!
const game = new Game(container)

// Import dinámico bajo DEV: en producción se elimina y el módulo no entra en el bundle.
if (import.meta.env.DEV) {
  import('./debug').then(({ installDebug }) => installDebug(game))
}

// Multijugador: en desarrollo y en los builds con VITE_MULTIPLAYER=1 (el de GitHub Pages lo lleva, ver deploy.yml).
// El lobby (con `?room=CODIGO` en la URL, "Unirse a CODIGO") va en un import dinámico: sin la bandera, el build
// no incluye nada de red.
if (import.meta.env.DEV || import.meta.env.VITE_MULTIPLAYER === '1') {
  import('./ui/lobby').then(({ installLobby }) => installLobby(game))
}
