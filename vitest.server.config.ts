import { defineConfig } from 'vitest/config'

/**
 * `npm run test:server`: humo de server/cf.ts en workerd (con el test harness de wrangler) y la medida de CPU de la sala.
 * Fuera de `npm test` porque arrancan workerd o tardan unos segundos.
 */
export default defineConfig({
  test: {
    include: ['server/**/*.workerd.test.ts', 'server/**/*.perf.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
})
