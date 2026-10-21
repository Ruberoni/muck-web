/// <reference types="vite/client" />

declare global {
  interface ImportMetaEnv {
    /** `wss://…` del Worker de multijugador, sin ruta (la variable `SERVER_URL` del repo en el build de CI). */
    readonly VITE_SERVER_URL?: string
    /** "1": el multijugador está activo en este build (en desarrollo siempre). */
    readonly VITE_MULTIPLAYER?: string
  }

  interface Window {
    __debug?: import('./debug').DebugApi
  }
}

export {}
