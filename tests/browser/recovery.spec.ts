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
  await quick(page, 'Prepare split').click()
  await field(page, 'Identity key').fill('registration')
  await run(page).click()
  await expect(last(page)).toContainText('Identity mapping staged.')
  expect(await page.evaluate(() => localStorage.getItem('unicodd.campaign'))).toBeNull()
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
      await act(quick(page, 'Mail'))
      await act(link(page, 'I reopened both cases'))
      await expect(last(page)).toContainText('The database says there are two')
      await act(quick(page, 'Campaign'))
      await act(link(page, 'The Backlog'))
      await act(quick(page, 'Compare titles'))
      await submit()
      await expect(last(page)).toContainText('equal')
      await act(quick(page, 'Replay queue'))
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
      await expect(last(page)).toContainText('QUEUE REPLAY VERIFIED')
      await act(quick(page, 'Recover appeals'))
      await fill('First appeal', 'AP-1842')
      await fill('Second appeal', 'AP-T001')
      await submit()
      await expect(last(page)).toContainText('Migration records are excluded')
      await fill('Second appeal', 'AP-2917')
      await submit()
      await act(link(page, '/outbox/review-handoff.txt'))
      await act(link(page, 'The Handshake'))

      await act(quick(page, 'Look up receipt'))
      await submit()
      await expect(last(page)).toContainText('multiple records under the same key')
      await fill('Case profile', 'tr')
      await submit()
      await expect(last(page)).toContainText('owner-1842')
      await act(quick(page, 'Look up receipt'))
      await fill('Case profile', 'tr')
      await fill('Channel label', 'iris')
      await submit()
      await expect(last(page)).toContainText('owner-2917')
      await act(quick(page, 'Bind approvals'))
      await select('probe')
      await fill('Routing key', 'turkish-lower')
      await submit()
      await expect(last(page)).toContainText('groups distinct receipt records')
      await select('bind')
      await fill('Routing key', 'registration')
      await fill('Receipt for 0001842', 'RC-1842')
      await fill('Receipt for 0002917', 'RC-2917')
      await submit()
      await expect(last(page)).toContainText('OWNER CONSENT VERIFIED')
      await act(link(page, '/outbox/authorization.txt'))
      await act(link(page, 'The Release'))

      await act(quick(page, 'Files'))
      await act(link(page, 'mail/'))
      await act(link(page, '04-release-conditions'))
      await expect(last(page)).toContainText('two intact owner records')
      await act(quick(page, 'Files'))
      await act(link(page, 'samples/'))
      await act(link(page, 'preview.txt'))
      await act(link(page, 'Inspect U+0301, ◌́'))
      await expect(log(page).getByRole('region', { name: 'Unicode U+0301' })).toContainText(
        'COMBINING ACUTE ACCENT',
      )
      await act(quick(page, 'Prepare split'))
      await submit()
      await expect(last(page)).toContainText('key collides')
      await fill('Identity key', 'registration')
      await submit()
      await act(quick(page, 'Audit preview'))
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

      await act(quick(page, 'Audit preview'))
      await select('verify')
      await submit()
      await expect(last(page)).toContainText('DRY RUN PASSED')
      await act(quick(page, 'Audit preview'))
      await select('commit')
      await submit()
      await expect(last(page)).toContainText('RECOVERY COMPLETE')
      await expect(last(page)).toContainText('0001842Mira')
      await expect(last(page)).toContainText('0002917Mіra')
      await expect(last(page).getByRole('button', { name: 'U+0456', exact: true })).toBeVisible()
      await last(page).getByRole('button', { name: 'U+0456', exact: true }).scrollIntoViewIfNeeded()
      await capture('03-restored-identities')

      await act(quick(page, 'Mail'))
      await act(link(page, 'It worked'))
      await expect(last(page)).toContainText('Only mine.')
      await act(quick(page, 'Mail'))
      await act(link(page, 'Thank you'))
      await expect(last(page)).toContainText('Except the name, apparently.')
      await capture('04-ending')
      await page.reload()
      if (width <= 830) await act(page.getByRole('button', { name: 'Session', exact: true }))
      await expect(page.getByRole('complementary', { name: 'Session context' })).toContainText(
        'Campaign complete',
      )
      if (width <= 830) await act(page.getByRole('button', { name: 'Session', exact: true }))
      await act(quick(page, 'Mail'))
      await expect(last(page)).toContainText('it-worked · Mira / Registration 0002917 · Read')
      await expect(last(page).getByRole('button', { name: 'Thank you', exact: true })).toHaveCount(
        1,
      )
    })
  })
}
