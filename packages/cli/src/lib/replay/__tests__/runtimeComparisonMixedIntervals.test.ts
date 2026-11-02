/** @jest-environment node */
import { createRuntimeOrderLinkPrefix } from '@tradejs/core/trade';
import type {
  Connector,
  ExchangeEntryRecord,
  Interval,
  RuntimeLineage,
  RuntimeSignalEvaluationRecord,
  RuntimeTradeRecord,
  Signal,
} from '@tradejs/types';
import {
  resetRunState,
  setRuntimeCompareContext,
} from '../../backtest/runState';
import type { TradeParityEntry } from '../../runtimeParity';
import type { RuntimeLineageScopeRecord } from '../../runtimeSignalsStorage';
import { loadRuntimeTrades } from '../../runtimeRedis';
import {
  loadRuntimeSignals,
  loadRuntimeSignalEvaluations,
  loadRuntimeLineageScopes,
} from '../../runtimeSignalsLoader';
import { saveAndPrintReplayRuntimeComparison } from '../runtimeComparison';
import type { ReplayRuntimeLineageRecord } from '../historicalSignalsReplayPreparation';
import type { ReplayStrategySummary } from '../support';

jest.mock('../cliConfig', () => ({
  replayInterval: '15',
  replayProjectRoot: '/tmp/tradejs-mixed-comparison',
  replayUserName: 'root',
}));
jest.mock('../../runtimeRedis', () => ({ loadRuntimeTrades: jest.fn() }));
jest.mock('../../runtimeSignalsLoader', () => ({
  loadRuntimeSignals: jest.fn(),
  loadRuntimeSignalEvaluations: jest.fn(),
  loadRuntimeLineageScopes: jest.fn(),
}));
jest.mock('@tradejs/infra/redis', () => ({
  ...jest.requireActual<typeof import('@tradejs/infra/redis')>(
    '@tradejs/infra/redis',
  ),
  getData: jest.fn(async (_key, fallback) => fallback),
  setData: jest.fn(),
  delKey: jest.fn(),
  setHashJsonField: jest.fn(),
}));

const minute = 60_000;
const start = Date.UTC(2026, 0, 2);
const lineage: RuntimeLineage = {
  schemaVersion: 3,
  strategyRevision: 'sr1:1111111111111111',
  deploymentCompositionId: 'dc1:2222222222222222',
  strategyPackageVersion: '1.0.0',
  strategyDependencyVersions: { '@tradejs/core': '1.0.0' },
  runtimePackageVersion: '1.0.0',
  maxLossValue: 1,
};

