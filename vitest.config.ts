import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Test against source directly so `shared` doesn't need a `dist` build for tests to run.
      '@fantasy-focus/shared': new URL('./shared/src/index.ts', import.meta.url).pathname,
    },
  },
  test: {
    environment: 'node',
    include: ['services/*/src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
