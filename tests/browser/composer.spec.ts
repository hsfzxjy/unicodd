import { expect, test, type Page } from '@playwright/test'
import { commandControl } from './command-controls'
import { commandRegistry } from '../../src/lib/commands'

const free = (page: Page) => page.getByRole('textbox', { name: 'Terminal command', exact: true })
const tag = (page: Page) => page.getByRole('button', { name: /^Change command:/ })
const run = (page: Page) => page.getByRole('button', { name: 'Run', exact: true })
const log = (page: Page) => page.getByRole('log')
const quick = (page: Page, name: string) =>
  page.getByRole('group', { name: 'Quick actions' }).getByRole('button', { name, exact: true })
const field = (page: Page, name: string) => page.getByRole('textbox', { name, exact: true })
async function editName(page: Page) {
  if (await tag(page).count()) {
    await tag(page).click()
    await page.getByRole('menuitem', { name: 'Edit command name…' }).click()
  }
}
async function typed(page: Page, text: string) {
  await editName(page)
  await free(page).fill(text)
  await free(page).press('Enter')
}
async function relay(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'relay-07', exact: true }).click()
  await expect(log(page).getByText('Relay queue online.', { exact: false })).toBeVisible()
}
async function select(page: Page, name: string) {
  await tag(page).click()
  await page.getByRole('menuitemradio', { name: new RegExp('^' + name + ' ') }).click()
}
async function selection(input: ReturnType<typeof field>, start: number, end: number) {
  await input.evaluate(
    (element: HTMLTextAreaElement, span) => {
      element.setSelectionRange(span[0], span[1])
      element.dispatchEvent(new Event('select', { bubbles: true }))
    },
    [start, end],
  )
}

test('tags every command, expands required input, leaves unknown text alone and executes zero arguments', async ({
  page,
}) => {
  await relay(page)
  const count = await log(page).locator('.terminal-entry').count()
  for (const definition of commandRegistry) {
    await editName(page)
    await free(page).fill(definition.name + ' ')
    await expect(tag(page)).toContainText(definition.name)
    await expect(free(page)).toHaveCount(0)
    await expect(page.locator('.composer-argument textarea')).toHaveCount(
      definition.arguments.length,
    )
  }
  await expect(log(page).locator('.terminal-entry')).toHaveCount(count)
  await editName(page)
  for (const text of ['lo ', 'unknown ']) {
    await free(page).fill(text)
    await expect(tag(page)).toHaveCount(0)
    await expect(free(page)).toHaveValue(text)
  }
  await free(page).fill('whoami ')
  await expect(tag(page)).toBeFocused()
  await tag(page).press('Enter')
  await expect(log(page).locator('.terminal-entry').last()).toContainText('guest · guest')
  await expect(free(page)).toBeVisible()
  await free(page).fill('cat')
  await free(page).press('Enter')
  await expect(field(page, 'path')).toBeFocused()
  await expect(page.locator('.argument-inspector')).toHaveCount(0)
  await field(page, 'path').fill('/README')
  await field(page, 'path').press('Enter')
  await expect(log(page).getByRole('region', { name: 'File /README' })).toBeVisible()
  await typed(page, 'login "  🧪é​  "')
  await expect(field(page, 'Account alias')).toHaveValue('  🧪é​  ')
  await expect(page.locator('.alias-editor')).toHaveCount(0)
  await expect(page.getByRole('form')).toHaveCount(1)
})

test('shows exact draft lengths and keeps the insertion point visible in the Unicode inspector', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 435 })
  await relay(page)
  await commandControl(page, 'login')
  const alias = field(page, 'Account alias')
  const total = page.getByLabel('Total units')
  const kind = page.getByRole('combobox', { name: 'Account alias inspector type' })
  const caret = page.locator('.argument-caret')
  await alias.fill('a🧪é\u200b')
  await expect(total).toHaveText('5')
  await selection(alias, 3, 3)
  await expect(caret).toHaveCount(0)
  await page.getByRole('button', { name: 'Code points', exact: true }).click()
  const inspector = page.getByRole('region', { name: 'Account alias Unicode inspector' })
  await expect(inspector).toBeVisible()
  await expect(caret).toBeVisible()
  await page.screenshot({ path: info.outputPath('blurred-argument-inspector.png') })
  const afterEmoji = (await caret.boundingBox())!.x
  await inspector.getByRole('button', { name: /^1\. U\+0061/ }).click()
  await inspector.getByRole('button', { name: 'Caret before' }).click()
  await expect(caret).toBeVisible()
  expect((await caret.boundingBox())!.x).toBeLessThan(afterEmoji)
  await alias.focus()
  await expect(caret).toHaveCount(0)
  await alias.fill('\\u01D40CAINT')
  await expect(total).toHaveText('5')
  await kind.selectOption('utf-8')
  await expect(total).toHaveText('8')
  await kind.selectOption('utf-16')
  await expect(total).toHaveText('6')
  await kind.selectOption('code-points')
  await alias.fill('مرحبا')
  await selection(alias, 5, 5)
  await inspector.getByRole('button', { name: /^1\. U\+0645/ }).focus()
  await expect(caret).toBeVisible()
  const rtlEnd = (await caret.boundingBox())!.x
  await alias.focus()
  await selection(alias, 0, 0)
  await inspector.getByRole('button', { name: /^1\. U\+0645/ }).focus()
  expect((await caret.boundingBox())!.x).toBeGreaterThan(rtlEnd)
  await alias.fill('a🧪é\u200b'.repeat(100))
  await alias.press('End')
  expect(await alias.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
  await selection(alias, 0, 0)
  await inspector.getByRole('button', { name: /^1\. U\+0061/ }).focus()
  await expect(caret).toBeVisible()
  expect(await alias.evaluate((element) => element.scrollLeft)).toBeLessThan(8)
})

