import { defineConfig } from '@playwright/test'

const port = Number(process.env.PLAYWRIGHT_TEST_PORT ?? 41737)
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('Invalid PLAYWRIGHT_TEST_PORT')
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  use: { baseURL, browserName: 'chromium' },
  webServer: {
    command: `node ./node_modules/vite/bin/vite.js --host 0.0.0.0 --port ${port} --strictPort`,
    url: baseURL,
  },
})
