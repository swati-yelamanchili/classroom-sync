import path from 'node:path';
import { defineConfig } from '@playwright/test';

const PORT = 4173;
const TMP = path.resolve(__dirname, 'e2e/.tmp');
const DATABASE_URL = `file:${path.join(TMP, 'e2e.db')}`;

export const E2E_PASSCODE = 'e2e-passcode';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 8_000 },
  // One server and database, shared; specs create their own lessons but read shared library state.
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Uses the Chrome already installed. Set PLAYWRIGHT_CHANNEL="" after `npx playwright install chromium` to use the bundled one.
    channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: [
      `mkdir -p ${TMP}`,
      `rm -f ${path.join(TMP, 'e2e.db')} ${path.join(TMP, 'e2e.db-journal')}`,
      'npm run build',
      'cd server',
      'npx prisma migrate deploy',
      'npx tsx prisma/seed.ts',
      'node dist/index.js',
    ].join(' && '),
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL,
      PORT: String(PORT),
      TEACHER_PASSCODE: E2E_PASSCODE,
      AUTH_SECRET: 'e2e-secret',
      RATE_LIMIT_API: '100000',
      RATE_LIMIT_LOGIN: '1000',
      RATE_LIMIT_STUDENT: '100000',
    },
  },
});