test('reveals timed command output at its configured boundaries', async ({ page }) => {
  await page.route('**/001-the-relay/scenario.json', async (route) => {
    const scenario = await (await route.fetch()).json()
    scenario.outputTiming = {
      cat: [
        { afterRows: 0, minMs: 700, maxMs: 800 },
        { afterRows: 1, minMs: 700, maxMs: 800 },
      ],
    }
    await route.fulfill({ json: scenario })
  })
  await relay(page)
  await typed(page, 'login \\u01D40CAINT')
  await page.evaluate(() => {
    Math.random = () => 0.999
  })
  const now = Date.now()
  await page.clock.install({ time: now })
  await page.clock.pauseAt(now + 1000)
  await typed(page, 'cat /queue/8c2f.msg')
  const entry = log(page).locator('.terminal-entry').last()
  const output = entry.locator('.entry-output')
  const file = entry.getByRole('region', { name: 'File /queue/8c2f.msg' })
  await expect(entry.locator('.command-echo')).toContainText('cat /queue/8c2f.msg')
  await expect(output).toHaveCount(0)
  await expect(quick(page, 'help')).toBeDisabled()
  await page.clock.runFor(799)
  await expect(output).toHaveCount(0)
  await page.clock.runFor(1)
  await expect(file).toBeVisible()
  await expect(output.locator('> *')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Goal: In progress' })).toBeInViewport()
  const toggle = entry.getByRole('button', { name: 'Toggle command output' })
  await toggle.press('Enter')
  await expect(file).toBeHidden()
  await page.clock.runFor(800)
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  const completion = output.locator('.progress-band[data-scope="scenario"]')
  await expect(completion).toHaveCount(1)
  await expect(completion).toBeHidden()
  await expect(page.getByRole('button', { name: 'Goal: Complete', exact: true })).toBeInViewport()
  await expect(page.getByRole('status').filter({ hasText: 'The Relay · Complete' })).toHaveCount(1)
  await toggle.press('Enter')
  await expect(completion).toBeVisible()
  await expect(quick(page, 'help')).toBeEnabled()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await typed(page, 'cat /README')
  await expect(entry.getByRole('region', { name: 'File /README' })).toBeVisible()
})

test('inspects UTF-8 byte groups and selects their source scalar', async ({ page }, info) => {
  await relay(page)
  await commandControl(page, 'login')
  const alias = field(page, 'Account alias')
  const kind = page.getByRole('combobox', { name: 'Account alias inspector type' })
  const grid = page.getByRole('group', { name: 'Account alias UTF-8' })
  await alias.fill('a🧪é\u200b')
  await kind.selectOption('utf-8')
  await expect(grid.locator('button > bdi')).toHaveText(['a', '🧪', 'e', '◌́', 'ZWSP'])
  await expect(grid.locator('.argument-byte-values')).toHaveText([
    '61',
    'F0 9F A7 AA',
    '65',
    'CC 81',
    'E2 80 8B',
  ])
  await page.screenshot({ path: info.outputPath('utf8-bytes-desktop.png') })
  await page.setViewportSize({ width: 390, height: 435 })
  const emoji = grid.getByRole('button', { name: 'Byte offset 0x0001, F0 9F A7 AA, U+1F9EA' })
  expect((await emoji.boundingBox())!.width).toBeGreaterThan(
    (await grid.getByRole('button').first().boundingBox())!.width,
  )
  await emoji.click()
  await expect(emoji).toHaveAttribute('aria-pressed', 'true')
  expect(
    await alias.evaluate((field: HTMLTextAreaElement) => [
      field.selectionStart,
      field.selectionEnd,
    ]),
  ).toEqual([1, 3])
  await expect(alias).toHaveValue('a🧪é\u200b')
  await page.screenshot({ path: info.outputPath('utf8-bytes-compact.png') })

  await alias.fill(String.raw`\u0069`)
  await expect(grid.locator('.argument-byte-values')).toHaveText(['69'])
  await page.setViewportSize({ width: 1280, height: 720 })
  await alias.fill('🧪'.repeat(49))
  await selection(alias, 0, 0)
  const groups = grid.getByRole('button')
  const next = page.getByRole('button', { name: 'Next', exact: true })
  await expect(groups).toHaveCount(49)
  await expect(next).toBeHidden()
  await page.screenshot({ path: info.outputPath('utf8-long-desktop.png') })

  await page.setViewportSize({ width: 390, height: 435 })
  await expect(groups).toHaveCount(49)
  await expect(next).toBeHidden()
  const last = groups.last()
  await expect(last).toHaveAccessibleName('Byte offset 0x00C0, F0 9F A7 AA, U+1F9EA')
  await last.click()
  await expect(last).toHaveAttribute('aria-pressed', 'true')
  expect(
    await alias.evaluate((field: HTMLTextAreaElement) => [
      field.selectionStart,
      field.selectionEnd,
    ]),
  ).toEqual([96, 98])
  await page.screenshot({ path: info.outputPath('utf8-long-compact.png') })

  await alias.evaluate((field: HTMLTextAreaElement) => {
    field.value = 'a\ud800'
    field.dispatchEvent(new InputEvent('input', { bubbles: true }))
  })
  await expect(page.getByText('Unpaired surrogate at UTF-16 offset 1.')).toBeVisible()
  await expect(grid).toHaveCount(0)
  await kind.selectOption('code-points')
  await expect(page.getByRole('button', { name: /U\+D800, Surrogate/ })).toBeVisible()
})

test('inspects escaped units, keeps the toolbar in place and reuses the raw echo', async ({
  page,
}, info) => {
  await page.route('**/001-the-relay/scenario.json', async (route) => {
    const scenario = await (await route.fetch()).json()
    const host = scenario.hosts.find((host: { login?: unknown }) => host.login)
    host.login.inspectors.push('wtf-8')
    await route.fulfill({ json: scenario })
  })
  await relay(page)
  await commandControl(page, 'login')
  const alias = field(page, 'Account alias')
  const kind = page.getByRole('combobox', { name: 'Account alias inspector type' })
  const inspector = page.getByRole('region', { name: 'Account alias Unicode inspector' })
  const actions = inspector.getByRole('group', { name: 'Inspector actions' })
  await expect(actions).toBeHidden()
  const source = String.raw`a\U1F9EA!\ud800.`
  await alias.fill(source)
  await kind.selectOption('utf-16')
  await selection(alias, 4, 4)
  await expect(page.getByLabel('Caret position')).toHaveText('3')
  await expect(page.getByLabel('Total units')).toHaveText('6')
  await expect(inspector.getByRole('button', { name: /D83E DDEA/ })).toBeVisible()
  await selection(alias, 3, 5)
  await expect(page.getByLabel('Selected unit range')).toHaveText('1-3')
  await expect(inspector.getByRole('button', { name: /D83E DDEA/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await kind.selectOption('wtf-8')
  await expect(inspector.getByRole('button', { name: /ED A0 80, U\+D800/ })).toBeVisible()
  await expect(page.getByLabel('Selected unit range')).toHaveText('1-5')
  await expect(page.getByLabel('Total units')).toHaveText('10')
  await page.screenshot({ path: info.outputPath('wtf-8-desktop.png') })
  await actions.getByRole('button', { name: 'Delete' }).click()
  await expect(alias).toHaveValue(String.raw`a!\ud800.`)
  await alias.fill('🧪'.repeat(450))
  await page.setViewportSize({ width: 390, height: 435 })
  const toolbarTop = (await actions.boundingBox())!.y
  await inspector.locator('.point-scroll').evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await expect(inspector.getByRole('button', { name: /^Byte offset/ }).last()).toBeInViewport()
  expect((await actions.boundingBox())!.y).toBe(toolbarTop)
  await page.screenshot({ path: info.outputPath('wtf-8-mobile.png') })

  const draft = String.raw`\UAE! a"b`
  await alias.fill(draft)
  await alias.press('Escape')
  const plain = String.raw`login "\UAE! a\"b"`
  await expect(free(page)).toHaveValue(plain)
  await free(page).press('Enter')
  const entry = log(page).locator('.terminal-entry').last()
  await expect(entry.locator('.command-line bdi')).toHaveText('login "®! a"b"')
  await expect(alias).toHaveValue(String.raw`\UAE! a\"b`)
  await page.reload()
  await expect(entry.locator('.command-line bdi')).toHaveText('login "®! a"b"')
  await entry.getByRole('button', { name: 'Edit this command' }).click()
  await expect(alias).toHaveValue(String.raw`\UAE! a\"b`)
})

test('resizes an argument upward and restores its height across commands and reload', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await relay(page)
  await commandControl(page, 'login')
  const alias = field(page, 'Account alias')
  const handle = page.getByRole('button', { name: 'Resize Account alias' })
  const inspector = page.getByRole('button', { name: 'Code points', exact: true })
  const before = (await alias.boundingBox())!
  const below = (await inspector.boundingBox())!.y
  const grip = (await handle.boundingBox())!
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
  await page.mouse.down()
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 - 90, { steps: 6 })
  await page.mouse.up()
  const after = (await alias.boundingBox())!
  expect(after.height).toBe(before.height + 90)
  expect(after.y).toBe(before.y - 90)
  expect((await inspector.boundingBox())!.y).toBe(below)
  expect(await alias.evaluate((element) => element.scrollHeight === element.clientHeight)).toBe(
    true,
  )
  await select(page, 'cat')
  expect((await field(page, 'path').boundingBox())!.height).toBe(before.height)
  await select(page, 'login')
  expect((await alias.boundingBox())!.height).toBe(after.height)
  await page.reload()
  await expect(alias).toBeVisible()
  expect((await alias.boundingBox())!.height).toBe(after.height)
  await handle.press('ArrowDown')
  expect((await alias.boundingBox())!.height).toBe(after.height - 12)
  await page.screenshot({ path: info.outputPath('resized-argument-desktop.png') })

  await page.setViewportSize({ width: 390, height: 435 })
  await expect(run(page)).toBeInViewport({ ratio: 1 })
  expect((await alias.boundingBox())!.height).toBe(after.height - 12)
  await page.screenshot({ path: info.outputPath('resized-argument-mobile.png') })

  const touch = await page.context().newCDPSession(page)
  await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true })
  const mobileGrip = (await handle.boundingBox())!
  const x = mobileGrip.x + mobileGrip.width / 2
  const y = mobileGrip.y + mobileGrip.height / 2
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x, y: y + 36 }],
  })
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  expect((await alias.boundingBox())!.height).toBe(after.height - 48)
  await touch.send('Emulation.setTouchEmulationEnabled', { enabled: false })

  await page.setViewportSize({ width: 900, height: 430 })
  await typed(page, 'login 𝐌AINT')
  await typed(page, 'cat /queue/8c2f.msg')
  await page.getByRole('combobox', { name: 'Case' }).selectOption('002-dead-letter')
  await commandControl(page, 'route')
  const header = field(page, 'Header recipient')
  const envelope = field(page, 'Envelope recipient')
  const headerHeight = (await header.boundingBox())!.height
  const siblingY = (await envelope.boundingBox())!.y
  const headerGrip = page.getByRole('button', { name: 'Resize Header recipient' })
  for (let step = 0; step < 5; step++) await headerGrip.press('ArrowUp')
  expect((await header.boundingBox())!.height).toBe(headerHeight + 60)
  expect((await envelope.boundingBox())!.y).toBe(siblingY)
  await expect(run(page)).toBeInViewport({ ratio: 1 })
})

