import type { Page } from '@playwright/test'

export async function skipOpening(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('unicodd.onboarding.v1', 'seen')
  })
}
