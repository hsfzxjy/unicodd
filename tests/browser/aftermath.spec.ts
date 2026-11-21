import { expect, test, type Locator, type Page } from '@playwright/test'
import { commandControl } from './command-controls'

const transcript = (page: Page) => page.getByRole('log', { name: 'Terminal transcript' })
const last = (page: Page) => transcript(page).locator('.terminal-entry').last()
const link = (page: Page, name: string) =>
  transcript(page).getByRole('button', { name, exact: true }).last()
const field = (page: Page, name: string) => page.getByRole('textbox', { name, exact: true })
const run = (page: Page) => page.getByRole('button', { name: 'Run', exact: true })
const scenario = (page: Page) => page.getByRole('combobox', { name: 'Case' })

async function seedReleaseSave(page: Page) {
  await page.addInitScript(() => {
    if (localStorage.getItem('unicodd.campaign')) return
    localStorage.setItem(
      'unicodd.campaign',
      JSON.stringify({
        version: 1,
        current: '006-the-release',
        completed: [
          '001-the-relay',
          '002-dead-letter',
          '003-the-index',
          '004-the-backlog',
          '005-the-handshake',
          '006-the-release',
        ],
        delivered: ['it-worked', 'thank-you'],
        read: ['it-worked'],
      }),
    )
  })
}

