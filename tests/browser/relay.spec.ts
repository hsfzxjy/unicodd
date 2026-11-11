import { expect, test, type Page } from '@playwright/test'
import { routeFixtures } from './content-routes'

const compatible = '\u{1D40C}AINT'
const terminal = (page: Page) => page.getByRole('log', { name: 'Terminal transcript' })
const quick = (page: Page, name: string) =>
  page.getByRole('group', { name: 'Quick actions' }).getByRole('button', { name, exact: true })
const link = (page: Page, name: string) =>
  terminal(page).getByRole('button', { name, exact: true }).last()
const contextPanel = (page: Page) => page.getByRole('complementary', { name: 'Session context' })
const incident = (page: Page) =>
  terminal(page).getByRole('region', { name: 'File /queue/8c2f.msg' })
const mail = (page: Page, path?: string) =>
  terminal(page)
    .getByRole('region', { name: path ? 'Mail ' + path : 'Inbox message' })
    .last()
const alias = (page: Page) => page.getByRole('textbox', { name: 'Account alias' })
const cmd = (page: Page) => page.getByRole('textbox', { name: 'Terminal command' })
const inspection = (page: Page, notation: string) =>
  terminal(page)
    .getByRole('region', { name: 'Unicode ' + notation })
    .last()

async function run(page: Page, text: string) {
  const tag = page.getByRole('button', { name: 'Change command', exact: true })
  if (await tag.count()) {
    await tag.click()
    await page.getByRole('menuitem', { name: 'Edit command name…' }).click()
  }
  await expect(cmd(page)).toBeEditable()
  await cmd(page).fill(text)
  await cmd(page).press('Enter')
}

async function openRelay(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'The Relay' })).toBeVisible()
}

