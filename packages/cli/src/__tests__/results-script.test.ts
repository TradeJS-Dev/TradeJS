export {};

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
  delKeyResult?: number;
  nodeEnv?: string;
};

const makeRedisKeys = () => ({
  tests: (userName: string) => `users:${userName}:tests:*`,
  testConfig: (userName: string, strategyName: string, testName: string) =>
    `users:${userName}:tests:${strategyName}:${testName}:config`,
  testStat: (userName: string, strategyName: string, testName: string) =>
    `users:${userName}:tests:${strategyName}:${testName}:stat`,
  testSummaries: (userName: string) => `users:${userName}:tests:index:summary`,
  strategyResults: (userName: string, strategyName: string) =>
    `users:${userName}:strategies:${strategyName}:results`,
});

const loadScript = async (scenario: Scenario) => {
  jest.resetModules();

  const redisKeys = makeRedisKeys();
  const getKeys = jest.fn(async () => scenario.configKeys);
  const setData = jest.fn(async () => null);
  const delKey = jest.fn(async () => scenario.delKeyResult ?? 0);
  const getData = jest.fn(async (key: string, fallback: any) => {
    if (key in scenario.testConfigs) return scenario.testConfigs[key];
    if (key in scenario.testStats) return scenario.testStats[key];
    if (key === redisKeys.testSummaries('root')) {
      return fallback;
    }
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

  jest.doMock('@tradejs/connectors', () => ({
    connectors: {
      ByBit: byBit,
    },
  }));

  jest.doMock('@tradejs/node/cli', () => ({
    ...jest.requireActual('@tradejs/node/cli'),
    getTickers,
  }));

  jest.doMock('@tradejs/infra/redis', () => ({
    getData,
    getKeys,
    setData,
    delKey,
    redisKeys,
  }));

  const prevNodeEnv = process.env.NODE_ENV;
  (process.env as any).NODE_ENV = scenario.nodeEnv ?? 'test';
  const module = await import('../scripts/results');
  (process.env as any).NODE_ENV = prevNodeEnv;

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

  it('uses indexed summaries when available instead of scanning raw config keys', async () => {
    jest.resetModules();

    const redisKeys = makeRedisKeys();
    const getKeys = jest.fn(async () => []);
    const setData = jest.fn(async () => null);
    const delKey = jest.fn(async () => 0);
    const getData = jest.fn(async (key: string, fallback: any) => {
      if (key === redisKeys.testSummaries('root')) {
        return [
          { value: 't1', data: { strategyName: 'TrendLine' } },
          { value: 't2', data: { strategyName: 'Breakout' } },
        ];
      }
      if (key === redisKeys.testConfig('root', 'TrendLine', 't1')) {
        return {
          strategyName: 'TrendLine',
          symbol: 'BTCUSDT',
          strategyConfig: { TP: 2, SL: 1 },
        };
      }
      if (key === redisKeys.testStat('root', 'TrendLine', 't1')) {
        return {
          totalReturn: 10,
          periodMonths: 1,
          winRate: 60,
          ordersPerMonth: 2,
          orders: 12,
        };
      }
      if (key === redisKeys.testConfig('root', 'Breakout', 't2')) {
        return {
          strategyName: 'Breakout',
          symbol: 'ETHUSDT',
          strategyConfig: { TP: 1, SL: 1 },
        };
      }
      if (key === redisKeys.testStat('root', 'Breakout', 't2')) {
        return {
          totalReturn: 8,
          periodMonths: 1,
          winRate: 65,
          ordersPerMonth: 2,
          orders: 9,
        };
      }
      return fallback;
    });

    jest.doMock('args', () => ({
      __esModule: true,
      default: {
        example: jest.fn(),
        option: jest.fn(),
        parse: jest.fn(() => ({
          strategy: 'TrendLine',
          user: 'root',
          coverage: false,
          update: true,
          merge: false,
          clear: false,
          verbose: false,
        })),
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

    jest.doMock('@tradejs/connectors', () => ({
      connectors: {
        ByBit: jest.fn(async () => ({})),
      },
    }));

    jest.doMock('@tradejs/node/cli', () => ({
      ...jest.requireActual('@tradejs/node/cli'),
      getTickers: jest.fn(async () => []),
    }));

    jest.doMock('@tradejs/infra/redis', () => ({
      getData,
      getKeys,
      setData,
      delKey,
      redisKeys,
    }));

    const module = await import('../scripts/results');
    await module.results();

    expect(getKeys).not.toHaveBeenCalled();
    expect(setData).toHaveBeenCalledWith(
      redisKeys.strategyResults('root', 'TrendLine'),
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

  it('prints error when --strategy is missing', async () => {
    const { results } = await loadScript({
      flags: {
        strategy: '',
        user: 'root',
        coverage: false,
        update: false,
        merge: false,
        clear: false,
        verbose: false,
      },
      configKeys: [],
      testConfigs: {},
      testStats: {},
    });

    await results();

    expect(errorSpy).toHaveBeenCalledWith('Missing --strategy');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('clear prints "no results" when nothing deleted', async () => {
    const { results, mocks } = await loadScript({
      flags: {
        strategy: 'TrendLine',
        user: 'root',
        coverage: false,
        update: false,
        merge: false,
        clear: true,
        verbose: false,
      },
      configKeys: [],
      testConfigs: {},
      testStats: {},
      delKeyResult: 0,
    });

    await results();

    expect(mocks.delKey).toHaveBeenCalledWith(
      mocks.redisKeys.strategyResults('root', 'TrendLine'),
    );
    expect(logSpy).toHaveBeenCalledWith('No results to clear for TrendLine');
    expect(exitSpy).toHaveBeenCalled();
  });

  it('clear prints "cleared" when key is deleted', async () => {
    const { results } = await loadScript({
      flags: {
        strategy: 'TrendLine',
        user: 'root',
        coverage: false,
        update: false,
        merge: false,
        clear: true,
        verbose: false,
      },
      configKeys: [],
      testConfigs: {},
      testStats: {},
      delKeyResult: 1,
    });

    await results();

    expect(logSpy).toHaveBeenCalledWith('Cleared results:TrendLine');
  });

  it('merge exits early when no good results were found', async () => {
    const { results, mocks } = await loadScript({
      flags: {
        strategy: 'TrendLine',
        user: 'root',
        coverage: false,
        update: false,
        merge: true,
        clear: false,
        verbose: false,
      },
      configKeys: [],
      testConfigs: {},
      testStats: {},
    });

    exitSpy.mockImplementationOnce((() => {
      throw new Error('EXIT');
    }) as any);

    await expect(results()).rejects.toThrow('EXIT');

    expect(logSpy).toHaveBeenCalledWith('No good results to merge.');
    expect(mocks.setData).not.toHaveBeenCalled();
  });

  it('merge exits early when no symbols have higher profit than saved', async () => {
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
        update: false,
        merge: true,
        clear: false,
        verbose: false,
      },
      ...testData,
      currentResults: {
        BTCUSDT: {
          config: { TP: 3, SL: 1 },
          stats: {
            totalReturn: 20,
            periodMonths: 1,
            winRate: 55,
            ordersPerMonth: 2,
            orders: 8,
          },
        },
      },
    });

    exitSpy.mockImplementationOnce((() => {
      throw new Error('EXIT');
    }) as any);

    await expect(results()).rejects.toThrow('EXIT');

    expect(logSpy).toHaveBeenCalledWith(
      'No symbols with higher profit than saved results:TrendLine',
    );
    expect(mocks.setData).not.toHaveBeenCalled();
  });

  it('merge verbose prints updates table when higher-profit symbols exist', async () => {
    const userName = 'root';
    const redisKeys = makeRedisKeys();
    const testData = createTestData(userName, [
      {
        strategyName: 'TrendLine',
        testName: 't1',
        symbol: 'BTCUSDT',
        strategyConfig: { TP: 3, SL: 1 },
        stat: {
          totalReturn: 15,
          periodMonths: 1,
          winRate: 60,
          ordersPerMonth: 2,
          orders: 11,
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

    const { results, mocks } = await loadScript({
      flags: {
        strategy: 'TrendLine',
        user: userName,
        coverage: false,
        update: false,
        merge: true,
        clear: false,
        verbose: true,
      },
      ...testData,
      currentResults: {
        BTCUSDT: {
          config: { TP: 2, SL: 1 },
          stats: {
            totalReturn: 5,
            periodMonths: 1,
            winRate: 50,
            ordersPerMonth: 2,
            orders: 7,
          },
        },
      },
    });

    await results();

    expect(logSpy).toHaveBeenCalledWith('MERGE UPDATES:');
    expect(mocks.setData).toHaveBeenCalledWith(
      redisKeys.strategyResults(userName, 'TrendLine'),
      expect.objectContaining({
        BTCUSDT: expect.any(Object),
        ETHUSDT: expect.any(Object),
      }),
      { expire: 0 },
    );
  });

  it('filters malformed keys, missing config/stat and low-quality stats in update mode', async () => {
    const userName = 'root';
    const redisKeys = makeRedisKeys();
    const malformedConfigKey = 'a:b:c:config';
    const missingConfigKey = redisKeys.testConfig(
      userName,
      'TrendLine',
      'missingcfg',
    );
    const mismatchConfigKey = redisKeys.testConfig(
      userName,
      'Other',
      'mismatch',
    );
    const noStatConfigKey = redisKeys.testConfig(
      userName,
      'TrendLine',
      'nostat',
    );
    const periodZeroConfigKey = redisKeys.testConfig(
      userName,
      'TrendLine',
      'period0',
    );
    const negativeBaseConfigKey = redisKeys.testConfig(
      userName,
      'TrendLine',
      'negativebase',
    );
    const goodConfigKey = redisKeys.testConfig(userName, 'TrendLine', 'good');

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
      configKeys: [
        malformedConfigKey,
        missingConfigKey,
        mismatchConfigKey,
        noStatConfigKey,
        periodZeroConfigKey,
        negativeBaseConfigKey,
        goodConfigKey,
      ],
      testConfigs: {
        [mismatchConfigKey]: {
          strategyName: 'Other',
          symbol: 'XRPUSDT',
          strategyConfig: { TP: 1 },
        },
        [noStatConfigKey]: {
          strategyName: 'TrendLine',
          symbol: 'ETHUSDT',
          strategyConfig: { TP: 1.5 },
        },
        [periodZeroConfigKey]: {
          strategyName: 'TrendLine',
          symbol: 'SOLUSDT',
          strategyConfig: { TP: 2 },
        },
        [negativeBaseConfigKey]: {
          strategyName: 'TrendLine',
          symbol: 'ADAUSDT',
          strategyConfig: { TP: 2 },
        },
        [goodConfigKey]: {
          strategyName: 'TrendLine',
          symbol: 'BTCUSDT',
          strategyConfig: { TP: 3, SL: 1 },
        },
      },
      testStats: {
        [redisKeys.testStat(userName, 'TrendLine', 'period0')]: {
          totalReturn: 50,
          periodMonths: 0,
          winRate: 70,
          ordersPerMonth: 2,
          orders: 9,
        },
        [redisKeys.testStat(userName, 'TrendLine', 'negativebase')]: {
          totalReturn: -200,
          periodMonths: 1,
          winRate: 70,
          ordersPerMonth: 2,
          orders: 9,
        },
        [redisKeys.testStat(userName, 'TrendLine', 'good')]: {
          totalReturn: 10,
          periodMonths: 1,
          winRate: 60,
          ordersPerMonth: 2,
          orders: 10,
        },
      },
    });

    await results();

    expect(mocks.setData).toHaveBeenCalledWith(
      redisKeys.strategyResults(userName, 'TrendLine'),
      {
        BTCUSDT: {
          config: { TP: 3, SL: 1 },
          stats: {
            totalReturn: 10,
            periodMonths: 1,
            winRate: 60,
            ordersPerMonth: 2,
            orders: 10,
          },
        },
      },
      { expire: 0 },
    );
  });

  it('auto-runs script when NODE_ENV is not test', async () => {
    await loadScript({
      flags: {
        strategy: 'TrendLine',
        user: 'root',
        coverage: false,
        update: false,
        merge: false,
        clear: false,
        verbose: false,
      },
      configKeys: [],
      testConfigs: {},
      testStats: {},
      nodeEnv: 'production',
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(exitSpy).toHaveBeenCalled();
  });
});
