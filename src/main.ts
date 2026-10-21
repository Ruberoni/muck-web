import './style.css'
import './ui/hud.css'
import { Game } from './game/Game'

const container = document.querySelector<HTMLDivElement>('#app')!
const game = new Game(container)

// Import dinámico bajo DEV: en producción se elimina y el módulo no entra en el bundle.
if (import.meta.env.DEV) {
  import('./debug').then(({ installDebug }) => installDebug(game))
}

// Multijugador, aún oculto: solo en desarrollo o en un build con VITE_MULTIPLAYER=1 (en producción, desde el PR 14).
// Con `?room=CODIGO` se entra en esa sala; si no se puede, se sigue jugando solo. El lobby llega en el PR 13.
const room = new URLSearchParams(location.search).get('room')
if ((import.meta.env.DEV || import.meta.env.VITE_MULTIPLAYER === '1') && room) {
  import('./net/netSession')
    .then(({ NetSession }) => NetSession.open('join', room.toUpperCase(), 'Jugador'))
    .then((session) => game.setSession(session))
    .catch((error) => console.warn(`No se pudo entrar en la sala ${room}:`, error))
}
