import {
  summarizeAiTrainEvaluations,
  summarizeAiTrainEvaluationsByDirection,
} from '../lib/aiTrainMetrics';

describe('aiTrainMetrics', () => {
  it('computes requested summary metrics and quality buckets', () => {
    const summary = summarizeAiTrainEvaluations([
      { profit: 10, profitableTrade: true, aiApproved: true, quality: 5 },
      { profit: -4, profitableTrade: false, aiApproved: true, quality: 4 },
      { profit: 6, profitableTrade: true, aiApproved: false, quality: 3 },
      { profit: -2, profitableTrade: false, aiApproved: false, quality: null },
      { profit: 0, profitableTrade: false, aiApproved: false, quality: 3 },
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
        expectancyDelta: 1,
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
    expect(summary.expectancyDelta).toBeNull();
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
});
