import { expect, test, type Locator, type Page } from '@playwright/test'
import { commandControl } from './command-controls'
import { skipOpening } from './opening'

test.beforeEach(async ({ page }) => {
  await skipOpening(page)
})

async function fixture(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'relay-07', exact: true }).click()
  await commandControl(page, 'login')
  await expect(page.getByRole('textbox', { name: 'Account alias' })).toBeVisible()
}

async function watchEditCues(page: Page) {
  await page.addInitScript(() => {
    const cues: { target: string; duration: number }[] = []
    const animate = Element.prototype.animate
    Element.prototype.animate = function (frames, options) {
      if (this.hasAttribute('data-edit-cue')) {
        cues.push({
          target: this.getAttribute('aria-label') ?? this.className,
          duration: Number(typeof options === 'number' ? options : options?.duration),
        })
        document.documentElement.dataset.editCues = JSON.stringify(cues)
      }
      return animate.call(this, frames, options)
    }
  })
  return () => page.evaluate(() => JSON.parse(document.documentElement.dataset.editCues ?? '[]'))
}

test('inspects a selected scalar and reuses earlier results at the active selection and caret', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await fixture(page)
  const input = page.getByRole('textbox', { name: 'Account alias' })
  const editor = page.getByRole('form', { name: 'Command composer' })
  const log = page.getByRole('log')
  const details = (notation: string) => log.getByRole('region', { name: 'Unicode ' + notation })
  const command = page.getByRole('textbox', { name: 'Terminal command' })
  await input.fill('e\u0301🧪\u200b')
  await expect(page.getByText('4 total', { exact: true })).toBeVisible()
  await editor.getByRole('button', { name: 'Code points', exact: true }).click()
  await expect(editor.getByRole('button', { name: /U\+0301/ })).toBeVisible()
  await expect(editor.getByRole('button', { name: /U\+200B, ZWSP/ })).toBeVisible()
  await editor.getByRole('button', { name: /U\+1F9EA/ }).click()
  await editor.getByRole('button', { name: 'Copy notation' }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('U+1F9EA')
  await editor.getByRole('button', { name: 'Inspect', exact: true }).press('Enter')
  const emoji = details('U+1F9EA')
  await expect(emoji).toBeFocused()
  await expect(emoji).toContainText('Other symbol')
  await expect(input).toHaveValue('e\u0301🧪\u200b')
  await page
    .getByRole('group', { name: 'Quick actions' })
    .getByRole('button', { name: 'inspect', exact: true })
    .click()
  const scalar = page.getByRole('textbox', { name: 'character', exact: true })
  await scalar.fill('U+D800')
  await scalar.press('Enter')
  await expect(log).toContainText('Enter one Unicode scalar')
  await scalar.fill('U+00E9')
  await scalar.press('Enter')
  await page
    .getByRole('group', { name: 'Quick actions' })
    .getByRole('button', { name: 'login', exact: true })
    .click()
  const accented = details('U+00E9')
  await expect(accented.getByRole('button', { name: /^NFD: Inspect U\+0065/ })).toBeVisible()
  await accented.getByRole('button', { name: /^NFD: Inspect U\+0301/ }).press('Enter')
  await expect(details('U+0301')).toContainText('Nonspacing mark')
  expect(
    await input.evaluate((field: HTMLTextAreaElement) => [
      field.selectionStart,
      field.selectionEnd,
    ]),
  ).toEqual([2, 4])
  await accented.getByRole('button', { name: 'Replace', exact: true }).click()
  await expect(input).toHaveValue('e\u0301é\u200b')
  await input.press('End')
  await accented.getByRole('button', { name: 'Insert NFD', exact: true }).click()
  await expect(input).toHaveValue('e\u0301é\u200be\u0301')
  await emoji.getByRole('button', { name: 'Insert', exact: true }).click()
  await expect(input).toHaveValue('e\u0301é\u200be\u0301🧪')
  expect(await input.evaluate((field: HTMLTextAreaElement) => field.selectionStart)).toBe(8)
  await input.press('Escape')
  await command.fill('')
  await emoji.getByRole('button', { name: 'Insert', exact: true }).click()
  await expect(command).toHaveValue('🧪')
  await expect(command).toBeFocused()
})

