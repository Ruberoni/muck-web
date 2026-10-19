/// <reference types="vite/client" />

declare global {
  interface Window {
    __debug?: import('./debug').DebugApi
  }
}

export {}
