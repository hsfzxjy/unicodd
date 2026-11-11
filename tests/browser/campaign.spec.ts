import { expect, test, type Locator, type Page } from '@playwright/test'

const transcript = (page: Page) => page.getByRole('log', { name: 'Terminal transcript' })
const link = (page: Page, name: string | RegExp) =>
  transcript(page).getByRole('button', { name, exact: true }).last()
const quick = (page: Page, name: string) =>
  page.getByRole('group', { name: 'Quick actions' }).getByRole('button', { name, exact: true })
const panel = (page: Page) => page.getByRole('complementary', { name: 'Session context' })

async function openCampaign(page: Page, path = '/') {
  await page.goto(path)
  await page.getByRole('region', { name: 'Terminal', exact: true }).waitFor()
}

async function run(page: Page, text: string) {
  const tag = page.getByRole('button', { name: 'Change command', exact: true })
  if (await tag.count()) {
    await tag.click()
    await page.getByRole('menuitem', { name: 'Edit command name…' }).click()
  }
  const input = page.getByRole('textbox', { name: 'Terminal command' })
  await expect(input).toBeEditable()
  await input.fill(text)
  await input.press('Enter')
}

type Activate = (target: Locator) => Promise<void>

async function recoverNotice(page: Page, act: Activate) {
  await act(quick(page, 'Files'))
  await act(link(page, 'delivered/'))
  await act(link(page, '2917.msg'))
  await expect(transcript(page)).toContainText('still quarantined')
  await act(link(page, 'mail/'))
  await act(link(page, '02-contact-import'))
  await expect(transcript(page)).toContainText('invisible separator')
  await act(link(page, '03-queue-review'))
  await expect(transcript(page)).toContainText('raw header')
  await act(quick(page, 'Route message'))
  const recipient = page.getByRole('textbox', { name: 'Header recipient', exact: true })
  const submit = page.getByRole('button', { name: 'Run', exact: true })
  await act(submit)
  await expect(transcript(page)).toContainText('under delivery hold')
  await act(link(page, 'samples/'))
  await act(link(page, 'legacy-address.txt'))
  await act(link(page, 'Inspect U+200B'))
  const details = transcript(page).getByRole('region', { name: 'Unicode U+200B' })
  await act(page.getByRole('button', { name: 'Code points', exact: false }))
  await act(page.getByRole('button', { name: '2. U+0069, i' }))
  await act(page.getByRole('button', { name: 'Caret after' }))
  await act(details.getByRole('button', { name: 'Insert', exact: true }))
  await expect(recipient).toHaveValue('Mi\u200bra')
  const envelope = page.getByRole('textbox', { name: 'Envelope recipient', exact: true })
  await expect(envelope).toHaveValue('Mira')
  await act(submit)
  await expect(transcript(page).locator('.terminal-entry').last()).toContainText('Envelope gateway')
  await expect(transcript(page).locator('.terminal-entry').last()).not.toContainText('Header')
  await act(link(page, 'address-card.txt'))
  await act(link(page, /Inspect U\+FF2D/))
  const widthVariant = transcript(page).getByRole('region', { name: 'Unicode U+FF2D' })
  await act(envelope)
  await envelope.press('Home')
  await envelope.press('Shift+ArrowRight')
  await act(widthVariant.getByRole('button', { name: 'Replace', exact: true }))
  await expect(envelope).toHaveValue('Ｍira')
  await expect(recipient).toHaveValue('Mi\u200bra')
  await act(submit)
  await expect(transcript(page)).toContainText('Message released from quarantine')
  await expect(transcript(page)).not.toContainText('2917 recovered. Objective complete.')
  await act(link(page, '/delivered/2917.msg'))
  await expect(transcript(page)).toContainText('I think we have the same account')
  await expect(transcript(page)).toContainText('Directory reference: index-09')
}

test('recovers Dead Letter by graphical actions from the development entry', async ({ page }) => {
  test.skip(
    Boolean(process.env.PLAYWRIGHT_TEST_PREVIEW),
    'Isolated development entry; full graphical production campaign is covered below',
  )
  await openCampaign(page, '/?scenario=002-dead-letter')
  await expect(panel(page)).toContainText('guest')
  await expect(panel(page)).toContainText('Quarantined')
  await recoverNotice(page, (target) => target.click())
  await expect(panel(page)).toContainText('Released')
  await expect(panel(page)).toContainText('Complete')
})

