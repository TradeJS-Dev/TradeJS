import { expect, test } from '@playwright/test';

const password = 'QuickstartE2e123!';

test('installs TradeJS and opens a dashboard with market data', async ({
  page,
}) => {
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
});
