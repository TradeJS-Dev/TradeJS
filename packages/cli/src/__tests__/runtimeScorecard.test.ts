import {
  buildRuntimeScorecard,
  formatRuntimeScorecardMarkdown,
} from '../lib/runtimeScorecard';

describe('runtime scorecard', () => {
  it('builds the causal funnel, parity, execution drift, and rolling outcomes', () => {
    const endTime = Date.UTC(2026, 7, 7, 18);
    const startTime = endTime - 24 * 60 * 60 * 1000;
    const runtimeArtifact = {
      reportType: 'runtime-evidence',
      window: { startTime, endTime },
      runtime: {
        evaluationStatsBuckets: [{ stats: { evaluated: 100, signals: 4 } }],
        evaluations: [
          {
            evaluation: {
              strategy: 'TrendLine',
              status: 'signal',
              aiAnalysis: { quality: 4, gateDecision: 'approved' },
            },
          },
          {
            evaluation: {
              strategy: 'TrendLine',
              status: 'signal',
              aiAnalysis: { quality: 2, gateDecision: 'rejected' },
            },
          },
        ],
        signals: [
          { signal: { orderStatus: 'completed', strategy: 'TrendLine' } },
          {
            signal: {
              orderStatus: 'failed',
              orderFailureReason: 'INSUFFICIENT_MARGIN',
              strategy: 'TrendLine',
            },
          },
        ],
        trades: [
          {
            trade: {
              orderId: 'order-1',
              status: 'closed',
              entryTimestamp: startTime,
              exitTimestamp: endTime - 1_000,
              closedPnl: 12,
              totalFee: 1,
              fundingFee: 0.2,
            },
          },
        ],
      },
    };
    const replayEvidenceArtifact = {
      replay: {
        runtimeComparison: {
          lineage: { reason: null },
          counts: { matched: 18, backtestOnly: 1, runtimeOnly: 1 },
        },
      },
    };
    const calibrationArtifact = {
      summary: {
        all: {
          signalToFillAdverseBps: { avg: 5 },
          residualVsCurrentModelBps: { avg: 4 },
        },
      },
    };
    const previousRuntimeArtifact = {
      reportType: 'runtime-evidence',
      window: {
        startTime: startTime - 24 * 60 * 60 * 1000,
        endTime: startTime,
      },
      runtime: {
        evaluations: [
          {
            evaluation: {
              strategy: 'TrendLine',
              status: 'signal',
              aiAnalysis: { quality: 4, gateDecision: 'approved' },
            },
          },
        ],
        signals: [
          { signal: { orderStatus: 'completed', strategy: 'TrendLine' } },
        ],
        trades: [],
      },
    };

    const scorecard = buildRuntimeScorecard({
      runtimeArtifact,
      replayEvidenceArtifact,
      calibrationArtifact,
      historyRuntimeArtifacts: [previousRuntimeArtifact],
      generatedAt: endTime,
      thresholds: {
        minimumParityRatio: 0.95,
        maximumSlippageResidualBps: 3,
        minimumClosedTrades: 1,
        minimumExpectancy: 0,
      },
    });

    expect(scorecard.funnel).toMatchObject({
      evaluations: 100,
      coreCandidates: 4,
      orderAttempts: 2,
      orderFailures: 1,
      balanceRejects: 1,
      fills: 1,
      closedTrades: 1,
    });
    expect(scorecard.funnel.gate).toMatchObject({
      available: true,
      approved: 1,
      rejected: 1,
    });
    expect(scorecard.parity.ratio).toBe(0.9);
    expect(scorecard.execution.residualVsCurrentModelBps).toBe(4);
    expect(scorecard.distributionChanges).toMatchObject({
      available: true,
      metrics: {
        aiQuality: {
          '2': { shareDelta: 0.5 },
          '4': { shareDelta: -0.5 },
        },
      },
    });
    expect(scorecard.rolling[0]).toMatchObject({
      closedTrades: 1,
      realizedPnl: 12,
      expectancy: 12,
    });
    expect(scorecard.promotionStatus).toBe('PROMOTION_BLOCKED');
    expect(scorecard.reactions.map((reaction) => reaction.code)).toEqual([
      'PARITY_REGRESSION',
      'SLIPPAGE_DRIFT',
    ]);
    expect(formatRuntimeScorecardMarkdown(scorecard)).toContain(
      'PROMOTION_BLOCKED',
    );
    expect(formatRuntimeScorecardMarkdown(scorecard)).toContain(
      'aiQuality.2: +50 pp',
    );
  });
});
