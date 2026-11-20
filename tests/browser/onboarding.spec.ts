import { expect, test, type Locator, type Page } from '@playwright/test'
import { commandControl } from './command-controls'

const access = (page: Page) => page.getByRole('heading', { name: 'MONONYM access console' })
const primary = (page: Page) => page.getByRole('button', { name: 'Read Mira’s request' })
const controls = (page: Page) =>
  page.locator('summary').getByText('Console controls', { exact: true })
const request = (page: Page) => page.getByRole('region', { name: 'Inbox message' })
const log = (page: Page) => page.getByRole('log', { name: 'Terminal transcript' })
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const relay = (page: Page) => page.getByRole('heading', { name: 'The Relay', exact: true })

function preferences(page: Page) {
  return page.evaluate(() => ({
    campaign: localStorage.getItem('unicodd.campaign'),
    onboarding: localStorage.getItem('unicodd.onboarding.v1'),
  }))
}

async function run(page: Page, command: string) {
  const input = page.getByRole('textbox', { name: 'Terminal command' })
  await input.fill(command)
  await input.press('Enter')
}

for (const [width, height] of [
  [320, 360],
  [390, 430],
  [390, 844],
  [1440, 900],
]) {
  test.describe(`Opening at ${width} × ${height}`, () => {
    const mobile = width < 600
    test.use({
      viewport: { width, height },
      hasTouch: mobile,
      isMobile: mobile,
      reducedMotion: 'reduce',
    })

    test('opens the real request once with the composer unfocused', async ({ page }, info) => {
      await page.goto('/')
      await access(page).waitFor()
      await expect(access(page)).toBeInViewport()
      await expect(primary(page)).toBeInViewport({ ratio: 1 })
      await expect(controls(page)).toBeInViewport({ ratio: 1 })
      expect((await primary(page).boundingBox())?.height).toBeGreaterThanOrEqual(44)
      expect((await controls(page).boundingBox())?.height).toBeGreaterThanOrEqual(44)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
      expect(await preferences(page)).toEqual({ campaign: null, onboarding: null })
      await page.screenshot({ path: info.outputPath('opening.png') })
      if (mobile) {
        await controls(page).tap()
      } else {
        await page.keyboard.press('Tab')
        await expect(primary(page)).toBeFocused()
        await page.keyboard.press('Tab')
        await expect(controls(page)).toBeFocused()
        await page.keyboard.press('Space')
      }
      await expect(
        page.getByText('Hosts and Mail in the title bar', { exact: false }),
      ).toBeVisible()
      await expect(
        page.getByText('Choose a command, fill any fields and use Run.', { exact: false }),
      ).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
      expect(await preferences(page)).toEqual({ campaign: null, onboarding: null })
      await page.screenshot({ path: info.outputPath('opening-reference.png') })
      if (width === 320) {
        await page.evaluate(() => (document.documentElement.style.fontSize = '200%'))
        const lastParagraph = page.getByText('Use Back to return to your work.', { exact: false })
        await lastParagraph.scrollIntoViewIfNeeded()
        await expect(lastParagraph).toBeInViewport()
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
        await primary(page).scrollIntoViewIfNeeded()
        await expect(primary(page)).toBeInViewport({ ratio: 1 })
      }
      await page.reload()
      await expect(access(page)).toBeVisible()
      await expect(page.getByText('Goal shows your task.', { exact: false })).toBeHidden()
      if (mobile) {
        await primary(page).tap()
      } else {
        await primary(page).press('Enter')
      }
      await expect(request(page)).toBeFocused()
      await expect(request(page)).toHaveCount(1)
      await expect(request(page)).toContainText('Can you retrieve it?')
      await expect(
        log(page).locator('.command-line').filter({ hasText: 'mail favor' }),
      ).toHaveCount(1)
      await expect(button(page, 'Open local inbox')).toBeVisible()
      await expect(page.getByRole('textbox', { name: 'Terminal command' })).not.toBeFocused()
      await expect.poll(async () => (await preferences(page)).onboarding).toBe('seen')
      await page.screenshot({ path: info.outputPath('request.png') })
      await button(page, 'Earlier reads').click()
      await expect(page.getByRole('button', { name: /A favor/ }).last()).toBeVisible()
      await page.reload()
      await expect(relay(page)).toBeVisible()
      await expect(access(page)).toHaveCount(0)
      await expect(request(page)).toHaveCount(1)
      await expect(button(page, 'Open local inbox')).toBeVisible()
      if (width === 320) {
        await expect(
          log(page).getByRole('button', { name: 'relay-07', exact: true }),
        ).not.toBeInViewport()
        await button(page, 'Open local hosts, 1 new').tap()
        const host = log(page).getByRole('button', { name: 'relay-07', exact: true }).last()
        await expect(host).toBeInViewport({ ratio: 1 })
        await host.tap()
        await expect(page.getByRole('button', { name: /^Session:.*relay-07/ })).toBeVisible()
      }
    })
  })
}

