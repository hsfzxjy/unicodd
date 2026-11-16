import type { Locator, Page } from '@playwright/test'

type Activate = (target: Locator) => Promise<void>

// Use the desktop shortcut when present. The compact layout offers the same
// commands through the Composer, where choosing a command never submits it.
export async function commandControl(
  page: Page,
  name: string,
  activate: Activate = (target) => target.click(),
  submit = false,
) {
  const shortcut = page
    .getByRole('group', { name: 'Quick actions' })
    .getByRole('button', { name, exact: true })
  if (!(await page.evaluate(() => matchMedia('(max-width: 830px)').matches)))
    return activate(shortcut)

  const browse = page
    .locator('.prompt-tools')
    .getByRole('button', { name, exact: true })
    .and(page.locator(':enabled'))
  if (await browse.isVisible()) return activate(browse)
  const tag = page.getByRole('button', { name: /^Change command:/ })
  await activate(tag.or(page.getByRole('button', { name: 'Commands', exact: true })))
  const menu = page.getByRole('menu', { name: 'Commands' })
  await activate(menu.getByRole('menuitemradio', { name: new RegExp(`^${name}( |$)`, 'u') }))
  if (submit) await activate(page.getByRole('button', { name: 'Run', exact: true }))
}
