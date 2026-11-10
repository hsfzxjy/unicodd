import { expect, test } from '@playwright/test'
import { routeFixtures } from './content-routes'

for (const [width, height] of [
  [375, 812],
  [390, 844],
  [768, 1024],
  [1280, 800],
  [1440, 900],
]) {
  test.describe(`The Gate at ${width} × ${height}`, () => {
    test.use({ viewport: { width, height }, hasTouch: width <= 768, isMobile: width <= 600 })

    test('submits, investigates, and solves using the Workbench', async ({ page }, info) => {
      const screenshot = (state: string) =>
        page.screenshot({ path: info.outputPath(state + '.png') })
      const activate = width <= 768 ? 'tap' : 'click'
      const submit = page.getByRole('button', { name: 'Submit', exact: true })
      const username = page.getByRole('textbox', { name: 'Username' })
      const status = page.getByRole('region', { name: 'Verification' }).getByRole('status')
      const filter = page.getByRole('listitem').filter({ hasText: 'Reserved-name filter' })
      const resolver = page.getByRole('listitem').filter({ hasText: 'Identity resolution' })
      const denied = page.getByText('Access denied.', { exact: false })
      const recovered = page.getByText('Two registration IDs', { exact: false })

      await page.goto('/')
      await expect(page.getByRole('combobox', { name: 'Target' }).getByRole('option')).toHaveText([
        'The Gate',
      ])
      await expect(page.getByRole('heading', { name: 'The Gate' })).toBeVisible()
      await expect(page.getByText('Connected to Archive Gateway.')).toBeVisible()
      await expect(username).toHaveValue('café')
      await expect(submit).toBeInViewport()
      await expect(page.getByRole('heading', { name: 'Verification' })).toBeInViewport()
      await expect(status).toHaveText('Pending')
      await expect(recovered).toHaveCount(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
      await screenshot('briefing')

      await submit[activate]()
      await expect(status).toHaveText('Failed')
      await expect(filter).toContainText('FAIL')
      await expect(resolver).toContainText('PASS')
      await expect(denied).toBeVisible()
      await expect(recovered).toHaveCount(0)
      await page.getByText('Analysis', { exact: false })[activate]()
      await expect(page.getByText('canonical_username', { exact: true })).toBeVisible()
      await screenshot('failed-analysis')
      await page.getByText('Analysis', { exact: false })[activate]()

      await page.getByText('Hint', { exact: true })[activate]()
      await expect(page.getByText('Compare its NFC and NFD', { exact: false })).toBeVisible()
      await page.getByText('Hint', { exact: true })[activate]()
      await page.getByRole('button', { name: 'Code points', exact: true })[activate]()
      await page.getByRole('button', { name: /U\+00E9/ })[activate]()
      const opener = page.getByRole('button', { name: 'Open Workbench' })
      await opener[activate]()
      const dialog = page.getByRole('dialog', { name: 'Unicode Workbench' })
      await expect(dialog.getByRole('textbox')).toHaveValue('U+00E9')
      await expect(dialog.getByRole('button', { name: /^NFD: inspect U\+0301/ })).toBeVisible()
      await screenshot('workbench')
      await dialog.getByRole('button', { name: /^NFD: inspect U\+0065/ })[activate]()
      await dialog.getByRole('button', { name: 'Replace', exact: true })[activate]()
      await expect(username).toHaveValue('cafe')
      await expect(status).toHaveText('Pending')
      await expect(filter).not.toContainText('Actual')
      await expect(denied).toHaveCount(0)

      await submit[activate]()
      await expect(status).toHaveText('Failed')
      await expect(filter).toContainText('PASS')
      await expect(resolver).toContainText('FAIL')
      await opener[activate]()
      const inspectAccent = dialog.getByRole('button', { name: /^Inspect U\+00E9,/ })
      await inspectAccent[activate]()
      await dialog.getByRole('button', { name: /^NFD: inspect U\+0301/ })[activate]()
      await dialog.getByRole('button', { name: 'Insert', exact: true })[activate]()
      await expect(username).toHaveValue('cafe\u0301')
      await expect(username).toBeFocused()
      await expect(recovered).toHaveCount(0)
      await submit[activate]()
      await expect(status).toHaveText('Passed')
      await expect(filter).toContainText('PASS')
      await expect(resolver).toContainText('PASS')
      await expect(page.getByText('Access granted.', { exact: false })).toBeVisible()
      await expect(recovered).toBeVisible()
      await recovered.scrollIntoViewIfNeeded()
      await screenshot('recovered')

      await username.fill('different')
      await expect(status).toHaveText('Pending')
      await expect(recovered).toHaveCount(0)
      await expect(page.getByRole('combobox', { name: 'Target' })).toHaveValue('001-the-gate')
    })
  })
}

test('runs an added JSON level with distinct inputs, graph, checks and narrative in the same workspace', async ({
  page,
}) => {
  await routeFixtures(page, true)
  await page.goto('/')
  const selector = page.getByRole('combobox', { name: 'Target' })
  await expect(page.getByRole('heading', { name: 'The Gate' })).toBeVisible()
  await expect(selector.getByRole('option')).toHaveText(['The Gate', 'Two input fixture'])
  await selector.selectOption('fixture-multiple')
  await expect(page.getByRole('heading', { name: 'Two input fixture' })).toBeVisible()
  await expect(page.getByText('Two-input sample loaded.')).toBeVisible()
  const left = page.getByRole('textbox', { name: 'Left input' })
  await expect(left).toHaveValue('Cafe\u0301')
  await expect(page.getByRole('textbox', { name: 'Right input' })).toHaveValue('Café')
  await expect(page.getByRole('textbox')).toHaveCount(2)
  const checks = page.getByRole('region', { name: 'Verification' }).getByRole('listitem')
  await expect(checks).toHaveCount(1)
  await expect(checks).toContainText('Combined length is nine')
  const submit = page.getByRole('button', { name: 'Submit', exact: true })
  await submit.click()
  await expect(page.getByRole('status')).toHaveText('Passed')
  await expect(page.getByText('Combined length verified.')).toBeVisible()
  await expect(page.getByText('Sample record · Two inputs joined.')).toBeVisible()
  await page.getByText('Analysis', { exact: false }).click()
  await expect(page.getByText('concat · text')).toBeVisible()
  await expect(page.getByText('codePointLength · integer')).toBeVisible()
  await left.fill('🧪')
  await submit.click()
  await expect(page.getByRole('status')).toHaveText('Failed')
  await expect(page.getByText('Fixture criteria unmet.')).toBeVisible()
  await expect(page.getByText('Sample record · Two inputs joined.')).toHaveCount(0)
})

test('identifies missing level content and retries the selected target', async ({ page }) => {
  await page.route('**/content/**/narrative.json', (route) => route.fulfill({ status: 404 }), {
    times: 1,
  })
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'Could not load target', exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('alert')).toContainText(/narrative\.json.*HTTP 404/)
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'The Gate' })).toBeVisible()
})

test('identifies a broken manifest without substituting a fallback level', async ({ page }) => {
  await page.route('**/content/manifest.json', (route) => route.fulfill({ json: { version: 2 } }), {
    times: 1,
  })
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText(/manifest\.json.*version.*Unsupported/)
  await expect(page.getByRole('combobox', { name: 'Target' })).toBeDisabled()
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'The Gate' })).toBeVisible()
})
