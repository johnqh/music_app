import { defineConfig, devices } from '@playwright/test';

const BASE_URL = 'http://localhost:5173';
const API_URL = 'http://localhost:8023';

/**
 * The e2e stack: the Vite dev server (VITE_E2E=1 auth shim pointed at the
 * e2e API) plus music_api in test mode (AI_TEST_MODE fixture transport,
 * bypass-token auth, the local music_test database). globalSetup truncates
 * the test DB so every run starts clean.
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command:
        'DATABASE_URL=postgres://localhost:5432/music_test PORT=8023 AI_TEST_MODE=1 TEST_AUTH_BYPASS_TOKEN=e2e-token AI_DAILY_LIMIT=10000 bun --cwd ../music_api src/index.ts',
      url: `${API_URL}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: `VITE_E2E=1 VITE_E2E_TOKEN=e2e-token VITE_API_URL=${API_URL} bun run dev`,
      url: BASE_URL,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
