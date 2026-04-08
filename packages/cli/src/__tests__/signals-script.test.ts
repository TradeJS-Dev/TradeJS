export {};

type ScriptFlags = {
  tickers?: string;
  exclude?: string;
  tickersLimit?: number;
  timeframe: number;
  makeOrders: boolean;
  notify: boolean;
  skipScreenshots: boolean;
  updateOnly: boolean;
  cacheOnly: boolean;
  showTickersList: boolean;
  chunk?: string;
  user: string;
  connector: string;
  points?: string;
  offset?: string;
};

type Scenario = {
  flags: ScriptFlags;
  strategyConfig?: Record<string, unknown>;
  existingSignalKeys?: string[];
};

const makeRedisKeys = () => ({
  strategies: (userName: string) => `users:${userName}:strategies`,
  signal: (symbol: string, signalId: string) => `signals:${symbol}:${signalId}`,
  signalsBySymbol: (symbol: string) => `signals:${symbol}:`,
  storeSignal: (symbol: string, signalId: string) =>
    `store:signals:${symbol}:${signalId}`,
});

const makeCandle = (timestamp: number, close: number) => ({
  timestamp,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1,
});

const loadScript = async (scenario: Scenario) => {
  jest.resetModules();

  const redisKeys = makeRedisKeys();
  const strategyConfigKey = 'users:root:strategies:TrendLine:config';
  const getKeys = jest.fn(async (key: string) => {
    if (key === `${redisKeys.strategies('root')}:`) {
      return [strategyConfigKey];
    }
    if (key === redisKeys.signalsBySymbol('ETHUSDT')) {
      return scenario.existingSignalKeys ?? [];
    }
    return [];
  });
  const getData = jest.fn(async (key: string, fallback: any) => {
    if (key === strategyConfigKey) {
      return scenario.strategyConfig ?? { INTERVAL: '15' };
    }
    return fallback;
  });
  const setData = jest.fn(async () => null);
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const connector = {
    kline: jest.fn(async ({ symbol }: { symbol: string }) => {
      if (symbol === 'BTCUSDT') {
        return [makeCandle(1000, 100), makeCandle(2000, 101)];
      }
      return [makeCandle(1000, 10), makeCandle(2000, 11)];
    }),
  };
  const strategySignal = {
    signalId: 'sig-new',
    strategy: 'TrendLine',
    symbol: 'ETHUSDT',
    interval: '15',
    direction: 'LONG',
    timestamp: 2000,
    prices: { currentPrice: 11 },
    figures: {},
    indicators: {},
    additionalIndicators: {},
  };
  const strategyFn = jest.fn(async () => strategySignal);
  const strategyCreator = jest.fn(async () => strategyFn);
  const getStrategyCreator = jest.fn(async () => strategyCreator);
  const getTickers = jest.fn(async () => ['ETHUSDT']);
  const update = jest.fn(async () => null);
  const makeScreenshots = jest.fn(async () => null);
  const sendToTG = jest.fn(async () => null);
  const runWithConcurrency = jest.fn(
    async <T>(items: T[], _limit: number, worker: (item: T) => Promise<void>) =>
      Promise.all(items.map(worker)),
  );
  const getTimestamp = jest.fn(() => 2000);
  const progressTick = jest.fn();

  jest.doMock('args', () => ({
    __esModule: true,
    default: {
      option: jest.fn(),
      parse: jest.fn(() => scenario.flags),
    },
  }));

  jest.doMock('progress', () => ({
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      tick: progressTick,
    })),
  }));

  jest.doMock('chalk', () => ({
    __esModule: true,
    default: {
      yellow: (value: string) => value,
      cyan: (value: string | number) => String(value),
      gray: (value: string) => value,
    },
  }));

  jest.doMock('@tradejs/node/connectors', () => ({
    DEFAULT_CONNECTOR_NAME: 'bybit',
    getConnectorCreatorByName: jest.fn(async () => async () => connector),
    resolveConnectorName: jest.fn(async () => 'bybit'),
  }));

  jest.doMock('@tradejs/connectors', () => ({
    ConnectorNames: {
      Binance: 'Binance',
      Coinbase: 'Coinbase',
    },
  }));

  jest.doMock('@tradejs/node/cli', () => ({
    getTickers,
    update,
    makeScreenshots,
    sendToTG,
  }));

  jest.doMock('@tradejs/core/async', () => ({
    runWithConcurrency,
  }));

  jest.doMock('@tradejs/node/strategies', () => ({
    getStrategyCreator,
  }));

  jest.doMock('@tradejs/core/time', () => ({
    getTimestamp,
  }));

  jest.doMock('@tradejs/infra/logger', () => ({
    logger,
  }));

  jest.doMock('@tradejs/infra/redis', () => ({
    getData,
    getKeys,
    redisKeys,
    setData,
  }));

  const prevNodeEnv = process.env.NODE_ENV;
  (process.env as any).NODE_ENV = 'test';
  const signalsScriptModule = await import('../scripts/signals');
  (process.env as any).NODE_ENV = prevNodeEnv;

  return {
    signals: signalsScriptModule.signals,
    mocks: {
      connector,
      getData,
      getKeys,
      getStrategyCreator,
      getTickers,
      logger,
      makeScreenshots,
      progressTick,
      redisKeys,
      runWithConcurrency,
      sendToTG,
      setData,
      strategyCreator,
      strategyFn,
      update,
    },
  };
};

describe('signals script', () => {
  const exitSpy = jest
    .spyOn(process, 'exit')
    .mockImplementation((() => undefined) as any);
  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    exitSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('re-evaluates symbol even when previous signal keys exist', async () => {
    const { signals, mocks } = await loadScript({
      flags: {
        timeframe: 15,
        makeOrders: false,
        notify: false,
        skipScreenshots: true,
        updateOnly: false,
        cacheOnly: true,
        showTickersList: false,
        user: 'root',
        connector: 'bybit',
      },
      existingSignalKeys: ['signals:ETHUSDT:old-signal'],
    });

    await signals();

    expect(mocks.getStrategyCreator).toHaveBeenCalledWith(
      'TrendLine',
      expect.any(String),
    );
    expect(mocks.strategyCreator).toHaveBeenCalledTimes(1);
    expect(mocks.strategyFn).toHaveBeenCalledTimes(1);
    expect(mocks.setData).toHaveBeenCalledWith(
      mocks.redisKeys.signal('ETHUSDT', 'sig-new'),
      expect.objectContaining({ signalId: 'sig-new', symbol: 'ETHUSDT' }),
      { expire: expect.any(Number) },
    );
    expect(mocks.setData).toHaveBeenCalledWith(
      mocks.redisKeys.storeSignal('ETHUSDT', 'sig-new'),
      expect.objectContaining({ signalId: 'sig-new', symbol: 'ETHUSDT' }),
      { expire: expect.any(Number) },
    );
    expect(mocks.getKeys).not.toHaveBeenCalledWith(
      mocks.redisKeys.signalsBySymbol('ETHUSDT'),
    );
  });
});
