import { expect, test } from '@playwright/test';

const password = 'QuickstartE2e123!';
const candleInterval = 15 * 60_000;

test.describe.configure({ retries: 0 });

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  console.log(
    '[quickstart failure]',
    JSON.stringify({
      path: new URL(page.url()).pathname,
      text: (
        await page
          .locator('body')
          .innerText({ timeout: 5_000 })
          .catch(() => '<body unavailable>')
      ).slice(0, 12_000),
    }),
  );
});

test('installs TradeJS and completes the first backtest from the UI', async ({
  page,
}) => {
  test.setTimeout(300_000);
  page.on('pageerror', (error) =>
    console.log('[quickstart page error]', error.message),
  );
  page.on('response', (response) => {
    if (response.status() >= 400)
      console.log(
        '[quickstart HTTP error]',
        response.status(),
        new URL(response.url()).pathname,
      );
    if (new URL(response.url()).pathname.startsWith('/api/kline/')) {
      void response
        .json()
        .then((payload) => {
          const candles = Array.isArray(payload?.data) ? payload.data : [];
          console.log(
            '[quickstart candles]',
            JSON.stringify({
              path: new URL(response.url()).pathname,
              status: response.status(),
              rows: candles.length,
              firstTimestamp: candles[0]?.timestamp,
              lastTimestamp: candles.at(-1)?.timestamp,
            }),
          );
        })
        .catch(() => undefined);
    }
  });

  // The chart should render independently of the default exchange's regional
  // availability on a hosted runner. The Coinbase backtest below still uses
  // the generated app, worker, and market connector.
  const latestOpen = Math.floor(Date.now() / candleInterval) * candleInterval;
  const chartCandles = Array.from({ length: 192 }, (_, index) => {
    const timestamp = latestOpen - (192 - index) * candleInterval;
    const open = 60_000 + index * 5;
    return {
      timestamp,
      dt: new Date(timestamp).toISOString(),
      open,
      high: open + 25,
      low: open - 10,
      close: open + 10,
      volume: 2,
      turnover: open * 2,
    };
  });
  await page.route(
    (url) =>
      /^\/api\/kline\/(?:bybit|coinbase)\/crypto\/BTC(?:USDT)?\/15$/.test(
        url.pathname,
      ),
    async (route) => {
      const { start = 0, end } = route.request().postDataJSON();
      await route.fulfill({
        json: {
          data: chartCandles.filter(
            ({ timestamp }) => timestamp >= start && timestamp < end,
          ),
        },
      });
    },
  );

  await page.goto('/routes/install');

  await expect(
    page.getByRole('heading', { name: 'Set up TradeJS', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page
    .getByRole('button', { name: 'Install and open dashboard' })
    .click();

  await expect(page).toHaveURL(/\/routes\/dashboard\//, {
    timeout: 60_000,
  });
  await expect(page.getByLabel('Backtest', { exact: true })).toBeVisible();

  const chart = page.locator('[data-testid="market-chart"]');
  await expect(chart).toHaveAttribute('data-chart-ready', 'true', {
    timeout: 90_000,
  });
  await expect(chart.locator('canvas').first()).toBeVisible();

  await page.getByLabel('Backtest', { exact: true }).click();
  await expect(page).toHaveURL(/\/routes\/backtest(?:\?.*)?$/, {
    timeout: 60_000,
  });
  await expect(page.getByText('Backtest runs', { exact: true })).toBeVisible();

  await page.locator('summary').filter({ hasText: 'New backtest' }).click();
  await page
    .getByRole('spinbutton', { name: 'Number of days', exact: true })
    .fill('7');

  await page.getByRole('combobox', { name: 'Exchange', exact: true }).click();
  await page.getByRole('option', { name: 'Coinbase', exact: true }).click();

  const tickersInput = page.getByRole('combobox', {
    name: 'Instruments',
    exact: true,
  });
  await tickersInput.click();
  await tickersInput.fill('BTC');
  await page
    .getByRole('option', { name: /^BTC(?:USDT)?(?:\s|$)/ })
    .first()
    .click({ timeout: 30_000 });
  await tickersInput.press('Escape');

  await page
    .locator('summary')
    .filter({ hasText: 'Advanced settings' })
    .click();
  await page
    .getByRole('spinbutton', { name: 'Max tests', exact: true })
    .fill('1');
  await page
    .getByRole('spinbutton', { name: 'Parallel workers', exact: true })
    .fill('1');

  const startResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/backtest/runs',
  );
  await page
    .getByRole('button', { name: 'Start backtest', exact: true })
    .click();
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
