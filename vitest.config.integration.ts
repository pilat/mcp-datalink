import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/__integration__/**/*.integration.test.ts'],
    globalSetup: './src/__integration__/global-setup.ts',
    globalTeardown: './src/__integration__/global-teardown.ts',
    testTimeout: 30000,
    hookTimeout: 120000,
    // Run tests sequentially to avoid DB deadlocks
    fileParallelism: false,
    sequence: {
      shuffle: false,
    },
  },
});
