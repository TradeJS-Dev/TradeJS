import { defineConnectorPlugin } from '@tradejs/core/config';
import {
  BTC_TICKER_SYMBOL,
  SANDBOX_TICKER_SYMBOL,
  buildDeterministicCandles,
  buildDeterministicTickers,
} from './sandboxMarketData';
import {
  type Connector,
  type ConnectorCreator,
  type ConnectorRegistryEntry,
  type KlineChartData,
} from '@tradejs/types';

const cache = new Map<string, KlineChartData>();
const capabilities = {
  supportedUniverses: ['crypto'],
  defaultUniverse: 'crypto',
} as const;

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
    capabilities,
    universe: 'crypto',
    listInstruments: async (query) => {
      if (
        query?.universe === 'tradfi' ||
        (query?.assetClasses?.length && !query.assetClasses.includes('crypto'))
      ) {
        return [];
      }

      const symbols = query?.symbols?.length
        ? new Set(query.symbols.map((symbol) => symbol.trim().toUpperCase()))
        : null;

      return buildDeterministicTickers()
        .filter((ticker) => !symbols || symbols.has(ticker.symbol))
        .map((ticker) => ({
          provider: 'sandbox',
          symbol: ticker.symbol,
          kind: 'spot' as const,
          assetClass: 'crypto' as const,
          universe: 'crypto' as const,
          status: 'trading' as const,
        }));
    },
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
    setTakeProfits: async () => true,
    setStopLoss: async () => true,
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