test('collapses individual results and reuses the full command as an editable draft', async ({
  page,
}, info) => {
  await relay(page)
  await typed(page, 'ls "./notes"')
  const listing = log(page).locator('.terminal-entry').last()
  await expect(listing.getByRole('button', { name: 'keypad.txt' })).toBeVisible()
  await typed(page, 'cat "/README"')
  const entries = log(page).locator('.terminal-entry')
  const notes = entries.filter({ hasText: 'ls "./notes"' })
  const file = entries.last().getByRole('region', { name: 'File /README' })
  await expect(file).toBeVisible()
  expect(
    await notes
      .locator('.prompt-host')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true)
  await page.screenshot({ path: info.outputPath('expanded-transcript-desktop.png') })

  await page.setViewportSize({ width: 390, height: 435 })
  const toggle = notes.getByRole('button', { name: 'Toggle command output' })
  expect((await toggle.boundingBox())!.width).toBeGreaterThanOrEqual(32)
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(notes.getByRole('button', { name: 'keypad.txt' })).toBeHidden()
  await expect(file).toBeVisible()
  await expect(toggle).toBeFocused()
  await page.screenshot({ path: info.outputPath('collapsed-transcript-compact.png') })
  await toggle.press('Enter')
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(notes.getByRole('button', { name: 'keypad.txt' })).toBeVisible()

  const command = 'unknown ' + 'a'.repeat(503) + '🧪é'
  await typed(page, command)
  const last = entries.last()
  await expect(last.locator('.command-echo bdi')).toHaveText(command.slice(0, 511) + '…')
  const count = await entries.count()
  await commandControl(page, 'login')
  await field(page, 'Account alias').fill('🧪é')
  await last.getByRole('button', { name: 'Edit this command' }).click()
  await expect(free(page)).toHaveValue(command)
  await expect(free(page)).toBeFocused()
  await expect(entries).toHaveCount(count)
  await notes.getByRole('button', { name: 'Edit this command' }).click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(tag(page)).toContainText('ls')
  await expect(field(page, 'path')).toHaveValue('./notes')
  await expect(field(page, 'path')).toBeFocused()
  await expect(entries).toHaveCount(count)
  await commandControl(page, 'login')
  await expect(field(page, 'Account alias')).toHaveValue('🧪é')

  await typed(page, 'whoami')
  await expect(entries.last()).toContainText('guest · guest')
  await entries.last().getByRole('button', { name: 'Edit this command' }).click()
  await expect(tag(page)).toContainText('whoami')
  await expect(tag(page)).toBeFocused()

  await typed(page, 'ls ""')
  await expect(entries.last()).toContainText('Enter a resource path.')
  await entries.last().getByRole('button', { name: 'Edit this command' }).click()
  await expect(free(page)).toHaveValue('ls ""')

  await typed(page, String.raw`login \u000041`)
  await expect(entries.last()).toContainText('Login rejected')
  await entries.last().getByRole('button', { name: 'Edit this command' }).click()
  await expect(field(page, 'Account alias')).toHaveValue(String.raw`\u000041`)
})

