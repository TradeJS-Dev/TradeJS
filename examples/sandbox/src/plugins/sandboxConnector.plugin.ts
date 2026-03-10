import {
  defineConnectorPlugin,
  type Connector,
  type ConnectorCreator,
  type ConnectorRegistryEntry,
  type KlineChartData,
} from '@tradejs/core';
import {
  BTC_TICKER_SYMBOL,
  SANDBOX_TICKER_SYMBOL,
  buildDeterministicCandles,
  buildDeterministicTickers,
} from './sandboxMarketData';

const cache = new Map<string, KlineChartData>();

const buildCacheKey = (params: {
  symbol: string;
  interval: string;
  start?: number;
  end: number;
}): string => {
  const { symbol, interval, start, end } = params;
  return [symbol, interval, start ?? '', end].join(':');
};

const SandboxMockConnectorCreator: ConnectorCreator = async () => {
  let state: Record<string, unknown> = {};

  const connector: Connector = {
    kline: async ({ symbol, interval, start, end }) => {
      const cacheKey = buildCacheKey({
        symbol,
        interval: String(interval),
        start,
        end,
      });

      const cached = cache.get(cacheKey);
      if (cached) {
        return cached;
      }

      const data = buildDeterministicCandles({
        symbol,
        interval,
        start,
        end,
      });
      cache.set(cacheKey, data);
      return data;
    },
    getTickers: async () => buildDeterministicTickers(),
    getPosition: async () => null,
    getPositions: async () => [],
    placeOrder: async () => true,
    closePosition: async () => true,
    getState: async () => state,
    setState: async (nextState: object) => {
      state = {
        ...state,
        ...nextState,
      };
    },
  };

  return connector;
};

const connectorEntries: ConnectorRegistryEntry[] = [
  {
    name: 'SandboxMockConnector',
    creator: SandboxMockConnectorCreator,
    providers: ['sandbox', 'sandboxmock'],
  },
];

export { SandboxMockConnectorCreator, connectorEntries };
export { SANDBOX_TICKER_SYMBOL, BTC_TICKER_SYMBOL };

export default defineConnectorPlugin({ connectorEntries });
