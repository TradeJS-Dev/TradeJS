import { expect, test } from '@playwright/test';

const password = 'QuickstartE2e123!';

test('installs TradeJS and completes the first backtest from the UI', async ({
  page,
}) => {
  test.setTimeout(300_000);

  await page.goto('/routes/install');

  await expect(
    page.getByRole('heading', { name: 'Create your local password' }),
  ).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page
    .getByRole('button', { name: 'Install and open dashboard' })
    .click();

  await expect(page).toHaveURL(/\/routes\/dashboard\//, {
    timeout: 60_000,
  });
  await expect(
    page.getByRole('link', { name: 'Create backtest' }),
  ).toBeVisible();

  const chart = page.locator('[data-testid="market-chart"]');
  await expect(chart).toHaveAttribute('data-chart-ready', 'true', {
    timeout: 90_000,
  });
  await expect(chart.locator('canvas').first()).toBeVisible();

  await page.getByRole('link', { name: 'Create backtest' }).click();
  await expect(page).toHaveURL(/\/routes\/backtest(?:\?.*)?$/);
  await expect(page.getByText('Backtest runs', { exact: true })).toBeVisible();

  await page.getByRole('spinbutton', { name: 'Days' }).fill('7');

  await page.getByRole('combobox', { name: 'Connector' }).click();
  await page.getByRole('option', { name: 'Coinbase', exact: true }).click();

  const tickersInput = page.getByRole('combobox', { name: 'Tickers' });
  await tickersInput.click();
  await tickersInput.fill('BTC');
  await page
    .getByRole('option', { name: /^BTC(?:USDT)?(?:\s|$)/ })
    .first()
    .click({ timeout: 30_000 });
  await tickersInput.press('Escape');

  await page.getByRole('spinbutton', { name: 'Tests limit' }).fill('1');
  await page.getByRole('spinbutton', { name: 'Parallel' }).fill('1');

  const startResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/backtest/runs',
  );
  await page.getByRole('button', { name: 'Start' }).click();
  await expect((await startResponse).ok()).toBeTruthy();

  await expect(page.getByText('Completed', { exact: true })).toBeVisible({
    timeout: 180_000,
  });
  await page.getByRole('button', { name: 'Results' }).first().click();

  await expect(page).toHaveURL(/\/routes\/strategies\/backtest$/, {
    timeout: 60_000,
  });
  await expect(page.getByText(/^(?:BTC|BTCUSDT)$/).first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(
    page
      .getByText('strategy:', { exact: true })
      .locator('..')
      .getByText('MaStrategy', { exact: true }),
  ).toBeVisible();
});