for (const [width, height] of [
  [1280, 800],
  [390, 435],
]) {
  test.describe(`transcript at ${width} × ${height}`, () => {
    test.use({ viewport: { width, height }, hasTouch: width < 600, isMobile: width < 600 })

    test('keeps the last command header in place when toggling its output', async ({
      page,
    }, info) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await relay(page)
      for (let i = 0; i < 12; i++) await commandControl(page, 'ls', undefined, true)
      await typed(page, 'ls ./notes')
      const entry = log(page).locator('.terminal-entry').last()
      await expect(entry.getByRole('button', { name: 'keypad.txt' })).toBeVisible()
      const header = entry.locator('.command-echo')
      const toggle = header.getByRole('button', { name: 'Toggle command output' })
      const measure = () => header.evaluate((element) => element.getBoundingClientRect().top)
      await expect(toggle).toBeInViewport({ ratio: 1 })
      expect(await log(page).evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
      const top = await measure()
      const activate = () => (width < 600 ? toggle.tap() : toggle.click())
      await activate()
      await expect(toggle).toHaveAttribute('aria-expanded', 'false')
      expect(Math.abs((await measure()) - top)).toBeLessThanOrEqual(1)
      await page.screenshot({ path: info.outputPath('collapsed-near-end.png') })

      await toggle.press('Enter')
      await expect(toggle).toHaveAttribute('aria-expanded', 'true')
      expect(Math.abs((await measure()) - top)).toBeLessThanOrEqual(1)
      await activate()
      await expect(toggle).toHaveAttribute('aria-expanded', 'false')
      await typed(page, 'whoami')
      await expect(entry).toContainText('guest · guest')
      const endGap = await entry.evaluate((element) => {
        const transcript = element.closest('.transcript')!
        return transcript.getBoundingClientRect().bottom - element.getBoundingClientRect().bottom
      })
      expect(endGap).toBeGreaterThanOrEqual(0)
      expect(endGap).toBeLessThanOrEqual(18)
    })
  })
}

