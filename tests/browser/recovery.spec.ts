import { expect, test, type Locator, type Page } from '@playwright/test'

const log = (page: Page) => page.getByRole('log', { name: 'Terminal transcript' })
const last = (page: Page) => log(page).locator('.terminal-entry').last()
const link = (page: Page, name: string) =>
  log(page).getByRole('button', { name, exact: true }).last()
const quick = (page: Page, name: string) =>
  page.getByRole('group', { name: 'Quick actions' }).getByRole('button', { name, exact: true })
const field = (page: Page, name: string) => page.getByRole('textbox', { name, exact: true })
const run = (page: Page) => page.getByRole('button', { name: 'Run', exact: true })

async function seedIndexSave(page: Page) {
  await page.addInitScript(() => {
    if (localStorage.getItem('unicodd.campaign')) return
    localStorage.setItem(
      'unicodd.campaign',
      JSON.stringify({
        version: 1,
        current: '003-the-index',
        completed: ['001-the-relay', '002-dead-letter', '003-the-index'],
        delivered: [
          'favor',
          'missing-notice',
          'missing-notice-reply',
          'spoke-to-her',
          'we-have-the-records',
        ],
        read: ['we-have-the-records'],
      }),
    )
  })
}

test('prepares the release independently through the development entry', async ({ page }) => {
  test.skip(Boolean(process.env.PLAYWRIGHT_TEST_PREVIEW), 'Requires the development entry')
  await page.goto('/?scenario=006-the-release')
  await expect(page.getByRole('combobox', { name: 'Scenario' })).toHaveValue('006-the-release')
  await quick(page, 'prepare').click()
  await field(page, 'Identity key').fill('registration')
  await run(page).click()
  await expect(last(page)).toContainText('Identity mapping staged.')
  expect(await page.evaluate(() => localStorage.getItem('unicodd.campaign'))).toBeNull()
})

test('keeps the Release briefing visible in a short viewport', async ({ page }) => {
  test.skip(Boolean(process.env.PLAYWRIGHT_TEST_PREVIEW), 'Requires the development entry')
  const errors: Error[] = []
  page.on('pageerror', (error) => errors.push(error))
  await page.setViewportSize({ width: 390, height: 420 })
  await page.goto('/?debug=1&scenario=006-the-release')
  await expect(
    log(page).getByText('Both owners approved the split.', { exact: false }),
  ).toBeInViewport({ ratio: 1 })
  await page.setViewportSize({ width: 390, height: 400 })
  await expect(
    log(page).getByText('Both owners approved the split.', { exact: false }),
  ).toBeInViewport({ ratio: 1 })
  await quick(page, 'ls').click()
  await expect(link(page, 'mail/')).toBeInViewport()
  expect(errors).toEqual([])
})