test('reveals controls immediately in both Help scopes during a remote session', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 430 })
  await page.goto('/')
  await primary(page).press('Space')
  await expect(request(page)).toBeFocused()
  await button(page, 'Open local hosts, 1 new').click()
  await log(page).getByRole('button', { name: 'relay-07', exact: true }).last().click()
  await commandControl(page, 'help', undefined, true)
  const help = log(page).getByRole('region', { name: 'Command reference' })
  await expect(help).toHaveCount(1)
  await expect(help).toBeFocused()
  await expect(controls(page)).toBeInViewport({ ratio: 1 })
  await expect(help.getByText('Goal shows your task.', { exact: false })).toBeHidden()
  await page.screenshot({ path: info.outputPath('remote-help.png') })
  await page.keyboard.press('Tab')
  await expect(controls(page)).toBeFocused()
  await page.keyboard.press('Space')
  await expect(help.getByText('Goal shows your task.', { exact: false })).toBeVisible()
  await expect(help.getByRole('button', { name: 'local connect <host>' })).toBeVisible()
  await expect(help.getByRole('button', { name: 'login [alias]', exact: true })).toBeVisible()
  await run(page, 'local help')
  await expect(help).toHaveCount(2)
  const prompt = page.getByRole('textbox', { name: 'Terminal command' })
  await expect(prompt).toBeFocused()
  await expect(prompt).toBeEditable()
  await expect(controls(page).last()).toBeInViewport({ ratio: 1 })
  await expect(help.last().getByText('Goal shows your task.', { exact: false })).toBeHidden()
  await expect(help.last().getByRole('button', { name: 'login [alias]', exact: true })).toHaveCount(
    0,
  )
  await controls(page).last().click()
  await expect(help.last().getByText('Goal shows your task.', { exact: false })).toBeVisible()
  await help.last().getByRole('button', { name: 'connect <host>', exact: true }).click()
  await expect(page.getByRole('button', { name: /Change command: local connect/ })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'host', exact: true })).toBeFocused()
  await expect(page.getByRole('button', { name: /^Session:.*relay-07/ })).toBeVisible()
})

test.describe('Relay after a touch opening', () => {
  test.use({
    viewport: { width: 390, height: 430 },
    hasTouch: true,
    isMobile: true,
  })

  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    test(`opens the authorized incident after the guest denial (${reducedMotion})`, async ({
      page,
    }, info) => {
      await page.emulateMedia({ reducedMotion })
      await page.goto('/')
      await primary(page).tap()
      await expect(request(page)).toContainText('I gave them 8C2F')
      await button(page, 'Open local hosts, 1 new').tap()
      await log(page).getByRole('button', { name: 'relay-07', exact: true }).last().tap()
      await run(page, 'cat /queue/8c2f.msg')
      await expect(log(page)).toContainText('Permission denied')
      await expect(button(page, 'The missing notice')).toHaveCount(0)
      await expect(button(page, 'Goal: In progress')).toBeVisible()

      const tap = (target: Locator) => target.tap()
      await commandControl(page, 'login', tap)
      const alias = page.getByRole('textbox', { name: 'Account alias' })
      await alias.fill('\u{1D40C}AINT')
      await alias.press('Home')
      await alias.press('Shift+ArrowRight')
      await button(page, 'Earlier reads').tap()
      await page
        .getByRole('list', { name: 'Earlier reads' })
        .getByRole('button', { name: /^A favor/ })
        .tap()
      await expect(request(page)).toBeInViewport()
      await button(page, 'Back').tap()
      expect(
        await alias.evaluate((field: HTMLTextAreaElement) => [
          field.selectionStart,
          field.selectionEnd,
        ]),
      ).toEqual([0, 2])
      await expect(alias).toHaveValue('\u{1D40C}AINT')
      await button(page, 'Run').tap()
      await expect(log(page)).toContainText('Authentication accepted')
      await expect(button(page, 'Goal: In progress')).toBeVisible()
      await expect(button(page, 'The missing notice')).toHaveCount(0)
      await log(page).getByRole('button', { name: '/queue/8c2f.msg', exact: true }).tap()
      const incident = log(page).getByRole('region', { name: 'File /queue/8c2f.msg' })
      const complete = page.getByRole('heading', { name: 'The Relay · Complete' })
      await expect(incident).toBeFocused()
      await expect(incident.locator('.file-path')).toBeInViewport({ ratio: 1 })
      await expect(incident.locator('.resource-text')).toContainText(
        'Two original registration records were recovered and independently verified.',
      )
      await expect(complete).not.toBeInViewport({ ratio: 1 })
      await page.screenshot({ path: info.outputPath('incident-start.png') })
      await button(page, 'Latest output, new milestone').tap()
      await expect(complete).toBeInViewport({ ratio: 1 })
      await expect(button(page, 'The missing notice')).toBeInViewport({ ratio: 1 })
      await expect(button(page, 'Dead Letter')).toBeInViewport({ ratio: 1 })
      await page.screenshot({ path: info.outputPath('incident-completion.png') })
      await run(page, 'cat /queue/8c2f.msg')
      await expect(incident).toHaveCount(2)
      await expect(complete).toHaveCount(1)
      await expect(button(page, 'The missing notice')).toHaveCount(1)
    })
  }
})

