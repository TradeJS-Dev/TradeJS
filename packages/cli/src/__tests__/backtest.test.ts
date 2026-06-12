jest.mock('args', () => ({
  __esModule: true,
  default: {
    example: jest.fn(),
    option: jest.fn(),
    parse: jest.fn(() => ({
      timeframe: '15',
      progressStep: 100,
      tests: 50,
      skip: 0,
      parallel: 4,
      top: 10,
      user: 'root',
      config: 'TrendLine:research',
      connector: 'bybit',
    })),
  },
}));

jest.mock('@tradejs/connectors', () => ({
  ConnectorNames: {
    Binance: 'Binance',
    Coinbase: 'Coinbase',
  },
}));

jest.mock('@tradejs/node/connectors', () => ({
  DEFAULT_CONNECTOR_NAME: 'bybit',
  getConnectorCreatorByName: jest.fn(),
  resolveConnectorName: jest.fn(),
}));

jest.mock('@tradejs/node/cli', () => ({
  drawStatInCLI: jest.fn(() => []),
  getTickers: jest.fn(),
  loadTradejsConfig: jest.fn(),
  update: jest.fn(),
}));

jest.mock('@tradejs/core/backtest', () => ({
  calculateStatsFull: jest.fn(),
  parseTestName: jest.fn((value: string) => ({
    symbol: value.split('__')[0],
    testId: value.split('__')[1] || value,
  })),
}));

jest.mock('@tradejs/core/grid', () => ({
  createTestSuite: jest.fn(),
  mergeConfigs: jest.fn(),
}));

jest.mock('@tradejs/core/data', () => ({
  toJson: jest.fn(),
}));

jest.mock('@tradejs/core/strategies', () => ({
  buildDefaultIndicatorPeriods: jest.fn((config?: Record<string, unknown>) => ({
    maFast:
      typeof config?.MA_FAST === 'number' ? Number(config.MA_FAST) : undefined,
    maSlow:
      typeof config?.MA_SLOW === 'number' ? Number(config.MA_SLOW) : undefined,
    atr: typeof config?.ATR === 'number' ? Number(config.ATR) : undefined,
  })),
}));

jest.mock('@tradejs/core/constants', () => ({
  BACKTEST_DEFAULT_DAYS: 30,
  BACKTEST_PRELOAD_DAYS: 5,
  TESTS_LIMIT: 100,
  TESTS_TOP_LIMIT: 10,
  TTL_1D: 86400,
  TTL_1M: 2592000,
}));

jest.mock('@tradejs/core/time', () => ({
  formatUnix: jest.fn(),
  getBacktestPreloadStart: jest.fn(),
  getTimestamp: jest.fn(),
}));

import args from 'args';
import { normalizeStrategyOrderLinkKey } from '@tradejs/core/trade';

jest.mock('@tradejs/infra/redis', () => ({
  setData: jest.fn(),
  getData: jest.fn(),
  getKeys: jest.fn(),
  redisKeys: {
    cacheOrders: (userName: string, orderLogId: string) =>
      `users:${userName}:cache:orders:${orderLogId}`,
    cachePositions: (userName: string, orderLogId: string) =>
      `users:${userName}:cache:positions:${orderLogId}`,
    testSummaries: (userName: string) =>
      `users:${userName}:tests:index:summary`,
  },
}));

jest.mock('../lib/derivativesContextBackfill', () => ({
  backfillDerivativesContextForBacktest: jest.fn(),
  shouldBackfillDerivativesContextForBacktest: jest.fn(),
}));

jest.mock('../lib/binanceMarketContextBackfill', () => ({
  backfillBinanceMarketContextForBacktest: jest.fn(),
  backfillBinanceMarketContextForReplay: jest.fn(),
  shouldBackfillBinanceMarketContextForBacktest: jest.fn(),
  shouldBackfillBinanceMarketContextForReplay: jest.fn(),
}));

jest.mock('../lib/coingeckoGlobalMarketContextBackfill', () => ({
  backfillCoingeckoGlobalContextForBacktest: jest.fn(),
  backfillCoingeckoGlobalContextForReplay: jest.fn(),
  shouldBackfillCoingeckoGlobalContextForBacktest: jest.fn(() => false),
  shouldBackfillCoingeckoGlobalContextForReplay: jest.fn(() => false),
}));

jest.mock('../lib/cliArgs', () => ({
  normalizeCliArgv: jest.fn((argv: string[]) => argv),
}));

jest.mock('../lib/timeWindow', () => ({
  resolveTimeWindow: jest.fn(),
}));

import {
  chunkTestSuiteBySymbol,
  resolveDefaultParallel,
  resolveDefaultWorkerHeapMb,
  mergePersistedTestSummaries,
  resolveRenderableStat,
  resolveBacktestEntryDelayBars,
  resolveBacktestPriceMode,
  resolveRequestedTestsLimit,
  resolveEffectiveParallel,
  resolveWorkerHeapMb,
  toPersistedBacktestResultEntry,
  toStrategyConfigGrid,
} from '../scripts/backtest';
import {
  buildPreparedTestSuite,
  updateBestTickerResult,
} from '../lib/backtest/runnerCore';
import {
  getBestTickerResultForSymbol,
  getAggregateAverageProfit,
  getAggregateWinRate,
  getProgressStats,
  getTopConfigResultBuckets,
  recordResultAggregates,
  resetRunState,
} from '../lib/backtest/runState';
import {
  buildReplayExchangeComparisonDetails,
  buildReplayRuntimeComparisonDetails,
  compareExchangeEntriesToBacktest,
  prepareReplayBinanceMarketContext,
  resolveReplayStrategyNameFromExchangeEntry,
} from '../scripts/replayRunner';
import {
  backfillBinanceMarketContextForReplay,
  shouldBackfillBinanceMarketContextForReplay,
} from '../lib/binanceMarketContextBackfill';
import {
  REPLAY_RUNTIME_COMPARE_TOLERANCE_BARS,
  REPLAY_RUNTIME_COMPARE_TOLERANCE_MS,
  buildReplayStrategyConfig,
  formatReplayRuntimeCompareTolerance,
} from '../lib/replay/support';
import {
  summarizeRuntimeTradesByStrategy,
  summarizeTradeParityByStrategy,
} from '../lib/paritySummary';
import { resolveStrategyNameByConfigKey } from '../lib/runtimeRedis';
import { getData } from '@tradejs/infra/redis';
import { calculateStatsFull } from '@tradejs/core/backtest';

