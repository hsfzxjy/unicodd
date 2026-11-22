import { expect, test, type Page } from '@playwright/test'
import { commandControl } from './command-controls'
import { routeFixtures } from './content-routes'

const log = (page: Page) => page.getByRole('log', { name: 'Terminal transcript' })
const entries = (page: Page) => log(page).locator('.terminal-entry')
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const picker = (page: Page) => page.locator('.reads-menu')
const choice = (page: Page, path: string) =>
  picker(page)
    .getByRole('button')
    .filter({ has: page.getByText(path, { exact: true }) })

async function type(page: Page, command: string) {
  const prompt = page.getByRole('textbox', { name: 'Terminal command', exact: true })
  const last = entries(page).last()
  const previous = (await last.count()) ? (await last.getAttribute('data-entry-id'))! : ''
  await expect(prompt).toBeEditable()
  await prompt.fill(command)
  await prompt.press('Enter')
  if (command === 'clear') await expect(entries(page)).toHaveCount(0)
  else {
    await expect(last).not.toHaveAttribute('data-entry-id', previous)
    await expect(last.locator('.output-wait')).toHaveCount(0)
  }
}

test.describe('Earlier reads at keyboard height', () => {
  test.use({
    viewport: { width: 390, height: 430 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'reduce',
  })

  test('returns to the original passage after a rejected command with a Unicode draft', async ({
    page,
  }, info) => {
    await page.addInitScript(() => {
      if (localStorage.getItem('unicodd.campaign')) return
      localStorage.setItem(
        'unicodd.campaign',
        JSON.stringify({
          version: 1,
          current: '002-dead-letter',
          completed: ['001-the-relay'],
          delivered: ['missing-notice'],
          read: [],
        }),
      )
    })
    await page.goto('/')
    await log(page).waitFor({ timeout: 20_000 })
    const cases = page.getByRole('combobox', { name: 'Case' })
    await expect(cases).toHaveValue('002-dead-letter')
    await expect(cases).toHaveCSS('font-family', /^system-ui\b/u)
    const oldRule = '/mail/01-delivery-hold'
    const rollout = '/spool/router-history.txt'
    await type(page, `cat ${oldRule}`)
    await type(page, `cat ${rollout}`)
    await type(page, 'whoami')
    const count = await entries(page).count()
    const mail = `[aria-label="Mail ${oldRule}"]`
    const original = log(page).locator(mail)
    const disclosure = entries(page)
      .filter({ has: page.locator(mail) })
      .getByRole('button', { name: 'Toggle command output', exact: true })
    await disclosure.tap()
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false')
    await commandControl(page, 'route', (target) => target.tap())
    const envelope = page.getByRole('textbox', { name: 'Envelope recipient' })
    const setDraft = async () => {
      await envelope.focus()
      await envelope.evaluate((field: HTMLTextAreaElement) => field.setSelectionRange(0, 2))
    }
    const draft = '🧪e\u0301'
    await envelope.fill(draft)
    await setDraft()
    await log(page).evaluate((el) => {
      el.scrollTop = 0
    })
    await expect(button(page, 'Latest output')).toBeVisible()

    const reads = button(page, 'Earlier reads')
    await reads.tap()
    await expect(picker(page)).toBeVisible()
    await expect(choice(page, oldRule)).toHaveCSS('font-family', /^system-ui\b/u)
    await page.keyboard.press('Escape')
    await expect(picker(page)).toBeHidden()
    await expect(envelope).toBeFocused()
    await reads.tap()
    await choice(page, oldRule).tap()
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true')
    await expect(envelope).toBeFocused()
    await expect(entries(page)).toHaveCount(count)

    const line = original.locator('pre')
    const passageTop = () => line.evaluate((el) => el.getBoundingClientRect().top)
    await line.evaluate((el) => {
      const transcript = el.closest('.transcript')!
      transcript.scrollTop +=
        el.getBoundingClientRect().top - transcript.getBoundingClientRect().top + 15
    })
    const before = await passageTop()
    await reads.press('Enter')
    await choice(page, rollout).press('Enter')
    await expect(log(page).getByRole('region', { name: `File ${rollout}` })).toBeFocused()
    await reads.tap()
    await choice(page, oldRule).tap()
    await expect.poll(async () => Math.abs((await passageTop()) - before)).toBeLessThanOrEqual(1)
    await expect(entries(page)).toHaveCount(count)
    await setDraft()
    await expect(button(page, 'Run')).toBeInViewport({ ratio: 1 })
    await button(page, 'Run').tap()
    await expect(entries(page).last()).toContainText('under delivery hold')
    await expect(button(page, 'View diagnostic')).toBeVisible()
    await expect.poll(async () => Math.abs((await passageTop()) - before)).toBeLessThanOrEqual(1)
    await button(page, 'View diagnostic').tap()
    await expect(
      entries(page)
        .last()
        .getByText(/under delivery hold/u),
    ).toBeInViewport()
    await page.screenshot({ path: info.outputPath('route-diagnostic-390x430.png') })
    await button(page, 'Back to read').tap()
    await expect.poll(async () => Math.abs((await passageTop()) - before)).toBeLessThanOrEqual(1)
    await expect(envelope).toHaveValue(draft)
    expect(
      await envelope.evaluate((field: HTMLTextAreaElement) => [
        field.selectionStart,
        field.selectionEnd,
      ]),
    ).toEqual([0, 2])
    await page.screenshot({ path: info.outputPath('earlier-passage-390x430.png') })
    await button(page, 'Back to work').tap()
    await expect.poll(() => log(page).evaluate((el) => el.scrollTop)).toBe(0)
  })
})

test('keeps a passage in place while a typed inspection arrives', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 435 })
  await page.addInitScript(() => localStorage.setItem('unicodd.onboarding.v1', 'seen'))
  await page.goto('/')
  await type(page, 'connect relay-07')
  const path = '/notes/print-samples.txt'
  await type(page, `cat ${path}`)
  await type(page, 'whoami')
  const position = () => log(page).evaluate((el) => el.scrollTop)
  const work = await position()
  await button(page, 'Earlier reads').press('Enter')
  await choice(page, path).press('Enter')
  const source = log(page).getByRole('region', { name: `File ${path}` })
  await expect(source).toBeFocused()
  const passage = await position()
  await type(page, 'inspect U+01FA')
  const inspection = log(page).getByRole('region', { name: 'Unicode U+01FA' })
  await expect(inspection).toHaveCount(1)
  await expect(button(page, 'View result')).toBeVisible()
  expect(await position()).toBe(passage)
  await button(page, 'View result').press('Enter')
  await expect(inspection).toBeFocused()
  await expect(inspection.locator('.inspection-summary')).toBeInViewport()
  await button(page, 'Back to read').press('Enter')
  await expect(source).toBeFocused()
  expect(await position()).toBe(passage)
  await button(page, 'Back to work').press('Enter')
  await expect(log(page)).toBeFocused()
  // The original working position was following output, so it now includes the inspection.
  expect(await position()).toBeGreaterThan(work)
  await expect(button(page, 'Latest output')).toHaveCount(0)
})