test('inserts an inspected character into the command selection without submitting', async ({
  page,
}) => {
  const cues = await watchEditCues(page)
  await page.goto('/')
  const command = page.getByRole('textbox', { name: 'Terminal command' })
  const log = page.getByRole('log')
  await command.fill('inspect U+0020')
  await command.press('Enter')
  const result = log.getByRole('region', { name: 'Unicode U+0020' })
  await expect(result).toBeVisible()
  await command.fill('inspect x')
  await command.press('End')
  await command.press('Shift+ArrowLeft')
  await result.getByRole('button', { name: 'Insert', exact: true }).click()
  await expect(command).toHaveValue('inspect \\u000020')
  await expect(command).toBeFocused()
  expect(await cues()).toEqual([{ target: 'free-field', duration: 180 }])
  await expect(result).toHaveCount(1)
  await command.press('Enter')
  await expect(result).toHaveCount(2)
})

test('cues the exact transfer groups or the field when the range is clipped', async ({
  page,
}, info) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' })
  const cues = await watchEditCues(page)
  await fixture(page)
  const input = page.getByRole('textbox', { name: 'Account alias' })
  await input.press('Escape')
  const command = page.getByRole('textbox', { name: 'Terminal command' })
  await command.fill('inspect U+00E9')
  await command.press('Enter')
  const result = page.getByRole('region', { name: 'Unicode U+00E9' })
  await expect(result.getByText('Changed', { exact: true })).toHaveCount(2)
  await commandControl(page, 'login')
  await input.fill('🧪')
  await page.getByRole('combobox', { name: 'Account alias inspector type' }).selectOption('utf-16')
  const insert = result.getByRole('button', { name: 'Insert NFD' })
  await insert.press('Enter')
  await expect(input).toHaveValue('🧪e\u0301')
  expect(await cues()).toEqual([
    { target: 'Unit offset 0x0002, 0065, U+0065', duration: 500 },
    { target: 'Unit offset 0x0003, 0301, U+0301', duration: 500 },
  ])
  expect(await input.evaluate((field: HTMLTextAreaElement) => field.selectionStart)).toBe(4)
  await page.screenshot({ path: info.outputPath('transfer-utf16.png') })

  const replace = result.getByRole('button', { name: 'Replace', exact: true })
  await input.fill('é')
  await input.press('Home')
  await input.press('Shift+ArrowRight')
  await replace.press('Enter')
  await expect(input).toHaveValue('é')
  expect(await input.evaluate((field: HTMLTextAreaElement) => field.selectionStart)).toBe(1)
  expect(await cues()).toHaveLength(2)

  const prefix = 'x'.repeat(100)
  await input.fill(prefix)
  const scroll = page.locator('.point-scroll')
  await scroll.evaluate((element) => (element.scrollTop = 0))
  await insert.press('Enter')
  await expect(input).toHaveValue(prefix + 'e\u0301')
  expect(await cues()).toHaveLength(3)
  expect((await cues()).at(-1)).toEqual({ target: 'argument-editor', duration: 500 })
  expect(await scroll.evaluate((element) => element.scrollTop)).toBe(0)
})

test('preserves composition and raw line endings and exposes repairable surrogate errors', async ({
  page,
}) => {
  await fixture(page)
  const input = page.getByRole('textbox', { name: 'Account alias' })
  const submit = page.getByRole('button', { name: 'Run', exact: true })
  await input.fill('a')
  await input.evaluate((field: HTMLTextAreaElement) => {
    field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    field.value = 'aに'
    field.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }))
  })
  await expect(submit).toBeDisabled()
  await input.evaluate((field: HTMLTextAreaElement) => {
    field.value = 'a日本'
    field.setSelectionRange(3, 3)
    field.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
  })
  await expect(input).toHaveValue('a日本')
  await expect(submit).toBeEnabled()
  await input.fill('')
  await input.evaluate((field: HTMLTextAreaElement) => {
    const clipboardData = new DataTransfer()
    clipboardData.setData('text/plain', 'x\r\ny')
    field.dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }),
    )
  })
  await expect(input).toHaveValue('x\ny')
  await page.getByRole('button', { name: 'Code points', exact: true }).click()
  await expect(page.getByRole('button', { name: /U\+000D, CR/ })).toBeVisible()
  await page.getByRole('button', { name: /U\+000A, LF/ }).click()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(input).toHaveValue('x\ny')
  await expect(page.getByRole('button', { name: /U\+000D, CR/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /U\+000A, LF/ })).toHaveCount(0)
  await input.evaluate((field: HTMLTextAreaElement) => {
    field.value = '🧪\ud800'
    field.dispatchEvent(new InputEvent('input', { bubbles: true }))
  })
  await submit.click()
  await expect(page.getByRole('log')).toContainText('Open Code points to find and remove it.')
  await page.getByRole('button', { name: /U\+D800, Surrogate/ }).click()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(input).toHaveValue('🧪')
})

