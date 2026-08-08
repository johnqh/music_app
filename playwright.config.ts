import { defineConfig, devices } from '@playwright/test';

const BASE_URL = 'http://localhost:5039';
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
  /**
   * Two workers, not the default four.
   *
   * Every spec now drives real server-side generation jobs against a single
   * music_api process and one database. At four workers the contention pushed
   * jobs past their waits and the suite failed a different handful of tests
   * each run — the classic shape of a load problem, not a defect.
   */
  workers: 2,
  /**
   * 30s (Playwright's default) is no longer realistic: generation is a real
   * server-side job here, deliberately slowed so its transient states can be
   * observed, and the acceptance spec runs a whole session end to end.
   */
  timeout: 90_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  /**
   * AI_TEST_DELAY_MS gives region-replacement jobs a wide window, so the
   * states the job model exists for — the locked editor, the projects-list
   * badge, cancelling mid-flight — are observable rather than raced. It
   * applies to replacement only: whole-score generation is on nearly every
   * spec's critical path, and delaying that taxes the whole suite. Without it a job
   * completes in microseconds and every state the job model exists for — the
   * locked editor, the projects-list badge, cancelling mid-flight — is gone
   * before a test can see it, making those assertions inherently racy.
   */
  webServer: [
    {
      command:
        'DATABASE_URL=postgres://localhost:5432/music_test PORT=8023 AI_TEST_MODE=1 AI_TEST_DELAY_MS=8000 TEST_AUTH_BYPASS_TOKEN=e2e-token AI_DAILY_LIMIT=10000 bun --cwd ../music_api src/index.ts',
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
