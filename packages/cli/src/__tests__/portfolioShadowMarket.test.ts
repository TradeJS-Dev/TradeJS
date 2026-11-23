import type { Connector, PortfolioStrategyEntry } from '@tradejs/types';
import {
  loadPortfolioShadowMarket,
  withoutShadowOrders,
} from '../lib/signals/portfolioShadowMarket';

const step = 900_000;
const boundary = Date.UTC(2025, 0, 1);
const bar = (timestamp: number) => ({
  timestamp,
  dt: new Date(timestamp).toISOString(),
  open: 100,
  high: 105,
  low: 95,
  close: 102,
  volume: 1,
  turnover: 1,
});
const connector = (): Connector => ({
  capabilities: { supportedUniverses: ['crypto'], defaultUniverse: 'crypto' },
  universe: 'crypto',
  kline: async ({ interval }) => {
    const duration = Number(interval) * 60_000;
    return [
      bar(boundary - 2 * duration),
      bar(boundary - duration),
      bar(boundary),
    ];
  },
  listInstruments: async () => [],
  getTickers: async () => [],
  getState: async () => ({}),
  setState: async () => {},
  getPosition: async () => null,
  getPositions: async () => [],
  placeOrder: jest.fn(async () => true),
  closePosition: jest.fn(async () => true),
  setTakeProfits: jest.fn(async () => true),
  setStopLoss: jest.fn(async () => true),
});

it('only evaluates the child intervals that closed at the boundary', async () => {
  const observed: [string, number][] = [];
  const makeChild = (interval: string) => {
    const config = { INTERVAL: interval, UNIVERSE: 'crypto' as const };
    return {
      entry: {
        manifest: { name: 'Child' + interval },
        defaults: config,
        parseConfig: () => config,
        createCore:
          ({
            strategyApi,
          }: Parameters<
            ReturnType<
              PortfolioStrategyEntry['resolveChildren']
            >[number]['entry']['createCore']
          >[0]) =>
          (candle: ReturnType<typeof bar>) => {
            observed.push([interval, candle.timestamp]);
            return strategyApi.skip('PROBE');
          },
      },
      config,
    };
  };
  const entry: PortfolioStrategyEntry = {
    kind: 'portfolio',
    manifest: { name: 'Probe' },
    defaults: {},
    parseConfig: () => ({}),
    resolveChildren: () => [makeChild('15'), makeChild('60')],
    execution: { maxPositions: 1, feeRate: 0, slippageBps: 0 },
    selectEntries: () => ({ ranked: [], pending: [] }),
    confirmEntry: () => null,
  };
  const marketConnector = connector();
  const snapshot = await loadPortfolioShadowMarket({
    entry,
    config: {},
    symbols: ['SOLUSDT'],
    closedAt: boundary,
    marketConnector,
    connectorName: 'ByBit',
    userName: 'shadow-test',
    cacheOnly: true,
  });
  expect(observed).toEqual([
    ['15', boundary - step],
    ['60', boundary - 4 * step],
  ]);
  expect(snapshot.market.candle('SOLUSDT', 0)?.timestamp).toBe(boundary - step);
  expect(snapshot.openingPrice('SOLUSDT')).toBe(100);
});

it('blocks connector writes in shadow while keeping market reads available', async () => {
  const source = connector();
  const shadow = withoutShadowOrders(source);
  await expect(shadow.closePosition({} as never)).rejects.toThrow(
    'disabled in portfolio shadow',
  );
  expect(source.closePosition).not.toHaveBeenCalled();
  expect(
    await shadow.kline({ symbol: 'SOLUSDT', interval: '15', end: boundary }),
  ).toHaveLength(3);
});
