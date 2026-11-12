import { defineConfig, devices } from '@playwright/test';

// Browser acceptance tests (T12). They run against a real production build served
// by the real Node server, using a separate throwaway DATA_DIR so the demo
// workspace in `data/` is never touched.
const PORT = Number(process.env.E2E_PORT || 3210);

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node server/index.js',
    url: `http://127.0.0.1:${PORT}/api/v1/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      PORT: String(PORT),
      DATA_DIR: 'data/e2e',
      DB_FILE: 'data/e2e/leadpulse.db',
      ALLOW_DEMO: 'true',
      PUBLIC_BASE_URL: `http://127.0.0.1:${PORT}`,
    },
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: 'test-results/.auth/demo.json' },
      dependencies: ['setup'],
    },
  ],
});
