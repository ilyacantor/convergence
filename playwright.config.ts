import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  // Serial execution: tests create engagements that other tests rely on;
  // parallel runs produce inter-test interference (duplicate engagements,
  // cache-stale active-engagement picks). Keep workers at 1 for determinism.
  workers: 1,
  // Global setup promotes a fixture engagement so reports-suite tests see
  // the data shape they need (IT assets, customer_service, etc.). Values
  // come from REPORTS_FIXTURE_ACQUIRER / _TARGET env vars in .env.development.
  globalSetup: require.resolve('./e2e/global-setup.ts'),
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3010',
    headless: true,
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
