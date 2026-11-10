import { expect, test, type Page } from '@playwright/test'

async function fixture(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'relay-07', exact: true }).click()
  await page.getByRole('button', { name: 'Login', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Account alias' })).toBeVisible()
}

test('navigates normalization results, persists favorites, replaces, inserts, copies, and deletes', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await fixture(page)
  const input = page.getByRole('textbox', { name: 'Account alias' })
  await input.fill('e\u0301🧪\u200b')
  await expect(page.getByText('4 code points', { exact: true })).toBeVisible()
  await expect(page.locator('.payload').getByText('UTF-16', { exact: false })).toHaveCount(0)
  await page.getByRole('button', { name: 'Code points', exact: true }).click()
  await expect(page.getByRole('button', { name: /U\+0301/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /U\+200B, ZWSP/ })).toBeVisible()
  await page.getByRole('button', { name: /U\+1F9EA/ }).click()
  await expect(page.getByText('Selected code point 3', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /U\+1F9EA/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('button', { name: 'Copy notation' }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('U+1F9EA')
  await page.getByRole('button', { name: 'Copy text' }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('🧪')
  await page.getByRole('button', { name: 'Open Workbench' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('UTF-16', { exact: false })).toHaveCount(0)
  const lookup = dialog.getByRole('textbox', { name: 'Character or hex code point' })
  await expect(lookup).toHaveValue('U+1F9EA')
  await lookup.fill('U+D800')
  await lookup.press('Enter')
  await expect(dialog.getByRole('alert')).toContainText('Enter one Unicode scalar')
  await lookup.fill('é')
  await lookup.press('Enter')
  await dialog.getByRole('button', { name: 'Favorite', exact: true }).click()
  await dialog.getByRole('button', { name: /^NFD: inspect U\+0301/ }).click()
  await expect(lookup).toHaveValue('U+0301')
  await dialog.getByRole('button', { name: 'Back' }).click()
  await expect(lookup).toHaveValue('U+00E9')
  await dialog.getByRole('button', { name: 'Replace', exact: true }).click()
  await expect(input).toHaveValue('e\u0301é\u200b')
  await expect(input).toBeFocused()
  await page.getByRole('button', { name: /U\+200B, ZWSP/ }).click()
  await page.getByRole('button', { name: 'Caret after' }).click()
  await expect(page.locator('.payload').getByRole('status')).toContainText(
    'Caret after code point 4',
  )
  await page.getByRole('button', { name: 'Open Workbench' }).click()
  await lookup.fill('1F680')
  await dialog.getByRole('button', { name: 'Look up' }).click()
  await dialog.getByRole('button', { name: 'Insert', exact: true }).click()
  await expect(input).toHaveValue('e\u0301é\u200b🚀')
  await page.getByRole('button', { name: /U\+0301/ }).click()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(input).toHaveValue('eé\u200b🚀')
  await page.reload()
  await page.getByRole('button', { name: 'Workbench', exact: true }).click()
  await expect(
    dialog
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Favorites', exact: true }) })
      .getByRole('button', { name: /Inspect U\+00E9/ }),
  ).toBeVisible()
})

test('preserves composition and raw line endings and exposes repairable surrogate errors', async ({
  page,
}) => {
  await fixture(page)
  const input = page.getByRole('textbox', { name: 'Account alias' })
  const submit = page.getByRole('button', { name: 'Submit login', exact: true })
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
  await expect(page.getByRole('button', { name: 'Submit login', exact: true })).toHaveCount(0)
  await page.unroute('**/*.wasm')
  await page.getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByRole('heading', { name: 'The Relay' })).toBeVisible()
})

test('keeps the native selection through Workbench navigation and Escape', async ({ page }) => {
  await fixture(page)
  const input = page.getByRole('textbox', { name: 'Account alias' })
  await input.fill('a🧪b')
  await input.press('Home')
  await input.press('ArrowRight')
  await input.press('Shift+ArrowRight')
  await input.press('Tab')
  await page.keyboard.press('Tab')
  const opener = page.getByRole('button', { name: 'Open Workbench' })
  await expect(opener).toBeFocused()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('textbox')).toHaveValue('U+1F9EA')
  await expect(dialog.getByRole('button', { name: 'Replace' })).toBeEnabled()
  await page.keyboard.press('Escape')
  await expect(opener).toBeFocused()
  await expect(input).toHaveValue('a🧪b')
  expect(
    await input.evaluate((field: HTMLTextAreaElement) => [
      field.selectionStart,
      field.selectionEnd,
    ]),
  ).toEqual([1, 3])
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