test('switches commands without execution, navigates the menu and restores scoped drafts and UTF-16 selections', async ({
  page,
}) => {
  await relay(page)
  await commandControl(page, 'login')
  const alias = field(page, 'Account alias')
  await alias.fill('a🧪é​')
  await selection(alias, 1, 3)
  const count = await log(page).locator('.terminal-entry').count()
  await tag(page).press('ArrowDown')
  const current = page.getByRole('menuitemradio', { checked: true })
  await expect(current).toBeFocused()
  await current.press('End')
  await expect(page.getByRole('menuitem', { name: 'Edit command name…' })).toBeFocused()
  await page.keyboard.press('Home')
  await expect(current).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(tag(page)).toBeFocused()
  await select(page, 'cat')
  await expect(field(page, 'path')).toBeFocused()
  await field(page, 'path').fill('/notes/keypad.txt')
  await select(page, 'login')
  await expect(alias).toHaveValue('a🧪é​')
  expect(
    await alias.evaluate((element: HTMLTextAreaElement) => [
      element.selectionStart,
      element.selectionEnd,
    ]),
  ).toEqual([1, 3])
  await expect(log(page).locator('.terminal-entry')).toHaveCount(count)
  await alias.press('Shift+Tab')
  await expect(tag(page)).toBeFocused()
  await tag(page).press('Tab')
  await expect(run(page)).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(alias).toBeFocused()
  await alias.press('Tab')
  await expect(page.getByRole('button', { name: 'Resize Account alias' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Code points', exact: true })).toBeFocused()
  await alias.fill('')
  await alias.press('Backspace')
  await expect(free(page)).toBeFocused()
  expect(
    await free(page).evaluate((element: HTMLInputElement) => [
      element.selectionStart,
      element.selectionEnd,
    ]),
  ).toEqual([0, 5])
  await free(page).fill('unknown command')
  await free(page).press('Enter')
  await expect(free(page)).toHaveValue('unknown command')
  await expect(log(page)).toContainText('Unknown command')
})

test('defers conversion, submission, cancellation and field advance throughout IME composition', async ({
  page,
}) => {
  await relay(page)
  const command = free(page)
  await command.evaluate((element) =>
    element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })),
  )
  await command.fill('login ')
  await command.press('Enter')
  await command.press('Escape')
  await expect(tag(page)).toHaveCount(0)
  await command.evaluate((element) =>
    element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })),
  )
  await expect(tag(page)).toHaveCount(0)
  await command.fill('login')
  await command.press('Space')
  const alias = field(page, 'Account alias')
  await expect(alias).toBeFocused()
  const count = await log(page).locator('.terminal-entry').count()
  await alias.evaluate((element) =>
    element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })),
  )
  await alias.press('Enter')
  await alias.press('Space')
  await alias.press('Escape')
  await expect(tag(page)).toContainText('login')
  await expect(run(page)).toBeDisabled()
  await expect(log(page).locator('.terminal-entry')).toHaveCount(count)
  await alias.evaluate((element: HTMLTextAreaElement) => {
    element.value = '日本'
    element.setSelectionRange(2, 2)
    element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
  })
  await alias.press('Enter')
  await expect(alias).toHaveValue('日本')
  await expect(log(page).locator('.terminal-entry')).toHaveCount(count + 1)
})

