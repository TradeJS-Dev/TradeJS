type ScriptFlags = {
  strategy: string;
  user: string;
  coverage: boolean;
  update: boolean;
  merge: boolean;
  clear: boolean;
  verbose: boolean;
};

type Scenario = {
  flags: ScriptFlags;
  configKeys: string[];
  testConfigs: Record<string, any>;
  testStats: Record<string, any>;
  currentResults?: Record<string, any>;
  tickers?: string[];
};

const makeRedisKeys = () => ({
  tests: (userName: string) => `users:${userName}:tests:*`,
  testConfig: (userName: string, strategyName: string, testName: string) =>
    `users:${userName}:tests:${strategyName}:${testName}:config`,
  testStat: (userName: string, strategyName: string, testName: string) =>
    `users:${userName}:tests:${strategyName}:${testName}:stat`,
  strategyResults: (userName: string, strategyName: string) =>
    `users:${userName}:strategies:${strategyName}:results`,
});

const loadScript = async (scenario: Scenario) => {
  jest.resetModules();

  const redisKeys = makeRedisKeys();
  const getKeys = jest.fn(async () => scenario.configKeys);
  const setData = jest.fn(async () => null);
  const delKey = jest.fn(async () => 0);
  const getData = jest.fn(async (key: string, fallback: any) => {
    if (key in scenario.testConfigs) return scenario.testConfigs[key];
    if (key in scenario.testStats) return scenario.testStats[key];
    if (key === redisKeys.strategyResults('root', 'TrendLine')) {
      return scenario.currentResults ?? fallback;
    }
    return fallback;
  });

  const byBit = jest.fn(async () => ({}));
  const getTickers = jest.fn(async () => scenario.tickers ?? []);

  jest.doMock('args', () => ({
    __esModule: true,
    default: {
      example: jest.fn(),
      option: jest.fn(),
      parse: jest.fn(() => scenario.flags),
    },
  }));

  jest.doMock('chalk', () => ({
    __esModule: true,
    default: {
      red: (s: string) => s,
      green: (s: string) => s,
      yellow: (s: string) => s,
      blue: (s: string) => s,
      magenta: (s: string) => s,
      gray: (s: string) => s,
    },
  }));

  jest.doMock('@src/connectors', () => ({
    connectors: {
      ByBit: byBit,
    },
  }));

  jest.doMock('@utils/cli', () => ({
    getTickers,
  }));

  jest.doMock('@utils/redis', () => ({
    getData,
    getKeys,
    setData,
    delKey,
    redisKeys,
  }));

  const module = await import('../scripts/results');

  return {
    results: module.results,
    mocks: { getData, getKeys, setData, delKey, byBit, getTickers, redisKeys },
  };
};

const createTestData = (userName: string, tests: Array<any>) => {
  const redisKeys = makeRedisKeys();
  const configKeys: string[] = [];
  const testConfigs: Record<string, any> = {};
  const testStats: Record<string, any> = {};

  for (const test of tests) {
    const configKey = redisKeys.testConfig(
      userName,
      test.strategyName,
      test.testName,
    );
    const statKey = redisKeys.testStat(
      userName,
      test.strategyName,
      test.testName,
    );
    configKeys.push(configKey);
    testConfigs[configKey] = {
      strategyName: test.strategyName,
      symbol: test.symbol,
      strategyConfig: test.strategyConfig,
    };
    testStats[statKey] = test.stat;
  }

  return { configKeys, testConfigs, testStats };
};