async function openIndexGraphically(page: Page, act: Activate) {
  await openCampaign(page)
  await expect(page.getByRole('heading', { name: 'The Relay' })).toBeVisible()
  await act(link(page, 'relay-07'))
  await act(quick(page, 'Login'))
  const alias = page.getByRole('textbox', { name: 'Account alias' })
  await alias.fill('AINT')
  await alias.press('Home')
  await act(quick(page, 'Files'))
  await act(link(page, 'notes/'))
  await act(link(page, 'maintenance-frame.txt'))
  await expect(transcript(page)).toContainText('8 UTF-8 bytes')
  await act(link(page, 'print-samples.txt'))
  await act(link(page, /Inspect U\+1D40C/))
  await act(
    transcript(page)
      .getByRole('region', { name: 'Unicode U+1D40C' })
      .getByRole('button', { name: 'Insert', exact: true }),
  )
  await expect(alias).toHaveValue('\u{1D40C}AINT')
  await act(page.getByRole('button', { name: 'Run', exact: true }))
  await act(quick(page, 'Files'))
  await act(link(page, 'queue/'))
  await act(link(page, '8c2f.msg'))
  await act(quick(page, 'Mail'))
  await act(link(page, 'The missing notice'))
  await expect(transcript(page)).toContainText('The relay handed it to postbox-03')
  await act(page.getByRole('button', { name: 'Open hosts list, 1 new', exact: true }))
  await expect(transcript(page).locator('.terminal-list').last()).toContainText('postbox-03 · New')
  await act(link(page, 'Dead Letter'))
  await recoverNotice(page, act)
  await act(quick(page, 'Mail'))
  await act(link(page, 'Re: The missing notice'))
  await expect(transcript(page)).toContainText('points to index-09')
  await act(link(page, 'The Index'))
  await act(quick(page, 'Mail'))
  await act(link(page, 'I spoke to her'))
  await expect(transcript(page)).toContainText('original forms we filled in')
}

async function beginIndex(page: Page, act: Activate) {
  await act(quick(page, 'Files'))
  await act(link(page, 'exports/'))
  await act(link(page, '8c2f-originals.json'))
  await expect(transcript(page)).toContainText('Original identifiers are restricted')
  await act(link(page, 'audit/'))
  await act(link(page, 'identifier-review.txt'))
  await expect(transcript(page)).toContainText('Script profile: Mixed')
  await act(link(page, 'encoding.log'))
  await expect(transcript(page)).toContainText('5 UTF-8 bytes')
  await act(link(page, 'byte-difference.txt'))
  await expect(transcript(page)).toContainText('First different byte offset: 1')
  await act(link(page, 'mail/'))
  await act(link(page, '02-source-records'))
  await expect(transcript(page)).toContainText('Which ID does a shared entry return')
  await act(link(page, '8c2f.summary'))
  await act(quick(page, 'Reconcile identifier'))
  await act(page.getByRole('button', { name: 'Run', exact: true }))
  await expect(transcript(page)).toContainText('Protected canonical identifier')
  await act(page.getByRole('button', { name: /Code points/ }))
  await act(page.getByRole('button', { name: '2. U+0069, i' }))
  await act(page.getByRole('button', { name: /Code points/ }))
  await act(link(page, 'Inspect U+0069, i'))
  const latin = transcript(page).getByRole('region', { name: 'Unicode U+0069', exact: true })
  await expect(latin).toContainText('LATIN SMALL LETTER I')
  await act(latin.locator('summary'))
  return latin.getByRole('button', { name: 'Inspect confusable U+0456, Cyrillic' })
}

