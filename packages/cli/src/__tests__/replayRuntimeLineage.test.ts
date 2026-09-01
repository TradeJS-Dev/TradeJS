import { createRuntimeOrderLinkPrefix } from '@tradejs/core/trade';
import type {
  RuntimeLineage,
  RuntimeSignalEvaluationRecord,
  RuntimeTradeRecord,
  Signal,
} from '@tradejs/types';
import {
  filterReplayComparisonByLineage,
  splitExchangeMatchesByRuntimeOrderStatus,
} from '../lib/replay/runtimeComparison';
import { buildStrategyNameByOrderLinkKey } from '../lib/runtimeParityDetails';
import type { TradeParityEntry } from '../lib/runtimeParity';

jest.mock('../lib/replay/cliConfig', () => ({
  replayInterval: '15',
  replayUserName: 'root',
}));

const lineage = (overrides: Partial<RuntimeLineage> = {}): RuntimeLineage => ({
  schemaVersion: 3,
  strategyRevision: 'sr1:1111111111111111',
  deploymentCompositionId: 'dc1:2222222222222222',
  strategyPackageVersion: '3.0.0',
  strategyDependencyVersions: { '@tradejs/strategy-kit': '3.0.0' },
  runtimePackageVersion: '3.2.0',
  maxLossValue: 1,
  ...overrides,
});

const signal = (timestamp: number, runtimeLineage: RuntimeLineage): Signal =>
  ({
    signalId: `signal-${timestamp}`,
    strategy: 'TrendShift',
    symbol: 'BTCUSDT',
    interval: '15',
    direction: 'LONG',
    timestamp,
    runtimeLineage,
  }) as Signal;

const evaluation = (
  timestamp: number,
  runtimeLineage: RuntimeLineage,
): RuntimeSignalEvaluationRecord => ({
  evaluationId: `evaluation-${timestamp}`,
  userName: 'root',
  strategy: 'TrendShift',
  symbol: 'BTCUSDT',
  interval: '15',
  timestamp,
  evaluatedAt: timestamp,
  status: 'signal',
  direction: 'LONG',
  runtimeLineage,
});

