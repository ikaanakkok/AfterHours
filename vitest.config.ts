import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 45000,
    hookTimeout: 60000,
    fileParallelism: false,
    maxWorkers: 1,
  },
});