for (const [width, height] of [
  [375, 812],
  [390, 844],
  [768, 1024],
  [1280, 800],
  [1440, 900],
]) {
  test.describe(`${width} × ${height}`, () => {
    test.use({ viewport: { width, height }, hasTouch: width <= 768, isMobile: width <= 600 })

    test('graphically recovers the original registrations', async ({ page, context }, info) => {
      const act: Activate = (target) => (width <= 768 ? target.tap() : target.click())
      const capture = async (name: string) => {
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
        expect(await transcript(page).evaluate((el) => el.scrollWidth)).toBe(
          await transcript(page).evaluate((el) => el.clientWidth),
        )
        await page.screenshot({ path: info.outputPath(name + '.png') })
      }
      if (process.env.PLAYWRIGHT_TEST_PREVIEW || width === 390 || width === 1440)
        await openIndexGraphically(page, act)
      else await openCampaign(page, '/?scenario=003-the-index')
      if (width <= 830) await act(page.getByRole('button', { name: 'Session', exact: true }))
      await expect(panel(page)).toContainText('auditor')
      await capture('01-auditor')
      if (width <= 830) await act(page.getByRole('button', { name: 'Session', exact: true }))
      const candidateLink = await beginIndex(page, act)
      await candidateLink.scrollIntoViewIfNeeded()
      await capture('02-confusables')
      const latin = transcript(page).getByRole('region', { name: 'Unicode U+0069', exact: true })
      await act(latin.getByRole('button', { name: 'Inspect confusable U+04CF, Cyrillic' }))
      const wrong = transcript(page).getByRole('region', { name: 'Unicode U+04CF' })
      await expect(wrong).toContainText('D3 8F')
      await act(wrong.getByRole('button', { name: 'Replace', exact: true }))
      await act(page.getByRole('button', { name: 'Run', exact: true }))
      await expect(transcript(page)).toContainText('Collision detected')
      await act(link(page, '/tools/bucket-8c2f.txt'))
      await expect(transcript(page)).toContainText('Original identifiers: REDACTED')
      await act(quick(page, 'Reconstruct owners'))
      const aName = page.getByRole('textbox', { name: 'Original name A' })
      const bName = page.getByRole('textbox', { name: 'Original name B' })
      const verify = page.getByRole('button', { name: 'Run', exact: true })
      await expect(aName).toHaveValue('')
      await aName.fill('Mira')
      await bName.fill('M\u04cfra')
      await act(verify)
      await expect(transcript(page)).toContainText(
        'Registration B: spelling differs from the verified source.',
      )
      await capture('03-reconstruction-retry')
      await bName.press('Home')
      await bName.press('ArrowRight')
      await bName.press('Shift+ArrowRight')
      await act(candidateLink)
      const details = transcript(page).getByRole('region', { name: 'Unicode U+0456' })
      await expect(details).toContainText('CYRILLIC SMALL LETTER BYELORUSSIAN-UKRAINIAN I')
      await expect(details).toContainText('D1 96')
      const replace = details.getByRole('button', { name: 'Replace', exact: true })
      if (width < 600) {
        await page.setViewportSize({ width, height: 435 })
        await replace.scrollIntoViewIfNeeded()
        await expect(replace).toBeInViewport({ ratio: 1 })
        await expect(verify).toBeInViewport({ ratio: 1 })
        await expect(aName).toBeInViewport({ ratio: 1 })
        await expect(bName).toBeInViewport({ ratio: 1 })
        await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeInViewport()
        await capture('03-keyboard-height')
      }
      if (width === 1280) {
        await bName.fill('Mra')
        await bName.press('Home')
        await bName.press('ArrowRight')
        await act(details.getByRole('button', { name: 'Insert', exact: true }))
      } else {
        await act(replace)
      }
      await expect(bName).toHaveValue('M\u0456ra')
      await expect(aName).toHaveValue('Mira')
      if (width === 1440) {
        await context.grantPermissions(['clipboard-read', 'clipboard-write'])
        await act(details.getByRole('button', { name: 'Copy notation U+0456' }))
        await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('U+0456')
      }
      if (width < 600) await page.setViewportSize({ width, height })
      await act(verify)
      await expect(transcript(page)).toContainText('Reconstruction verified')
      await expect(transcript(page)).not.toContainText('Original registrations recovered')
      await act(link(page, '/exports/8c2f-originals.json'))
      await expect(transcript(page)).toContainText('Original registrations recovered')
      await expect(link(page, 'Inspect U+0456')).toBeVisible()
      await capture('04-originals')
      await act(quick(page, 'Mail'))
      await act(link(page, 'We have the records'))
      await expect(transcript(page)).toContainText("We'd like to keep both accounts.")
      await capture('05-final-mail')
    })
  })
}