test('retains failed arguments and cursor context, recalls structured history and applies a success once', async ({
  page,
}) => {
  await relay(page)
  await commandControl(page, 'login')
  const alias = field(page, 'Account alias')
  await alias.fill('a🧪é​')
  await selection(alias, 1, 3)
  await alias.press('Enter')
  await expect(alias).toBeFocused()
  await expect(alias).toHaveValue('a🧪é​')
  expect(
    await alias.evaluate((element: HTMLTextAreaElement) => [
      element.selectionStart,
      element.selectionEnd,
    ]),
  ).toEqual([1, 3])
  await alias.fill(String.raw`\u01D40CAINT`)
  await alias.press('Enter')
  await expect(free(page)).toBeVisible()
  await expect(log(page).getByText('Authentication accepted', { exact: false })).toHaveCount(1)
  await free(page).press('ArrowUp')
  await expect(alias).toHaveValue(String.raw`\u01D40CAINT`)
  await alias.fill('draft with spaces')
  await alias.press('Shift+Enter')
  await expect(alias).toHaveValue('draft with spaces\n')
  await page.getByRole('button', { name: /^Open local inbox/ }).click()
  await log(page).getByRole('button', { name: 'A favor', exact: true }).last().click()
  await expect(log(page).getByRole('region', { name: 'Inbox message' })).toBeVisible()
  const mailEntry = log(page).locator('.terminal-entry').last()
  await expect(mailEntry.locator('.command-line')).toHaveText(/local.*mail favor/)
  await expect(mailEntry.locator('.command-line')).not.toContainText('@relay-07')
  await expect(alias).toHaveValue('draft with spaces\n')
  await page.reload()
  await expect(mailEntry.locator('.command-line')).toHaveText(/local.*mail favor/)
  await expect(alias).toHaveValue('draft with spaces\n')
  await commandControl(page, 'logout', undefined, true)
  await expect(page.locator('.prompt-host').last()).toHaveText('local ›')
  await log(page).getByRole('button', { name: 'relay-07', exact: true }).last().click()
  await commandControl(page, 'login')
  await expect(alias).not.toHaveValue('draft with spaces\n')
})

test('keeps extra one-line arguments repairable and preserves raw scalar escapes on failed retry', async ({
  page,
}) => {
  await relay(page)
  await typed(page, 'connect missing')
  await expect(field(page, 'host')).toHaveValue('missing')
  await typed(page, 'login a b')
  await expect(free(page)).toHaveValue('login a b')
  await typed(page, String.raw`login \u00D800`)
  const alias = field(page, 'Account alias')
  await expect(alias).toHaveValue(String.raw`\u00D800`)
  await alias.fill(String.raw`\u01D40CAINT`)
  await run(page).dblclick()
  await expect(log(page).getByText('Authentication accepted', { exact: false })).toHaveCount(1)
})

test('maps the one-line caret into a failed Unicode argument and disables edits for zero parameters', async ({
  page,
}) => {
  await relay(page)
  await free(page).fill('login "a🧪b"')
  await free(page).evaluate((element: HTMLInputElement) => element.setSelectionRange(8, 10))
  await free(page).press('Enter')
  const alias = field(page, 'Account alias')
  await expect(alias).toHaveValue('a🧪b')
  expect(
    await alias.evaluate((element: HTMLTextAreaElement) => [
      element.selectionStart,
      element.selectionEnd,
    ]),
  ).toEqual([1, 3])
  await page.getByRole('button', { name: 'Code points', exact: true }).click()
  await page.getByRole('form').getByRole('button', { name: 'Inspect', exact: true }).click()
  const details = log(page).getByRole('region', { name: 'Unicode U+1F9EA' })
  await expect(details).toBeVisible()
  await select(page, 'whoami')
  await expect(details.getByRole('button', { name: 'Insert', exact: true })).toBeDisabled()
  await select(page, 'login')
  await expect(alias).toHaveValue('a🧪b')
  await alias.press('Escape')
  await free(page).fill('whoami')
  await free(page).press('Enter')
  await free(page).press('ArrowUp')
  await free(page).press('ArrowUp')
  await expect(alias).toHaveValue('a🧪b')
})

