import type { KlineChartItem, RuntimeLineage, Signal } from '@tradejs/types';
import type { TradeParityEntry } from '../../runtimeParity';
import { buildReplayRuntimeComparisonDetails } from '../../runtimeParityDetails';
import { executeHistoricalReplay } from '../historicalSignalsReplayExecution';
import { createHistoricalReplaySkipEvidence } from '../historicalSignalsReplaySkipEvidence';

const runtimeLineage: RuntimeLineage = {
  schemaVersion: 3,
  strategyRevision: 'sr1:a2c0d054b31a86eb',
  deploymentCompositionId: 'dc1:b9f585c6aeb0bb73',
  strategyPackageVersion: '3.0.3',
  strategyDependencyVersions: {},
  runtimePackageVersion: '3.1.27-beta.245',
  maxLossValue: 1,
};

describe('historical signals replay skip evidence', () => {
  it('keeps a core skip reason through runtime-only mismatch diagnosis', async () => {
    const timestamp = Date.UTC(2026, 7, 31, 14, 45);
    const candle: KlineChartItem = {
      timestamp,
      dt: new Date(timestamp).toISOString(),
      open: 0.7165,
      high: 0.7178,
      low: 0.6426,
      close: 0.6561,
      volume: 1_635_202.97,
      turnover: 1_072_711.16,
    };
    const execution = await executeHistoricalReplay(
      {
        plan: {
          symbolRuntimes: [
            {
              symbol: 'HNTUSDT',
              replayData: [candle],
              btcReplayData: [candle],
              ethReplayData: [],
              currentIndex: 0,
              strategies: [
                {
                  strategyName: 'RelativeRotation',
                  strategyConfig: { INTERVAL: '15' },
                  runtimeLineage,
                  run: jest.fn().mockResolvedValue('POSITION_EXISTS'),
                },
              ],
            },
          ],
          orderedTimestamps: [timestamp],
          sharedReplayKeyPrefixes: [],
          runtimeLineages: [
            {
              strategy: 'RelativeRotation',
              symbol: 'HNTUSDT',
              deploymentId: 'production',
              accountId: 'bybit-default',
              lineage: runtimeLineage,
            },
          ],
        },
        connector: {
          advanceMarket: jest.fn(),
        } as any,
        hookContext: {} as any,
      },
      {
        clock: { now: () => timestamp },
        progress: { tick: jest.fn() },
        display: {
          signals: String,
          aborted: String,
          timestamp: String,
        },
        invokeBeforeSignals: jest.fn(),
        invokeAfterSignals: jest.fn(),
        enrichSignal: jest.fn(),
        releaseIndicatorsCache: jest.fn(),
        releaseReplayCache: jest.fn(),
      },
    );

    const replayLineageScopes = execution.replayLineageScopes;
    expect(replayLineageScopes).toEqual([
      expect.objectContaining({
        strategy: 'RelativeRotation',
        symbol: 'HNTUSDT',
        firstTimestamp: timestamp,
        lastTimestamp: timestamp,
        evaluationRuns: [
          {
            status: 'skip',
            reason: 'POSITION_EXISTS',
            firstTimestamp: timestamp,
            lastTimestamp: timestamp,
            stepMs: 15 * 60_000,
          },
        ],
      }),
    ]);

    const runtimeEntry = {
      id: 'runtime-hnt-short',
      source: 'runtime',
      strategy: 'RelativeRotation',
      symbol: 'HNTUSDT',
      direction: 'SHORT',
      timestamp,
      signalTimestamp: timestamp,
      price: 0.6538,
    } as TradeParityEntry;
    const details = buildReplayRuntimeComparisonDetails({
      matched: [],
      runtimeOnly: [runtimeEntry],
      backtestOnly: [],
      runtimeEntries: [runtimeEntry],
      backtestEntries: [],
      toleranceMs: 15 * 60_000,
      replayLineageScopes,
      limit: 10,
    });

    expect(details.mismatchDrilldown?.runtimeOnly[0]).toMatchObject({
      classification: 'core_skipped',
      reason: 'POSITION_EXISTS',
      replayEvaluationOutcome: {
        status: 'skip',
        reason: 'POSITION_EXISTS',
        timestamp,
        timestampDiffMs: 0,
        source: 'replay_scope_compact',
      },
    });
  });

  it('compacts adjacent skips and keeps coverage through a signal', () => {
    const timestamp = Date.UTC(2026, 7, 31, 14, 15);
    const skipEvidence = createHistoricalReplaySkipEvidence([
      {
        strategy: 'RelativeRotation',
        symbol: 'HNTUSDT',
        deploymentId: 'production',
        accountId: 'bybit-default',
        lineage: runtimeLineage,
      },
    ]);
    const record = (offsetBars: number, result: Signal | string | undefined) =>
      skipEvidence.record({
        strategyName: 'RelativeRotation',
        symbol: 'HNTUSDT',
        strategyConfig: { INTERVAL: '15' },
        runtimeLineage,
        timestamp: timestamp + offsetBars * 15 * 60_000,
        result,
      });

    record(0, 'NO_RELATIVE_ROTATION');
    record(1, 'NO_RELATIVE_ROTATION');
    record(2, undefined);
    record(3, {} as Signal);

    expect(skipEvidence.values()).toEqual([
      expect.objectContaining({
        firstTimestamp: timestamp,
        lastTimestamp: timestamp + 3 * 15 * 60_000,
        evaluationRuns: [
          {
            status: 'skip',
            reason: 'NO_RELATIVE_ROTATION',
            firstTimestamp: timestamp,
            lastTimestamp: timestamp + 15 * 60_000,
            stepMs: 15 * 60_000,
          },
          {
            status: 'skip',
            reason: 'NO_SIGNAL',
            firstTimestamp: timestamp + 2 * 15 * 60_000,
            lastTimestamp: timestamp + 2 * 15 * 60_000,
            stepMs: 15 * 60_000,
          },
        ],
      }),
    ]);
  });

  it('does not retain per-candle skip evidence when collection is disabled', () => {
    const timestamp = Date.UTC(2026, 7, 31, 14, 15);
    const skipEvidence = createHistoricalReplaySkipEvidence(
      [
        {
          strategy: 'RelativeRotation',
          symbol: 'HNTUSDT',
          lineage: runtimeLineage,
        },
      ],
      false,
    );

    skipEvidence.record({
      strategyName: 'RelativeRotation',
      symbol: 'HNTUSDT',
      strategyConfig: { INTERVAL: '15' },
      runtimeLineage,
      timestamp,
      result: 'NO_RELATIVE_ROTATION',
    });

    expect(skipEvidence.values()).toEqual([]);
  });

  it('processes a signal without retaining it when signal collection is disabled', async () => {
    const timestamp = Date.UTC(2026, 7, 31, 14, 15);
    const candle = { timestamp } as KlineChartItem;
    const signal = { timestamp } as Signal;
    const enrichSignal = jest.fn();
    const execution = await executeHistoricalReplay(
      {
        plan: {
          symbolRuntimes: [
            {
              symbol: 'BTCUSDT',
              replayData: [candle],
              btcReplayData: [candle],
              ethReplayData: [],
              currentIndex: 0,
              strategies: [
                {
                  strategyName: 'RelativeRotation',
                  strategyConfig: { INTERVAL: '15' },
                  runtimeLineage,
                  run: jest.fn().mockResolvedValue(signal),
                },
              ],
            },
          ],
          orderedTimestamps: [timestamp],
          sharedReplayKeyPrefixes: [],
          runtimeLineages: [],
        },
        connector: { advanceMarket: jest.fn() } as any,
        hookContext: {} as any,
        collectSignals: false,
      },
      {
        clock: { now: () => timestamp },
        progress: { tick: jest.fn() },
        display: {
          signals: String,
          aborted: String,
          timestamp: String,
        },
        invokeBeforeSignals: jest.fn(),
        invokeAfterSignals: jest.fn(),
        enrichSignal,
        releaseIndicatorsCache: jest.fn(),
        releaseReplayCache: jest.fn(),
      },
    );

    expect(enrichSignal).toHaveBeenCalledWith(signal);
    expect(execution.signals).toEqual([]);
  });
});
