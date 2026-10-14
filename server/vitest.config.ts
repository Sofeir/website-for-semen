import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Все тесты работают с одной тестовой базой — гоняем последовательно.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    env: { NODE_ENV: 'test' },
  },
});