test('advances and reverses through both route fields and preserves both reconstruction names on retry', async ({
  page,
}) => {
  test.skip(
    Boolean(process.env.PLAYWRIGHT_TEST_PREVIEW),
    'Uses isolated development entries; production campaign is covered separately',
  )
  await page.goto('/?scenario=002-dead-letter')
  await free(page).fill('route')
  await free(page).press('Enter')
  const header = field(page, 'Header recipient')
  const envelope = field(page, 'Envelope recipient')
  await expect(header).toBeFocused()
  await header.fill('a🧪b')
  await header.press('Enter')
  await expect(envelope).toBeFocused()
  await envelope.press('Shift+Tab')
  await expect(header).toBeFocused()
  await header.press('Enter')
  await expect(envelope).toBeFocused()
  await envelope.fill('Ｍira')
  await selection(envelope, 0, 1)
  await envelope.press('Enter')
  await expect(header).toHaveValue('a🧪b')
  await expect(envelope).toHaveValue('Ｍira')
  expect(
    await envelope.evaluate((element: HTMLTextAreaElement) => [
      element.selectionStart,
      element.selectionEnd,
    ]),
  ).toEqual([0, 1])
  await page.goto('/?scenario=003-the-index')
  await typed(page, 'reconcile Mіra')
  await typed(page, 'reconstruct')
  await expect(page.locator('.composer-fixed')).toContainText('0001842')
  await expect(page.locator('.composer-fixed')).toContainText('0002917')
  const a = field(page, 'Original name A')
  const b = field(page, 'Original name B')
  await a.fill('Mira')
  await b.fill('M🧪ra')
  await selection(b, 1, 3)
  await b.press('Enter')
  await expect(a).toHaveValue('Mira')
  await expect(b).toHaveValue('M🧪ra')
  await typed(page, 'inspect U+0456')
  await commandControl(page, 'reconstruct')
  await log(page)
    .getByRole('region', { name: 'Unicode U+0456' })
    .getByRole('button', { name: 'Replace', exact: true })
    .click()
  await expect(a).toHaveValue('Mira')
  await expect(b).toHaveValue('Mіra')
  await b.press('Enter')
  await expect(log(page)).toContainText('Reconstruction verified')
  await expect(free(page)).toBeVisible()
})

test('keeps a long structured command and its menu usable at 320 × 430', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await relay(page)
  await typed(page, 'login 𝐌AINT')
  await typed(page, 'cat /queue/8c2f.msg')
  await page.getByRole('combobox', { name: 'Case' }).selectOption('002-dead-letter')
  await commandControl(page, 'route')
  const header = field(page, 'Header recipient')
  const draft = 'a🧪é'.repeat(45)
  await header.fill(draft)
  await selection(header, 1, 3)
  await page.getByRole('button', { name: 'Code points', exact: true }).click()
  const goal = page.getByRole('button', { name: 'Goal: In progress', exact: true })
  await goal.click()
  await page.setViewportSize({ width: 320, height: 430 })
  await expect(goal).toBeInViewport({ ratio: 1 })
  await expect(run(page)).toBeInViewport({ ratio: 1 })
  await expect(log(page)).toBeInViewport({ ratio: 1 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320)
  await tag(page).press('ArrowDown')
  const menu = page.getByRole('menu', { name: 'Commands' })
  await expect(menu).toBeInViewport({ ratio: 1 })
  await expect(menu.getByRole('menuitemradio', { checked: true })).toBeFocused()
  await page.keyboard.press('End')
  await expect(menu.getByRole('menuitem', { name: 'Edit command name…' })).toBeInViewport({
    ratio: 1,
  })
  await page.keyboard.press('Escape')
  await expect(tag(page)).toBeFocused()
  await expect(header).toHaveValue(draft)
  expect(
    await header.evaluate((element: HTMLTextAreaElement) => [
      element.selectionStart,
      element.selectionEnd,
    ]),
  ).toEqual([1, 3])
})

