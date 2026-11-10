import { readFile } from 'node:fs/promises'
import type { Page } from '@playwright/test'
import fixtureManifest from '../fixtures/content/manifest.json' with { type: 'json' }

export async function routeFixtures(page: Page, append = false) {
  await page.route('**/content/manifest.json', async (route) => {
    const manifest = append ? await (await route.fetch()).json() : fixtureManifest
    if (append) manifest.levels.push(fixtureManifest.levels[1])
    await route.fulfill({ json: manifest })
  })
  await page.route('**/content/levels/fixture-*/**.json', async (route) => {
    const path = new URL(route.request().url()).pathname.split('/content/')[1]
    const body = await readFile(new URL(`../fixtures/content/${path}`, import.meta.url))
    await route.fulfill({ contentType: 'application/json', body })
  })
}
