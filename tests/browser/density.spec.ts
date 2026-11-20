import { expect, test } from '@playwright/test'

for (const [width, height] of [
  [320, 568],
  [390, 430],
  [900, 430],
]) {
  test.describe(`${width} × ${height} density`, () => {
    const phone = width < 600
    test.use({
      viewport: { width, height },
      hasTouch: phone,
      isMobile: phone,
      reducedMotion: 'reduce',
    })

    test('keeps a long route draft editable with the Goal and Unicode tools open', async ({
      page,
    }) => {
      const button = (name: string) => page.getByRole('button', { name, exact: true })
      const input = (name: string) => page.getByRole('textbox', { name, exact: true })
      const log = page.getByRole('log')
      const free = input('Terminal command')
      const run = async (command: string) => {
        await free.fill(command)
        await free.press('Enter')
      }
      await page.goto('/')
      await button('relay-07').last().click()
      await run('login 𝐌AINT')
      await run('cat /queue/8c2f.msg')
      await page.getByRole('combobox', { name: 'Case' }).selectOption('002-dead-letter')
      const goal = button('Goal: In progress')
      if (phone) {
        const picker = button('Commands')
        await free.fill('draft 🧪')
        await free.press('Home')
        await picker.tap()
        await expect(page.getByRole('menu', { name: 'Commands' })).toBeInViewport({ ratio: 1 })
        await page.keyboard.press('Escape')
        await expect(picker).toBeFocused()
        await expect(free).toHaveValue('draft 🧪')
        expect(await free.evaluate((field: HTMLInputElement) => field.selectionStart)).toBe(0)
        await picker.tap()
        await page.getByRole('menuitemradio', { name: /^route / }).tap()
      } else await run('route')

      const header = input('Header recipient')
      const envelope = input('Envelope recipient')
      const draft = (phone ? 'a🧪é\u200b' : 'a🧪é\n').repeat(28)
      await expect(header).toBeFocused()
      await header.fill(draft)
      await header.press('Control+End')
      expect(await header.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(0)
      expect(await header.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
      await expect(page.getByLabel('Total units').filter({ visible: true })).toHaveText('140')
      const label = page.getByText('Header recipient', { exact: true })
      await expect(label).toHaveCSS('font-family', /^system-ui\b/u)
      if (phone) {
        const field = (await header.boundingBox())!
        expect(field.y).toBeGreaterThan((await label.boundingBox())!.y)
        expect(field.width).toBeGreaterThan(width - 40)
      }

      await goal.click()
      await expect(page.getByRole('region', { name: 'Goal', exact: true })).toContainText(
        'Recover and read',
      )
      const kind = page.getByRole('combobox', { name: 'Header recipient inspector type' })
      await kind.selectOption('utf-8')
      const inspector = page.getByRole('region', { name: 'Header recipient Unicode inspector' })
      const status = inspector.getByText(/^Page \d+ of \d+$/)
      const byteGroups = inspector.getByRole('button', { name: /^Byte offset/ })
      await expect(status).toBeHidden()
      await expect(byteGroups).toHaveCount(140)
      await expect(byteGroups.first()).toBeInViewport({
        ratio: phone ? 1 : 0.1,
      })
      await expect(button('Run')).toBeInViewport({ ratio: 1 })
      await expect(log).toBeInViewport({ ratio: 1 })
      expect((await log.boundingBox())!.height).toBeGreaterThanOrEqual(100)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
      const quick = page.getByRole('group', { name: 'Quick actions' })
      if (phone) {
        await expect(quick).toBeHidden()
        await expect(button('Earlier reads')).toBeInViewport({ ratio: 1 })
        await kind.selectOption('code-points')
        await expect(status).toHaveCount(0)
        const points = inspector
          .getByRole('group', { name: 'Header recipient code points' })
          .getByRole('button')
        await expect(points).toHaveCount(140)
        await expect(points.first()).toBeInViewport({ ratio: 1 })
        const last = points.last()
        await last.tap()
        await expect(last).toHaveAttribute('aria-pressed', 'true')
        expect(
          await header.evaluate((field: HTMLTextAreaElement) => [
            field.selectionStart,
            field.selectionEnd,
          ]),
        ).toEqual([167, 168])
      } else expect((await quick.boundingBox())!.height).toBeLessThan(45)

      await header.press('Enter')
      await expect(envelope).toBeFocused()
      await expect(envelope).toBeInViewport({ ratio: 1 })
      await envelope.fill('🧪é')
      await envelope.press('Home')
      await envelope.press('Shift+ArrowRight')
      await envelope.press('Shift+Tab')
      await expect(header).toBeFocused()
      await expect(header).toBeInViewport({ ratio: 1 })
      await expect(header).toHaveValue(draft)
      await header.press('Enter')
      expect(await envelope.evaluate((el) => (el as HTMLTextAreaElement).selectionEnd)).toBe(2)
      await button('Run').click()
      await expect(log.locator('.terminal-entry').last().locator('.error')).toBeVisible()
      await expect(header).toHaveValue(draft)
      await expect(envelope).toHaveValue('🧪é')
    })
  })
}

test('compact normalization keeps each form visible and represents only equal results together', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const command = page.getByRole('textbox', { name: 'Terminal command' })
  await command.fill('inspect U+01FA')
  await command.press('Enter')
  const inspection = page.getByRole('region', { name: 'Unicode U+01FA' })
  const rows = inspection.locator('.inspection-form:visible')
  await expect(rows).toHaveCount(2)
  await expect(rows.first().locator('dt code:visible')).toHaveText(['NFC', 'NFKC'])
  await expect(rows.last().locator('dt code:visible')).toHaveText(['NFD', 'NFKD'])
  await expect(rows.first().locator('dd code')).toHaveText(['U+01FA'])
  await expect(rows.last().locator('dd code')).toHaveText(['U+0041', 'U+030A', 'U+0301'])
  await rows.last().getByRole('button', { name: 'Insert NFD' }).click()
  await expect(command).toHaveValue('A\u030a\u0301')
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(rows).toHaveCount(4)
  await expect(rows.locator('dt code:visible')).toHaveText(['NFC', 'NFD', 'NFKC', 'NFKD'])
})
