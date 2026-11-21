import { expect, test } from '@playwright/test'
import { skipOpening } from './opening'

test.beforeEach(async ({ page }) => {
  await skipOpening(page)
})

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
      await expect(
        page.getByText('140 total', { exact: true }).filter({ visible: true }),
      ).toBeVisible()
      const label = page.getByText('Header recipient', { exact: true })
      await expect(label).toHaveCSS('font-family', /^system-ui\b/u)
      if (phone) {
        const field = (await header.boundingBox())!
        expect(field.y).toBeGreaterThan((await label.boundingBox())!.y)
        expect(field.width).toBeGreaterThan(width - 40)
      }

      await goal.click()
      await expect(page.getByRole('region', { name: 'Goal', exact: true })).toContainText(
        'Release and read',
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

test('keeps the focused last parameter inside its scrollport through live resizing', async ({
  page,
}) => {
  test.skip(Boolean(process.env.PLAYWRIGHT_TEST_PREVIEW), 'Requires Release direct entry')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?scenario=006-the-release')
  const progress = page.getByRole('button', { name: /^Progress:/u })
  await progress.press('Enter')
  const panel = page.getByRole('region', { name: 'Progress', exact: true })
  await expect(panel).toBeVisible()
  const free = page.getByRole('textbox', { name: 'Terminal command' })
  await free.fill('preview')
  await free.press('Space')
  const field = page.getByRole('textbox', { name: 'Controls', exact: true })
  await field.fill('raw🧪')
  await field.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(3, 5, 'backward'))
  const log = page.getByRole('log')
  const run = page.getByRole('button', { name: 'Run', exact: true })
  for (const [width, height, floor] of [
    [390, 435, 100],
    [320, 360, 72],
    [667, 375, 72],
    [900, 430, 100],
    [390, 430, 100],
    [390, 844, 100],
  ]) {
    await page.setViewportSize({ width, height })
    await expect(field).toBeFocused()
    await expect
      .poll(() =>
        field.evaluate((el: HTMLTextAreaElement) => {
          const editor = el.getBoundingClientRect()
          const scroller = el.closest('.composer-arguments')!
          const bounds = scroller.getBoundingClientRect()
          return (
            editor.top >= bounds.top - 1 && editor.bottom <= bounds.top + scroller.clientHeight + 1
          )
        }),
      )
      .toBe(true)
    await expect(run).toBeInViewport({ ratio: 1 })
    await expect(panel.getByRole('heading', { name: 'Progress', exact: true })).toBeInViewport({
      ratio: 1,
    })
    await expect(panel.getByRole('progressbar', { name: 'Case steps complete' })).toBeInViewport()
    await expect(progress.getByText('0/12', { exact: true })).toBeInViewport()
    await expect.poll(async () => (await log.boundingBox())!.height).toBeGreaterThanOrEqual(floor)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    expect(
      await field.evaluate((el: HTMLTextAreaElement) => [
        el.selectionStart,
        el.selectionEnd,
        el.selectionDirection,
      ]),
    ).toEqual([3, 5, 'backward'])
  }
})

test('labels compact command discovery and leaves room to type at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('/')
  await page.getByRole('button', { name: 'relay-07', exact: true }).click()
  await expect(page.getByRole('button', { name: /^Session:.*relay-07/ })).toBeVisible()
  const commands = page.getByRole('button', { name: 'Commands', exact: true })
  await expect(commands).toHaveText('Commands')
  expect((await commands.boundingBox())!.height).toBeGreaterThanOrEqual(32)
  const free = page.getByRole('textbox', { name: 'Terminal command' })
  expect(
    await free.evaluate((el) => {
      const measure = document.createElement('canvas').getContext('2d')!
      const style = getComputedStyle(el)
      measure.font = style.fontSize + ' ' + style.fontFamily
      return el.clientWidth >= measure.measureText('01234567').width
    }),
  ).toBe(true)
  await commands.press('Enter')
  await expect(page.getByRole('menu', { name: 'Commands' })).toBeInViewport()
  await page.keyboard.press('Escape')
  await expect(commands).toBeFocused()
})

test('keeps labelled title controls and switches the panel layout at 830/831px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 830, height: 1024 })
  await page.goto('/')
  const title = page.locator('.frame-title')
  const controls = title.getByRole('button')
  const names = ['Goal', 'Session', 'Progress', 'Hosts', 'Mail']
  for (const [index, name] of names.entries()) {
    const button = controls.nth(index)
    await expect(button.getByText(name, { exact: true })).toBeVisible()
    if (index === 0) await button.focus()
    else await page.keyboard.press('Tab')
    await expect(button).toBeFocused()
  }
  const session = title.getByRole('button', { name: /^Session:/u })
  await session.press('Enter')
  const panel = page.getByRole('region', { name: 'Session', exact: true })
  const log = page.getByRole('log')
  await expect(panel).toHaveCSS('position', 'static')
  expect((await log.boundingBox())!.y).toBeGreaterThan((await panel.boundingBox())!.y)
  await page.setViewportSize({ width: 831, height: 1024 })
  await expect(panel).toHaveCSS('position', 'absolute')
  expect((await log.boundingBox())!.y).toBeCloseTo((await panel.boundingBox())!.y, 0)
  await panel.focus()
  await expect(panel).toHaveCSS('outline-style', 'solid')
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  await expect(session).toBeFocused()

  const free = page.getByRole('textbox', { name: 'Terminal command' })
  await free.fill('clear')
  await free.press('Enter')
  await expect(log).toBeEmpty()
  await free.fill('whoami')
  await free.press('Enter')
  const edit = log.getByRole('button', { name: 'Edit this command', exact: true })
  await expect(edit).toBeInViewport()
  await session.press('Enter')
  await expect(panel).toBeVisible()
  await edit.focus()
  await expect(panel).toBeHidden()
  await expect(edit).toBeFocused()
  await expect(edit).toBeInViewport({ ratio: 1 })
})
