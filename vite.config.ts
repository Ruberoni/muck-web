/// <reference types="vitest/config" />
import { configDefaults } from 'vitest/config'
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
  test: {
    // Los de la Durable Object (arrancan workerd) y la medida de CPU van aparte, con `npm run test:server`.
    exclude: [...configDefaults.exclude, 'server/**/*.workerd.test.ts', 'server/**/*.perf.test.ts'],
  },
})