for (const [width, height] of [
  [375, 812],
  [390, 844],
  [768, 1024],
  [1280, 800],
  [1440, 900],
]) {
  test.describe(`${width} × ${height} composer`, () => {
    test.use({ viewport: { width, height }, hasTouch: width <= 768, isMobile: width <= 600 })
    test('renders the same prompt surface, dropdown, optional argument and long Unicode draft', async ({
      page,
    }, info) => {
      await relay(page)
      const frame = page.getByRole('region', { name: 'Terminal', exact: true })
      const frameBox = (await frame.boundingBox())!
      const gutter = width <= 600 ? 0 : width <= 830 ? 4 : 12
      expect(frameBox.width).toBe(Math.min(1200, width - 2 * gutter))
      expect(Math.abs(frameBox.x - (width - frameBox.width) / 2)).toBeLessThan(1)
      const systemFont = /^system-ui\b/u
      const capture = async (name: string) => {
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
        await expect(run(page)).toBeInViewport({ ratio: 1 })
        await page.screenshot({ path: info.outputPath(name + '.png') })
      }
      await capture('01-free')
      await free(page).fill('help ')
      await expect(tag(page)).toHaveCSS('font-family', systemFont)
      await capture('02-zero')
      await tag(page).click()
      const menu = page.getByRole('menu', { name: 'Commands' })
      await expect(menu).toBeInViewport({ ratio: 1 })
      const item = menu.getByRole('menuitemradio').first()
      await expect(item).toHaveCSS('font-family', systemFont)
      await expect(item.locator('.meta')).toHaveCSS('font-family', systemFont)
      await expect(page.getByRole('menuitemradio', { name: /^reconstruct / })).toHaveCount(0)
      await capture('03-dropdown')
      await page.keyboard.press('Escape')
      await select(page, 'ls')
      const path = field(page, 'path')
      await expect(path).toBeVisible()
      await expect(path).toHaveAttribute('placeholder', 'path')
      const tagBox = (await tag(page).boundingBox())!
      const pathBox = (await path.boundingBox())!
      const runBox = (await run(page).boundingBox())!
      if (width <= 600) {
        const formBox = (await page.getByRole('form', { name: 'Command composer' }).boundingBox())!
        expect(pathBox.y).toBeGreaterThanOrEqual(
          Math.max(tagBox.y + tagBox.height, runBox.y + runBox.height),
        )
        expect(pathBox.width).toBeGreaterThanOrEqual(formBox.width - 12)
      } else {
        expect(
          Math.abs(pathBox.y + pathBox.height / 2 - tagBox.y - tagBox.height / 2),
        ).toBeLessThan(2)
        expect(pathBox.x).toBeGreaterThan(tagBox.x + tagBox.width)
        expect(pathBox.x + pathBox.width).toBeLessThanOrEqual(runBox.x)
      }
      await capture('03-path')
      await run(page).click()
      await expect(log(page).locator('.terminal-entry').last()).toContainText('/')
      await commandControl(page, 'login')
      const alias = field(page, 'Account alias')
      await expect(alias).toHaveAttribute('placeholder', 'Account alias')
      await expect(alias).toHaveCSS('font-size', '13px')
      const inspectorType = page.getByRole('combobox', { name: 'Account alias inspector type' })
      await expect(inspectorType).toHaveCSS('font-family', systemFont)
      await expect(inspectorType.locator('option').first()).toHaveCSS('font-family', systemFont)
      await alias.fill('a🧪é​'.repeat(100))
      expect((await alias.boundingBox())!.height).toBe(width === 768 ? 44 : 36)
      await selection(alias, 0, 1)
      const pointsToggle = page.getByRole('button', { name: 'Code points', exact: true })
      await pointsToggle.click()
      await expect(page.locator('.argument-mirror')).toHaveCSS('font-size', '13px')
      await page
        .getByRole('form', { name: 'Command composer' })
        .getByRole('button', { name: 'Inspect', exact: true })
        .click()
      await expect(log(page).getByRole('region', { name: 'Unicode U+0061' })).toBeVisible()
      await pointsToggle.click()
      await capture('04-long-inspection')
      await alias.press('Enter')
      await expect(alias).toHaveValue('a🧪é​'.repeat(100))
      await capture('05-retry')
      if (width <= 600) {
        await page.setViewportSize({ width, height: 435 })
        await expect(alias).toBeInViewport()
        await capture('06-keyboard-height')
      }
      await pointsToggle.click()
      const inspector = page.getByRole('region', { name: 'Account alias Unicode inspector' })
      const points = inspector
        .getByRole('group', { name: 'Account alias code points' })
        .getByRole('button')
      await expect(points).toHaveCount(500)
      await expect(points.first().locator('code')).toHaveCSS('font-family', systemFont)
      await expect(inspector.getByText(/^Page \d+ of \d+$/)).toHaveCount(0)
      await expect(inspector).toBeInViewport({ ratio: 1 })
      await expect(alias).toBeInViewport({ ratio: 1 })
      await capture('07-code-points')
      const last = points.last()
      await expect(last).toHaveAccessibleName('500. U+200B, ZWSP')
      await last.click()
      await expect(last).toHaveAttribute('aria-pressed', 'true')
      await capture('08-code-points-end')
    })
  })
}
