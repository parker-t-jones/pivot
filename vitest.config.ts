import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Test against source directly so workspace packages don't need a `dist` build for tests to run.
      // Before `@pivot/shared`: a string alias also matches `@pivot/shared/<subpath>` as a prefix.
      '@pivot/shared/broadcast': new URL('./shared/src/broadcast/index.ts', import.meta.url)
        .pathname,
      '@pivot/shared': new URL('./shared/src/index.ts', import.meta.url).pathname,
      '@pivot/engine': new URL('./services/engine/src/index.ts', import.meta.url).pathname,
      '@pivot/dispatcher': new URL('./services/dispatcher/src/index.ts', import.meta.url).pathname,
      '@pivot/ingestion': new URL('./services/ingestion/src/index.ts', import.meta.url).pathname,
    },
  },
  test: {
    environment: 'node',
    include: [
      'shared/src/**/*.test.ts',
      'services/*/src/**/*.test.ts',
      'app/**/*.test.ts',
      'scripts/**/*.test.ts',
    ],
  },
});
