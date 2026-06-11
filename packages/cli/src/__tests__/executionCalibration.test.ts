import { buildExecutionCalibrationReport } from '../lib/executionCalibration';

describe('execution calibration helpers', () => {
  it('builds live execution shortfall metrics from runtime debug telemetry', () => {
    const report = buildExecutionCalibrationReport({
      nowMs: 1_800_000_000_000,
      runtimeArtifact: {
        trades: [
          {
            trade: {
              orderId: 'tjs-long-1',
              signalId: 'sig-long-1',
              strategy: 'TrendLine',
              symbol: 'BTCUSDT',
              interval: '15',
              direction: 'LONG',
              qty: 2,
              signalTimestamp: 1_000,
              signalClosePrice: 100,
              arrivalMid: 101,
              bid: 100.9,
              ask: 101.1,
              spreadBps: 19.8,
              orderSubmitTime: 901_000,
              fillAvgPrice: 101.2,
              fillTime: 901_120,
              fee: 0.2024,
              entryPrice: 101.2,
              entryTimestamp: 1_000,
            },
            redisValues: {
              signal: {
                signalId: 'sig-long-1',
                strategy: 'TrendLine',
                symbol: 'BTCUSDT',
                interval: '15',
                timestamp: 1_000,
                indicators: {
                  candles15m: [{ close: 100 }, { close: 101 }, { close: 102 }],
                },
              },
            },
          },
          {
            trade: {
              orderId: 'tjs-short-1',
              signalId: 'sig-short-1',
              strategy: 'TrendLine',
              symbol: 'ETHUSDT',
              interval: '15',
              direction: 'SHORT',
              qty: 1,
              signalTimestamp: 1_000,
              signalClosePrice: 100,
              arrivalMid: 99,
              bid: 98.9,
              ask: 99.1,
              spreadBps: 20.2,
              orderSubmitTime: 901_500,
              fillAvgPrice: 98.8,
              fillTime: 901_650,
              fee: 0.0988,
              entryPrice: 98.8,
              entryTimestamp: 1_000,
            },
            redisValues: {
              signal: {
                signalId: 'sig-short-1',
                strategy: 'TrendLine',
                symbol: 'ETHUSDT',
                interval: '15',
                timestamp: 1_000,
                indicators: {
                  candles15m: [{ close: 100 }, { close: 101 }, { close: 102 }],
                },
              },
            },
          },
        ],
      },
      replayEvidenceArtifact: {
        replay: {
          runtimeComparison: {
            matched: [
              {
                orderLinkId: 'tjs-long-1',
                signalId: 'sig-long-1',
                strategy: 'TrendLine',
                symbol: 'BTCUSDT',
                direction: 'LONG',
                backtestPrice: 101.4,
                runtimePrice: 101.2,
              },
              {
                orderLinkId: 'tjs-replay-only',
                signalId: 'sig-replay-only',
                strategy: 'TrendLine',
                symbol: 'SOLUSDT',
                direction: 'LONG',
                backtestPrice: 50,
                runtimePrice: 50.5,
              },
            ],
          },
        },
      },
    });

    expect(report.counts).toEqual({
      runtimeTrades: 2,
      telemetryTrades: 2,
      fullTelemetryTrades: 2,
      replayMatched: 2,
      replayMatchedRuntimeTrades: 1,
      replayOnlyMatches: 1,
    });
    expect(report.samples[0]).toEqual(
      expect.objectContaining({
        signalToArrivalAdverseBps: 100,
        arrivalToFillAdverseBps: 19.80198,
        signalToFillAdverseBps: 120,
        feeBps: 10,
        signalCloseToSubmitMs: 0,
        submitToFillMs: 120,
      }),
    );
    expect(report.samples[0].currentDelayRiskBps).toBeCloseTo(3.7083, 4);
    expect(report.samples[0].replayEntryResidualBps).toBeCloseTo(-19.724, 3);
    expect(report.samples[1]).toEqual(
      expect.objectContaining({
        signalToArrivalAdverseBps: 101.010101,
        arrivalToFillAdverseBps: 20.242915,
        signalToFillAdverseBps: 121.45749,
        feeBps: 10,
      }),
    );
    expect(report.replayOnlySamples).toHaveLength(1);
    expect(report.replayOnlySamples[0].replayEntryResidualBps).toBe(100);
    expect(report.summary.byStrategy.TrendLine.trades).toBe(3);
    expect(report.recommendation.confidence).toBe('low');
    expect(report.recommendation.baseSlippageBps).toBeCloseTo(0, 1);
    expect(report.recommendation.delayRiskMultiplier).toBeGreaterThan(10);
  });

  it('falls back to replay residuals when runtime telemetry is unavailable', () => {
    const report = buildExecutionCalibrationReport({
      runtimeArtifact: {
        trades: [],
      },
      replayEvidenceArtifact: {
        replay: {
          runtimeComparison: {
            matched: [
              {
                orderLinkId: 'tjs-old-1',
                signalId: 'sig-old-1',
                strategy: 'AdaptiveTrendChannel',
                symbol: 'CELOUSDT',
                direction: 'LONG',
                backtestPrice: 0.061,
                runtimePrice: 0.06161,
              },
            ],
          },
        },
      },
    });

    expect(report.counts.fullTelemetryTrades).toBe(0);
    expect(report.replayOnlySamples[0].replayEntryResidualBps).toBeCloseTo(100);
    expect(report.recommendation.confidence).toBe('none');
    expect(report.recommendation.notes[0]).toContain('No full live execution');
  });
});
