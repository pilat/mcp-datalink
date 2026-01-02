import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Unit tests should run fast without external dependencies
    include: ['src/**/*.test.ts'],
    exclude: ['src/__integration__/**', 'node_modules/**'],
  },
});