test('shows a structured error if the browser cannot load WASM', async ({ page }) => {
  await page.route('**/*.wasm', (route) => route.abort())
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('engine_unavailable')
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toHaveCount(0)
  await page.unroute('**/*.wasm')
  await page.getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByRole('heading', { name: 'The Relay' })).toBeVisible()
})

test('prefills inspect from quick actions and inspects a native resource selection', async ({
  page,
}) => {
  await fixture(page)
  const quick = page.getByRole('group', { name: 'Quick actions' })
  await quick.getByRole('button', { name: 'inspect', exact: true }).click()
  const scalar = page.getByRole('textbox', { name: 'character', exact: true })
  await expect(scalar).toBeFocused()
  await scalar.fill('U+200B')
  await scalar.press('Enter')
  const log = page.getByRole('log')
  await expect(log.getByRole('region', { name: 'Unicode U+200B' })).toContainText('Format')
  await quick.getByRole('button', { name: 'ls', exact: true }).click()
  await log.getByRole('button', { name: 'README' }).click()
  const resource = log.getByRole('region', { name: 'File /README' })
  await resource.locator('pre').evaluate((element) => {
    const range = document.createRange()
    range.setStart(element.firstChild!, 0)
    range.setEnd(element.firstChild!, 1)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
  })
  await quick.getByRole('button', { name: 'inspect U+004D', exact: true }).click()
  await expect(log.getByRole('region', { name: 'Unicode U+004D' })).toContainText(
    'Uppercase letter',
  )
})

test('marks the caret boundary in a wrapping code-point grid', async ({ page }, info) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await fixture(page)
  const input = page.getByRole('textbox', { name: 'Account alias' })
  await input.fill('a🧪bcde')
  await input.press('Home')
  await page.getByRole('button', { name: 'Code points', exact: true }).click()
  const grid = page.getByRole('group', { name: 'Account alias code points' })
  const points = grid.getByRole('button')
  const marker = grid.locator('.point-caret')
  const before = (index: number) => points.nth(index).locator('.point-caret:not(.at-end)')

  await expect(before(0)).toBeVisible()
  await input.press('ArrowRight')
  await input.press('ArrowRight')
  await expect(before(2)).toBeVisible()
  await expect(marker).toHaveCount(1)

  const nextRow = points.nth(4)
  expect((await nextRow.boundingBox())!.y).toBeGreaterThan((await points.nth(3).boundingBox())!.y)
  await points.nth(3).click()
  await expect(marker).toHaveCount(0)
  await page.getByRole('button', { name: 'Caret after', exact: true }).click()
  await expect(before(4)).toBeVisible()
  await page.screenshot({ path: info.outputPath('wrapped-caret.png') })

  await input.press('End')
  await expect(points.last().locator('.point-caret.at-end')).toBeVisible()
  await expect(marker).toHaveCount(1)
})

async function center(locator: Locator) {
  const bounds = (await locator.boundingBox())!
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
}

test('labels exact inspector units and distinguishes selection in forced colors', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 320, height: 435 })
  await fixture(page)
  const input = page.getByRole('textbox', { name: 'Account alias' })
  const kind = page.getByRole('combobox', { name: 'Account alias inspector type' })
  const status = page.locator('.inspector-stats')
  await expect(status).toContainText('Caret 0 · 0 total')
  await input.fill('e\u0301🧪')
  await input.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(2, 4))
  for (const [type, range, total, unit] of [
    ['code-points', '[2, 3)', '3', 'code point'],
    ['utf-16', '[2, 4)', '4', 'UTF-16 code unit'],
    ['utf-8', '[3, 7)', '7', 'UTF-8 byte'],
  ]) {
    await kind.selectOption(type)
    await expect(status.getByText('Range ' + range, { exact: true })).toBeVisible()
    await expect(status.getByText(total + ' total', { exact: true })).toBeVisible()
    expect(await status.ariaSnapshot()).toContain('zero-based ' + unit + ' offset')
    expect(await status.ariaSnapshot()).toContain('exclusive')
  }
  const selected = page.getByRole('button', { name: /Byte offset.*U\+1F9EA/, pressed: true })
  const neighbor = page.getByRole('button', { name: /Byte offset.*U\+0301/, pressed: false })
  await expect(selected).not.toHaveCSS('box-shadow', 'none')
  await page.emulateMedia({ forcedColors: 'active' })
  await page.keyboard.press('Tab')
  await selected.focus()
  await expect(selected).toHaveCSS('outline-style', 'solid')
  expect(await selected.evaluate((el) => getComputedStyle(el).borderColor)).not.toBe(
    await neighbor.evaluate((el) => getComputedStyle(el).borderColor),
  )
  await page.screenshot({ path: info.outputPath('forced-colors-selection.png') })
  await input.fill(String.raw`\ud800`)
  await expect(status.getByText('Count unavailable', { exact: true })).toBeVisible()
  await expect(page.getByText('Unpaired surrogate at UTF-16 offset 0.')).toBeVisible()
})

