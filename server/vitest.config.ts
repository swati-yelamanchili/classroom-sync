import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/globalSetup.ts'],
    env: { DATABASE_URL: `file:${path.resolve(__dirname, 'test/.tmp/test.db')}` },
    // Integration suites share one SQLite file.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
