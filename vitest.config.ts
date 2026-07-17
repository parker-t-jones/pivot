import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Test against source directly so workspace packages don't need a `dist` build for tests to run.
      '@fantasy-focus/shared': new URL('./shared/src/index.ts', import.meta.url).pathname,
      '@fantasy-focus/engine': new URL('./services/engine/src/index.ts', import.meta.url).pathname,
      '@fantasy-focus/dispatcher': new URL('./services/dispatcher/src/index.ts', import.meta.url)
        .pathname,
    },
  },
  test: {
    environment: 'node',
    include: ['services/*/src/**/*.test.ts', 'app/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