test('drags a range across rows and scrolls to select offscreen inspector blocks', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 650 })
  await fixture(page)
  const input = page.getByRole('textbox', { name: 'Account alias' })
  const range = page.getByText(/^Range \[/u)
  const kind = page.getByRole('combobox', { name: 'Account alias inspector type' })
  await input.fill(String.raw`a\u00AE🧪bcdefg`)
  await kind.selectOption('utf-8')
  const bytes = page.getByRole('group', { name: 'Account alias UTF-8' }).getByRole('button')
  const start = await center(bytes.nth(6))
  const end = await center(bytes.nth(1))
  expect(start.y).toBeGreaterThan(end.y)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 8 })
  await expect(range).toHaveText('Range [1, 11)')
  await page.mouse.up()
  await expect(range).toHaveText('Range [1, 11)')
  await expect(bytes.and(page.getByRole('button', { pressed: true }))).toHaveCount(6)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.screenshot({ path: info.outputPath('inspector-desktop-range.png') })
  await page.setViewportSize({ width: 390, height: 650 })
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(input).toHaveValue('afg')

  await input.fill('x'.repeat(100))
  await kind.selectOption('code-points')
  const points = page.getByRole('group', { name: 'Account alias code points' }).getByRole('button')
  const first = await center(points.first())
  const scroll = page.locator('.point-scroll')
  const bounds = (await scroll.boundingBox())!
  await page.mouse.move(first.x, first.y)
  await page.mouse.down()
  await page.mouse.move(first.x, bounds.y + bounds.height - 6)
  await expect.poll(() => scroll.evaluate((node) => node.scrollTop)).toBeGreaterThan(60)
  await page.mouse.up()
  const selected = points.and(page.getByRole('button', { pressed: true }))
  expect(await selected.count()).toBeGreaterThan(16)
  await expect(selected.first()).toHaveAccessibleName('Code point offset 0, U+0078, x')
})

test.describe('touch range selection', () => {
  test.use({ viewport: { width: 390, height: 435 }, isMobile: true, hasTouch: true })

  test('selects with a swipe or a held drag and keeps native vertical scrolling', async ({
    page,
  }, info) => {
    await fixture(page)
    const input = page.getByRole('textbox', { name: 'Account alias' })
    const range = page.getByText(/^Range \[/u)
    await input.fill('abcdefghijklmnopqrstuvwxyz'.repeat(4))
    await page.getByRole('button', { name: 'Code points', exact: true }).tap()
    const points = page
      .getByRole('group', { name: 'Account alias code points' })
      .getByRole('button')
    const touch = await page.context().newCDPSession(page)
    const start = await center(points.nth(1))
    const across = await center(points.nth(3))
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] })
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [across] })
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(range).toHaveText('Range [1, 4)')

    const lower = await center(points.nth(6))
    expect(lower.y).toBeGreaterThan(start.y)
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [lower] })
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: lower.x, y: lower.y - 48 }],
    })
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    const scroll = page.locator('.point-scroll')
    await expect.poll(() => scroll.evaluate((node) => node.scrollTop)).toBeGreaterThan(0)
    await expect(range).toHaveText('Range [1, 4)')

    await scroll.evaluate((node) => {
      node.scrollTop = 0
    })
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] })
    await page.waitForTimeout(350)
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [lower] })
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(range).toHaveText('Range [1, 7)')
    await page.screenshot({ path: info.outputPath('inspector-touch-range.png') })
    await expect
      .poll(() =>
        input.evaluate((field: HTMLTextAreaElement) => [field.selectionStart, field.selectionEnd]),
      )
      .toEqual([1, 7])
  })
})
