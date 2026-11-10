import { readFile } from 'node:fs/promises'
import type { Page } from '@playwright/test'

const fixtureRoot = new URL('../fixtures/content/', import.meta.url)

export async function routeFixtures(page: Page, append = false) {
  await page.route('**/content/manifest.json', async (route) => {
    const fixture = JSON.parse(await readFile(new URL('manifest.json', fixtureRoot), 'utf8'))
    const manifest = append ? await (await route.fetch()).json() : fixture
    if (append) manifest.scenarios.push(...fixture.scenarios)
    await route.fulfill({ json: manifest })
  })
  await page.route('**/content/scenarios/demo/**', async (route) => {
    const path = new URL(route.request().url()).pathname.split('/content/')[1]
    const body = await readFile(new URL(path, fixtureRoot))
    await route.fulfill({
      contentType: path.endsWith('.json') ? 'application/json' : 'text/plain',
      body,
    })
  })
}