test('completes and replays the entire campaign with commands across reloads', async ({ page }) => {
  await openCampaign(page)
  await run(page, 'campaign')
  await expect(link(page, 'The Relay')).toBeVisible()
  await expect(link(page, 'The Index')).toHaveCount(0)
  await run(page, 'scenario 003-the-index')
  await expect(transcript(page)).toContainText('Unknown destination')
  await run(page, 'connect relay-07')
  await run(page, 'login \u{1D40C}AINT')
  await run(page, 'cat /queue/8c2f.msg')
  await run(page, 'mail missing-notice')
  await expect(transcript(page)).toContainText('The relay handed it to postbox-03')
  await page.reload()
  await expect(panel(page)).toContainText('Complete')
  await run(page, 'scenario 002-dead-letter')
  await expect(panel(page)).toContainText('postbox-03')
  await run(page, 'route Mira Mira')
  await expect(transcript(page)).toContainText('under delivery hold')
  await run(page, 'route stranger Mira')
  await expect(transcript(page)).toContainText('could not be resolved')
  await run(page, String.raw`route Mi\u00200Bra \u00FF2Dira`)
  await run(page, 'cat /delivered/2917.msg')
  await expect(transcript(page)).toContainText('I think we have the same account')
  await page.reload()
  await expect(panel(page)).toContainText('postbox-03')
  await expect(panel(page)).toContainText('Complete')
  await run(page, 'scenario 003-the-index')
  await expect(panel(page)).toContainText('index-09')
  await run(page, 'reconcile outsider')
  await expect(transcript(page)).toContainText('No matching collision record')
  await run(page, 'reconcile \u039cira')
  await run(page, 'cat /exports/8c2f-originals.json')
  await expect(transcript(page)).toContainText('Verify the source registrations')
  await run(page, 'reconstruct Mira \u039cira')
  await expect(transcript(page)).toContainText('spelling differs from the verified source')
  await run(page, String.raw`reconstruct Mira M\u000456ra`)
  await run(page, 'cat /exports/8c2f-originals.json')
  await expect(link(page, 'The Backlog')).toBeVisible()
  await run(page, 'mail we-have-the-records')
  await expect(transcript(page)).toContainText("We'd like to keep both accounts.")
  await page.reload()
  await run(page, 'scenario 004-the-backlog')
  await run(page, 'replay en-US primary title 1 start')
  await expect(transcript(page)).toContainText('Replay skipped records')
  await run(page, 'replay en-US primary composite 2 start')
  const scenario = page.getByRole('combobox', { name: 'Scenario' })
  await scenario.selectOption('003-the-index')
  await expect(panel(page)).toContainText('index-09')
  await scenario.selectOption('004-the-backlog')
  await expect(panel(page)).toContainText('appeals-04')
  await page.reload()
  await run(page, 'recover AP-1842 AP-2917')
  await run(page, 'cat /outbox/review-handoff.txt')
  await expect(link(page, 'The Handshake')).toBeVisible()
  await page.reload()
  await run(page, 'scenario 005-the-handshake')
  await run(page, 'lookup tr IRIS')
  await run(page, 'lookup tr iris')
  await run(page, 'bind turkish-lower RC-1842 RC-2917')
  await expect(transcript(page)).toContainText('misroutes distinct records')
  await run(page, 'bind registration RC-1842 RC-2917')
  await run(page, 'cat /outbox/authorization.txt')
  await expect(link(page, 'The Release')).toBeVisible()
  await page.reload()
  await run(page, 'scenario 006-the-release')
  await run(page, 'prepare registration preserve')
  await run(page, 'preview grapheme 4 isolate escape')
  await run(page, 'verify')
  await run(page, 'commit')
  await expect(transcript(page)).toContainText('RECOVERY COMPLETE')
  await expect(panel(page)).toContainText('Campaign complete')
  await page.reload()
  await expect(panel(page)).toContainText('Campaign complete')
  await run(page, 'commit')
  await expect(transcript(page)).toContainText('Transaction already applied.')
  await run(page, 'mail it-worked')
  await expect(transcript(page)).toContainText('Only mine.')
  await run(page, 'scenario 001-the-relay')
  await expect(panel(page)).toContainText('maintenance')
  await page.getByRole('button', { name: 'Reset session' }).click()
  await expect(panel(page)).toContainText('Open')
  await run(page, 'connect relay-07')
  await run(page, 'login \u{1D40C}AINT')
  await run(page, 'cat /queue/8c2f.msg')
  await expect(panel(page).getByText('Complete', { exact: true })).toBeVisible()
  await run(page, 'mail')
  await expect(
    transcript(page).getByRole('button', { name: 'The missing notice', exact: true }),
  ).toHaveCount(1)
  await expect(
    transcript(page).getByRole('button', { name: 'We have the records', exact: true }),
  ).toHaveCount(1)
  await expect(transcript(page)).toContainText(
    'we-have-the-records · Mira / Registration 0002917 · Read',
  )
  await run(page, 'campaign')
  page.once('dialog', (dialog) => dialog.accept())
  await link(page, 'Reset campaign…').click()
  await expect(page.getByRole('heading', { name: 'The Relay' })).toBeVisible()
  await expect(panel(page)).toContainText('Open')
  await run(page, 'mail')
  await expect(link(page, 'We have the records')).toHaveCount(0)
  await expect(link(page, 'A favor')).toHaveCount(1)
})

test('ignores development scenario entry on the built site', async ({ page }) => {
  test.skip(!process.env.PLAYWRIGHT_TEST_PREVIEW, 'Requires the production build')
  await openCampaign(page, '/?scenario=006-the-release')
  await expect(page.getByRole('heading', { name: 'The Relay' })).toBeVisible()
  await expect(panel(page)).toContainText('local')
})

test('keeps internal puzzle matrix files off the game server', async ({ page }) => {
  for (const path of [
    '/private/testing/puzzle-regression-matrix.md',
    '/private/testing/recovery-regression-matrix.json',
    '/tests/fixtures/puzzle-matrix.json',
    '/tests/fixtures/recovery-matrix.json',
  ]) {
    const response = await page.request.get(path, { headers: { Accept: 'application/json' } })
    const expected = process.env.PLAYWRIGHT_TEST_PREVIEW ? [404] : [403, 404]
    expect(expected).toContain(response.status())
  }
})
