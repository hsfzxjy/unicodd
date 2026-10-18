import { expect, test, type Page } from '@playwright/test';

function collectBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function loadApp(page: Page): Promise<void> {
  await page.goto('./');
  await page.getByRole('button', { name: 'Dismiss how to play' }).click();
}

test('loads discovery data only when a consumer requests it', async ({ page }) => {
  const errors = collectBrowserErrors(page);
  const requestedUrls: string[] = [];
  page.on('request', (request) => requestedUrls.push(request.url()));

  await loadApp(page);
  await expect(page.getByRole('heading', { name: 'A seam in the string' })).toBeVisible();
  await expect(page.getByText('Loading the operation graph…')).toHaveCount(0);
  expect(requestedUrls.some((url) => url.includes('/unicode-indexes/'))).toBe(false);

  const relationshipResponse = page.waitForResponse((response) =>
    response.url().endsWith('/unicode-indexes/relationships-17.0.0.json'),
  );
  await page.getByRole('button', { name: 'Character lab' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect((await relationshipResponse).ok()).toBe(true);
  await expect(page.getByRole('heading', { name: 'Character relationships' })).toBeVisible();

  const nameResponse = page.waitForResponse((response) =>
    response.url().endsWith('/unicode-indexes/names-17.0.0.json'),
  );
  await page.getByRole('searchbox', { name: 'Character search' }).fill('circled digit one');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  expect((await nameResponse).ok()).toBe(true);
  await expect(page.getByText('CIRCLED DIGIT ONE', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('loads optional puzzle assets without breaking the workbench', async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await loadApp(page);

  const relationshipResponse = page.waitForResponse((response) =>
    response.url().endsWith('/unicode-indexes/relationships-17.0.0.json'),
  );
  await page.getByLabel('Choose puzzle').selectOption('5');
  await expect(page.getByRole('heading', { name: 'Looks equal, stays different' })).toBeVisible();
  expect((await relationshipResponse).ok()).toBe(true);
  await expect(page.getByText('Loading the operation graph…')).toHaveCount(0);

  const historicalResponse = page.waitForResponse((response) =>
    response.url().endsWith('/wasm/unicodd_unicode_15.wasm'),
  );
  await page.getByLabel('Choose puzzle').selectOption('8');
  await expect(page.getByRole('heading', { name: 'New meaning for an old number' })).toBeVisible();
  expect((await historicalResponse).ok()).toBe(true);
  await expect(page.getByText('Loading the operation graph…')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('isolates and retries an optional discovery-data failure', async ({ page }) => {
  let failManifestRequest = true;
  await page.route('**/unicode-indexes/unicode-current.json', async (route) => {
    if (failManifestRequest) {
      failManifestRequest = false;
      await route.fulfill({ status: 503, body: 'Temporarily unavailable' });
      return;
    }
    await route.continue();
  });

  await loadApp(page);
  await page.getByLabel('Language').selectOption('zh-CN');
  await page.getByLabel('选择谜题').selectOption('5');
  await expect(page.getByRole('alert')).toHaveText('无法加载 Unicode 发现数据（状态 503）。');
  await expect(page.getByRole('button', { name: '重试加载谜题数据' })).toBeVisible();

  const relationshipResponse = page.waitForResponse((response) =>
    response.url().endsWith('/unicode-indexes/relationships-17.0.0.json'),
  );
  await page.getByRole('button', { name: '重试加载谜题数据' }).click();
  expect((await relationshipResponse).ok()).toBe(true);
  await expect(page.getByText('正在加载运算图…')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '看起来相同，实际仍不同' })).toBeVisible();
});

test('localizes and retries an optional name-index failure', async ({ page }) => {
  let failNameRequest = true;
  await page.route('**/unicode-indexes/names-17.0.0.json', async (route) => {
    if (failNameRequest) {
      failNameRequest = false;
      await route.fulfill({ status: 503, body: 'Temporarily unavailable' });
      return;
    }
    await route.continue();
  });

  await loadApp(page);
  await page.getByLabel('Language').selectOption('zh-CN');
  await page.getByRole('button', { name: '字符实验室' }).click();
  await page.getByRole('searchbox', { name: '字符搜索' }).fill('circled digit one');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('字符搜索暂不可用（状态 503）。');

  const nameResponse = page.waitForResponse((response) =>
    response.url().endsWith('/unicode-indexes/names-17.0.0.json'),
  );
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  expect((await nameResponse).ok()).toBe(true);
  await expect(page.getByText('CIRCLED DIGIT ONE', { exact: true })).toBeVisible();
});

test('isolates and retries a historical-engine failure', async ({ page }) => {
  let failManifestRequest = true;
  await page.route('**/wasm/unicode-15-1.json', async (route) => {
    if (failManifestRequest) {
      failManifestRequest = false;
      await route.fulfill({ status: 503, body: 'Temporarily unavailable' });
      return;
    }
    await route.continue();
  });

  await loadApp(page);
  await page.getByLabel('Language').selectOption('zh-CN');
  await page.getByLabel('选择谜题').selectOption('8');
  await expect(page.getByRole('alert')).toHaveText('无法加载历史 Unicode 引擎（状态 503）。');
  await expect(page.getByRole('button', { name: '重试加载谜题数据' })).toBeVisible();

  const historicalResponse = page.waitForResponse((response) =>
    response.url().endsWith('/wasm/unicodd_unicode_15.wasm'),
  );
  await page.getByRole('button', { name: '重试加载谜题数据' }).click();
  expect((await historicalResponse).ok()).toBe(true);
  await expect(page.getByText('正在加载运算图…')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '旧码位的新含义' })).toBeVisible();
});
