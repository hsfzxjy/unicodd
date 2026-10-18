import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function dismissGuide(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: 'Dismiss how to play' }).click();
}

test('explains the play loop and keeps puzzle navigation in browser history', async ({ page }) => {
  await page.goto('./?puzzle=encoding-lengths');
  await expect(
    page.getByRole('heading', { level: 1, name: 'One character, four bytes' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Construct, inspect, apply, observe' }),
  ).toBeVisible();
  await expect(page.getByText('Open the character lab and follow relationships.')).toBeVisible();
  await dismissGuide(page);

  await page.getByRole('button', { name: 'Previous puzzle' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'A seam in the string' })).toBeVisible();
  await expect(page).toHaveURL(/puzzle=nfc-concatenation-boundary/);

  await page.getByLabel('Choose puzzle').selectOption('4');
  await expect(page.getByRole('heading', { name: 'Formatting that disappears' })).toBeVisible();
  await expect(page).toHaveURL(/puzzle=compatibility-normalization/);

  await page.goBack();
  await expect(page.getByRole('heading', { name: 'A seam in the string' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'One character, four bytes' })).toBeVisible();

  await page.getByRole('button', { name: 'How to play' }).click();
  await expect(
    page.getByRole('heading', { name: 'Construct, inspect, apply, observe' }),
  ).toBeVisible();
});

test('switches between English and Chinese without resetting puzzle state', async ({ page }) => {
  await page.goto('./?puzzle=encoding-lengths');
  await page.getByLabel('Language').selectOption('zh-CN');

  await expect(page).toHaveTitle(/一个字符，四个字节/);
  await expect(page.getByRole('heading', { name: '一个字符，四个字节' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '构造、检查、应用、观察' })).toBeVisible();
  await page.getByRole('button', { name: '关闭玩法说明' }).click();

  const input = page.locator('#puzzle-input');
  await input.fill('🧩');
  await expect(page.getByText('谜题已解开', { exact: true })).toBeVisible();
  await expect(page.getByText('已达到目标', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '计算三种表示的长度' })).toBeVisible();

  await page.getByLabel('语言').selectOption('en');
  await expect(
    page.getByRole('heading', { level: 1, name: 'One character, four bytes' }),
  ).toBeVisible();
  await expect(input).toHaveValue('🧩');
  await expect(page.getByText('Puzzle solved', { exact: true })).toBeVisible();
});