describe('backtest script helpers', () => {
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    delete process.env.TRADEJS_BACKTEST_SYMBOL_GROUP_MAX_TESTS;
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    (getData as jest.Mock).mockReset();
    (calculateStatsFull as jest.Mock).mockReset();
    resetRunState();
  });

  afterEach(() => {
    delete process.env.TRADEJS_BACKTEST_SYMBOL_GROUP_MAX_TESTS;
    consoleLogSpy.mockRestore();
  });

  it('derives safer resource defaults for smaller machines', () => {
    expect(resolveDefaultWorkerHeapMb(16 * 1024 * 1024 * 1024)).toBe(1536);
    expect(resolveDefaultWorkerHeapMb(32 * 1024 * 1024 * 1024)).toBe(2048);
    expect(resolveDefaultWorkerHeapMb(96 * 1024 * 1024 * 1024)).toBe(3072);

    expect(resolveDefaultParallel(16 * 1024 * 1024 * 1024, 8, 1536)).toBe(4);
    expect(resolveDefaultParallel(6 * 1024 * 1024 * 1024, 8, 1536)).toBe(2);
  });

  it('clamps worker heap env to a minimum floor and falls back on invalid values', () => {
    expect(resolveWorkerHeapMb('128', 8192)).toBe(256);
    expect(resolveWorkerHeapMb('2048', 8192)).toBe(2048);
    expect(resolveWorkerHeapMb('not-a-number', 4096)).toBe(4096);
  });

  it('caps parallelism by env max and never drops below one', () => {
    expect(resolveEffectiveParallel('6', '2', 8)).toBe(2);
    expect(resolveEffectiveParallel('0', '3', 8)).toBe(3);
    expect(resolveEffectiveParallel('bad', 'bad', 5)).toBe(5);
    expect(resolveEffectiveParallel('-10', '-2', 5)).toBe(1);
  });

  it('normalizes backtest price mode CLI values', () => {
    expect(resolveBacktestPriceMode('open')).toBe('open');
    expect(resolveBacktestPriceMode('close')).toBe('close');
    expect(resolveBacktestPriceMode('mid')).toBe('mid');
    expect(resolveBacktestPriceMode('rand')).toBe('open');
    expect(resolveBacktestPriceMode('bad')).toBe('open');
    expect(resolveBacktestPriceMode(undefined)).toBe('open');
  });

  it('normalizes backtest entry delay bars CLI values', () => {
    expect(resolveBacktestEntryDelayBars('1')).toBe(1);
    expect(resolveBacktestEntryDelayBars(3)).toBe(3);
    expect(resolveBacktestEntryDelayBars('0')).toBe(0);
    expect(resolveBacktestEntryDelayBars('-2')).toBe(0);
    expect(resolveBacktestEntryDelayBars('bad')).toBe(1);
    expect(resolveBacktestEntryDelayBars(undefined)).toBe(1);
    expect(resolveBacktestEntryDelayBars(undefined, 2)).toBe(2);
  });

  it('removes the default tests limit in signals replay mode unless the user set it explicitly', () => {
    expect(
      resolveRequestedTestsLimit({
        isLiveMode: true,
        requestedLimit: 100,
        hasExplicitLimit: false,
      }),
    ).toBe(Number.POSITIVE_INFINITY);

    expect(
      resolveRequestedTestsLimit({
        isLiveMode: true,
        requestedLimit: 250,
        hasExplicitLimit: true,
      }),
    ).toBe(250);

    expect(
      resolveRequestedTestsLimit({
        isLiveMode: false,
        requestedLimit: 100,
        hasExplicitLimit: false,
      }),
    ).toBe(100);
  });

  it('describes --top as a grid helper', () => {
    expect(args.option).toHaveBeenCalledWith(
      ['T', 'top'],
      'Return N best tests/config buckets for grid runs (defaults to 50)',
      10,
    );
  });

  it('tracks the best result per ticker even for low-profit or zero-trade runs', () => {
    const first = {
      test: { symbol: 'BTCUSDT', name: 'BTCUSDT__1' },
      stat: { profit: 0, amount: 0, orders: 0 },
    } as any;
    const second = {
      test: { symbol: 'BTCUSDT', name: 'BTCUSDT__2' },
      stat: { profit: 3, amount: 3, orders: 1 },
    } as any;

    expect(updateBestTickerResult(first)).toBe(true);
    expect(getBestTickerResultForSymbol('BTCUSDT')).toBe(first);

    expect(updateBestTickerResult(second)).toBe(true);
    expect(getBestTickerResultForSymbol('BTCUSDT')).toBe(second);
  });

  it('does not replace a ticker result when the next profit is worse', () => {
    const best = {
      test: { symbol: 'ETHUSDT', name: 'ETHUSDT__1' },
      stat: { profit: 12, amount: 12, orders: 2 },
    } as any;
    const worse = {
      test: { symbol: 'ETHUSDT', name: 'ETHUSDT__2' },
      stat: { profit: -4, amount: -4, orders: 7 },
    } as any;

    expect(updateBestTickerResult(best)).toBe(true);
    expect(updateBestTickerResult(worse)).toBe(false);
    expect(getBestTickerResultForSymbol('ETHUSDT')).toBe(best);
  });

  it('aggregates progress and ranks configs by average profit', () => {
    const cfgLow = { PARAM: 1 };
    const cfgHigh = { PARAM: 2 };
    recordResultAggregates({
      test: {
        name: 'BTCUSDT_suite_1',
        symbol: 'BTCUSDT',
        configId: 'cfg-low',
        strategyConfig: cfgLow,
      },
      stat: { netProfit: 100, wins: 1, losses: 1, winRate: 50 },
    } as any);
    recordResultAggregates({
      test: {
        name: 'ETHUSDT_suite_2',
        symbol: 'ETHUSDT',
        configId: 'cfg-low',
        strategyConfig: cfgLow,
      },
      stat: { netProfit: -50, wins: 0, losses: 1, winRate: 0 },
    } as any);
    recordResultAggregates({
      test: {
        name: 'BTCUSDT_suite_3',
        symbol: 'BTCUSDT',
        configId: 'cfg-high',
        strategyConfig: cfgHigh,
      },
      stat: { netProfit: 40, wins: 1, losses: 0, winRate: 100 },
    } as any);
    recordResultAggregates({
      test: {
        name: 'ETHUSDT_suite_4',
        symbol: 'ETHUSDT',
        configId: 'cfg-high',
        strategyConfig: cfgHigh,
      },
      stat: { netProfit: 30, wins: 1, losses: 1, winRate: 50 },
    } as any);

    const progress = getProgressStats();
    expect(getAggregateAverageProfit(progress)).toBe(30);
    expect(getAggregateWinRate(progress)).toBe(50);

    const topConfigs = getTopConfigResultBuckets(2);
    expect(topConfigs[0]?.configId).toBe('cfg-high');
    expect(getAggregateAverageProfit(topConfigs[0]!)).toBe(35);
    expect(topConfigs[0]?.strategyConfig).toBe(cfgHigh);
    expect(topConfigs[1]?.configId).toBe('cfg-low');
    expect(getAggregateAverageProfit(topConfigs[1]!)).toBe(25);
  });

  it('parses runtime strategy config keys and rejects unrelated keys', () => {
    expect(
      resolveStrategyNameByConfigKey(
        'root',
        'users:root:strategies:TrendLine:config',
      ),
    ).toBe('TrendLine');
    expect(
      resolveStrategyNameByConfigKey(
        'root',
        'users:other:strategies:TrendLine:config',
      ),
    ).toBeNull();
    expect(
      resolveStrategyNameByConfigKey('root', 'users:root:strategies:TrendLine'),
    ).toBeNull();
  });

  it('wraps a live strategy config into a single-value grid for createTestSuite', () => {
    expect(
      toStrategyConfigGrid({
        RISK: 2,
        ENABLED: true,
        ENV: 'BACKTEST',
        INTERVAL: '15',
        MAKE_ORDERS: true,
        CLOSE_OPPOSITE_POSITIONS: false,
        BACKTEST_PRICE_MODE: 'open',
        BACKTEST_ENTRY_DELAY_BARS: 1,
        TRENDLINE: { leftBars: 5 },
      }),
    ).toEqual({
      RISK: [2],
      ENABLED: [true],
      TRENDLINE: [{ leftBars: 5 }],
    });
  });

  it('injects CLI runtime fields into prepared worker tests', async () => {
    const preparedSuite = await buildPreparedTestSuite({
      testSuite: [
        {
          userName: 'root',
          name: 'BTCUSDT_suite_test',
          testId: 'test',
          testSuiteId: 'suite',
          symbol: 'BTCUSDT',
          strategyName: 'TrendLine',
          strategyConfig: {
            MA_FAST: 10,
            ENV: 'CRON',
            INTERVAL: '60',
            MAKE_ORDERS: false,
            CLOSE_OPPOSITE_POSITIONS: true,
            BACKTEST_PRICE_MODE: 'mid',
          },
          connectorName: 'ByBit',
          options: { start: 1, end: 2 },
        } as any,
      ],
      window: { start: 100, end: 200, source: 'explicit' } as any,
      preloadStart: 50,
      isReplay: false,
    });

    expect(preparedSuite).toEqual([
      expect.objectContaining({
        interval: '15',
        options: { start: 100, end: 200 },
        strategyConfig: {
          MA_FAST: 10,
          ENV: 'BACKTEST',
          INTERVAL: '15',
          MAKE_ORDERS: true,
          CLOSE_OPPOSITE_POSITIONS: false,
          BACKTEST_PRICE_MODE: 'open',
          BACKTEST_ENTRY_DELAY_BARS: 1,
        },
      }),
    ]);
  });

  it('forces signals replay configs into PARITY mode while preserving runtime gate settings', () => {
    expect(
      buildReplayStrategyConfig({
        interval: '15' as any,
        strategyConfig: {
          AI_ENABLED: true,
          AI_MODE: 'gate',
          MIN_AI_QUALITY: 5,
          ML_ENABLED: false,
          ML_THRESHOLD: 0.1,
          MAKE_ORDERS: false,
          ENV: 'CRON',
        },
      }),
    ).toEqual({
      AI_ENABLED: true,
      AI_MODE: 'gate',
      MIN_AI_QUALITY: 5,
      ML_ENABLED: false,
      ML_THRESHOLD: 0.1,
      MAKE_ORDERS: true,
      ENV: 'PARITY',
      INTERVAL: '15',
      RECORD_RUNTIME_TRADES: false,
    });
  });

  it('summarizes synced runtime trades by strategy including active pnl', () => {
    expect(
      summarizeRuntimeTradesByStrategy([
        {
          orderId: 'o1',
          strategy: 'TrendLine',
          symbol: 'BTCUSDT',
          direction: 'LONG',
          qty: 1,
          entryPrice: 100,
          entryTimestamp: 1,
          status: 'closed',
          closedPnl: 12,
        },
        {
          orderId: 'o2',
          strategy: 'TrendLine',
          symbol: 'ETHUSDT',
          direction: 'SHORT',
          qty: 1,
          entryPrice: 200,
          entryTimestamp: 2,
          status: 'active',
          currentPnl: -3,
        },
        {
          orderId: 'o3',
          strategy: 'Breakout',
          symbol: 'SOLUSDT',
          direction: 'LONG',
          qty: 1,
          entryPrice: 50,
          entryTimestamp: 3,
          status: 'closed',
          closedPnl: 5.555,
        },
      ] as any),
    ).toEqual([
      {
        strategyName: 'Breakout',
        trades: 1,
        activeTrades: 0,
        closedTrades: 1,
        totalPnl: 5.55,
      },
      {
        strategyName: 'TrendLine',
        trades: 2,
        activeTrades: 1,
        closedTrades: 1,
        totalPnl: 9,
      },
    ]);
  });

  it('summarizes trade parity counts by strategy', () => {
    expect(
      summarizeTradeParityByStrategy({
        runtimeEntries: [
          {
            id: 'r1',
            source: 'runtime',
            strategy: 'TrendLine',
            symbol: 'BTCUSDT',
            direction: 'LONG',
            timestamp: 1,
            price: 100,
          },
        ],
        runtimeDuplicateEntries: [
          {
            id: 'dup1',
            source: 'runtime',
            strategy: 'TrendLine',
            symbol: 'BTCUSDT',
            direction: 'LONG',
            timestamp: 1,
            price: 100,
          },
        ],
        backtestEntries: [
          {
            id: 'b1',
            source: 'backtest',
            strategy: 'TrendLine',
            symbol: 'BTCUSDT',
            direction: 'LONG',
            timestamp: 1,
            price: 100,
          },
          {
            id: 'b2',
            source: 'backtest',
            strategy: 'Breakout',
            symbol: 'ETHUSDT',
            direction: 'SHORT',
            timestamp: 2,
            price: 200,
          },
        ],
        matchedEntries: [
          {
            runtime: {
              id: 'r1',
              source: 'runtime',
              strategy: 'TrendLine',
              symbol: 'BTCUSDT',
              direction: 'LONG',
              timestamp: 1,
              price: 100,
            },
            backtest: {
              id: 'b1',
              source: 'backtest',
              strategy: 'TrendLine',
              symbol: 'BTCUSDT',
              direction: 'LONG',
              timestamp: 1,
              price: 100,
            },
            timestampDiffMs: 0,
            priceDeltaPct: 0,
          },
        ],
        runtimeOnlyEntries: [],
        backtestOnlyEntries: [
          {
            id: 'b2',
            source: 'backtest',
            strategy: 'Breakout',
            symbol: 'ETHUSDT',
            direction: 'SHORT',
            timestamp: 2,
            price: 200,
          },
        ],
      }),
    ).toEqual([
      [
        'Breakout',
        {
          runtime: 0,
          runtimeDuplicates: 0,
          backtest: 1,
          matched: 0,
          runtimeOnly: 0,
          backtestOnly: 1,
        },
      ],
      [
        'TrendLine',
        {
          runtime: 1,
          runtimeDuplicates: 1,
          backtest: 1,
          matched: 1,
          runtimeOnly: 0,
          backtestOnly: 0,
        },
      ],
    ]);
  });

  it('matches exchange entry executions to nearest backtest entries by symbol, direction and time', () => {
    expect(
      compareExchangeEntriesToBacktest({
        toleranceMs: 15 * 60 * 1000,
        exchangeEntries: [
          {
            symbol: 'BTCUSDT',
            direction: 'LONG',
            qty: 1,
            entryPrice: 101,
            entryTimestamp: 1_000,
            orderId: 'ex-1',
            orderLinkId: 'tjs-1',
            closedPnl: 12,
          },
          {
            symbol: 'ETHUSDT',
            direction: 'SHORT',
            qty: 1,
            entryPrice: 199,
            entryTimestamp: 4_000,
            orderId: 'ex-2',
            orderLinkId: 'tjs-2',
            closedPnl: -5,
          },
        ] as any,
        backtestEntries: [
          {
            id: 'bt-1',
            source: 'backtest',
            strategy: 'TrendLine',
            symbol: 'BTCUSDT',
            direction: 'LONG',
            timestamp: 1_500,
            price: 100,
          },
          {
            id: 'bt-2',
            source: 'backtest',
            strategy: 'Breakout',
            symbol: 'SOLUSDT',
            direction: 'LONG',
            timestamp: 7_000,
            price: 50,
          },
        ] as any,
      }),
    ).toEqual({
      matched: [
        {
          exchange: {
            symbol: 'BTCUSDT',
            direction: 'LONG',
            qty: 1,
            entryPrice: 101,
            entryTimestamp: 1_000,
            orderId: 'ex-1',
            orderLinkId: 'tjs-1',
            closedPnl: 12,
          },
          backtest: {
            id: 'bt-1',
            source: 'backtest',
            strategy: 'TrendLine',
            symbol: 'BTCUSDT',
            direction: 'LONG',
            timestamp: 1_500,
            price: 100,
          },
          timestampDiffMs: 500,
          priceDeltaPct: 0.9900990099009901,
        },
      ],
      exchangeOnly: [
        {
          symbol: 'ETHUSDT',
          direction: 'SHORT',
          qty: 1,
          entryPrice: 199,
          entryTimestamp: 4_000,
          orderId: 'ex-2',
          orderLinkId: 'tjs-2',
          closedPnl: -5,
        },
      ],
      backtestOnly: [
        {
          id: 'bt-2',
          source: 'backtest',
          strategy: 'Breakout',
          symbol: 'SOLUSDT',
          direction: 'LONG',
          timestamp: 7_000,
          price: 50,
        },
      ],
    });
  });

  it('matches replay exchange entries against the backtest candle close timestamp', () => {
    const intervalMs = 15 * 60 * 1000;
    const result = compareExchangeEntriesToBacktest({
      toleranceMs: 2 * intervalMs,
      backtestTimestampOffsetMs: intervalMs,
      exchangeEntries: [
        {
          symbol: 'ARIAUSDT',
          direction: 'SHORT',
          qty: 29,
          entryPrice: 0.04228,
          entryTimestamp: intervalMs + 95_478,
          orderId: 'ex-1',
          orderLinkId: 'tjs-doubletap--abc',
        },
      ] as any,
      backtestEntries: [
        {
          id: 'bt-1',
          source: 'backtest',
          strategy: 'DoubleTap',
          symbol: 'ARIAUSDT',
          direction: 'SHORT',
          timestamp: 0,
          price: 0.04215,
        },
      ] as any,
    });

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]).toEqual(
      expect.objectContaining({
        timestampDiffMs: 95_478,
      }),
    );
    expect(result.exchangeOnly).toEqual([]);
    expect(result.backtestOnly).toEqual([]);
  });

  it('uses two bars as replay runtime comparison tolerance', () => {
    expect(REPLAY_RUNTIME_COMPARE_TOLERANCE_BARS).toBe(2);
    expect(REPLAY_RUNTIME_COMPARE_TOLERANCE_MS).toBe(30 * 60 * 1000);
    expect(formatReplayRuntimeCompareTolerance()).toBe('2 bars');
  });

  it('builds replay parity details with nearest unmatched candidates', () => {
    const details = buildReplayExchangeComparisonDetails({
      matched: [],
      exchangeOnly: [
        {
          symbol: 'ETHUSDT',
          direction: 'LONG',
          qty: 1,
          entryPrice: 100,
          entryTimestamp: 1_000,
          orderId: 'ex-1',
          orderLinkId: 'tjs-trendfollow--abc',
        },
      ] as any,
      backtestOnly: [
        {
          id: 'bt-1',
          source: 'backtest',
          strategy: 'TrendFollow',
          symbol: 'ETHUSDT',
          direction: 'LONG',
          timestamp: 3_000,
          price: 101,
          signalId: 'sig-1',
        },
      ] as any,
      exchangeEntries: [
        {
          symbol: 'ETHUSDT',
          direction: 'LONG',
          qty: 1,
          entryPrice: 100,
          entryTimestamp: 1_000,
          orderId: 'ex-1',
          orderLinkId: 'tjs-trendfollow--abc',
        },
      ] as any,
      backtestEntries: [
        {
          id: 'bt-1',
          source: 'backtest',
          strategy: 'TrendFollow',
          symbol: 'ETHUSDT',
          direction: 'LONG',
          timestamp: 3_000,
          price: 101,
          signalId: 'sig-1',
        },
      ] as any,
      strategyNameByOrderLinkKey: new Map([['trendfollow', 'TrendFollow']]),
      toleranceMs: 1_000,
      backtestTimestampOffsetMs: 15 * 60_000,
      runtimeSignals: [
        {
          signalId: 'rt-sig-1',
          strategy: 'TrendFollow',
          symbol: 'ETHUSDT',
          direction: 'LONG',
          interval: '15',
          timestamp: 3_000,
          orderStatus: 'skipped',
          orderSkipReason: 'AI_QUALITY_BELOW_MIN (2 < 4)',
          aiAnalysis: {
            direction: 'LONG',
            quality: 2,
            needRetest: true,
            qualityReason: 'weak gate',
          },
          prices: {},
          figures: {},
          indicators: {},
          additionalIndicators: {
            baseContext: {
              derivatives: {
                summary: {
                  pressure: 'crowded_long',
                },
              },
            },
          },
        },
      ] as any,
      limit: 10,
    });

    expect(details.runtimeOnly).toEqual([
      expect.objectContaining({
        source: 'exchange',
        inferredStrategy: 'TrendFollow',
        symbol: 'ETHUSDT',
        timestamp: 1_000,
        orderId: 'ex-1',
      }),
    ]);
    expect(details.backtestOnly).toEqual([
      expect.objectContaining({
        source: 'backtest',
        strategy: 'TrendFollow',
        signalId: 'sig-1',
      }),
    ]);
    expect(details.nearestCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          timestampDiffMs: 902_000,
          reason: 'outside_tolerance',
        }),
      ]),
    );
    expect(details.backtestOnly[0]).toEqual(
      expect.objectContaining({
        timestamp: 3_000,
        comparisonTimestamp: 903_000,
      }),
    );
    expect(details.mismatchDrilldown?.summary).toEqual({
      runtimeOnly: {
        timing_or_price_drift: 1,
      },
      backtestOnly: {
        gated_or_policy_blocked: 1,
      },
      artifacts: {
        limit: 10,
        runtimeOnlyIncluded: 0,
        runtimeOnlyOmitted: 1,
        backtestOnlyIncluded: 1,
        backtestOnlyOmitted: 0,
      },
    });
    expect(details.mismatchDrilldown?.backtestOnly[0]).toEqual(
      expect.objectContaining({
        classification: 'gated_or_policy_blocked',
        reason: 'AI_QUALITY_BELOW_MIN (2 < 4)',
        runtimeSignal: expect.objectContaining({
          signalId: 'rt-sig-1',
          timestampDiffMs: 0,
          ai: expect.objectContaining({
            quality: 2,
            qualityReason: 'weak gate',
          }),
        }),
        runtimeSignalArtifact: expect.objectContaining({
          signalId: 'rt-sig-1',
          additionalIndicators: expect.objectContaining({
            baseContext: expect.objectContaining({
              derivatives: expect.objectContaining({
                summary: expect.objectContaining({
                  pressure: 'crowded_long',
                }),
              }),
            }),
          }),
        }),
      }),
    );
  });

  it('adds replay-side gate diagnostics for exchange-only replay mismatches', () => {
    const details = buildReplayExchangeComparisonDetails({
      matched: [],
      exchangeOnly: [
        {
          symbol: 'ARIAUSDT',
          direction: 'SHORT',
          qty: 1,
          entryPrice: 0.04228,
          entryTimestamp: 903_000,
          orderId: 'ex-1',
          orderLinkId: 'tjs-doubletap--abc',
        },
      ] as any,
      backtestOnly: [],
      exchangeEntries: [],
      backtestEntries: [],
      strategyNameByOrderLinkKey: new Map([['doubletap', 'DoubleTap']]),
      toleranceMs: 1_000,
      backtestTimestampOffsetMs: 15 * 60_000,
      replaySignals: [
        {
          signalId: 'replay-sig-1',
          strategy: 'DoubleTap',
          symbol: 'ARIAUSDT',
          direction: 'SHORT',
          interval: '15',
          timestamp: 3_000,
          orderStatus: 'skipped',
          orderSkipReason: 'ENTRY_POLICY_BLOCKED',
          prices: {},
          figures: {},
          indicators: {},
          additionalIndicators: {
            baseContext: {
              participation: {
                volume: {
                  volumeRel20: 0.7,
                },
              },
              derivatives: {
                summary: {
                  pressure: 'crowded_long',
                },
              },
            },
          },
        },
      ] as any,
      limit: 10,
    });

    expect(details.mismatchDrilldown?.summary.runtimeOnly).toEqual({
      gated_or_policy_blocked: 1,
    });
    expect(details.mismatchDrilldown?.summary.artifacts).toEqual(
      expect.objectContaining({
        limit: 10,
        runtimeOnlyIncluded: 1,
        runtimeOnlyOmitted: 0,
      }),
    );
    expect(details.mismatchDrilldown?.runtimeOnly[0]).toEqual(
      expect.objectContaining({
        classification: 'gated_or_policy_blocked',
        reason: 'ENTRY_POLICY_BLOCKED',
        replaySignal: expect.objectContaining({
          signalId: 'replay-sig-1',
          timestampDiffMs: 0,
          orderStatus: 'skipped',
        }),
        replaySignalArtifact: expect.objectContaining({
          signalId: 'replay-sig-1',
          additionalIndicators: expect.objectContaining({
            baseContext: expect.objectContaining({
              participation: expect.objectContaining({
                volume: expect.objectContaining({
                  volumeRel20: 0.7,
                }),
              }),
              derivatives: expect.objectContaining({
                summary: expect.objectContaining({
                  pressure: 'crowded_long',
                }),
              }),
            }),
          }),
        }),
      }),
    );
  });

  it('keeps mismatch diagnostics when full replay artifacts are disabled', () => {
    const originalLimit = process.env.REPLAY_PARITY_ARTIFACT_LIMIT;
    process.env.REPLAY_PARITY_ARTIFACT_LIMIT = '0';

    try {
      const details = buildReplayExchangeComparisonDetails({
        matched: [],
        exchangeOnly: [
          {
            symbol: 'ARIAUSDT',
            direction: 'SHORT',
            qty: 1,
            entryPrice: 0.04228,
            entryTimestamp: 903_000,
            orderId: 'ex-1',
            orderLinkId: 'tjs-doubletap--abc',
          },
        ] as any,
        backtestOnly: [],
        exchangeEntries: [],
        backtestEntries: [],
        strategyNameByOrderLinkKey: new Map([['doubletap', 'DoubleTap']]),
        toleranceMs: 1_000,
        backtestTimestampOffsetMs: 15 * 60_000,
        replaySignals: [
          {
            signalId: 'replay-sig-1',
            strategy: 'DoubleTap',
            symbol: 'ARIAUSDT',
            direction: 'SHORT',
            interval: '15',
            timestamp: 3_000,
            orderStatus: 'skipped',
            orderSkipReason: 'ENTRY_POLICY_BLOCKED',
            prices: {},
            figures: {},
            indicators: {},
            additionalIndicators: {
              baseContext: {
                derivatives: {
                  summary: {
                    pressure: 'crowded_long',
                  },
                },
              },
            },
          },
        ] as any,
        limit: 10,
      });

      expect(details.mismatchDrilldown?.summary.artifacts).toEqual({
        limit: 0,
        runtimeOnlyIncluded: 0,
        runtimeOnlyOmitted: 1,
        backtestOnlyIncluded: 0,
        backtestOnlyOmitted: 0,
      });
      expect(details.mismatchDrilldown?.runtimeOnly[0]).toEqual(
        expect.objectContaining({
          replaySignal: expect.objectContaining({
            signalId: 'replay-sig-1',
          }),
        }),
      );
      expect(
        details.mismatchDrilldown?.runtimeOnly[0].replaySignalArtifact,
      ).toBeUndefined();
    } finally {
      if (originalLimit == null) {
        delete process.env.REPLAY_PARITY_ARTIFACT_LIMIT;
      } else {
        process.env.REPLAY_PARITY_ARTIFACT_LIMIT = originalLimit;
      }
    }
  });

  it('builds matched replay parity cost, exit, and pnl diagnostics', () => {
    const details = buildReplayRuntimeComparisonDetails({
      matched: [
        {
          runtime: {
            id: 'rt-1',
            source: 'runtime',
            strategy: 'TrendLine',
            symbol: 'BTCUSDT',
            direction: 'LONG',
            qty: 2,
            timestamp: 1_000,
            price: 101,
            exitType: 'exit',
            exitTimestamp: 2_100,
            exitPrice: 109,
            realizedPnl: 14,
            entryFee: 0.1,
            exitFee: 0.2,
            fundingFee: -0.01,
            totalFee: 0.29,
          },
          backtest: {
            id: 'bt-1',
            source: 'backtest',
            strategy: 'TrendLine',
            symbol: 'BTCUSDT',
            direction: 'LONG',
            qty: 2,
            timestamp: 1_000,
            price: 100,
            exitType: 'tp',
            exitTimestamp: 2_000,
            exitPrice: 110,
            expectedPnl: 20,
            entryFee: 0.05,
            exitFee: 0.05,
            fundingFee: 0,
            totalFee: 0.1,
          },
          timestampDiffMs: 0,
          priceDeltaPct: 0.9900990099009901,
        },
      ],
      runtimeOnly: [],
      backtestOnly: [],
      runtimeEntries: [],
      backtestEntries: [],
      toleranceMs: 1_000,
      limit: 10,
    });

    expect(details.matched[0]).toEqual(
      expect.objectContaining({
        exitTimestampDiffMs: 100,
        exitType: {
          expected: 'tp',
          actual: 'exit',
          matches: false,
        },
        pnl: {
          expectedPnl: 20,
          realizedPnl: 14,
          delta: -6,
        },
        slippage: {
          entryPriceDeltaPct: 0.9900990099009901,
          exitPriceDeltaPct: 0.9174311926605505,
          entryCost: 2,
          exitCost: 2,
          totalCost: 4,
        },
      }),
    );
    expect(details.matched[0].runtime.costs).toEqual({
      entryFee: 0.1,
      exitFee: 0.2,
      fundingFee: -0.01,
      totalFee: 0.29,
    });
  });

  it('calculates short-side replay slippage cost with correct sign', () => {
    const details = buildReplayRuntimeComparisonDetails({
      matched: [
        {
          runtime: {
            id: 'rt-short',
            source: 'runtime',
            strategy: 'TrendLine',
            symbol: 'ETHUSDT',
            direction: 'SHORT',
            qty: 2,
            timestamp: 1_000,
            price: 99,
            exitTimestamp: 2_000,
            exitPrice: 111,
            realizedPnl: -24,
          },
          backtest: {
            id: 'bt-short',
            source: 'backtest',
            strategy: 'TrendLine',
            symbol: 'ETHUSDT',
            direction: 'SHORT',
            qty: 2,
            timestamp: 1_000,
            price: 100,
            exitTimestamp: 2_000,
            exitPrice: 110,
            expectedPnl: -20,
          },
          timestampDiffMs: 0,
          priceDeltaPct: 1.0101010101010102,
        },
      ],
      runtimeOnly: [],
      backtestOnly: [],
      runtimeEntries: [],
      backtestEntries: [],
      toleranceMs: 1_000,
      limit: 10,
    });

    expect(details.matched[0].slippage).toEqual({
      entryPriceDeltaPct: 1.0101010101010102,
      exitPriceDeltaPct: 0.9009009009009009,
      entryCost: 2,
      exitCost: 2,
      totalCost: 4,
    });
    expect(details.matched[0].pnl).toEqual({
      expectedPnl: -20,
      realizedPnl: -24,
      delta: -4,
    });
  });

  it('falls back to cached stat when result artifacts are missing', async () => {
    (getData as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const result = await resolveRenderableStat({
      orderLogId: 'log-1',
      stat: {
        amount: 123,
        profit: 45,
        orders: 6,
        winRate: 50,
      },
      test: {
        userName: 'root',
        name: 'BTCUSDT_suite_test',
        strategyName: 'TrendLine',
      },
    } as any);

    expect(result.hasArtifacts).toBe(false);
    expect(result.orderLog).toBeNull();
    expect(result.stat).toEqual(
      expect.objectContaining({
        amount: 123,
        profit: 45,
        orders: 6,
      }),
    );
    expect(calculateStatsFull).not.toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'warning: logs not found for BTCUSDT_suite_test; using cached stat only',
      ),
    );
  });

  it('strips heavy inline artifacts from persisted backtest results', () => {
    const persisted = toPersistedBacktestResultEntry({
      orderLogId: 'log-1',
      stat: {
        amount: 123,
        profit: 45,
        orders: 6,
      },
      inlineOrderLog: [{ timestamp: 1 }] as any,
      inlinePositionLog: [{ open: { timestamp: 1 } }] as any,
      inlineReplaySignalEvaluations: [{ evaluationId: 'eval-1' }] as any,
      test: {
        userName: 'root',
        name: 'BTCUSDT_suite_test',
        testId: 'test',
        testSuiteId: 'suite',
        symbol: 'BTCUSDT',
        strategyName: 'TrendLine',
        strategyConfig: { MA_FAST: 21 },
        connectorName: 'bybit',
        options: { start: 1_000, end: 2_000 },
        ml: false,
        ai: true,
      },
    } as any);

    expect(persisted).toEqual({
      orderLogId: 'log-1',
      stat: {
        amount: 123,
        profit: 45,
        orders: 6,
      },
      test: {
        userName: 'root',
        name: 'BTCUSDT_suite_test',
        testId: 'test',
        testSuiteId: 'suite',
        symbol: 'BTCUSDT',
        strategyName: 'TrendLine',
        strategyConfig: { MA_FAST: 21 },
        connectorName: 'bybit',
        options: { start: 1_000, end: 2_000 },
        ml: false,
        ai: true,
      },
    });
    expect('inlineOrderLog' in persisted).toBe(false);
    expect('inlinePositionLog' in persisted).toBe(false);
    expect('inlineReplaySignalEvaluations' in persisted).toBe(false);
  });

  it('resolves replay strategy from exchange orderLinkId', () => {
    const trendShiftKey = normalizeStrategyOrderLinkKey('TrendShift');

    expect(
      resolveReplayStrategyNameFromExchangeEntry({
        exchangeEntry: {
          orderLinkId: `tjs-${trendShiftKey}--abc123def456`,
        } as any,
        strategyNameByOrderLinkKey: new Map([
          [String(trendShiftKey), 'TrendShift'],
        ]),
      }),
    ).toBe('TrendShift');

    expect(
      resolveReplayStrategyNameFromExchangeEntry({
        exchangeEntry: {
          orderLinkId: 'tjs-legacy-id',
        } as any,
        strategyNameByOrderLinkKey: new Map([
          [String(trendShiftKey), 'TrendShift'],
        ]),
      }),
    ).toBeNull();
  });

  it('prepares Binance market context for replay from the prepared run window', async () => {
    (shouldBackfillBinanceMarketContextForReplay as jest.Mock).mockReturnValue(
      true,
    );
    (backfillBinanceMarketContextForReplay as jest.Mock).mockResolvedValue({
      skipped: false,
      tradeFlowRows: 1,
      depthRows: 1,
      breadthRows: 1,
      skippedSymbols: 0,
    });

    await prepareReplayBinanceMarketContext({
      tickers: ['ETHUSDT', 'SOLUSDT'],
      window: { start: 1_000, end: 2_000 },
      preloadStart: 500,
    });

    expect(shouldBackfillBinanceMarketContextForReplay).toHaveBeenCalledWith({
      cacheOnly: false,
    });
    expect(backfillBinanceMarketContextForReplay).toHaveBeenCalledWith({
      userName: 'root',
      projectRoot: String(process.env.PROJECT_CWD || process.cwd()).trim(),
      symbols: ['ETHUSDT', 'SOLUSDT'],
      interval: '15',
      startMs: 1_000,
      endMs: 2_000,
      preloadStartMs: 500,
    });
  });

  it('merges persisted summary index with valid legacy items and overrides duplicates', () => {
    const merged = mergePersistedTestSummaries(
      [
        {
          value: 'BTCUSDT__1',
          label: 'BTCUSDT_1',
          data: { strategyName: 'TrendLine', netProfit: 10 },
        },
        {
          value: 'ETHUSDT__2',
          label: 'ETHUSDT_2',
          data: { strategyName: 'Breakout', netProfit: 7 },
        },
        {
          value: 'BROKEN__3',
          label: 'BROKEN_3',
          data: { netProfit: 1 },
        } as any,
      ],
      new Map([
        [
          'TrendLine:BTCUSDT__1',
          {
            value: 'BTCUSDT__1',
            label: 'BTCUSDT_1',
            data: { strategyName: 'TrendLine', netProfit: 42 },
          },
        ],
        [
          'VolumeDivergence:SOLUSDT__4',
          {
            value: 'SOLUSDT__4',
            label: 'SOLUSDT_4',
            data: { strategyName: 'VolumeDivergence', netProfit: 15 },
          },
        ],
      ]),
    );

    expect(merged).toEqual([
      {
        value: 'BTCUSDT__1',
        label: 'BTCUSDT_1',
        data: { strategyName: 'TrendLine', netProfit: 42 },
      },
      {
        value: 'ETHUSDT__2',
        label: 'ETHUSDT_2',
        data: { strategyName: 'Breakout', netProfit: 7 },
      },
      {
        value: 'SOLUSDT__4',
        label: 'SOLUSDT_4',
        data: { strategyName: 'VolumeDivergence', netProfit: 15 },
      },
    ]);
  });

  it('keeps each symbol on a single worker chunk while balancing load', () => {
    const suite = [
      { name: 'btc-1', symbol: 'BTCUSDT' },
      { name: 'btc-2', symbol: 'BTCUSDT' },
      { name: 'eth-1', symbol: 'ETHUSDT' },
      { name: 'eth-2', symbol: 'ETHUSDT' },
      { name: 'sol-1', symbol: 'SOLUSDT' },
      { name: 'sol-2', symbol: 'SOLUSDT' },
    ] as any;

    const chunks = chunkTestSuiteBySymbol(suite, 2);

    expect(chunks).toHaveLength(2);
    expect(chunks[0].map((test: any) => test.symbol)).toEqual([
      'BTCUSDT',
      'BTCUSDT',
      'SOLUSDT',
      'SOLUSDT',
    ]);
    expect(chunks[1].map((test: any) => test.symbol)).toEqual([
      'ETHUSDT',
      'ETHUSDT',
    ]);
  });

  it('splits very large symbol groups so one symbol cannot occupy a single worker', () => {
    process.env.TRADEJS_BACKTEST_SYMBOL_GROUP_MAX_TESTS = '2';
    const suite = [
      { name: 'btc-1', symbol: 'BTCUSDT' },
      { name: 'btc-2', symbol: 'BTCUSDT' },
      { name: 'btc-3', symbol: 'BTCUSDT' },
      { name: 'btc-4', symbol: 'BTCUSDT' },
      { name: 'eth-1', symbol: 'ETHUSDT' },
      { name: 'eth-2', symbol: 'ETHUSDT' },
    ] as any;

    const chunks = chunkTestSuiteBySymbol(suite, 3);

    expect(chunks).toHaveLength(3);
    expect(chunks.map((chunk) => chunk.length)).toEqual([2, 2, 2]);
  });
});
