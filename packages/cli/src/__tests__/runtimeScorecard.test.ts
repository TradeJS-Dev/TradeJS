import {
  buildRuntimeScorecard,
  formatRuntimeScorecardMarkdown,
} from '../lib/runtimeScorecard';

const runtimeLineage = {
  schemaVersion: 1,
  compositionId: 'release-composition-trendline-v1',
  gitSha: 'deadbeef',
  gitDirty: false,
  gateFingerprint: 'a'.repeat(64),
  configFingerprint: 'b'.repeat(64),
  contextFingerprint: 'c'.repeat(64),
  maxLossValue: 10,
};

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
              runtimeLineage,
              status: 'signal',
              aiAnalysis: {
                quality: 4,
                gateDecision: 'approved',
                llmDecision: 'rejected',
                gateContradictsLlm: true,
              },
            },
          },
          {
            evaluation: {
              strategy: 'TrendLine',
              runtimeLineage,
              status: 'signal',
              aiAnalysis: { quality: 2, gateDecision: 'rejected' },
            },
          },
        ],
        signals: [
          {
            signal: {
              orderStatus: 'completed',
              strategy: 'TrendLine',
              runtimeLineage,
            },
          },
          {
            signal: {
              orderStatus: 'failed',
              orderFailureReason: 'INSUFFICIENT_MARGIN',
              strategy: 'TrendLine',
              runtimeLineage,
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
              strategy: 'TrendLine',
              runtimeLineage,
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
      prospectiveEvidenceArtifact: {
        reportType: 'strategy-prospective-evidence',
        rawCoreExpectancy: 0.2,
        aiGateExpectancy: 0.5,
        regimeCoverage: 0.8,
      },
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
    expect(scorecard.lineage).toMatchObject({
      complete: true,
      conflicts: false,
      compositionId: 'release-composition-trendline-v1',
      gitSha: 'deadbeef',
      maxLossValue: 10,
    });
    expect(scorecard.funnel.gate).toMatchObject({
      available: true,
      approved: 1,
      rejected: 1,
    });
    expect(scorecard.gateComparison).toEqual({
      policy: 'ai_approved_only',
      eligible: 1,
      compared: 1,
      coverage: 1,
      agreements: 0,
      disagreements: 1,
      gateApprovedLlmRejected: 1,
      gateRejectedLlmApproved: 0,
    });
    expect(scorecard.parity.ratio).toBe(0.9);
    expect(scorecard.execution.residualVsCurrentModelBps).toBe(4);
    expect(scorecard.prospective).toEqual({
      rawCoreExpectancy: 0.2,
      aiGateExpectancy: 0.5,
      regimeCoverage: 0.8,
    });
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
    expect(formatRuntimeScorecardMarkdown(scorecard)).toContain(
      'AI / LLM disagreement: 1/1',
    );
  });

  it('isolates every scorecard cohort to the requested strategy', () => {
    const endTime = 1_000_000;
    const runtimeArtifact = {
      window: { startTime: 0, endTime },
      runtime: {
        evaluations: [
          { strategy: 'DoubleTap', status: 'signal' },
          { strategy: 'TrendLine', status: 'signal' },
        ],
        signals: [
          { strategy: 'DoubleTap', orderStatus: 'completed' },
          { strategy: 'TrendLine', orderStatus: 'failed' },
        ],
        trades: [
          {
            strategy: 'DoubleTap',
            orderId: 'dt',
            status: 'closed',
            exitTimestamp: endTime - 1,
            closedPnl: 5,
          },
          {
            strategy: 'TrendLine',
            orderId: 'tl',
            status: 'closed',
            exitTimestamp: endTime - 1,
            closedPnl: -100,
          },
        ],
      },
    };
    const replayEvidenceArtifact = {
      replay: {
        runtimeComparison: {
          byStrategy: {
            DoubleTap: { matched: 9, backtestOnly: 1, runtimeOnly: 0 },
            TrendLine: { matched: 0, backtestOnly: 10, runtimeOnly: 10 },
          },
        },
      },
    };

    const scorecard = buildRuntimeScorecard({
      runtimeArtifact,
      replayEvidenceArtifact,
      strategy: 'DoubleTap',
      generatedAt: endTime,
    });

    expect(scorecard.strategy).toBe('DoubleTap');
    expect(scorecard.funnel).toMatchObject({
      evaluations: 1,
      coreCandidates: 1,
      orderAttempts: 1,
      orderFailures: 0,
      closedTrades: 1,
    });
    expect(scorecard.realized.pnl).toBe(5);
    expect(scorecard.parity.ratio).toBe(0.9);
  });
});
