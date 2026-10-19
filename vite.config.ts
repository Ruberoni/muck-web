import { defineConfig } from 'vite'

export default defineConfig({
  // Rutas relativas: funciona en GitHub Pages (/muck-web/), con otro nombre de repo o con dominio propio.
  base: './',
  build: {
    chunkSizeWarningLimit: 800,
    rolldownOptions: {
      output: {
        codeSplitting: { groups: [{ name: 'three', test: /node_modules[\\/]three/ }] },
      },
    },
  },
})
