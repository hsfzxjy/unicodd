import { defineConfig } from '@playwright/test'

const port = Number(process.env.PLAYWRIGHT_TEST_PORT ?? 41737)
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('Invalid PLAYWRIGHT_TEST_PORT')
const baseURL = `http://127.0.0.1:${port}`
const privateDossier = process.env.UNICODD_PRIVATE_TESTS === '1'

export default defineConfig({
  testDir: privateDossier ? './private/testing/browser' : './tests/browser',
  outputDir: privateDossier ? './private/testing/browser-results' : undefined,
  fullyParallel: true,
  use: { baseURL, browserName: 'chromium' },
  webServer: {
    command: `node ./node_modules/vite/bin/vite.js ${process.env.PLAYWRIGHT_TEST_PREVIEW ? 'preview ' : ''}--host 0.0.0.0 --port ${port} --strictPort`,
    url: baseURL,
  },
})