test('jumps to the original command output and returns without submitting or editing', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 430 })
  await page.addInitScript(() => localStorage.setItem('unicodd.onboarding.v1', 'seen'))
  await page.goto('/')
  await type(page, 'connect relay-07')
  await type(page, 'inspect U+01FA')
  const earlier = entries(page).last()
  const id = await earlier.getAttribute('data-entry-id')
  await earlier.getByRole('button', { name: 'Toggle command output' }).click()
  await type(page, 'help')
  await type(page, 'whoami')
  await type(page, 'login wrong')
  const alias = page.getByRole('textbox', { name: 'Account alias' })
  await alias.fill('X🧪e\u0301')
  await alias.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(1, 3))
  const snapshot = () =>
    page.evaluate(
      () => JSON.parse(localStorage.getItem('unicodd.campaign')!).levels['001-the-relay'].journal,
    )
  const journal = await snapshot()
  const count = await entries(page).count()
  const original = log(page).locator(`[data-entry-id="${id}"]`)
  await log(page).evaluate((el) => {
    el.scrollTop = 10
  })
  await expect(button(page, 'Latest output')).toBeVisible()
  const choose = async (keyboard: boolean) => {
    const activate = (el: ReturnType<typeof button>) => (keyboard ? el.press('Enter') : el.click())
    await activate(button(page, 'Earlier reads'))
    await activate(picker(page).getByRole('button', { name: 'Command output', exact: true }))
    const list = picker(page).getByRole('list', { name: 'Command output, newest first' })
    await activate(list.getByRole('button', { name: /inspect U\+01FA.*relay-07/ }))
  }
  await choose(false)
  await expect(alias).toBeFocused()
  expect(
    await alias.evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd]),
  ).toEqual([1, 3])
  await expect(original.getByRole('button', { name: 'Toggle command output' })).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  await expect(original.locator('.command-line')).toBeInViewport({ ratio: 1 })
  await button(page, 'Back to work').click()
  await expect.poll(() => log(page).evaluate((el) => el.scrollTop)).toBe(10)
  await choose(true)
  await expect(original).toBeFocused()
  await expect(entries(page)).toHaveCount(count)
  expect(await snapshot()).toEqual(journal)
  await expect(alias).toHaveValue('X🧪e\u0301')
})

