import './style.css'
import './ui/hud.css'
import { Game } from './game/Game'

const container = document.querySelector<HTMLDivElement>('#app')!
const game = new Game(container)

// Import dinámico bajo DEV: en producción se elimina y el módulo no entra en el bundle.
if (import.meta.env.DEV) {
  import('./debug').then(({ installDebug }) => installDebug(game))
}