test('preserves the preference through cancelled and confirmed campaign reset', async ({
  page,
}) => {
  await page.goto('/')
  await primary(page).click()
  await expect(request(page)).toBeFocused()
  await run(page, 'campaign')
  const reset = button(page, 'Reset campaign…')
  page.once('dialog', (dialog) => dialog.dismiss())
  await reset.click()
  await expect(request(page)).toHaveCount(1)
  await expect(button(page, 'Open local inbox')).toBeVisible()
  page.once('dialog', (dialog) => dialog.accept())
  await reset.click()
  await expect(button(page, 'Open local inbox, 1 unread')).toBeVisible()
  await expect(request(page)).toHaveCount(0)
  expect((await preferences(page)).onboarding).toBe('seen')
  await page.evaluate(() => localStorage.removeItem('unicodd.campaign'))
  await page.reload()
  await expect(button(page, 'Open local inbox, 1 unread')).toBeVisible()
  expect((await preferences(page)).onboarding).toBe('seen')
})

test('rechecks the save at activation and resumes progress from another tab', async ({
  page,
  context,
  baseURL,
}) => {
  await page.goto('/')
  await expect(access(page)).toBeVisible()
  const other = await context.newPage()
  await other.goto(baseURL!)
  await primary(other).click()
  await expect(request(other)).toBeFocused()
  await run(other, 'connect relay-07')
  await expect(other.getByRole('button', { name: /^Session:.*relay-07/ })).toBeVisible()
  await other.close()
  await primary(page).click()
  await expect(page.getByRole('button', { name: /^Session:.*relay-07/ })).toBeVisible()
  await expect(request(page)).toHaveCount(1)
})

test('legacy completion bypasses the opening', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('unicodd.objective.001-the-relay', 'true'))
  await page.goto('/')
  await expect(button(page, 'Goal: Complete')).toBeVisible()
  await expect(access(page)).toHaveCount(0)
  expect((await preferences(page)).onboarding).toBeNull()
})

test('development direct entry leaves both onboarding and campaign storage alone', async ({
  page,
}) => {
  test.skip(Boolean(process.env.PLAYWRIGHT_TEST_PREVIEW), 'Requires the development server')
  await page.goto('/?scenario=002-dead-letter')
  await expect(page.getByRole('button', { name: /^Session:.*postbox-03/ })).toBeVisible()
  await expect(access(page)).toHaveCount(0)
  expect(await preferences(page)).toEqual({ campaign: null, onboarding: null })
})

for (const accessBlocked of [false, true]) {
  test(`reads the request with storage ${accessBlocked ? 'access' : 'writes'} blocked`, async ({
    page,
  }) => {
    await page.addInitScript((blocked) => {
      if (blocked) {
        Object.defineProperty(window, 'localStorage', {
          get() {
            throw new Error('Access blocked')
          },
        })
      } else {
        Storage.prototype.setItem = () => {
          throw new Error('Write blocked')
        }
      }
    }, accessBlocked)
    await page.goto('/')
    await primary(page).evaluate((element: HTMLButtonElement) => {
      element.click()
      element.click()
    })
    await expect(request(page)).toBeFocused()
    await expect(request(page)).toHaveCount(1)
    await page.reload()
    await expect(access(page)).toBeVisible()
  })
}