test('retains only authorized read snapshots beyond scrollback and drops them on session reset', async ({
  page,
}, info) => {
  test.setTimeout(60_000)
  await page.setViewportSize({ width: 1280, height: 800 })
  await routeFixtures(page)
  await page.goto('/?terminalLab=contextual-terminal')
  const reads = button(page, 'Earlier reads')
  const sealed = '/exhibit/sealed'
  await type(page, 'cat /index')
  await type(page, 'cat /exhibit/sealed')
  await expect(entries(page).last()).toContainText('Permission denied')
  await reads.click()
  await expect(choice(page, sealed)).toHaveCount(0)
  await expect(picker(page).getByRole('combobox')).toHaveCount(0)
  await picker(page).getByRole('button', { name: 'Command output', exact: true }).click()
  await picker(page)
    .getByRole('button', { name: /cat \/exhibit\/sealed/ })
    .click()
  await expect(entries(page).last()).toContainText('Permission denied')
  await expect(log(page).getByRole('region', { name: `Mail ${sealed}` })).toHaveCount(0)
  await button(page, 'Back to work').click()
  await reads.click()
  await page.keyboard.press('Escape')
  const command = page.getByRole('textbox', { name: 'Terminal command', exact: true })
  const rejectedPath = page.getByRole('textbox', { name: 'path', exact: true })
  await rejectedPath.press('Escape')
  await expect(command).toBeFocused()
  await type(page, 'login 🧪')
  await type(page, `cat ${sealed}`)
  const original = log(page)
    .getByRole('region', { name: `Mail ${sealed}` })
    .locator('pre')
  await expect(original).toHaveText('Fixture restricted archive.')
  await type(page, 'logout')
  await type(page, 'connect shelf')
  for (let i = 0; i < 81; i++) await type(page, 'whoami')
  await expect(entries(page)).toHaveCount(80)
  await expect(original).toHaveCount(0)
  const savedCommands = () =>
    page.evaluate(
      () => JSON.parse(localStorage.getItem('unicodd.campaign')!).levels.demo.journal.commands,
    )
  const journal = await savedCommands()
  await reads.click()
  await expect(picker(page).getByRole('list', { name: 'Earlier reads' })).toBeVisible()
  await picker(page).getByRole('button', { name: 'Command output', exact: true }).click()
  const commands = picker(page).getByRole('list', { name: 'Command output, newest first' })
  await expect(commands.getByRole('button')).toHaveCount(80)
  await expect(commands.getByRole('button', { name: /cat/ })).toHaveCount(0)
  await picker(page).getByRole('button', { name: 'Back to earlier reads' }).click()
  await page.screenshot({ path: info.outputPath('reads-desktop.png') })
  await choice(page, sealed).click()
  await expect(log(page).getByRole('region', { name: 'Earlier read' }).locator('pre')).toHaveText(
    'Fixture restricted archive.',
  )
  await expect(entries(page)).toHaveCount(80)
  expect(await savedCommands()).toEqual(journal)
  await type(page, `cat ${sealed}`)
  await expect(entries(page).last()).toContainText('Permission denied')
  await rejectedPath.press('Escape')
  await type(page, 'clear')
  await reads.click()
  await expect(picker(page)).toContainText('Open a file or message to see it here.')
  await page.keyboard.press('Escape')
  await type(page, 'cat /index')
  await page.getByRole('button', { name: /^Session:/ }).click()
  await button(page, 'Restart session').click()
  await expect(entries(page)).toHaveCount(1)
  await reads.click()
  await expect(picker(page)).toContainText('Open a file or message to see it here.')
})
