import { expect, test, type Page } from '@playwright/test'
import { routeFixtures } from './content-routes'

const fullwidth = 'ＭＡＩＮＴ'
const terminal = (page: Page) => page.getByRole('log', { name: 'Terminal transcript' })
const quick = (page: Page, name: string) =>
  page.getByRole('group', { name: 'Quick actions' }).getByRole('button', { name, exact: true })
const link = (page: Page, name: string) =>
  terminal(page).getByRole('button', { name, exact: true }).last()
const contextPanel = (page: Page) => page.getByRole('complementary', { name: 'Session context' })
const incident = (page: Page) =>
  terminal(page).getByRole('region', { name: 'File /queue/8c2f.msg' })
const alias = (page: Page) => page.getByRole('textbox', { name: 'Account alias' })
const cmd = (page: Page) => page.getByRole('textbox', { name: 'Terminal command' })

async function run(page: Page, text: string) {
  await expect(cmd(page)).toBeEditable()
  await cmd(page).fill(text)
  await cmd(page).press('Enter')
}

async function openRelay(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'The Relay' })).toBeVisible()
}

test('plays the entire Relay through graphical actions and restores only objective progress after reload', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openRelay(page)
  const panel = contextPanel(page)
  await expect(panel).toContainText('local')
  await expect(panel).toContainText('Open')
  await quick(page, 'Hosts').click()
  await link(page, 'relay-07').click()
  await expect(panel).toContainText('relay-07')
  await expect(panel).toContainText('guest')
  await quick(page, 'Files').click()
  await link(page, 'queue/').click()
  await link(page, '8c2f.msg').click()
  await expect(terminal(page)).toContainText('Permission denied')
  await expect(incident(page)).toHaveCount(0)
  await link(page, 'README').click()
  await expect(terminal(page)).toContainText('The gateway rejects direct login')
  await link(page, 'notes/').click()
  await link(page, 'migration.txt').click()
  await expect(terminal(page)).toContainText('no longer use the same identifier tables')
  await quick(page, 'Login').click()
  await alias(page).fill('MAINT')
  await page.getByRole('button', { name: 'Submit login' }).click()
  await expect(terminal(page)).toContainText('Reserved account name')
  await expect(alias(page)).toHaveValue('MAINT')
  await alias(page).fill('ＡＩＮＴ')
  await alias(page).press('Home')
  await link(page, 'keypad.txt').click()
  await terminal(page)
    .getByRole('button', { name: /Inspect U\+FF2D/ })
    .click()
  const bench = page.getByRole('dialog', { name: 'Unicode Workbench' })
  await expect(bench.getByRole('textbox')).toHaveValue('U+FF2D')
  await expect(bench.getByRole('button', { name: /NFKC: inspect U\+004D/ })).toBeVisible()
  await bench.getByRole('button', { name: 'Copy', exact: true }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Ｍ')
  await bench.getByRole('button', { name: 'Insert', exact: true }).click()
  await expect(alias(page)).toHaveValue(fullwidth)
  expect(await alias(page).evaluate((field: HTMLTextAreaElement) => field.selectionStart)).toBe(1)
  await page.getByRole('button', { name: 'Submit login' }).click()
  await expect(terminal(page)).toContainText('Authentication accepted')
  await expect(panel).toContainText('maintenance')
  await expect(panel).toContainText('Open')
  await quick(page, 'Files').click()
  await link(page, 'queue/').click()
  await link(page, '8c2f.msg').click()
  await expect(incident(page)).toContainText('independently')
  await expect(panel.getByText('Complete', { exact: true })).toBeVisible()
  await quick(page, 'Clear').click()
  await expect(terminal(page)).toBeEmpty()
  await expect(panel).toContainText('maintenance')
  await expect(panel).toContainText('Complete')
  await quick(page, 'Logout').click()
  await expect(panel).toContainText('guest')
  await page.reload()
  await expect(panel).toContainText('local')
  await expect(panel).toContainText('Complete')
  await page.getByRole('button', { name: 'Reset session' }).click()
  await expect(panel).toContainText('Open')
  await page.reload()
  await expect(panel).toContainText('Open')
})

