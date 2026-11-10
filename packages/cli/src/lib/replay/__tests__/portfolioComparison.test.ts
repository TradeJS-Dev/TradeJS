import { createHash } from 'node:crypto';
import { comparePortfolioReports } from '../portfolioComparison';

const report = (revision: string, pnl: number) => ({
  schema: 'tradejs-portfolio-backtest/v1',
  window: { start: 0, end: 14 * 86400000 },
  lineage: {
    batchCount: 1,
    cacheOnly: true,
    connector: 'bybit',
    interval: '15',
    tickers: ['AAAUSDT', 'BBBUSDT'],
    candleCoverage: null,
    binanceMarketContextRows: null,
    maxLossValue: 10,
    strategies: [
      {
        strategyName: 'First',
        revision,
        maxLossValue: 10,
        effectiveConfig: {},
      },
      {
        strategyName: 'Second',
        revision: 'fixed',
        maxLossValue: 10,
        effectiveConfig: {},
      },
    ],
  },
  metrics: {
    portfolio: [
      {
        window: 'full',
        scope: 'PORTFOLIO',
        cohort: 'ALL' as const,
        n: 1,
        wins: 1,
        losses: 0,
        pnl,
        pnlPerTrade: pnl,
        profitFactor: null,
        winRate: 1,
        realizedMaxDrawdown: 0,
        cadencePerDay: 1 / 14,
      },
    ],
    strategies: [],
  },
  trades: [
    {
      strategyName: 'First',
      direction: 'LONG' as const,
      openedAt: 100,
      exitedAt: 200,
      pnl,
    },
  ],
  curves: { portfolioDrawdown: [{ timestamp: 0, value: 0 }] },
});
const signed = (value: ReturnType<typeof report>) => ({
  ...value,
  checksum: createHash('sha256').update(JSON.stringify(value)).digest('hex'),
});

it('pairs realized results by calendar and rejects a comparison without shared execution', () => {
  const before = report('A', 10),
    after = report('B', 7);
  expect(comparePortfolioReports(signed(before), after)).toMatchObject({
    changedStrategy: 'First',
    delta: { pnl: -3, trades: 0 },
    bootstrap: { observedMeanPnlDelta: -1.5 },
  });
  expect(() =>
    comparePortfolioReports({ ...signed(before), trades: [] }, after),
  ).toThrow('checksum');
  expect(() =>
    comparePortfolioReports(signed(before), {
      ...after,
      lineage: { ...after.lineage, batchCount: 2 },
    }),
  ).toThrow('single shared batch');
  expect(() =>
    comparePortfolioReports(signed(before), {
      ...after,
      lineage: { ...after.lineage, tickers: ['BBBUSDT'] },
    }),
  ).toThrow('tickers');
});

it('attributes only identical filled versus capacity-rejected signals of unchanged strategies', () => {
  const before = {
    ...report('A', 10),
    portfolioDiagnostics: {
      markedMaxDrawdown: 12,
      unpricedCycles: 0,
      admissions: [
        { key: 'same', strategy: 'Second', status: 'filled' as const },
        { key: 'changed', strategy: 'First', status: 'filled' as const },
      ],
    },
  };
  const after = {
    ...report('B', 7),
    portfolioDiagnostics: {
      markedMaxDrawdown: 18,
      unpricedCycles: 0,
      admissions: [
        {
          key: 'same',
          strategy: 'Second',
          status: 'capacity-rejected' as const,
        },
        {
          key: 'changed',
          strategy: 'First',
          status: 'capacity-rejected' as const,
        },
        {
          key: 'unknown',
          strategy: 'Second',
          status: 'capacity-rejected' as const,
        },
      ],
    },
  };
  expect(comparePortfolioReports(signed(before), after)).toMatchObject({
    markedDrawdown: { control: 12, candidate: 18, delta: 6 },
    capacityDisplacement: { displaced: 1, restored: 0 },
  });
});

it('marks an open replay position at the candle close rather than its fill price', async () => {
  const { createPortfolioReplayConnector } = await import(
    '../portfolioReplayConnector'
  );
  const connector = createPortfolioReplayConnector(
    {} as import('@tradejs/types').Connector,
    true,
  );
  const bar = (timestamp: number, close: number) => ({
    timestamp,
    dt: new Date(timestamp).toISOString(),
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
    turnover: close,
  });
  await connector.advanceMarket({ symbol: 'BTCUSDT', candle: bar(1000, 100) });
  await connector.placeOrder({
    symbol: 'BTCUSDT',
    price: 100,
    qty: 2,
    direction: 'LONG',
    timestamp: 1000,
  });
  const before = connector.getMarkedEquity();
  await connector.advanceMarket({ symbol: 'BTCUSDT', candle: bar(2000, 90) });
  expect(connector.getMarkedEquity()! - before!).toBeCloseTo(-20);
  expect(connector.getReplayArtifacts().positionLog).toHaveLength(0);
});