describe('results script', () => {
  const exitSpy = jest
    .spyOn(process, 'exit')
    .mockImplementation((() => undefined) as any);
  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    exitSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('stores update payload as { config, stats } entries', async () => {
    const userName = 'root';
    const testData = createTestData(userName, [
      {
        strategyName: 'TrendLine',
        testName: 't1',
        symbol: 'BTCUSDT',
        strategyConfig: { TP: 2, SL: 1 },
        stat: {
          totalReturn: 10,
          periodMonths: 1,
          winRate: 60,
          ordersPerMonth: 2,
          orders: 12,
        },
      },
    ]);

    const { results, mocks } = await loadScript({
      flags: {
        strategy: 'TrendLine',
        user: userName,
        coverage: false,
        update: true,
        merge: false,
        clear: false,
        verbose: false,
      },
      ...testData,
    });

    await results();

    expect(mocks.setData).toHaveBeenCalledWith(
      mocks.redisKeys.strategyResults(userName, 'TrendLine'),
      {
        BTCUSDT: {
          config: { TP: 2, SL: 1 },
          stats: {
            totalReturn: 10,
            periodMonths: 1,
            winRate: 60,
            ordersPerMonth: 2,
            orders: 12,
          },
        },
      },
      { expire: 0 },
    );
  });

  it('merge adds new symbols and updates only symbols with higher profit', async () => {
    const userName = 'root';
    const redisKeys = makeRedisKeys();
    const testData = createTestData(userName, [
      {
        strategyName: 'TrendLine',
        testName: 't1',
        symbol: 'BTCUSDT',
        strategyConfig: { TP: 3, SL: 1 },
        stat: {
          totalReturn: 7,
          periodMonths: 1,
          winRate: 65,
          ordersPerMonth: 2,
          orders: 9,
        },
      },
      {
        strategyName: 'TrendLine',
        testName: 't2',
        symbol: 'ETHUSDT',
        strategyConfig: { TP: 2, SL: 1 },
        stat: {
          totalReturn: 6,
          periodMonths: 1,
          winRate: 61,
          ordersPerMonth: 2,
          orders: 10,
        },
      },
    ]);

    const currentResults = {
      BTCUSDT: {
        config: { TP: 2, SL: 1 },
        stats: {
          totalReturn: 5,
          periodMonths: 1,
          winRate: 55,
          ordersPerMonth: 2,
          orders: 8,
        },
      },
      XRPUSDT: {
        config: { TP: 1.5, SL: 1 },
        stats: {
          totalReturn: 9,
          periodMonths: 1,
          winRate: 58,
          ordersPerMonth: 2,
          orders: 7,
        },
      },
    };

    const { results, mocks } = await loadScript({
      flags: {
        strategy: 'TrendLine',
        user: userName,
        coverage: false,
        update: false,
        merge: true,
        clear: false,
        verbose: false,
      },
      ...testData,
      currentResults,
    });

    await results();

    expect(mocks.setData).toHaveBeenCalledWith(
      redisKeys.strategyResults(userName, 'TrendLine'),
      {
        XRPUSDT: currentResults.XRPUSDT,
        BTCUSDT: {
          config: { TP: 3, SL: 1 },
          stats: {
            totalReturn: 7,
            periodMonths: 1,
            winRate: 65,
            ordersPerMonth: 2,
            orders: 9,
          },
        },
        ETHUSDT: {
          config: { TP: 2, SL: 1 },
          stats: {
            totalReturn: 6,
            periodMonths: 1,
            winRate: 61,
            ordersPerMonth: 2,
            orders: 10,
          },
        },
      },
      { expire: 0 },
    );
  });

  it('coverage counts existing only for symbols that are currently good', async () => {
    const userName = 'root';
    const testData = createTestData(userName, [
      {
        strategyName: 'TrendLine',
        testName: 't1',
        symbol: 'BTCUSDT',
        strategyConfig: { TP: 2.5, SL: 1 },
        stat: {
          totalReturn: 7,
          periodMonths: 1,
          winRate: 55,
          ordersPerMonth: 2,
          orders: 8,
        },
      },
      {
        strategyName: 'TrendLine',
        testName: 't2',
        symbol: 'ETHUSDT',
        strategyConfig: { TP: 2, SL: 1 },
        stat: {
          totalReturn: 8,
          periodMonths: 1,
          winRate: 62,
          ordersPerMonth: 2,
          orders: 9,
        },
      },
    ]);

    const { results } = await loadScript({
      flags: {
        strategy: 'TrendLine',
        user: userName,
        coverage: true,
        update: false,
        merge: false,
        clear: false,
        verbose: false,
      },
      ...testData,
      currentResults: {
        BTCUSDT: {
          config: { TP: 2, SL: 1 },
          stats: {
            totalReturn: 4,
            periodMonths: 1,
            winRate: 52,
            ordersPerMonth: 2,
            orders: 7,
          },
        },
        XRPUSDT: {
          config: { TP: 1.2, SL: 1 },
          stats: {
            totalReturn: 3,
            periodMonths: 1,
            winRate: 45,
            ordersPerMonth: 2,
            orders: 6,
          },
        },
      },
      tickers: ['BTCUSDT', 'ETHUSDT', 'XRPUSDT', 'SOLUSDT'],
    });

    await results();

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('COVERAGE: 1 / 1 / 4 (50.00 %)'),
    );
  });
});
