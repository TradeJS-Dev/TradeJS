import {
  getDataEdgesForSymbols,
  getReferenceCandlePrices,
} from '@tradejs/infra/timescale/candles';
import type { Signal } from '@tradejs/types';
import { getConnectorCreatorByProvider } from '../connectorsRegistry';
import {
  enrichSignalWithReferenceMarkets,
  prepareReferenceMarketHistory,
} from '../strategyHelpers/referenceMarkets';

jest.mock('@tradejs/infra/timescale/candles', () => ({
  getReferenceCandlePrices: jest.fn(),
  getDataEdgesForSymbols: jest.fn().mockResolvedValue(new Map()),
}));
jest.mock('../connectorsRegistry', () => ({
  getConnectorCreatorByProvider: jest.fn(),
}));

const timestamp = Date.parse('2026-10-05T20:00:00Z');
const hour = 3_600_000;
const request = {
  userName: 'test',
  projectRoot: '/fixture',
  startMs: timestamp - 24 * hour,
  endMs: timestamp,
  live: false,
};

it('does not fetch from Bybit when cache-only, and warms the fixed universe in normal runs', async () => {
  const kline = jest.fn().mockResolvedValue([]);
  const mockCreator = jest.fn().mockResolvedValue({ kline });
  jest.mocked(getConnectorCreatorByProvider).mockResolvedValue(mockCreator);
  await prepareReferenceMarketHistory({ ...request, cacheOnly: true });
  expect(mockCreator).not.toHaveBeenCalled();
  await prepareReferenceMarketHistory({ ...request, cacheOnly: false });
  expect(
    mockCreator.mock.calls.map(([config]) => config.universe).sort(),
  ).toEqual(['crypto', 'tradfi']);
  expect(kline).toHaveBeenCalledTimes(63);
  expect(kline).toHaveBeenCalledWith({
    symbol: 'XAGUSDT',
    interval: '60',
    start: timestamp - 26 * hour,
    end: timestamp - hour,
    warmOnly: true,
    silent: true,
  });
  expect(kline).toHaveBeenCalledWith(
    expect.objectContaining({
      symbol: 'SOLUSDT',
      interval: '240',
    }),
  );
});

it('shares the same cached measurements across signals, and preserves frozen exports', async () => {
  const getRows = jest.mocked(getReferenceCandlePrices);
  getRows.mockResolvedValue([
    {
      symbol: 'ETHUSDT',
      interval: 60,
      timestamp: timestamp - 2 * hour,
      close: 100,
      volume: 1,
    },
    {
      symbol: 'ETHUSDT',
      interval: 60,
      timestamp: timestamp - hour,
      close: 99,
      volume: 1,
    },
  ]);
  const signal: Signal = {
    signalId: 'fixture',
    symbol: 'BTCUSDT',
    strategy: 'Fixture',
    timestamp,
    interval: '15',
    direction: 'LONG',
    prices: {
      currentPrice: 100,
      takeProfitPrice: 110,
      stopLossPrice: 95,
      riskRatio: 2,
    },
    indicators: {},
    figures: {},
  };
  const a: Signal = { ...signal, additionalIndicators: { existing: true } };
  const b: Signal = { ...signal, timestamp: timestamp + 15 * 60_000 };
  const frozen: Signal = { ...signal, aiFeatureReplay: { snapshot: null } };
  await Promise.all([a, b, frozen].map(enrichSignalWithReferenceMarkets));
  expect(getRows).toHaveBeenCalledTimes(1);
  expect(a.additionalIndicators?.existing).toBe(true);
  expect(
    a.additionalIndicators?.referenceMarkets?.frames.h1?.returnsPct.ETHUSDT,
  ).toBeCloseTo(100 * Math.log(0.99));
  expect(b.additionalIndicators).toEqual({
    referenceMarkets: a.additionalIndicators?.referenceMarkets,
  });
  expect(frozen.additionalIndicators).toBeUndefined();
});

it('does not call the exchange when the requested reference history is already cached', async () => {
  jest.mocked(getConnectorCreatorByProvider).mockClear();
  jest
    .mocked(getDataEdgesForSymbols)
    .mockImplementation(
      async (_provider, symbols) =>
        new Map(symbols.map((symbol) => [symbol, { min: 0, max: timestamp }])),
    );
  await prepareReferenceMarketHistory({ ...request, cacheOnly: false });
  expect(getConnectorCreatorByProvider).not.toHaveBeenCalled();
});
