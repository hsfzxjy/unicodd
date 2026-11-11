import { expect, test, type Page } from '@playwright/test'

async function fixture(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'relay-07', exact: true }).click()
  await page.getByRole('button', { name: 'Login', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Account alias' })).toBeVisible()
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
  await expect(page.getByText('4 code points', { exact: true })).toBeVisible()
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
    .getByRole('button', { name: 'Inspect', exact: true })
    .click()
  const scalar = page.getByRole('textbox', { name: 'character', exact: true })
  await scalar.fill('U+D800')
  await scalar.press('Enter')
  await expect(log).toContainText('Enter one Unicode scalar')
  await scalar.fill('U+00E9')
  await scalar.press('Enter')
  await page
    .getByRole('group', { name: 'Quick actions' })
    .getByRole('button', { name: 'Login', exact: true })
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
  await expect(result).toHaveCount(1)
  await command.press('Enter')
  await expect(result).toHaveCount(2)
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
  await quick.getByRole('button', { name: 'Inspect', exact: true }).click()
  const scalar = page.getByRole('textbox', { name: 'character', exact: true })
  await expect(scalar).toBeFocused()
  await scalar.fill('U+200B')
  await scalar.press('Enter')
  const log = page.getByRole('log')
  await expect(log.getByRole('region', { name: 'Unicode U+200B' })).toContainText('Format')
  await quick.getByRole('button', { name: 'Files' }).click()
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
  await quick.getByRole('button', { name: 'Inspect selection' }).click()
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
