import {
  summarizeAiTrainEvaluations,
  summarizeAiTrainEvaluationsByDirection,
  summarizeAiTrainEvaluationsByMonth,
  summarizeAiTrainEvaluationsByQualityThreshold,
} from '../lib/aiTrainMetrics';

describe('aiTrainMetrics', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  it('computes requested summary metrics and quality buckets', () => {
    const summary = summarizeAiTrainEvaluations([
      {
        profit: 10,
        profitableTrade: true,
        aiApproved: true,
        quality: 5,
        timestamp: 0,
      },
      {
        profit: -4,
        profitableTrade: false,
        aiApproved: true,
        quality: 4,
        timestamp: DAY_MS,
      },
      {
        profit: 6,
        profitableTrade: true,
        aiApproved: false,
        quality: 3,
        timestamp: 2 * DAY_MS,
      },
      {
        profit: -2,
        profitableTrade: false,
        aiApproved: false,
        quality: null,
        timestamp: 3 * DAY_MS,
      },
      {
        profit: 0,
        profitableTrade: false,
        aiApproved: false,
        quality: 3,
        timestamp: 4 * DAY_MS,
      },
    ]);

    expect(summary).toEqual(
      expect.objectContaining({
        approved: 2,
        rejected: 3,
        truePositive: 1,
        falsePositive: 1,
        trueNegative: 2,
        falseNegative: 1,
        profitable: 2,
        unprofitable: 2,
        flat: 1,
        precisionApproved: 0.5,
        recallWinners: 0.5,
        avgProfitApproved: 3,
        avgProfitAll: 2,
        avgProfitApprovedPerDay: 1.5,
        avgProfitApprovedPerMonth: 45.65625,
        avgApprovedTradesPerDay: 0.5,
        avgApprovedTradesPerWeek: 3.5,
        expectancyDelta: 1,
        approvedRisk: expect.objectContaining({
          trades: 2,
          totalProfit: 6,
          grossProfit: 10,
          grossLoss: 4,
          profitFactor: 2.5,
          payoffRatio: 2.5,
          avgWin: 10,
          avgLoss: 4,
          largestWin: 10,
          largestLoss: -4,
          winRate: 0.5,
          maxDrawdown: 4,
          maxDrawdownPctOfGrossProfit: 0.4,
          maxDrawdownPctOfTotalProfit: 4 / 6,
          recoveryFactor: 1.5,
          ulcerIndex: Math.sqrt(16 / 2),
          maxConsecutiveWins: 1,
          maxConsecutiveLosses: 1,
        }),
      }),
    );

    expect(summary.qualityBuckets).toEqual([
      {
        quality: 3,
        count: 2,
        approved: 0,
        profitable: 1,
        totalProfit: 6,
      },
      {
        quality: 4,
        count: 1,
        approved: 1,
        profitable: 0,
        totalProfit: -4,
      },
      {
        quality: 5,
        count: 1,
        approved: 1,
        profitable: 1,
        totalProfit: 10,
      },
      {
        quality: null,
        count: 1,
        approved: 0,
        profitable: 0,
        totalProfit: -2,
      },
    ]);
  });

  it('returns null ratios when denominators are zero', () => {
    const summary = summarizeAiTrainEvaluations([
      { profit: -2, profitableTrade: false, aiApproved: false, quality: null },
    ]);

    expect(summary.precisionApproved).toBeNull();
    expect(summary.recallWinners).toBeNull();
    expect(summary.avgProfitApproved).toBeNull();
    expect(summary.avgProfitApprovedPerDay).toBeNull();
    expect(summary.avgProfitApprovedPerMonth).toBeNull();
    expect(summary.avgApprovedTradesPerDay).toBeNull();
    expect(summary.avgApprovedTradesPerWeek).toBeNull();
    expect(summary.expectancyDelta).toBeNull();
    expect(summary.approvedRisk).toEqual({
      trades: 0,
      totalProfit: 0,
      grossProfit: 0,
      grossLoss: 0,
      profitFactor: null,
      payoffRatio: null,
      avgWin: null,
      avgLoss: null,
      largestWin: null,
      largestLoss: null,
      winRate: null,
      maxDrawdown: 0,
      maxDrawdownPctOfGrossProfit: null,
      maxDrawdownPctOfTotalProfit: null,
      recoveryFactor: null,
      ulcerIndex: null,
      maxConsecutiveWins: 0,
      maxConsecutiveLosses: 0,
    });
  });

  it('splits summaries by direction', () => {
    const summaries = summarizeAiTrainEvaluationsByDirection([
      {
        profit: 10,
        profitableTrade: true,
        aiApproved: true,
        quality: 5,
        direction: 'LONG',
      },
      {
        profit: -4,
        profitableTrade: false,
        aiApproved: true,
        quality: 4,
        direction: 'LONG',
      },
      {
        profit: 6,
        profitableTrade: true,
        aiApproved: false,
        quality: 3,
        direction: 'SHORT',
      },
      {
        profit: -2,
        profitableTrade: false,
        aiApproved: false,
        quality: null,
        direction: 'SHORT',
      },
      {
        profit: 1,
        profitableTrade: true,
        aiApproved: true,
        quality: 5,
        direction: null,
      },
    ]);

    expect(summaries).toEqual([
      expect.objectContaining({
        direction: 'LONG',
        summary: expect.objectContaining({
          approved: 2,
          truePositive: 1,
          falsePositive: 1,
        }),
      }),
      expect.objectContaining({
        direction: 'SHORT',
        summary: expect.objectContaining({
          approved: 0,
          falseNegative: 1,
          trueNegative: 1,
        }),
      }),
      expect.objectContaining({
        direction: 'UNKNOWN',
        summary: expect.objectContaining({
          approved: 1,
          truePositive: 1,
          falsePositive: 0,
        }),
      }),
    ]);
  });

  it('splits approved risk summaries by month', () => {
    const summaries = summarizeAiTrainEvaluationsByMonth([
      {
        profit: 10,
        profitableTrade: true,
        aiApproved: true,
        quality: 5,
        timestamp: Date.parse('2026-01-05T00:00:00Z'),
      },
      {
        profit: -4,
        profitableTrade: false,
        aiApproved: true,
        quality: 4,
        timestamp: Date.parse('2026-01-06T00:00:00Z'),
      },
      {
        profit: 6,
        profitableTrade: true,
        aiApproved: true,
        quality: 5,
        timestamp: Date.parse('2026-02-01T00:00:00Z'),
      },
    ]);

    expect(summaries).toEqual([
      expect.objectContaining({
        month: '2026-01',
        summary: expect.objectContaining({
          approved: 2,
          approvedRisk: expect.objectContaining({
            totalProfit: 6,
            profitFactor: 2.5,
          }),
        }),
      }),
      expect.objectContaining({
        month: '2026-02',
        summary: expect.objectContaining({
          approved: 1,
          approvedRisk: expect.objectContaining({
            totalProfit: 6,
            profitFactor: null,
          }),
        }),
      }),
    ]);
  });

  it('recomputes qN+ streams from direction matches', () => {
    const summaries = summarizeAiTrainEvaluationsByQualityThreshold([
      {
        profit: 10,
        profitableTrade: true,
        aiApproved: true,
        modelDirectionMatches: true,
        quality: 5,
      },
      {
        profit: -4,
        profitableTrade: false,
        aiApproved: false,
        modelDirectionMatches: true,
        quality: 3,
      },
      {
        profit: 6,
        profitableTrade: true,
        aiApproved: false,
        modelDirectionMatches: false,
        quality: 5,
      },
    ]);

    expect(summaries.map((entry) => entry.label)).toEqual([
      'q3+',
      'q4+',
      'q5+',
    ]);
    expect(summaries.map((entry) => entry.summary.approved)).toEqual([2, 1, 1]);
  });
});