test('plays the entire Relay through graphical actions and restores the session after reload', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openRelay(page)
  const panel = contextPanel(page)
  await expect(panel).toContainText('local')
  await expect(panel).toContainText('Open')
  await link(page, 'New mail, open inbox').click()
  await expect(terminal(page)).toContainText('mira@outside.net · Unread')
  await link(page, 'A favor').click()
  await expect(mail(page)).toContainText('Can you retrieve it?')
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
  await expect(terminal(page)).toContainText('correspondence archive')
  await link(page, 'mail/').click()
  await expect(terminal(page).locator('.terminal-list').last().getByRole('button')).toHaveText([
    '01-old-consoles',
    '02-login-compatibility',
    '03-maintenance-policy',
  ])
  await link(page, '01-old-consoles').click()
  await expect(mail(page, '/mail/01-old-consoles')).toContainText('different code points')
  await link(page, '02-login-compatibility').click()
  await expect(mail(page, '/mail/02-login-compatibility').getByRole('article')).toHaveCount(2)
  await expect(mail(page, '/mail/02-login-compatibility')).toContainText('next maintenance window')
  await quick(page, 'Login').click()
  await alias(page).fill('MAINT')
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(terminal(page)).toContainText('Reserved account name')
  await expect(alias(page)).toHaveValue('MAINT')
  await alias(page).fill('AINT')
  await alias(page).press('Home')
  await quick(page, 'Files').click()
  await link(page, 'notes/').click()
  await link(page, 'maintenance-frame.txt').click()
  await expect(terminal(page)).toContainText('6 UTF-16 units')
  await link(page, 'print-samples.txt').click()
  await terminal(page)
    .getByRole('button', { name: /Inspect U\+1D40C/ })
    .click()
  const details = inspection(page, 'U+1D40C')
  await expect(details).toContainText('Uppercase letter')
  await expect(details.getByRole('button', { name: /NFKC: Inspect U\+004D/ })).toBeVisible()
  await details.getByRole('button', { name: 'Copy', exact: true }).click()
  await expect(terminal(page)).toContainText('Copied.')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('\u{1D40C}')
  await details.getByRole('button', { name: 'Insert', exact: true }).click()
  await expect(alias(page)).toHaveValue(compatible)
  expect(await alias(page).evaluate((field: HTMLTextAreaElement) => field.selectionStart)).toBe(2)
  await page.getByRole('button', { name: 'Run', exact: true }).click()
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
  await quick(page, 'Mail').click()
  await expect(terminal(page)).toContainText('mira@outside.net · Read')
  await link(page, 'A favor').click()
  await expect(mail(page)).toContainText('Can you retrieve it?')
  await quick(page, 'Logout').click()
  await expect(panel).toContainText('guest')
  await page.reload()
  await expect(panel).toContainText('relay-07')
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
  await run(page, 'ls /mail')
  await expect(link(page, '03-maintenance-policy')).toBeVisible()
  await run(page, 'cat /mail/03-maintenance-policy')
  await expect(mail(page, '/mail/03-maintenance-policy')).toContainText(
    'MAINT is not a personal account',
  )
  await run(page, 'mail favor')
  await expect(mail(page)).toContainText('Can you retrieve it?')
  await run(page, 'cat "/queue/8c2f.msg"')
  await expect(terminal(page)).toContainText('Permission denied')
  await run(page, 'login')
  await expect(alias(page)).toBeVisible()
  await alias(page).fill('unsent')
  await run(page, 'login "unknown"')
  await expect(terminal(page)).toContainText('Decoded character count')
  await expect(alias(page)).toHaveValue('unknown')
  await alias(page).press('Escape')
  await expect(alias(page)).toHaveCount(0)
  await quick(page, 'Login').click()
  await expect(alias(page)).toHaveValue('unknown')
  await run(page, 'inspect \u{1D40C}')
  await expect(inspection(page, 'U+1D40C')).toBeVisible()
  await quick(page, 'Login').click()
  await expect(alias(page)).toHaveValue('unknown')
  await run(page, `login "${compatible}"`)
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

test('shows host and mail alerts and updates read status in existing lists', async ({
  page,
}, info) => {
  await routeFixtures(page)
  await page.goto('/')
  const hosts = (name = 'Open hosts list') => page.getByRole('button', { name, exact: true })
  const inbox = (name = 'Open inbox') => page.getByRole('button', { name, exact: true })
  const list = terminal(page).locator('.terminal-list').last()
  const row = (label: string) =>
    terminal(page)
      .getByRole('listitem')
      .filter({ has: page.getByRole('button', { name: label, exact: true }) })
      .last()

  await expect(hosts()).toBeVisible()
  await expect(inbox()).toBeVisible()
  await quick(page, 'Files').click()
  await expect(row('index')).toHaveAttribute('data-status', 'Unread')
  await link(page, 'index').click()
  await expect(row('index')).toHaveAttribute('data-status', 'Read')
  const newHosts = hosts('Open hosts list, 1 new')
  const unreadMail = inbox('Open inbox, 1 unread')
  await expect(newHosts).toBeVisible()
  await expect(unreadMail).toBeVisible()
  await page.screenshot({ path: info.outputPath('title-alerts-desktop.png') })

  await page.setViewportSize({ width: 390, height: 435 })
  await unreadMail.click()
  await expect(list).toBeFocused()
  await expect(row('Fixture delivery')).toHaveAttribute('data-status', 'Unread')
  await page.screenshot({ path: info.outputPath('title-alerts-compact.png') })
  await link(page, 'Fixture delivery').click()
  await expect(row('Fixture delivery')).toHaveAttribute('data-status', 'Read')
  await expect(inbox()).toBeVisible()

  await newHosts.click()
  await expect(list).toBeFocused()
  await expect(row('annex')).toHaveAttribute('data-status', 'New')
  await link(page, 'annex').click()
  await expect(hosts()).toBeVisible()
  await expect(row('annex')).not.toHaveAttribute('data-status', 'New')
  await quick(page, 'Files').click()
  await expect(row('document')).toHaveAttribute('data-status', 'Unread')
  await link(page, 'document').click()
  await expect(row('document')).toHaveAttribute('data-status', 'Read')

  await page.reload()
  await quick(page, 'Files').click()
  await expect(row('document')).toHaveAttribute('data-status', 'Read')
  await expect(hosts()).toBeVisible()
  await expect(inbox()).toBeVisible()
  await hosts().click()
  await expect(row('annex')).not.toHaveAttribute('data-status', 'New')
  await link(page, 'shelf').click()
  await quick(page, 'Files').click()
  await expect(row('index')).toHaveAttribute('data-status', 'Read')
})

test('saves level workspaces and drops their command history when a game text changes', async ({
  page,
}, info) => {
  await routeFixtures(page, true)
  await page.goto('/')
  const selector = page.getByRole('combobox', { name: 'Scenario' })
  const log = terminal(page)
  const readme = log.getByRole('region', { name: 'File /README' })
  const readmeEntry = log.locator('.terminal-entry').filter({
    has: page.locator('.command-line').filter({ hasText: 'cat /README' }),
  })
  const disclosure = readmeEntry.getByRole('button', { name: 'Toggle command output' })
  const tools = page.getByRole('button', { name: 'Code points', exact: true })
  await run(page, 'connect relay-07')
  await run(page, 'login ' + compatible)
  await run(page, 'cat /README')
  await expect(readme).toContainText('MONONYM Message Services')
  await disclosure.click()
  await cmd(page).fill('login ')
  const draft = String.raw`a🧪é\u000020`
  await alias(page).fill(draft)
  await alias(page).evaluate((field: HTMLTextAreaElement) => {
    field.setSelectionRange(1, 3)
    field.dispatchEvent(new Event('select'))
  })
  await tools.click()
  await selector.selectOption('demo')
  await run(page, 'cat /index')
  await expect(log).toContainText('The annex is available.')
  await run(page, 'connect annex')
  await expect(contextPanel(page)).toContainText('annex')
  await selector.selectOption('001-the-relay')
  await expect(contextPanel(page)).toContainText('maintenance')
  await expect(alias(page)).toHaveValue(draft)
  await expect(tools).toHaveAttribute('aria-expanded', 'true')
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false')
  await disclosure.click()
  await expect(readme).toContainText('MONONYM Message Services')
  await page.screenshot({ path: info.outputPath('restored-level-desktop.png') })

  await page.reload()
  await expect(contextPanel(page)).toContainText('maintenance')
  await expect(alias(page)).toHaveValue(draft)
  expect(
    await alias(page).evaluate((field: HTMLTextAreaElement) => [
      field.selectionStart,
      field.selectionEnd,
    ]),
  ).toEqual([1, 3])
  await expect(readme).toContainText('MONONYM Message Services')
  await alias(page).press('Alt+ArrowUp')
  const path = page.getByRole('textbox', { name: 'path', exact: true })
  await expect(path).toHaveValue('/README')
  await path.press('Alt+ArrowDown')
  await expect(alias(page)).toHaveValue(draft)
  await page.setViewportSize({ width: 390, height: 435 })
  await page.screenshot({ path: info.outputPath('restored-level-compact.png') })
  const session = page.getByRole('button', { name: 'Session', exact: true })
  await session.click()
  const saved = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('unicodd.campaign')!).levels)
  expect(JSON.stringify(await saved())).not.toContain('MONONYM Message Services')

  await page.route('**/001-the-relay/files/README.txt', async (route) => {
    const response = await route.fetch()
    await route.fulfill({ response, body: (await response.text()) + '\nRevision test.\n' })
  })
  await page.reload()
  await expect(alias(page)).toHaveValue(draft)
  await expect(contextPanel(page)).toContainText('maintenance')
  await expect(log.locator('.command-echo')).toHaveCount(0)
  const levels = await saved()
  expect(levels['001-the-relay'].composer.history).toEqual([])
  expect(levels.demo.journal).toBeUndefined()
  await selector.selectOption('demo')
  await expect(session).toHaveAttribute('aria-expanded', 'false')
  await session.click()
  await expect(contextPanel(page)).toContainText('annex')
  await expect(log.locator('.command-echo')).toHaveCount(0)
})

