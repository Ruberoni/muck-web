/// <reference types="vite/client" />

declare global {
  interface Window {
    __debug?: { worldHash: string }
  }
}

export {}
