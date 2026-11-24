import type { NewsEvent, Signal } from '@tradejs/types';
import { getKlineCandlesRange } from '@tradejs/infra/timescale/candles';
import { readNewsArchive } from '@tradejs/infra/timescale/client';
import {
  enrichSignalWithNews,
  loadNewsContext,
} from '../strategyHelpers/newsContext';

jest.mock('@tradejs/infra/timescale/candles');
jest.mock('@tradejs/infra/timescale/client');

test('shares the market read and only asks for completed reaction candles', async () => {
  const t = Date.parse('2025-03-12T12:30:00Z');
  const event: NewsEvent = {
    eventId: 'test',
    revision: 1,
    type: 'us.cpi',
    provider: 'bls',
    timeZone: 'America/New_York',
    url: 'https://bls.gov/',
    status: 'published',
    eventDay: '2025-03-12',
    scheduledAt: t,
    publishedAt: t,
    availableAt: t + 1,
    precision: 'minute',
    provenance: 'observed',
  };
  jest
    .mocked(readNewsArchive)
    .mockResolvedValue({ schemaVersion: 1, events: [event], coverage: [] });
  jest.mocked(getKlineCandlesRange).mockImplementation(
    async (_, symbol, __, start, end) =>
      [
        { timestamp: start, close: 100 },
        { timestamp: end - 1, close: symbol === 'BTCUSDT' ? 101 : 102 },
      ] as never,
  );
  const original = Object.freeze({ gateFeatures: Object.freeze({}) });
  const signal = {
    signalId: 'news-fixture',
    strategy: 'Fixture',
    direction: 'LONG',
    prices: {
      currentPrice: 100,
      stopLossPrice: 99,
      takeProfitPrice: 102,
      riskRatio: 2,
    },
    indicators: {},
    figures: {},
    symbol: 'SOLUSDT',
    interval: '15',
    timestamp: t,
    additionalIndicators: { baseContext: original },
  } as Signal;
  const [_, sol, eth] = await Promise.all([
    enrichSignalWithNews(signal),
    loadNewsContext(t + 900000, 'SOLUSDT'),
    loadNewsContext(t + 900000, 'ETHUSDT'),
  ]);
  expect(readNewsArchive).toHaveBeenCalledTimes(1);
  expect(getKlineCandlesRange).toHaveBeenCalledTimes(5);
  expect(getKlineCandlesRange).toHaveBeenCalledWith(
    'bybit',
    'BTCUSDT',
    15,
    t - 900000,
    t + 1,
  );
  expect(sol.features.reactionRelativePct).toBeCloseTo(1);
  expect(eth.features.reactionBreadth).toBe(1);
  expect(signal.additionalIndicators?.baseContext?.gateFeatures?.news).toEqual(
    sol.features,
  );
  expect(original).not.toHaveProperty('news');
});

test('storage failure leaves explicit unavailable context', async () => {
  jest.mocked(readNewsArchive).mockRejectedValueOnce(new Error('offline'));
  const ctx = await loadNewsContext(1_700_000_000_000, 'BTCUSDT');
  expect(ctx.status).toBe('unavailable');
  expect(ctx.features.reactionRelativePct).toBeNull();
});