test('preserves ordinary text editing and applies an explored selection explicitly', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('./');
  await dismissGuide(page);
  await page.getByRole('button', { name: 'Character lab' }).click();

  const editor = page.getByRole('textbox', { name: 'Unicode text' });
  await editor.focus();
  await page.evaluate(() => navigator.clipboard.writeText('e\u0301🧩'));
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Control+V');
  await expect(editor).toHaveValue('e\u0301🧩');

  await editor.evaluate((element: HTMLTextAreaElement) => {
    element.setSelectionRange(2, 4);
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await expect(page.getByText('U+1F9E9', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Close lab' }).click();
  await page.locator('#puzzle-left').fill('ab');
  await page.getByRole('button', { name: /U\+0061, item 1/ }).click();
  await page.getByRole('button', { name: 'Insert explored' }).first().click();
  await expect(page.locator('#puzzle-left')).toHaveValue('a🧩b');
});

test('shows, reorders, deletes, and inserts puzzle input values as blocks', async ({ page }) => {
  await page.goto('./');
  await dismissGuide(page);

  const input = page.locator('#puzzle-left');
  const card = input.locator('xpath=ancestor::article');
  await input.fill('e\u0301🧩');
  await expect(card.getByRole('list', { name: 'Input A Unicode scalars' })).toBeVisible();
  await expect(card.getByText('U+0065', { exact: true })).toBeVisible();
  await expect(card.getByText('U+0301', { exact: true })).toBeVisible();
  await expect(card.getByText('U+1F9E9', { exact: true })).toBeVisible();
  await expect(card.locator('.puzzle-rendered output')).toHaveText('e\u0301🧩');

  const blocks = card.locator('.sequence-block');
  await blocks.nth(2).dragTo(blocks.nth(0));
  await expect(input).toHaveValue('🧩e\u0301');

  await card.getByRole('button', { name: 'Delete U+0065' }).click();
  await expect(input).toHaveValue('🧩\u0301');

  await card.getByRole('button', { name: /U\+1F9E9, item 1/ }).focus();
  await page.keyboard.press('Alt+ArrowRight');
  await expect(input).toHaveValue('\u0301🧩');

  await page.getByLabel('Choose puzzle').selectOption('7');
  const unitsInput = page.locator('#puzzle-input');
  const unitsCard = unitsInput.locator('xpath=ancestor::article');
  await unitsInput.fill('D83E DDE9');
  await expect(
    unitsCard.getByRole('list', { name: 'UTF-16 units UTF-16 code units' }),
  ).toBeVisible();
  await expect(unitsCard.getByText('D83E', { exact: true })).toBeVisible();
  await expect(unitsCard.getByText('DDE9', { exact: true })).toBeVisible();
  await expect(unitsCard.locator('.puzzle-rendered output')).toHaveText('🧩');
  await unitsCard.getByRole('button', { name: 'Delete DDE9' }).click();
  await expect(unitsInput).toHaveValue('D83E');
  await expect(unitsCard.locator('.puzzle-rendered output')).toHaveText('Not valid scalar text');
});

test('reorders selected code-point blocks with touch-sized controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./');
  await dismissGuide(page);

  const input = page.locator('#puzzle-left');
  const card = input.locator('xpath=ancestor::article');
  await input.fill('e\u0301🧩');
  await card.getByRole('button', { name: /U\+0301, item 2/ }).click();

  const moveLeft = card.getByRole('button', { name: 'Move U+0301 left' });
  const moveLeftBox = await moveLeft.boundingBox();
  expect(moveLeftBox?.width).toBeGreaterThanOrEqual(32);
  expect(moveLeftBox?.height).toBeGreaterThanOrEqual(32);
  await moveLeft.click();
  await expect(input).toHaveValue('\u0301e🧩');

  await card.getByRole('button', { name: 'Move U+0301 right' }).click();
  await expect(input).toHaveValue('e\u0301🧩');

  const deleteButton = card.getByRole('button', { name: 'Delete U+0301' });
  const deleteBox = await deleteButton.boundingBox();
  expect(deleteBox?.width).toBeGreaterThanOrEqual(24);
  expect(deleteBox?.height).toBeGreaterThanOrEqual(24);
  await deleteButton.click();
  await expect(input).toHaveValue('e🧩');
});

test('solves the first puzzle and exposes graph values without color alone', async ({ page }) => {
  await page.goto('./?puzzle=not-a-real-puzzle');
  await dismissGuide(page);
  await expect(page.getByRole('heading', { name: 'A seam in the string' })).toBeVisible();

  await page.locator('#puzzle-left').fill('e');
  await page.locator('#puzzle-right').fill('\u0301');
  await expect(page.getByText('Puzzle solved', { exact: true })).toBeVisible();
  await expect(page.getByText('Target reached', { exact: true })).toBeVisible();

  const graphNode = page.locator('.operation-node').first();
  await graphNode.focus();
  await expect(graphNode).toHaveAccessibleName(/Input A.*U\+0065/);
  await page.keyboard.press('Enter');
  const explanation = page.getByRole('region', { name: 'Input A' });
  await expect(explanation).toBeVisible();
  await expect(explanation).toContainText('exact sequence of Unicode scalars');
  await expect(explanation).toContainText('Current');
  await expect(explanation).toContainText('U+0065');
  await page.getByRole('button', { name: 'Close operation explanation' }).click();
  await expect(explanation).toBeHidden();
});

test('contains dialog focus and keeps the workbench reachable on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./');
  const guideBox = await page.locator('#play-guide').boundingBox();
  expect(guideBox?.x).toBeGreaterThanOrEqual(0);
  expect((guideBox?.x ?? 0) + (guideBox?.width ?? 0)).toBeLessThanOrEqual(390);
  await dismissGuide(page);

  const dimensions = await page.evaluate(() => ({
    clientHeight: document.body.clientHeight,
    scrollHeight: document.body.scrollHeight,
    clientWidth: document.body.clientWidth,
    scrollWidth: document.body.scrollWidth,
  }));
  expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.clientHeight);
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);

  const trigger = page.getByRole('button', { name: 'Character lab' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close lab' })).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');

  const focusable = dialog.locator(
    'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
  );
  await focusable.last().focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Close lab' })).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('');

  await trigger.click();
  await page.locator('.discovery-backdrop').click({ position: { x: 2, y: 2 } });
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('reflows at a desktop-equivalent 200% viewport', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 360 });
  await page.goto('./');
  await dismissGuide(page);

  await expect(page.getByRole('navigation', { name: 'Puzzle navigation' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Character lab' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Watch the normalization boundary' }),
  ).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    clientHeight: document.body.clientHeight,
    scrollHeight: document.body.scrollHeight,
    clientWidth: document.body.clientWidth,
    scrollWidth: document.body.scrollWidth,
  }));
  expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.clientHeight);
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);

  await page.getByLabel('Language').selectOption('zh-CN');
  await expect(page.getByRole('heading', { name: '观察规范化边界' })).toBeVisible();
  const chineseDimensions = await page.evaluate(() => ({
    clientHeight: document.body.clientHeight,
    scrollHeight: document.body.scrollHeight,
    clientWidth: document.body.clientWidth,
    scrollWidth: document.body.scrollWidth,
  }));
  expect(chineseDimensions.scrollHeight).toBeLessThanOrEqual(chineseDimensions.clientHeight);
  expect(chineseDimensions.scrollWidth).toBeLessThanOrEqual(chineseDimensions.clientWidth);
});

