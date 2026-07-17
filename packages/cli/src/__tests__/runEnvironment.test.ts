const mockGetTickers = jest.fn();
const mockUpdate = jest.fn();
const mockResolveConnectorName = jest.fn();
const mockGetConnectorCreatorByName = jest.fn();
const mockLoadBtcReferenceConnectors = jest.fn();
const mockUpdateMarketHistoryWithBtcReferences = jest.fn();
const mockRedisGetData = jest.fn();
const mockRedisSetData = jest.fn();

jest.mock('@tradejs/node/cli', () => ({
  getTickers: (...args: unknown[]) => mockGetTickers(...args),
  update: (...args: unknown[]) => mockUpdate(...args),
}));

jest.mock('@tradejs/node/connectors', () => ({
  DEFAULT_CONNECTOR_NAME: 'ByBit',
  getConnectorCreatorByName: (...args: unknown[]) =>
    mockGetConnectorCreatorByName(...args),
  resolveConnectorName: (...args: unknown[]) =>
    mockResolveConnectorName(...args),
}));

jest.mock('../lib/marketData/historyPrepare', () => ({
  loadBtcReferenceConnectors: (...args: unknown[]) =>
    mockLoadBtcReferenceConnectors(...args),
  updateMarketHistoryWithBtcReferences: (...args: unknown[]) =>
    mockUpdateMarketHistoryWithBtcReferences(...args),
}));

jest.mock('@tradejs/infra/redis', () => ({
  getData: (...args: unknown[]) => mockRedisGetData(...args),
  setData: (...args: unknown[]) => mockRedisSetData(...args),
  redisKeys: {
    tickerUniverse: (userName: string, connectorName: string) =>
      `users:${userName}:cache:tickers:${connectorName}`,
  },
}));

import {
  prepareRunEnvironment,
  resolveBacktestExecutionPreloadInterval,
} from '../lib/runEnvironment';

const ticker = (symbol: string, volume24h: number) => ({
  symbol,
  lastPrice: 100,
  indexPrice: 100,
  markPrice: 100,
  prevPrice24h: 90,
  price24hPcnt: 0.1,
  highPrice24h: 110,
  lowPrice24h: 80,
  prevPrice1h: 99,
  openInterest: 1,
  openInterestValue: 1,
  turnover24h: volume24h,
  volume24h,
  fundingRate: 0,
  nextFundingTime: 1,
  predictedDeliveryPrice: '0',
  basisRate: '0',
  deliveryFeeRate: '0',
  deliveryTime: 1,
  ask1Size: 1,
  bid1Price: 99,
  ask1Price: 101,
  bid1Size: 1,
  basis: '0',
  preOpenPrice: '0',
  preQty: '0',
});

describe('resolveBacktestExecutionPreloadInterval', () => {
  it('maps primary backtest intervals to execution preload intervals', () => {
    expect(resolveBacktestExecutionPreloadInterval('15')).toBe('5');
    expect(resolveBacktestExecutionPreloadInterval('60')).toBe('15');
  });

  it('does not infer execution preload intervals for unsupported primary intervals', () => {
    expect(resolveBacktestExecutionPreloadInterval('5' as any)).toBeNull();
    expect(resolveBacktestExecutionPreloadInterval('240' as any)).toBeNull();
  });
});

