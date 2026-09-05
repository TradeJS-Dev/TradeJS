import {
  buildCompletedBacktestDatasetAttemptKeys,
  assertFrozenBacktestExecutionCosts,
  buildBacktestTestKey,
  filterCompletedBacktestResultsForSuite,
  filterRemainingBacktestTests,
  isBacktestDatasetRowForCompletedAttempt,
  withBacktestRunDatasetMetadata,
} from '../lib/backtest/checkpoint';

const makeTest = (overrides: Record<string, unknown> = {}) =>
  ({
    userName: 'root',
    name: String(overrides.name ?? 'BTCUSDT_suite_test'),
    testId: String(overrides.testId ?? 'test'),
    testSuiteId: String(overrides.testSuiteId ?? 'suite'),
    configId: String(overrides.configId ?? 'cfg'),
    symbol: String(overrides.symbol ?? 'BTCUSDT'),
    interval: '15',
    options: { start: 1_000, end: 2_000 },
    strategyName: 'TrendLine',
    strategyConfig: {
      A: 1,
      nested: {
        b: 2,
      },
    },
    connectorName: 'bybit',
    ai: true,
    ml: false,
    ...overrides,
  }) as any;

describe('backtest checkpoint helpers', () => {
  const executionCosts = {
    fees: { makerRate: 0, takerRate: 0.001 },
    slippage: {
      baseBps: 10,
      spreadMultiplier: 1,
      marketImpactBps: 0,
      delayRiskMultiplier: 0,
    },
    funding: { enabled: false },
  };

  it('keys every economic assumption separately from strategy decisions', () => {
    const baseline = makeTest({
      executionCosts,
      executionCostsCacheOnly: true,
    });
    for (const changed of [
      {
        ...executionCosts,
        fees: { ...executionCosts.fees, makerRate: -0.0001 },
      },
      {
        ...executionCosts,
        slippage: { ...executionCosts.slippage, baseBps: 20 },
      },
      { ...executionCosts, funding: { enabled: true } },
    ]) {
      expect(
        buildBacktestTestKey(
          makeTest({ executionCosts: changed, executionCostsCacheOnly: true }),
        ),
      ).not.toBe(buildBacktestTestKey(baseline));
    }
    expect(
      buildBacktestTestKey({ ...baseline, executionCostsCacheOnly: false }),
    ).not.toBe(buildBacktestTestKey(baseline));
  });

  it('refuses continuation with unresolved or malformed economic assumptions', () => {
    expect(() => assertFrozenBacktestExecutionCosts([makeTest()])).toThrow(
      'without frozen executionCosts',
    );
    expect(() =>
      assertFrozenBacktestExecutionCosts([makeTest({ executionCosts: {} })]),
    ).toThrow();
    expect(() =>
      assertFrozenBacktestExecutionCosts([makeTest({ executionCosts })]),
    ).not.toThrow();
  });

  it('builds stable test keys without depending on random test ids', () => {
    const left = makeTest({
      name: 'BTCUSDT_random_a',
      testId: 'random-a',
      testSuiteId: 'suite-a',
    });
    const right = makeTest({
      name: 'BTCUSDT_random_b',
      testId: 'random-b',
      testSuiteId: 'suite-b',
    });

    expect(buildBacktestTestKey(left)).toBe(buildBacktestTestKey(right));
    expect(buildBacktestTestKey(makeTest({ symbol: 'ETHUSDT' }))).not.toBe(
      buildBacktestTestKey(left),
    );
  });

  it('filters completed and remaining tests by checkpoint keys', () => {
    const first = makeTest({ symbol: 'BTCUSDT' });
    const second = makeTest({ symbol: 'ETHUSDT' });
    const stale = makeTest({ symbol: 'SOLUSDT' });
    const completed = [
      {
        result: {
          orderLogId: '1',
          stat: { amount: 1, orders: 1, profit: 1 },
          test: first,
        },
        status: 'success',
        testKey: buildBacktestTestKey(first),
        updatedAt: new Date(0).toISOString(),
      },
      {
        result: {
          orderLogId: '2',
          stat: { amount: 2, orders: 1, profit: 2 },
          test: stale,
        },
        status: 'success',
        testKey: buildBacktestTestKey(stale),
        updatedAt: new Date(0).toISOString(),
      },
    ] as any;

    expect(
      filterCompletedBacktestResultsForSuite({
        completed,
        testSuite: [first, second],
      }).map((item) => item.testKey),
    ).toEqual([buildBacktestTestKey(first)]);
    expect(
      filterRemainingBacktestTests({
        completed,
        testSuite: [first, second],
      }),
    ).toEqual([second]);
  });

  it('adds run dataset metadata without changing stable test keys', () => {
    const test = makeTest({ symbol: 'ETHUSDT' });
    const testKey = buildBacktestTestKey(test);

    const [withMetadata] = withBacktestRunDatasetMetadata({
      runId: '202606201200-aaaaaaaa',
      testSuite: [test],
    });

    expect(withMetadata).toEqual(
      expect.objectContaining({
        backtestRunId: '202606201200-aaaaaaaa',
        backtestTestKey: testKey,
      }),
    );
    expect(buildBacktestTestKey(withMetadata)).toBe(testKey);
  });

  it('matches dataset rows only for completed chunk attempts', () => {
    const test = makeTest({
      symbol: 'ETHUSDT',
      chunkId: '202606201200-aaaaaaaa-new',
    });
    const testKey = buildBacktestTestKey(test);
    const completed = [
      {
        result: {
          orderLogId: '1',
          stat: { amount: 1, orders: 1, profit: 1 },
          test,
        },
        status: 'success',
        testKey,
        updatedAt: new Date(0).toISOString(),
      },
    ] as any;
    const attempts = buildCompletedBacktestDatasetAttemptKeys(completed);

    expect(
      isBacktestDatasetRowForCompletedAttempt(
        {
          backtestTestKey: testKey,
          backtestChunkId: '202606201200-aaaaaaaa-old',
        },
        attempts,
      ),
    ).toBe(false);
    expect(
      isBacktestDatasetRowForCompletedAttempt(
        {
          backtestTestKey: testKey,
          backtestChunkId: '202606201200-aaaaaaaa-new',
        },
        attempts,
      ),
    ).toBe(true);
  });
});