for (const [width, height] of [
  [375, 812],
  [390, 844],
  [768, 1024],
  [1280, 800],
  [1440, 900],
]) {
  test.describe('Recovery · ' + width + ' × ' + height, () => {
    test.use({ viewport: { width, height }, isMobile: width <= 600, hasTouch: width <= 768 })

    test('continues an Index save through all three scenarios using graphical controls', async ({
      page,
      context,
    }, info) => {
      const act = (target: Locator) => (width <= 768 ? target.tap() : target.click())
      const submit = () => act(run(page))
      const fill = async (name: string, value: string) => {
        const editor = field(page, name)
        await editor.scrollIntoViewIfNeeded()
        await editor.fill(value)
      }
      const select = async (name: string) => {
        await act(page.getByRole('button', { name: 'Change command', exact: true }))
        await act(page.getByRole('menuitemradio', { name: new RegExp('^' + name + '\\b') }))
      }
      const capture = async (name: string) => {
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
        expect(await log(page).evaluate((el) => el.scrollWidth)).toBe(
          await log(page).evaluate((el) => el.clientWidth),
        )
        await page.screenshot({ path: info.outputPath(name + '.png') })
      }

      await seedIndexSave(page)
      await page.goto('/')
      await expect(page.getByRole('combobox', { name: 'Scenario' })).toHaveValue('003-the-index')
      await act(quick(page, 'campaign'))
      await act(link(page, 'The Backlog'))
      await act(link(page, 'I reopened both cases'))
      await expect(last(page)).toContainText('The database says there are two')
      await act(quick(page, 'collate'))
      await submit()
      await expect(last(page)).toContainText('equal')
      await act(quick(page, 'replay'))
      await submit()
      await expect(last(page)).toContainText('Replay skipped records')
      await expect(field(page, 'Cursor strategy')).toHaveValue('title')
      if (width < 600) {
        await page.setViewportSize({ width, height: 435 })
        await expect(run(page)).toBeInViewport({ ratio: 1 })
        await fill('Start cursor', 'deployed-v1')
        await submit()
        await expect(last(page)).toContainText('does not belong to the active snapshot')
        await expect(field(page, 'Start cursor')).toHaveValue('deployed-v1')
        await capture('01-replay-keyboard-height')
        await fill('Start cursor', 'start')
        await page.setViewportSize({ width, height })
      }
      await fill('Cursor strategy', 'composite')
      await fill('Rows per page', '2')
      await submit()
      await expect(last(page).getByRole('heading', { name: 'Queue replay verified' })).toBeVisible()
      await act(quick(page, 'recover'))
      await fill('First appeal', 'AP-1842')
      await fill('Second appeal', 'AP-T001')
      await submit()
      await expect(last(page)).toContainText('Migration records are excluded')
      await fill('Second appeal', 'AP-2917')
      await submit()
      await expect(
        last(page).getByRole('heading', { name: 'Both appeals recovered' }),
      ).toBeVisible()
      await act(link(page, '/outbox/review-handoff.txt'))
      await expect(
        last(page).getByRole('heading', { name: 'The Backlog · Complete' }),
      ).toBeVisible()
      await act(link(page, 'The Handshake'))
      await act(link(page, 'Both cases are open'))
      await expect(last(page)).toContainText('two independent owner confirmations')

      await act(quick(page, 'lookup'))
      await submit()
      await expect(last(page)).toContainText('multiple records under the same key')
      await expect(last(page)).not.toContainText('Receipt retrieved')
      await fill('Case profile', 'tr')
      await submit()
      await expect(last(page)).toContainText('owner-1842')
      await expect(last(page)).toContainText('Receipt retrieved')
      await act(quick(page, 'lookup'))
      await fill('Case profile', 'tr')
      await fill('Channel label', 'iris')
      await submit()
      await expect(last(page)).toContainText('owner-2917')
      await act(quick(page, 'bind'))
      await select('probe')
      await fill('Routing key', 'turkish-lower')
      await submit()
      await expect(last(page)).toContainText('groups distinct receipt records')
      await expect(last(page)).not.toContainText('Routing audit passed')
      await fill('Routing key', 'registration')
      await submit()
      await expect(last(page)).toContainText('Routing audit passed')
      await act(quick(page, 'bind'))
      await select('bind')
      await fill('Routing key', 'registration')
      await fill('Receipt for 0001842', 'RC-1842')
      await fill('Receipt for 0002917', 'RC-2917')
      await submit()
      await expect(
        last(page).getByRole('heading', { name: 'Owner consent verified' }),
      ).toBeVisible()
      await act(link(page, '/outbox/authorization.txt'))
      await expect(
        last(page).getByRole('heading', { name: 'The Handshake · Complete' }),
      ).toBeVisible()
      await act(link(page, 'The Release'))
      await act(link(page, 'Before you run the split'))
      await expect(last(page)).toContainText('account number appear beside the wrong label')

      await act(quick(page, 'ls'))
      await act(link(page, 'mail/'))
      await act(link(page, '04-release-conditions'))
      await expect(last(page)).toContainText('two intact owner records')
      await act(quick(page, 'ls'))
      await act(link(page, 'samples/'))
      await act(link(page, 'preview.txt'))
      await act(link(page, 'Inspect U+0301, ◌́'))
      await expect(log(page).getByRole('region', { name: 'Unicode U+0301' })).toContainText(
        'COMBINING ACUTE ACCENT',
      )
      await act(quick(page, 'prepare'))
      await submit()
      await expect(last(page)).toContainText('key collides')
      await fill('Identity key', 'registration')
      await submit()
      await act(quick(page, 'preview'))
      await submit()
      await expect(last(page)).toContainText('invalid UTF-16')
      await fill('Limit units', 'grapheme')
      await fill('Bidi policy', 'isolate')
      await fill('Controls', 'escape')
      await submit()
      await expect(last(page)).toContainText('Audit preview passed')
      const audit = log(page)
        .locator('.terminal-entry')
        .filter({ hasText: 'Audit preview passed' })
        .last()
      const mixed = audit
        .locator('.report-row')
        .filter({ hasText: 'تمت' })
        .filter({ hasText: '0002917' })
      await expect(mixed.locator('bdi')).toHaveText([
        'rtl',
        '41/64 UTF-8 bytes',
        'CASE ',
        'تمت ',
        ' 0002917 STATE APPROVED',
      ])
      await expect(last(page)).toContainText('Café')
      await expect(last(page)).toContainText('👩‍💻')
      await expect(last(page)).toContainText('[U+202E]')
      if (width === 1440) {
        await context.grantPermissions(['clipboard-read', 'clipboard-write'])
        await act(mixed.getByRole('button', { name: 'Copy line' }))
        await expect
          .poll(() => page.evaluate(() => navigator.clipboard.readText()))
          .toBe('CASE \u2068تمت \u2069 0002917 STATE APPROVED')
      }
      await mixed.scrollIntoViewIfNeeded()
      await capture('02-audit-fields')

      await act(quick(page, 'verify'))
      await expect(last(page).getByRole('heading', { name: 'Dry run passed' })).toBeVisible()
      await act(quick(page, 'verify'))
      await expect(last(page)).toContainText('Verified original records')
      await expect(log(page).getByRole('heading', { name: 'Dry run passed' })).toHaveCount(1)
      await act(quick(page, 'commit'))
      await expect(page.getByRole('button', { name: 'Change command' })).toContainText('commit')
      await expect(log(page).getByRole('heading', { name: 'The Release · Complete' })).toHaveCount(
        0,
      )
      await submit()
      await expect(last(page)).toContainText('RECOVERY COMPLETE')
      await expect(
        last(page).getByRole('heading', { name: 'The Release · Complete' }),
      ).toBeVisible()
      await expect(last(page)).toContainText('0001842Mira')
      await expect(last(page)).toContainText('0002917Mіra')
      await expect(last(page).getByRole('button', { name: 'U+0456', exact: true })).toBeVisible()
      await last(page).getByRole('button', { name: 'U+0456', exact: true }).scrollIntoViewIfNeeded()
      await capture('03-restored-identities')

      await act(quick(page, 'mail'))
      await act(link(page, 'It worked'))
      await expect(last(page)).toContainText('Only mine.')
      await act(quick(page, 'mail'))
      await act(link(page, 'Thank you'))
      await expect(last(page)).toContainText('Please tell Support both cases can close.')
      await capture('04-ending')
      await page.reload()
      await act(page.getByRole('button', { name: 'Session', exact: true }))
      await expect(page.getByRole('complementary', { name: 'Session context' })).toContainText(
        'Complete',
      )
      await act(page.getByRole('button', { name: 'Session', exact: true }))
      await act(quick(page, 'mail'))
      await expect(last(page)).toContainText('it-worked · Mira / Registration 0002917 · Read')
      await expect(last(page).getByRole('button', { name: 'Thank you', exact: true })).toHaveCount(
        1,
      )
    })
  })
}