test('supports history, completion, usage feedback, and IME-safe submission', async ({ page }) => {
  await openRelay(page)
  const field = cmd(page)
  await page.locator('.prompt label').click()
  await expect(field).toBeFocused()
  await field.fill('con')
  await expect(page.getByRole('button', { name: 'connect', exact: true })).toBeVisible()
  await field.press('Escape')
  await expect(page.getByRole('group', { name: 'Command suggestions' })).toHaveCount(0)
  await field.fill('connect r')
  await field.press('Tab')
  const host = page.getByRole('textbox', { name: 'host', exact: true })
  await expect(host).toHaveValue('relay-07')
  await host.press('Enter')
  await expect(contextPanel(page)).toContainText('relay-07')
  await run(page, 'cat')
  const path = page.getByRole('textbox', { name: 'path', exact: true })
  await expect(path).toBeFocused()
  await path.fill('missing')
  await path.press('Enter')
  await expect(terminal(page)).toContainText('No such resource')
  await path.press('Escape')
  await field.fill('draft')
  await field.press('ArrowUp')
  await expect(path).toHaveValue('missing')
  await path.press('Alt+ArrowDown')
  await expect(field).toHaveValue('draft')
  await field.fill('inspect 日')
  await field.evaluate((element) =>
    element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })),
  )
  await field.press('Enter')
  await expect(inspection(page, 'U+65E5')).toHaveCount(0)
  await field.evaluate((element) =>
    element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })),
  )
  await field.press('Enter')
  await expect(inspection(page, 'U+65E5')).toBeVisible()
})