test('keeps long Chinese puzzle content reachable in the mobile workspace', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./');
  await page.getByLabel('Language').selectOption('zh-CN');
  await page.getByRole('button', { name: '关闭玩法说明' }).click();

  await page.locator('#puzzle-left').fill('e\u0301🧩e\u0323\u0301a\u0308');
  await page.getByRole('button', { name: '显示提示' }).click();
  await expect(page.getByText('从探索器中的 é 开始，检查它的规范分解。')).toBeVisible();

  const graphNode = page.locator('.operation-node').first();
  await graphNode.focus();
  await page.keyboard.press('Enter');
  const explanation = page.locator('.operation-explanation');
  await expect(explanation).toBeVisible();
  await expect(explanation).toContainText('运算说明');

  const dimensions = await page.evaluate(() => ({
    clientHeight: document.body.clientHeight,
    scrollHeight: document.body.scrollHeight,
    clientWidth: document.body.clientWidth,
    scrollWidth: document.body.scrollWidth,
  }));
  expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.clientHeight);
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);

  await page.getByRole('button', { name: '关闭运算说明' }).click();
  await page.getByRole('button', { name: '字符实验室' }).click();
  const dialogBox = await page.getByRole('dialog').boundingBox();
  expect(dialogBox?.x).toBeGreaterThanOrEqual(0);
  expect((dialogBox?.x ?? 0) + (dialogBox?.width ?? 0)).toBeLessThanOrEqual(390);
  expect(dialogBox?.y).toBeGreaterThanOrEqual(0);
  expect((dialogBox?.y ?? 0) + (dialogBox?.height ?? 0)).toBeLessThanOrEqual(844);
});

test('has no automatically detectable accessibility violations in either workspace', async ({
  page,
}) => {
  await page.goto('./');
  await expect(
    page.getByRole('heading', { name: 'Construct, inspect, apply, observe' }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await dismissGuide(page);
  await page.getByRole('button', { name: 'Character lab' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole('button', { name: 'Close lab' }).click();
  await page.getByLabel('Language').selectOption('zh-CN');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole('button', { name: '字符实验室' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
