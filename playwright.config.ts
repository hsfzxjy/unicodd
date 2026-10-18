import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  outputDir: 'test-results',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173/unicodd/',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command:
      'npm run build -- --base /unicodd/ && npm run preview -- --host 127.0.0.1 --port 4173 --base /unicodd/',
    url: 'http://127.0.0.1:4173/unicodd/',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