describe('replay runtime lineage filtering', () => {
  it('compares only artifacts inside a matching deployment lineage window', () => {
    const expected = lineage();
    const mismatched = lineage({ strategyPackageVersion: '2.9.0' });
    const matchingSignal = signal(200, expected);
    const runtimeTrades = [
      {
        orderId: 'matching-order',
        signalId: matchingSignal.signalId,
        strategy: 'TrendShift',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        qty: 1,
        entryPrice: 100,
        entryTimestamp: 215,
        status: 'active',
      },
      {
        orderId: 'old-order',
        signalId: 'signal-100',
        strategy: 'TrendShift',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        qty: 1,
        entryPrice: 90,
        entryTimestamp: 115,
        status: 'active',
      },
    ] as RuntimeTradeRecord[];
    const backtestEntries = [50, 150, 250].map(
      (timestamp) =>
        ({
          id: `bt-${timestamp}`,
          source: 'backtest',
          strategy: 'TrendShift',
          symbol: 'BTCUSDT',
          direction: 'LONG',
          timestamp,
          signalTimestamp: timestamp,
          price: 100,
        }) as TradeParityEntry,
    );

    const result = filterReplayComparisonByLineage({
      replayLineages: [
        {
          strategy: 'TrendShift',
          symbol: 'BTCUSDT',
          lineage: expected,
        },
      ],
      runtimeTrades,
      runtimeSignals: [matchingSignal, signal(100, mismatched)],
      runtimeSignalEvaluations: [
        evaluation(100, expected),
        evaluation(250, expected),
        evaluation(300, mismatched),
      ],
      runtimeLineageScopes: [
        {
          strategy: 'TrendShift',
          symbol: 'BTCUSDT',
          runtimeConfigId: 'config',
          lineage: expected,
          firstTimestamp: 100,
          lastTimestamp: 250,
        },
        {
          strategy: 'TrendShift',
          symbol: 'BTCUSDT',
          runtimeConfigId: 'config',
          lineage: mismatched,
          firstTimestamp: 300,
          lastTimestamp: 400,
        },
      ],
      backtestEntries,
    });

    expect(result.runtimeTrades.map((trade) => trade.orderId)).toEqual([
      'matching-order',
    ]);
    expect(
      result.runtimeSignalEvaluations.map((item) => item.timestamp),
    ).toEqual([100, 250]);
    expect(result.backtestEntries.map((entry) => entry.timestamp)).toEqual([
      150, 250,
    ]);
    expect(result.lineage).toMatchObject({
      comparableScopes: 1,
      excludedRuntimeTrades: 1,
      excludedRuntimeSignals: 1,
      excludedRuntimeEvaluations: 1,
      excludedRuntimeLineageScopes: 1,
      excludedBacktestEntries: 1,
      excludedBacktestEntryDetails: [
        {
          strategy: 'TrendShift',
          symbol: 'BTCUSDT',
          direction: 'LONG',
          timestamp: 50,
          signalTimestamp: 50,
          price: 100,
          reason: 'before_runtime_window',
          runtimeWindow: {
            firstTimestamp: 100,
            lastTimestamp: 250,
          },
        },
      ],
      reason: null,
    });
  });

  it('excludes cross-deployment and risk-scale scopes', () => {
    const expected = lineage();
    const otherRisk = lineage({ maxLossValue: 10 });
    const crossDeploymentSignal = {
      ...signal(100, expected),
      deploymentId: 'staging',
      accountId: 'bybit-main',
    };
    const otherRiskSignal = {
      ...signal(200, otherRisk),
      deploymentId: 'production',
      accountId: 'bybit-main',
    };

    const result = filterReplayComparisonByLineage({
      replayLineages: [
        {
          strategy: 'TrendShift',
          symbol: 'BTCUSDT',
          deploymentId: 'production',
          accountId: 'bybit-main',
          lineage: expected,
        },
      ],
      runtimeTrades: [],
      runtimeSignals: [crossDeploymentSignal, otherRiskSignal],
      runtimeSignalEvaluations: [],
      runtimeLineageScopes: [],
      backtestEntries: [],
    });

    expect(result.runtimeSignals).toEqual([]);
    expect(result.lineage).toMatchObject({
      comparableScopes: 0,
      excludedRuntimeSignals: 2,
      reason: 'no_runtime_artifacts_with_matching_lineage',
    });
  });

  it('reports absent replay lineage scopes separately from lineage mismatch', () => {
    const result = filterReplayComparisonByLineage({
      replayLineages: [],
      runtimeTrades: [],
      runtimeSignals: [],
      runtimeSignalEvaluations: [],
      runtimeLineageScopes: [],
      backtestEntries: [],
    });

    expect(result.lineage).toMatchObject({
      replayScopes: 0,
      comparableScopes: 0,
      reason: 'replay_produced_no_lineage_scopes',
    });
  });
});

describe('exchange order status classification', () => {
  it('removes orderStatus=failed executions from successful matches', () => {
    const prefix = createRuntimeOrderLinkPrefix('TrendShift');
    const exchange = {
      symbol: 'BTCUSDT',
      direction: 'LONG' as const,
      qty: 1,
      entryPrice: 101,
      entryTimestamp: 1_100,
      orderLinkId: `${prefix}abcdef`,
    };
    const backtest = {
      id: 'bt',
      source: 'backtest' as const,
      strategy: 'TrendShift',
      symbol: 'BTCUSDT',
      direction: 'LONG' as const,
      timestamp: 100,
      signalTimestamp: 100,
      price: 100,
    };

    const result = splitExchangeMatchesByRuntimeOrderStatus({
      matched: [
        {
          exchange,
          backtest,
          timestampDiffMs: 0,
          priceDeltaPct: 1,
        },
      ],
      strategyNameByOrderLinkKey: buildStrategyNameByOrderLinkKey([
        'TrendShift',
      ]),
      runtimeSignals: [],
      runtimeSignalEvaluations: [
        {
          ...evaluation(100, lineage()),
          orderStatus: 'failed',
          reason: 'SET_TAKE_PROFITS_FAILED',
        },
      ],
      toleranceMs: 100,
      signalTimestampOffsetMs: 1_000,
    });

    expect(result.completed).toEqual([]);
    expect(result.orderFailed).toHaveLength(1);
    expect(result.orderFailed[0].reason).toBe('SET_TAKE_PROFITS_FAILED');
  });
});