test('completes relative paths and marks local and remote command echoes', async ({
  page,
}, info) => {
  await openRelay(page)
  await run(page, 'connect relay-07')
  const local = terminal(page).locator('.command-echo').first()
  await expect(local).toContainText('local ›')
  await expect(local).not.toHaveClass(/remote/)
  const field = cmd(page)
  await field.fill('cat notes/k')
  const suggestion = page.getByRole('button', { name: 'cat notes/keypad.txt', exact: true })
  await expect(suggestion).toBeVisible()
  await page.screenshot({ path: info.outputPath('relative-completion.png') })
  await field.press('Tab')
  const path = page.getByRole('textbox', { name: 'path', exact: true })
  await expect(path).toHaveValue('notes/keypad.txt')
  await path.press('Enter')
  await expect(terminal(page)).toContainText('Field terminal')
  const remote = terminal(page).locator('.command-echo.remote').last()
  await expect(remote.locator('.prompt-host')).toHaveText('@relay-07 ›')
  await expect(remote.locator('bdi')).toHaveText('cat notes/keypad.txt')
  await field.fill('ls ./no')
  await page.getByRole('button', { name: 'ls ./notes', exact: true }).click()
  await expect(path).toHaveValue('./notes')
  await path.press('Enter')
  await expect(link(page, 'keypad.txt')).toBeVisible()
  await field.fill('cat /REA')
  await field.press('Tab')
  await expect(path).toHaveValue('/README')
  await path.press('Enter')
  await page.setViewportSize({ width: 390, height: 844 })
  await field.fill('cat ')
  await path.fill('')
  await expect(page.getByRole('button', { name: 'cat README', exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath('mobile-relative-completion.png') })
})

test('interprets six-digit Unicode escapes in commands and the alias editor', async ({ page }) => {
  const escapedAlias = String.raw`\u01D40CAINT`
  await openRelay(page)
  await run(page, String.raw`inspect \u01F9EA`)
  await expect(inspection(page, 'U+1F9EA')).toBeVisible()
  await run(page, 'connect relay-07')
  await run(page, String.raw`cat \u000052EADME`)
  await expect(terminal(page).getByRole('region', { name: 'File /README' })).toBeVisible()
  await run(page, 'login ' + escapedAlias)
  await expect(contextPanel(page)).toContainText('maintenance')
  await quick(page, 'Logout').click()
  await quick(page, 'Login').click()
  const draft = alias(page)
  const submit = page.getByRole('button', { name: 'Run', exact: true })
  await draft.fill(String.raw`\u01F9EA`)
  await draft.selectText()
  await page
    .getByRole('form', { name: 'Command composer' })
    .getByRole('button', { name: 'Inspect', exact: true })
    .click()
  await expect(terminal(page).getByRole('region', { name: 'Unicode U+1F9EA' })).toHaveCount(2)
  await draft.fill(String.raw`\u00D800`)
  await submit.click()
  await expect(terminal(page)).toContainText(String.raw`Not a Unicode scalar: \u00D800`)
  await expect(draft).toHaveValue(String.raw`\u00D800`)
  await draft.fill(escapedAlias)
  await submit.click()
  await expect(contextPanel(page)).toContainText('maintenance')
})

test('loads a second authored scenario through the same terminal and handles quoted paths', async ({
  page,
}) => {
  await routeFixtures(page, true)
  await page.goto('/')
  const selector = page.getByRole('combobox', { name: 'Scenario' })
  await run(page, 'mail favor')
  await selector.selectOption('demo')
  await expect(contextPanel(page)).toContainText('shelf')
  const notice = terminal(page).getByRole('button', { name: 'New mail, open inbox' })
  await expect(notice).toHaveCount(0)
  await run(page, 'cat index')
  await expect(terminal(page)).toContainText('The annex is available')
  await notice.click()
  await link(page, 'Fixture delivery').click()
  await expect(mail(page)).toContainText('2026-01-01')
  await expect(mail(page)).toContainText('Fixture event body.')
  await run(page, 'cat /exhibit/sealed')
  await expect(terminal(page)).toContainText('Permission denied: /exhibit/sealed')
  await expect(terminal(page)).not.toContainText('Fixture restricted archive.')
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
  const text = 'unknown <img> אבג'
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

test.describe('mobile Unicode sequence', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true })

  test('wraps long normalization output and inserts the whole sequence by touch', async ({
    page,
  }, info) => {
    await openRelay(page)
    await link(page, 'relay-07').tap()
    await quick(page, 'Login').tap()
    await alias(page).fill('a🧪b')
    await alias(page).press('Home')
    await alias(page).press('ArrowRight')
    await run(page, 'inspect U+FDFA')
    await quick(page, 'Login').tap()
    const details = inspection(page, 'U+FDFA')
    const insert = details.getByRole('button', { name: 'Insert NFKC', exact: true })
    await expect(details.getByRole('button', { name: /^NFKC: Inspect / })).toHaveCount(18)
    expect((await insert.boundingBox())?.height).toBe(44)
    expect(await terminal(page).evaluate((element) => element.scrollWidth)).toBe(
      await terminal(page).evaluate((element) => element.clientWidth),
    )
    await page.screenshot({ path: info.outputPath('long-inspection.png') })
    await insert.tap()
    await expect(alias(page)).toHaveValue('aصلى الله عليه وسلم🧪b')
  })

  test('keeps the active draft and selection when crossing the layout breakpoint', async ({
    page,
  }) => {
    await openRelay(page)
    await link(page, 'relay-07').tap()
    await quick(page, 'Login').tap()
    const input = alias(page)
    await input.fill('a🧪b')
    await input.press('Home')
    await input.press('ArrowRight')
    await input.press('Shift+ArrowRight')
    await page.setViewportSize({ width: 1280, height: 800 })
    await expect(page.locator('.workspace > .context-frame')).toBeVisible()
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.locator('.terminal-frame .command-composer')).toBeVisible()
    await expect(input).toHaveValue('a🧪b')
    expect(
      await input.evaluate((field: HTMLTextAreaElement) => [
        field.selectionStart,
        field.selectionEnd,
      ]),
    ).toEqual([1, 3])
  })
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
        await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeInViewport({
          ratio: 1,
        })
        await page.screenshot({ path: info.outputPath(name + '.png') })
      }
      const act = async (target: ReturnType<Page['getByRole']>) => {
        if (width <= 768) await target.tap()
        else await target.click()
      }
      const narrow = width <= 830
      const frame = page.getByRole('region', { name: 'Terminal', exact: true })
      const sessionToggle = frame.getByRole('button', { name: 'Session', exact: true })
      await openRelay(page)
      if (narrow) {
        await expect(contextPanel(page)).toBeHidden()
        await expect(page.locator('.workspace > .context-frame')).toHaveCount(0)
        await expect(sessionToggle).toHaveAttribute('aria-expanded', 'false')
      } else {
        await expect(contextPanel(page)).toBeVisible()
        await expect(sessionToggle).toHaveCount(0)
      }
      await capture('01-local')
      await act(link(page, 'New mail, open inbox'))
      await act(link(page, 'A favor'))
      await expect(mail(page)).toContainText('Can you retrieve it?')
      await capture('01-incoming-mail')
      await act(link(page, 'relay-07'))
      await capture('02-guest')
      await act(quick(page, 'Files'))
      await capture('03-resources')
      await act(link(page, 'README'))
      await capture('04-readme')
      await act(link(page, 'mail/'))
      await act(link(page, '02-login-compatibility'))
      const thread = mail(page, '/mail/02-login-compatibility')
      await expect(
        thread.getByText('Rowan / Directory Team', { exact: true }).first(),
      ).toBeInViewport()
      await capture('04-archive-thread-start')
      await thread.getByText('next maintenance window', { exact: false }).scrollIntoViewIfNeeded()
      await capture('04-archive-thread-end')
      await act(quick(page, 'Files'))
      await act(link(page, 'queue/'))
      await act(link(page, '8c2f.msg'))
      await capture('05-denied')
      await act(quick(page, 'Login'))
      await expect(alias(page)).toBeInViewport()
      if (narrow) {
        await expect(frame.getByRole('form', { name: 'Command composer' })).toBeVisible()
        await expect(frame.getByRole('heading', { name: 'Objective' })).toBeHidden()
      }
      await capture('06-login')
      if (width < 600) {
        await alias(page).focus()
        await page.setViewportSize({ width, height: 435 })
        await expect(alias(page)).toBeInViewport()
        await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeInViewport()
        await page.screenshot({ path: info.outputPath('07-keyboard-space.png') })
        await page.setViewportSize({ width, height })
      }
      await alias(page).fill('AINT')
      await alias(page).press('Home')
      await act(quick(page, 'Files'))
      await act(link(page, 'notes/'))
      await act(link(page, 'print-samples.txt'))
      await capture('08-keypad')
      await act(terminal(page).getByRole('button', { name: /Inspect U\+1D40C/ }))
      const details = inspection(page, 'U+1D40C')
      await expect(details.getByRole('button', { name: /NFKC: Inspect U\+004D/ })).toBeVisible()
      await capture('09-inspection')
      const insert = details.getByRole('button', { name: 'Insert', exact: true })
      if (width < 600) {
        await page.setViewportSize({ width, height: 435 })
        await page
          .getByRole('region', { name: 'Terminal', exact: true })
          .evaluate((element) => element.scrollIntoView({ block: 'end' }))
        await insert.scrollIntoViewIfNeeded()
        await expect(insert).toBeInViewport({ ratio: 1 })
        await expect(alias(page)).toBeInViewport()
        await page.screenshot({ path: info.outputPath('10-inspection-short-viewport.png') })
        await page.setViewportSize({ width, height })
      }
      await act(insert)
      await expect(alias(page)).toHaveValue(compatible)
      await expect(
        terminal(page)
          .locator('.command-echo bdi')
          .filter({ hasText: /^inspect \u{1D40C}$/u }),
      ).toHaveCount(1)
      await alias(page).fill('MAINT')
      await act(page.getByRole('button', { name: 'Run', exact: true }))
      await expect(terminal(page)).toContainText('Reserved account name')
      await capture('11-rejected')
      await alias(page).fill(compatible)
      await act(page.getByRole('button', { name: 'Run', exact: true }))
      await expect(terminal(page)).toContainText('Authentication accepted')
      if (narrow) {
        await expect(contextPanel(page)).toBeHidden()
        await act(sessionToggle)
        await expect(sessionToggle).toHaveAttribute('aria-expanded', 'true')
      }
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
      if (narrow) await act(sessionToggle)
      await act(quick(page, 'Files'))
      await act(link(page, 'queue/'))
      await act(link(page, '8c2f.msg'))
      if (narrow) await act(sessionToggle)
      await expect(contextPanel(page)).toContainText('Complete')
      await expect(incident(page)).toBeVisible()
      await expect(
        terminal(page).getByText('Incident 8C2F retrieved. Objective complete.'),
      ).toBeInViewport()
      await capture('13-complete')
    })
  })
}