test('reaches equivalent states through typed actions in a different exploration order', async ({
  page,
}) => {
  await openRelay(page)
  await run(page, 'help')
  await expect(terminal(page)).toContainText('connect <host>')
  await run(page, 'hosts')
  await expect(terminal(page).getByText('Known hosts', { exact: true })).toHaveCount(2)
  await run(page, 'connect missing')
  await expect(terminal(page)).toContainText('Unknown host')
  await run(page, 'connect relay-07')
  await expect(contextPanel(page)).toContainText('relay-07')
  await run(page, 'ls /notes')
  await expect(link(page, 'keypad.txt')).toBeVisible()
  await run(page, 'cat notes/keypad.txt')
  await expect(terminal(page)).toContainText('Field terminal')
  await run(page, 'cat "/queue/8c2f.msg"')
  await expect(terminal(page)).toContainText('Permission denied')
  await run(page, 'login')
  await expect(alias(page)).toBeVisible()
  await alias(page).fill('unsent')
  await run(page, 'login "unknown"')
  await expect(terminal(page)).toContainText('Account not found')
  await expect(alias(page)).toHaveValue('unsent')
  await page.getByRole('button', { name: 'Hide editor' }).click()
  await expect(alias(page)).toBeHidden()
  await quick(page, 'Login').click()
  await expect(alias(page)).toHaveValue('unsent')
  await run(page, 'inspect Ｍ')
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('textbox')).toHaveValue('U+FF2D')
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await run(page, `login "${fullwidth}"`)
  await expect(contextPanel(page)).toContainText('maintenance')
  await expect(contextPanel(page)).toContainText('Open')
  await run(page, 'whoami')
  await expect(terminal(page)).toContainText('MAINT · maintenance')
  await run(page, 'cat queue/8c2f.msg')
  await expect(incident(page)).toBeVisible()
  await expect(contextPanel(page)).toContainText('Complete')
  await run(page, 'logout')
  await expect(contextPanel(page)).toContainText('guest')
  await run(page, 'clear')
  await expect(terminal(page)).toBeEmpty()
  await expect(contextPanel(page)).toContainText('Complete')
})

test('supports history, completion, usage feedback, and IME-safe submission', async ({ page }) => {
  await openRelay(page)
  const field = cmd(page)
  await field.fill('con')
  await expect(page.getByRole('button', { name: 'connect', exact: true })).toBeVisible()
  await field.press('Escape')
  await expect(page.getByRole('group', { name: 'Command suggestions' })).toHaveCount(0)
  await field.fill('connect r')
  await field.press('Tab')
  await expect(field).toHaveValue('connect relay-07')
  await field.press('Enter')
  await expect(contextPanel(page)).toContainText('relay-07')
  await run(page, 'cat')
  await expect(terminal(page)).toContainText('Usage: cat <path>')
  await field.fill('draft')
  await field.press('ArrowUp')
  await expect(field).toHaveValue('cat')
  await field.press('ArrowUp')
  await expect(field).toHaveValue('connect relay-07')
  await field.press('ArrowDown')
  await field.press('ArrowDown')
  await expect(field).toHaveValue('draft')
  await field.fill('inspect 日')
  await field.evaluate((element) =>
    element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })),
  )
  await field.press('Enter')
  await expect(page.getByRole('dialog')).toBeHidden()
  await field.evaluate((element) =>
    element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })),
  )
  await field.press('Enter')
  await expect(page.getByRole('dialog').getByRole('textbox')).toHaveValue('U+65E5')
})

test('loads a second authored scenario through the same terminal and handles quoted paths', async ({
  page,
}) => {
  await routeFixtures(page, true)
  await page.goto('/')
  const selector = page.getByRole('combobox', { name: 'Scenario' })
  await selector.selectOption('demo')
  await expect(contextPanel(page)).toContainText('shelf')
  await run(page, 'cat index')
  await expect(terminal(page)).toContainText('The annex is available')
  await run(page, 'login 🧪')
  await expect(contextPanel(page)).toContainText('curator')
  await run(page, 'cat "/exhibit/sample card"')
  await expect(terminal(page)).toContainText('Sample card')
  await run(page, 'connect annex')
  await quick(page, 'Files').click()
  await link(page, 'document').click()
  await expect(contextPanel(page)).toContainText('Complete')
  await selector.selectOption('001-the-relay')
  await expect(contextPanel(page)).toContainText('local')
  await expect(contextPanel(page)).toContainText('Open')
})

test('has no standalone puzzle controls on the former content URL', async ({ page }) => {
  const response = await page.request.get('/content/levels/001-the-gate/puzzle.json', {
    headers: { Accept: 'application/json' },
  })
  expect(response.status()).toBe(404)
  await openRelay(page)
  await expect(page.getByRole('heading', { name: 'Verification' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'The Gate' })).toHaveCount(0)
})