for (const [width, height] of [
  [1280, 800],
  [390, 844],
]) {
  test.describe('Aftermath · ' + width + 'px', () => {
    test.use({ viewport: { width, height }, isMobile: width < 600, hasTouch: width < 600 })

    test('investigates and retries every stage from a completed legacy release', async ({
      page,
    }, info) => {
      test.setTimeout(60_000)
      const act = (target: Locator) => (width < 600 ? target.tap() : target.click())
      const submit = () => act(run(page))
      const snap = async (name: string) => {
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
        expect(await transcript(page).evaluate((el) => el.scrollWidth)).toBe(
          await transcript(page).evaluate((el) => el.clientWidth),
        )
        await page.screenshot({ path: info.outputPath(name + '.png') })
      }
      await seedReleaseSave(page)
      await page.goto('/')
      await page.getByRole('region', { name: 'Terminal', exact: true }).waitFor({ timeout: 20_000 })
      await expect(scenario(page)).toHaveValue('006-the-release')
      await commandControl(page, 'local campaign', act, true)
      await act(link(page, 'The Other Side'))
      await expect(scenario(page)).toHaveValue('007-the-other-side')
      await commandControl(page, 'ls', act, true)
      await act(link(page, 'outbox/'))
      await act(link(page, 'contracts.txt'))
      await expect(last(page)).toContainText('Final path segment ends')
      const urls = (await last(page).innerText()).match(/https:\/\/\S+/gu) ?? []
      expect(urls).toHaveLength(2)
      const [firstUrl, secondUrl] = urls
      if (!firstUrl || !secondUrl)
        throw new Error('Both receipt URLs must be available in the outbox.')
      expect(secondUrl.endsWith('Cafe\u0301')).toBe(true)

      await commandControl(page, 'resolve', act)
      const url = field(page, 'Destination URL')
      await url.fill(secondUrl)
      await submit()
      await expect(last(page)).toContainText('endpoint is assigned to a different owner')
      await expect(url).toHaveValue(secondUrl)
      await field(page, 'Host profile').fill('nontransitional')
      await submit()
      await expect(last(page)).toContainText('xn--strae-oqa.trace.test')
      await expect(last(page)).toContainText('endpoint and resource match')
      await snap('01-gateway')
      const prompt = field(page, 'Terminal command')
      await prompt.fill('dispatch')
      await prompt.press('Space')
      await expect(page.getByRole('button', { name: /^Change command:/ })).toContainText('dispatch')
      await field(page, 'GW-1842 URL').fill(firstUrl)
      await field(page, 'GW-2917 URL').fill(secondUrl)
      await submit()
      await expect(last(page)).toContainText(
        'Both transport requests resolved to the same endpoint.',
      )
      await expect(field(page, 'GW-2917 URL')).toHaveValue(secondUrl)
      await field(page, 'Host profile').fill('nontransitional')
      await submit()
      await expect(last(page)).toContainText('application ingestion pending')
      const dispatch = transcript(page).getByRole('heading', { name: 'Both destinations verified' })
      await expect(dispatch).toBeInViewport()
      const gatewayComplete = transcript(page).getByRole('heading', {
        name: 'The Other Side · Complete',
      })
      await expect(gatewayComplete).toHaveCount(0)
      await page.reload()
      await expect(scenario(page)).toHaveValue('007-the-other-side')
      await expect(dispatch).toHaveCount(1)
      await expect(link(page, '/reports/gateway.txt')).toBeVisible()
      await act(link(page, '/reports/gateway.txt'))
      await expect(gatewayComplete).toBeVisible()
      await expect(last(page)).toContainText(
        'Gateway reconciliation filed. Application ingestion is still pending.',
      )
      await act(link(page, 'The Fragments'))
      await expect(scenario(page)).toHaveValue('008-the-fragments')
      const progress = page.getByRole('button', { name: /^Progress:/ })
      await expect(progress).toHaveAttribute(
        'title',
        /Application acknowledgments: Payload verification pending/,
      )
      const ingestionPath = '/reports/ingestion.txt'
      const ingestion = transcript(page).getByRole('region', { name: 'File ' + ingestionPath })
      const fragmentsComplete = transcript(page).getByRole('heading', {
        name: 'The Fragments · Complete',
      })
      const readIngestion = async () => {
        const prompt = field(page, 'Terminal command')
        await prompt.fill('cat ' + ingestionPath)
        await prompt.press('Enter')
      }
      await readIngestion()
      await expect(last(page)).toContainText(
        'Ingestion report unavailable until both application acknowledgments and malformed-frame handling pass verification.',
      )
      await expect(ingestion).toHaveCount(0)
      await expect(fragmentsComplete).toHaveCount(0)

      await commandControl(page, 'capture', act)
      await submit()
      await expect(last(page)).toContainText('0..49 of 49 bytes')
      await commandControl(page, 'capture', act)
      const offset = field(page, 'Byte offset')
      await offset.fill('0')
      await offset.evaluate((el: HTMLTextAreaElement) => {
        el.focus()
        el.setSelectionRange(0, 1)
      })
      await act(link(page, 'Use offset 0x000E for byte E2'))
      await expect(offset).toHaveValue('0x000E')
      await expect
        .poll(() =>
          offset.evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd]),
        )
        .toEqual([6, 6])
      await submit()
      await expect(last(page)).toContainText('14..49 of 49 bytes')

      await commandControl(page, 'deframe', act)
      if (width < 600) await page.setViewportSize({ width, height: 435 })
      await expect(run(page)).toBeInViewport({ ratio: 1 })
      await submit()
      await expect(last(page)).toContainText('Replacement decoding is diagnostic only')
      await expect(field(page, 'UTF-8 decoder')).toHaveValue('chunks')
      await field(page, 'UTF-8 decoder').fill('strict')
      await field(page, 'Invalid frame policy').fill('quarantine')
      await field(page, 'Chunk boundaries').fill('2,4,16,17,18,24,29,30,47,48')
      await submit()
      await expect(last(page)).toContainText('Both owner-bound ACKs verified.')
      await expect(progress).toHaveAttribute(
        'title',
        /Application acknowledgments: Both payloads match the ledger/,
      )
      await expect(
        last(page).getByRole('heading', { name: 'Receiver acknowledgments verified' }),
      ).toBeInViewport()
      await expect(last(page)).toContainText('bytes 23..25 · frame resumes at 27')
      await link(page, 'Use offset 0x0017 for byte E2').scrollIntoViewIfNeeded()
      await snap('02-receiver')
      if (width < 600) await page.setViewportSize({ width, height: 430 })
      await act(link(page, ingestionPath))
      await expect(ingestion).toBeFocused()
      await expect(ingestion.locator('.file-path')).toBeInViewport({ ratio: 1 })
      await expect(ingestion.locator('.resource-text')).toHaveText(
        'APPLICATION INGESTION / LINK 07\n\n' +
          'The application stored both correlated ACKs and retained malformed frames in quarantine. ' +
          'The source receipts and dispatch evidence are attached to the archival batch.',
      )
      await snap('03-ingestion-start')
      if (width < 600) {
        await expect(fragmentsComplete).not.toBeInViewport()
        await act(page.getByRole('button', { name: 'View completion', exact: true }))
      }
      await expect(fragmentsComplete).toBeInViewport({ ratio: 1 })
      await expect(link(page, 'Legacy archive import review')).toBeInViewport({ ratio: 1 })
      await expect(link(page, 'The Boundary')).toBeInViewport({ ratio: 1 })
      await snap('04-ingestion-completion')
      await readIngestion()
      await expect(ingestion).toHaveCount(2)
      await expect(fragmentsComplete).toHaveCount(1)
      await expect(
        transcript(page).getByRole('button', { name: 'Legacy archive import review', exact: true }),
      ).toHaveCount(1)
      if (width < 600) await page.setViewportSize({ width, height })
      await act(link(page, 'The Boundary'))
      await expect(scenario(page)).toHaveValue('009-the-boundary')

      await commandControl(page, 'mirror', act)
      await act(page.getByRole('button', { name: /^Change command:/ }))
      await act(page.getByRole('menuitemradio', { name: /^identifier\b/u }))
      const label = field(page, 'Original label')
      await label.fill('Ᲊora')
      await label.dispatchEvent('compositionstart')
      await label.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true })
      await expect(label).toHaveValue('Ᲊora')
      await label.dispatchEvent('compositionend', { data: 'Ᲊora' })
      await submit()
      await expect(last(page)).toContainText('unassigned')
      await commandControl(page, 'identifier', act)
      await label.fill(String.raw`\u001C89ora`)
      await field(page, 'Unicode version').fill('18.0')
      await submit()
      await expect(last(page)).toContainText('XID_Start true')

      await commandControl(page, 'mirror', act)
      await field(page, 'Label storage').fill('opaque')
      await field(page, 'Legacy handle policy').fill('suffix')
      await submit()
      await expect(last(page)).toContainText('Handle collision')
      await expect(last(page)).toContainText('AR-EU-1842')
      await expect(field(page, 'Legacy handle policy')).toHaveValue('suffix')
      await field(page, 'Legacy handle policy').fill('prefix:case_')
      await submit()
      await expect(last(page)).toContainText('5 verified and queryable records')
      await expect(
        last(page).getByRole('heading', { name: 'Archive references verified' }),
      ).toBeInViewport()
      await expect(last(page)).toContainText('18.0.0 search collision')
      const reportLink = link(page, '/reports/reconciliation.txt')
      if (width < 600)
        expect(
          await reportLink.locator('bdi').evaluate((label) => {
            const range = document.createRange()
            range.selectNodeContents(label)
            return range.getClientRects().length
          }),
        ).toBe(1)
      await snap('03-bridge')
      await act(reportLink)
      await expect(
        last(page).getByRole('heading', { name: 'The Boundary · Complete' }),
      ).toBeVisible()
      await page.reload()
      await expect(scenario(page)).toHaveValue('009-the-boundary')
      await commandControl(page, 'local campaign', act, true)
      await expect(last(page)).toContainText('The Needle')
    })
  })
}
