import { expect, test, type Page } from '@playwright/test'

const transcript = (page: Page) => page.getByRole('log', { name: 'Terminal transcript' })
const link = (page: Page, name: string | RegExp) =>
  transcript(page).getByRole('button', { name, exact: true }).last()
const quick = (page: Page, name: string) =>
  page.getByRole('group', { name: 'Quick actions' }).getByRole('button', { name, exact: true })
const panel = (page: Page) => page.getByRole('complementary', { name: 'Session context' })

async function run(page: Page, text: string) {
  const input = page.getByRole('textbox', { name: 'Terminal command' })
  await input.fill(text)
  await input.press('Enter')
}

test('recovers Dead Letter through the archive, notation links and recipient editor', async ({
  page,
}) => {
  await page.goto('/?scenario=002-dead-letter')
  await expect(panel(page)).toContainText('guest')
  await expect(panel(page)).toContainText('Quarantined')
  await quick(page, 'Files').click()
  await link(page, 'delivered/').click()
  await link(page, '2917.msg').click()
  await expect(transcript(page)).toContainText('still quarantined')
  await link(page, 'mail/').click()
  await link(page, 'contact-import').click()
  await expect(transcript(page)).toContainText('invisible separator')
  await link(page, 'queue-review').click()
  await expect(transcript(page)).toContainText('resolver cleans it up later')
  await quick(page, 'Route message').click()
  const recipient = page.getByRole('textbox', { name: 'Recipient', exact: true })
  const submit = page.getByRole('button', { name: 'Submit route' })
  await submit.click()
  await expect(transcript(page)).toContainText('under delivery hold')
  await link(page, 'samples/').click()
  await link(page, 'legacy-address.txt').click()
  await link(page, 'Inspect U+200B').click()
  const details = transcript(page).getByRole('region', { name: 'Unicode U+200B' })
  await page.getByRole('button', { name: 'Code points', exact: false }).click()
  await page.getByRole('button', { name: '2. U+0069, i' }).click()
  await page.getByRole('button', { name: 'Caret after' }).click()
  await details.getByRole('button', { name: 'Insert', exact: true }).click()
  await expect(recipient).toHaveValue('Mi\u200bra')
  await submit.click()
  await expect(panel(page)).toContainText('Released')
  await expect(panel(page)).toContainText('Open')
  await link(page, '/delivered/2917.msg').click()
  await expect(panel(page)).toContainText('Complete')
  await expect(transcript(page)).toContainText('I think we have the same account')
  await expect(transcript(page)).toContainText('Directory reference: index-09')
})