const fixture = (
  mode: 'runtime' | 'exchange',
  nativeInterval: Interval = '60',
  nativeMinutes = 60,
  failed = false,
) => {
  const window = {
    start: start + 15 * minute,
    end: start + (nativeMinutes + 60) * minute,
  };
  const descriptors = [
    {
      strategy: 'Fifteen',
      interval: '15' as const,
      symbol: 'BTCUSDT',
      nativeTime: start + 15 * minute,
      entryTime: start + 30 * minute,
      replayTime: start + 15 * minute,
    },
    {
      strategy: 'Native',
      interval: nativeInterval,
      symbol: 'ETHUSDT',
      nativeTime: start,
      entryTime: start + nativeMinutes * minute,
      replayTime: start + (nativeMinutes - 15) * minute,
    },
  ];
  const summaries: ReplayStrategySummary[] = descriptors.map(
    ({ strategy, interval }) => ({
      strategyName: strategy,
      strategyConfig: { INTERVAL: interval },
      tickers: 1,
      tickersWithTrades: 1,
      orders: 1,
      wins: 1,
      losses: 0,
      netProfit: 1,
      avgTradeProfit: 1,
      winRate: 100,
    }),
  );
  const signals: Signal[] = descriptors.map((item, index) => ({
    signalId: `signal-${index}`,
    strategy: item.strategy,
    symbol: item.symbol,
    interval: item.interval,
    timestamp: item.nativeTime,
    direction: 'LONG',
    orderStatus: failed && index === 1 ? 'failed' : 'completed',
    ...(failed && index === 1
      ? { orderFailureReason: 'SET_STOP_LOSS_FAILED' }
      : {}),
    runtimeLineage: lineage,
    figures: {},
    prices: {
      currentPrice: 100,
      stopLossPrice: 90,
      takeProfitPrice: 110,
      riskRatio: 1,
    },
    indicators: {},
  }));
  const evaluations: RuntimeSignalEvaluationRecord[] = signals.map(
    (signal) => ({
      evaluationId: signal.signalId,
      signalId: signal.signalId,
      userName: 'root',
      strategy: signal.strategy,
      symbol: signal.symbol,
      interval: signal.interval,
      timestamp: signal.timestamp,
      evaluatedAt: signal.timestamp,
      direction: 'LONG',
      status: 'signal',
      orderStatus: signal.orderStatus,
      reason:
        signal.orderStatus === 'failed' ? 'SET_STOP_LOSS_FAILED' : 'SIGNAL',
      runtimeLineage: lineage,
    }),
  );
  const scopes: RuntimeLineageScopeRecord[] = signals.map((signal) => ({
    strategy: signal.strategy,
    symbol: signal.symbol,
    lineage,
    firstTimestamp: signal.timestamp,
    lastTimestamp: signal.timestamp,
  }));
  const replayLineages: ReplayRuntimeLineageRecord[] = signals.map(
    (signal) => ({ strategy: signal.strategy, symbol: signal.symbol, lineage }),
  );
  const backtestEntries: TradeParityEntry[] = descriptors.map(
    (item, index) => ({
      id: `backtest-${index}`,
      source: 'backtest',
      strategy: item.strategy,
      symbol: item.symbol,
      direction: 'LONG',
      timestamp: item.replayTime,
      signalTimestamp: item.nativeTime,
      price: 100,
      qty: 1,
      signalId: signals[index].signalId,
    }),
  );
  const trades: RuntimeTradeRecord[] = descriptors.map((item, index) => ({
    orderId: `order-${index}`,
    signalId: signals[index].signalId,
    strategy: item.strategy,
    symbol: item.symbol,
    interval: item.interval,
    direction: 'LONG',
    qty: 1,
    entryPrice: 100,
    entryTimestamp: item.entryTime,
    signalTimestamp: item.nativeTime,
    exitTimestamp: item.entryTime + minute,
    exitPrice: 101,
    closedPnl: 1,
    status: 'closed',
    runtimeLineage: lineage,
  }));
  const exchangeRows: ExchangeEntryRecord[] = descriptors.map(
    (item, index) => ({
      orderId: `exchange-${index}`,
      orderLinkId: `${createRuntimeOrderLinkPrefix(item.strategy)}abcdef${index}`,
      symbol: item.symbol,
      direction: 'LONG',
      qty: 1,
      entryPrice: 100,
      entryTimestamp: item.entryTime,
    }),
  );
  const getEntryExecutions = jest.fn(async () => exchangeRows);
  const connector: Connector = {
    capabilities: { supportedUniverses: ['crypto'], defaultUniverse: 'crypto' },
    universe: 'crypto',
    kline: jest.fn(),
    listInstruments: jest.fn(),
    getState: jest.fn(),
    setState: jest.fn(),
    getPosition: jest.fn(),
    getPositions: jest.fn(),
    placeOrder: jest.fn(),
    setTakeProfits: jest.fn(),
    setStopLoss: jest.fn(),
    closePosition: jest.fn(),
    getTickers: jest.fn(),
    getEntryExecutions,
    getClosedPnl: jest.fn(async () => []),
  };
  setRuntimeCompareContext({ connector, connectorName: 'bybit', window });
  jest
    .mocked(loadRuntimeTrades)
    .mockResolvedValue(mode === 'runtime' ? trades : []);
  jest
    .mocked(loadRuntimeSignals)
    .mockImplementation(async (_user, query) =>
      signals.filter(
        (signal) =>
          signal.timestamp >= (query?.startTime ?? 0) &&
          signal.timestamp <= (query?.endTime ?? Infinity),
      ),
    );
  jest
    .mocked(loadRuntimeSignalEvaluations)
    .mockImplementation(async (_user, query) =>
      evaluations.filter(
        (evaluation) =>
          evaluation.timestamp >= (query?.startTime ?? 0) &&
          evaluation.timestamp <= (query?.endTime ?? Infinity),
      ),
    );
  jest
    .mocked(loadRuntimeLineageScopes)
    .mockImplementation(async (_user, query) =>
      scopes.filter(
        (scope) =>
          scope.lastTimestamp >= query.startTime &&
          scope.firstTimestamp <= query.endTime,
      ),
    );
  return {
    window,
    getEntryExecutions,
    run: () =>
      saveAndPrintReplayRuntimeComparison({
        liveStrategySummaries: summaries,
        backtestEntries,
        replaySignals: signals,
        replayLineages,
        replayLineageScopes: scopes,
      }),
    summaries,
    expectedTimes: descriptors.map((item) => item.entryTime),
  };
};