test('keeps manual scrollback and safely renders raw command echoes', async ({ page }) => {
  await openRelay(page)
  for (let count = 0; count < 8; count++) await quick(page, 'Help').click()
  const log = terminal(page)
  await log.evaluate((element) => {
    element.scrollTop = 0
  })
  const latest = page.getByRole('button', { name: /Latest output/ })
  await expect(latest).toBeVisible()
  const text = 'probe <img> אבג'
  await run(page, text)
  await expect(log).toContainText('Unknown command')
  await expect(log.locator('img')).toHaveCount(0)
  const echo = log.locator('.command-echo bdi').last()
  await expect(echo).toHaveText(text)
  expect(await echo.evaluate((element) => getComputedStyle(element).unicodeBidi)).toBe('isolate')
  expect(await log.evaluate((element) => element.scrollTop)).toBe(0)
  await latest.click()
  await expect(echo).toBeInViewport()
  await expect(latest).toHaveCount(0)
})

for (const [width, height] of [
  [375, 812],
  [390, 844],
  [768, 1024],
  [1280, 800],
  [1440, 900],
]) {
  test.describe(`${width} × ${height}`, () => {
    test.use({ viewport: { width, height }, hasTouch: width <= 768, isMobile: width <= 600 })
    test('renders the Relay at each step with persistent context and touch actions', async ({
      page,
    }, info) => {
      const capture = async (name: string) => {
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
        expect(
          await page
            .locator('.transcript')
            .evaluate((element) => element.scrollWidth <= element.clientWidth),
        ).toBe(true)
        if (!(await page.getByRole('dialog').isVisible()))
          await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeInViewport({
            ratio: 1,
          })
        await page.screenshot({ path: info.outputPath(name + '.png') })
      }
      const act = async (target: ReturnType<Page['getByRole']>) => {
        if (width <= 768) await target.tap()
        else await target.click()
      }
      await openRelay(page)
      await capture('01-local')
      await act(link(page, 'relay-07'))
      await capture('02-guest')
      await act(quick(page, 'Files'))
      await capture('03-resources')
      await act(link(page, 'README'))
      await capture('04-readme')
      await act(link(page, 'queue/'))
      await act(link(page, '8c2f.msg'))
      await capture('05-denied')
      await act(quick(page, 'Login'))
      await expect(alias(page)).toBeInViewport()
      await capture('06-login')
      if (width < 600) {
        await alias(page).focus()
        await page.setViewportSize({ width, height: 435 })
        await expect(alias(page)).toBeInViewport()
        await expect(page.getByRole('button', { name: 'Submit login' })).toBeInViewport()
        await page.screenshot({ path: info.outputPath('07-keyboard-space.png') })
        await page.setViewportSize({ width, height })
      }
      await alias(page).fill('ＡＩＮＴ')
      await alias(page).press('Home')
      await act(quick(page, 'Files'))
      await act(link(page, 'notes/'))
      await act(link(page, 'keypad.txt'))
      await capture('08-keypad')
      await act(terminal(page).getByRole('button', { name: /Inspect U\+FF2D/ }))
      const bench = page.getByRole('dialog')
      await expect(bench.getByRole('button', { name: /NFKC: inspect U\+004D/ })).toBeVisible()
      await capture('09-workbench')
      const insert = bench.getByRole('button', { name: 'Insert', exact: true })
      if (width < 600) {
        await page.setViewportSize({ width, height: 435 })
        await expect(insert).toBeInViewport()
        await page.screenshot({ path: info.outputPath('10-workbench-keyboard-space.png') })
        await page.setViewportSize({ width, height })
      }
      await act(insert)
      await expect(alias(page)).toHaveValue(fullwidth)
      await expect(
        terminal(page)
          .locator('.command-echo bdi')
          .filter({ hasText: /^inspect Ｍ$/u }),
      ).toHaveCount(1)
      await alias(page).fill('MAINT')
      await act(page.getByRole('button', { name: 'Submit login' }))
      await expect(terminal(page)).toContainText('Reserved account name')
      await capture('11-rejected')
      await alias(page).fill(fullwidth)
      await act(page.getByRole('button', { name: 'Submit login' }))
      await expect(contextPanel(page)).toContainText('maintenance')
      if (width <= 600) {
        const access = contextPanel(page).getByText('maintenance', { exact: true })
        expect(
          await access.evaluate((element) => {
            const range = document.createRange()
            range.selectNodeContents(element)
            return range.getClientRects().length
          }),
        ).toBe(1)
      }
      await capture('12-maintenance')
      await act(quick(page, 'Files'))
      await act(link(page, 'queue/'))
      await act(link(page, '8c2f.msg'))
      await expect(contextPanel(page)).toContainText('Complete')
      await expect(incident(page)).toBeVisible()
      await capture('13-complete')
    })
  })
}