describe('prepareRunEnvironment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveConnectorName.mockResolvedValue('ByBit');
    mockGetTickers.mockResolvedValue(['ETHUSDT']);
    mockUpdate.mockResolvedValue(undefined);
    mockRedisGetData.mockResolvedValue(null);
    mockRedisSetData.mockResolvedValue(undefined);
    mockUpdateMarketHistoryWithBtcReferences.mockResolvedValue(undefined);
    mockLoadBtcReferenceConnectors.mockResolvedValue({
      binance: { name: 'Binance' },
      coinbase: { name: 'Coinbase' },
    });
    mockGetConnectorCreatorByName.mockResolvedValue(async () => ({
      name: 'ByBit',
      getTickers: jest.fn(async () => [ticker('ETHUSDT', 100_000_000)]),
    }));
  });

  it('preloads execution interval only on the selected market connector', async () => {
    const instrument = {
      symbol: 'ETHUSDT',
      universe: 'crypto' as const,
      assetClass: 'crypto' as const,
      kind: 'perpetual' as const,
    };
    const listInstruments = jest.fn(async () => [instrument]);
    mockGetConnectorCreatorByName.mockResolvedValue(async () => ({
      name: 'ByBit',
      getTickers: jest.fn(async () => [ticker('ETHUSDT', 100_000_000)]),
      listInstruments,
    }));

    const result = await prepareRunEnvironment({
      connector: 'ByBit',
      userName: 'root',
      interval: '15',
      projectRoot: '/repo',
      startTime: 1_700_000_000_000,
      endTime: 1_700_086_400_000,
    });

    expect(result?.connectorName).toBe('ByBit');
    expect(listInstruments).toHaveBeenCalledTimes(1);
    expect(listInstruments).toHaveBeenCalledWith({
      universe: 'crypto',
      assetClasses: undefined,
      symbols: ['ETHUSDT'],
    });
    expect(result?.instrumentsBySymbol.get('ETHUSDT')).toBe(instrument);
    expect(mockUpdateMarketHistoryWithBtcReferences).toHaveBeenCalledTimes(1);
    expect(mockUpdateMarketHistoryWithBtcReferences).toHaveBeenCalledWith(
      expect.objectContaining({
        connectorName: 'ByBit',
        interval: '15',
        symbols: ['ETHUSDT'],
        preloadEnd: 1_700_086_400_000,
      }),
    );
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'ByBit' }),
      '5',
      ['ETHUSDT'],
      undefined,
      expect.objectContaining({
        connectorLabel: 'ByBit',
        preloadEnd: 1_700_086_400_000,
        skipCovered: true,
      }),
    );
    expect(mockRedisSetData).toHaveBeenCalledWith(
      'users:root:cache:tickers:ByBit',
      expect.objectContaining({
        connectorName: 'ByBit',
        tickers: [expect.objectContaining({ symbol: 'ETHUSDT' })],
      }),
      { expire: 0 },
    );
  });

  it('uses cached ticker universe in cacheOnly mode without touching the connector ticker endpoint', async () => {
    const connectorGetTickers = jest.fn(async () => [
      ticker('ETHUSDT', 100_000_000),
    ]);
    const listInstruments = jest.fn(async () => []);
    mockGetConnectorCreatorByName.mockResolvedValue(async () => ({
      name: 'ByBit',
      getTickers: connectorGetTickers,
      listInstruments,
    }));
    mockRedisGetData.mockResolvedValue({
      version: 1,
      connectorName: 'ByBit',
      updatedAt: '2026-06-17T00:00:00.000Z',
      tickers: [ticker('ETHUSDT', 100_000_000), ticker('SOLUSDT', 200_000_000)],
    });

    const result = await prepareRunEnvironment({
      connector: 'ByBit',
      userName: 'root',
      interval: '15',
      projectRoot: '/repo',
      startTime: 1_700_000_000_000,
      endTime: 1_700_086_400_000,
      cacheOnly: true,
      tickersLimit: 1,
    });

    expect(result?.tickers).toEqual(['SOLUSDT']);
    expect(mockRedisGetData).toHaveBeenCalledWith(
      'users:root:cache:tickers:ByBit',
      null,
    );
    expect(connectorGetTickers).not.toHaveBeenCalled();
    expect(listInstruments).not.toHaveBeenCalled();
    expect(result?.instrumentsBySymbol.size).toBe(0);
    expect(mockRedisSetData).not.toHaveBeenCalled();
    expect(mockUpdateMarketHistoryWithBtcReferences).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('fails cacheOnly runs without explicit tickers when ticker universe is not cached', async () => {
    await expect(
      prepareRunEnvironment({
        connector: 'ByBit',
        userName: 'root',
        interval: '15',
        projectRoot: '/repo',
        startTime: 1_700_000_000_000,
        endTime: 1_700_086_400_000,
        cacheOnly: true,
      }),
    ).rejects.toThrow(
      'No cached ticker universe for ByBit. Run once without --cacheOnly or pass --tickers explicitly.',
    );
  });

  it('fails a run when the connector returns an empty ticker universe', async () => {
    mockGetConnectorCreatorByName.mockResolvedValue(async () => ({
      name: 'ByBit',
      getTickers: jest.fn(async () => []),
    }));

    await expect(
      prepareRunEnvironment({
        connector: 'ByBit',
        userName: 'root',
        interval: '15',
        projectRoot: '/repo',
        startTime: 1_700_000_000_000,
        endTime: 1_700_086_400_000,
      }),
    ).rejects.toThrow(
      'No tickers available for ByBit. Check connector market-data access or select tickers explicitly.',
    );
    expect(mockUpdateMarketHistoryWithBtcReferences).not.toHaveBeenCalled();
  });
});