beforeEach(() => {
  jest.clearAllMocks();
  resetRunState();
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

it.each(['runtime', 'exchange'] as const)(
  'matches 15m and 60m entries using native intervals in %s mode, including leading metadata',
  async (mode) => {
    const f = fixture(mode);
    const result = await f.run();
    expect(result).toMatchObject({
      mode,
      matchedCount: 2,
      runtimeOnlyCount: 0,
      backtestOnlyCount: 0,
    });
    expect(
      result?.details?.matched.map((item) => item.timestampDiffMs),
    ).toEqual([0, 0]);
    expect(
      result?.details?.matched.map((item) => item.backtest.comparisonTimestamp),
    ).toEqual(f.expectedTimes);
    const metadataWindow = {
      startTime: start - 30 * minute,
      endTime: f.window.end,
    };
    expect(loadRuntimeSignals).toHaveBeenCalledWith('root', metadataWindow);
    expect(loadRuntimeSignalEvaluations).toHaveBeenCalledWith(
      'root',
      metadataWindow,
    );
    expect(loadRuntimeLineageScopes).toHaveBeenCalledWith(
      'root',
      metadataWindow,
    );
    expect(loadRuntimeTrades).toHaveBeenCalledWith('root', {
      startTime: f.window.start,
      endTime: f.window.end,
    });
    if (mode === 'exchange')
      expect(f.getEntryExecutions).toHaveBeenCalledWith(
        expect.objectContaining({
          startTime: f.window.start,
          endTime: f.window.end,
        }),
      );
  },
);

it('retains a native hourly failed-order classification and its comparison timestamp in exchange mode', async () => {
  const f = fixture('exchange', '60', 60, true);
  const result = await f.run();
  expect(result).toMatchObject({
    matchedCount: 1,
    orderFailedCount: 1,
    runtimeOnlyCount: 0,
    backtestOnlyCount: 0,
  });
  expect(result?.details?.orderFailed).toEqual([
    expect.objectContaining({
      reason: 'SET_STOP_LOSS_FAILED',
      timestampDiffMs: 0,
      backtest: expect.objectContaining({
        comparisonTimestamp: start + 60 * minute,
      }),
    }),
  ]);
});

it.each([
  ['D', 1440],
  ['W', 10080],
] as const)(
  'supports the fixed native duration of %s in runtime comparison',
  async (interval, minutes) => {
    const f = fixture('runtime', interval, minutes);
    const result = await f.run();
    expect(result).toMatchObject({
      matchedCount: 2,
      runtimeOnlyCount: 0,
      backtestOnlyCount: 0,
    });
    expect(
      result?.details?.matched.map((item) => item.backtest.comparisonTimestamp),
    ).toEqual(f.expectedTimes);
  },
);

it('rejects a missing native strategy interval before metadata loading instead of falling back to 15m', async () => {
  const f = fixture('runtime');
  f.summaries[1].strategyConfig.INTERVAL = undefined;
  await expect(f.run()).rejects.toThrow(/interval/i);
  expect(loadRuntimeTrades).not.toHaveBeenCalled();
});
