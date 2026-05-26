import {
  applyAiTrainSymbolQuarantine,
  summarizeAiTrainDuplicateSignals,
} from '../lib/aiTrainQuarantine';

describe('aiTrainQuarantine', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  it('blocks approved rows for a weak symbol after enough approved losses', () => {
    const rows = [
      { profit: -1, aiApproved: true, timestamp: 0 },
      { profit: -1, aiApproved: true, timestamp: DAY_MS },
      { profit: 0.2, aiApproved: true, timestamp: 2 * DAY_MS },
      { profit: -1, aiApproved: true, timestamp: 3 * DAY_MS },
      { profit: -1, aiApproved: true, timestamp: 4 * DAY_MS },
      { profit: -1, aiApproved: true, timestamp: 5 * DAY_MS },
      { profit: 10, aiApproved: true, timestamp: 6 * DAY_MS },
      { profit: 10, aiApproved: true, timestamp: 21 * DAY_MS },
    ].map((row) => ({
      ...row,
      profitableTrade: row.profit > 0,
      quality: 5,
      direction: 'LONG',
      strategy: 'TrendShift',
      symbol: 'TESTUSDT',
    }));

    const result = applyAiTrainSymbolQuarantine(rows, {
      enabled: true,
      minApprovedLosses: 5,
      minProfitFactor: 1,
      cooldownDays: 14,
    });

    expect(result.summary.blocked).toBe(1);
    expect(result.summary.events).toHaveLength(1);
    expect(result.evaluations.map((row) => row.aiApproved)).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      false,
      true,
    ]);
  });

  it('does not trigger when profit factor is healthy after losses', () => {
    const rows = [
      { profit: 10, aiApproved: true, timestamp: 0 },
      { profit: -1, aiApproved: true, timestamp: DAY_MS },
      { profit: -1, aiApproved: true, timestamp: 2 * DAY_MS },
      { profit: -1, aiApproved: true, timestamp: 3 * DAY_MS },
      { profit: -1, aiApproved: true, timestamp: 4 * DAY_MS },
      { profit: -1, aiApproved: true, timestamp: 5 * DAY_MS },
      { profit: 10, aiApproved: true, timestamp: 6 * DAY_MS },
    ].map((row) => ({
      ...row,
      profitableTrade: row.profit > 0,
      quality: 5,
      direction: 'LONG',
      strategy: 'TrendShift',
      symbol: 'TESTUSDT',
    }));

    const result = applyAiTrainSymbolQuarantine(rows, {
      enabled: true,
      minApprovedLosses: 5,
      minProfitFactor: 1,
      cooldownDays: 14,
    });

    expect(result.summary.blocked).toBe(0);
    expect(result.summary.events).toHaveLength(0);
    expect(result.evaluations.every((row) => row.aiApproved)).toBe(true);
  });

  it('summarizes duplicate signal rows by timestamp and compact context', () => {
    const baseRow = {
      signalId: 'signal-1',
      strategyName: 'TrendShift',
      symbol: '1000BTTUSDT',
      direction: 'SHORT' as const,
      timestamp: 1_700_000_000_000,
      profit: -10,
      payload: {
        signal: {
          symbol: '1000BTTUSDT',
          signalId: 'signal-1',
          interval: '15',
          direction: 'SHORT' as const,
          timestamp: 1_700_000_000_000,
          strategy: 'TrendShift',
          prices: {
            currentPrice: 1,
            takeProfitPrice: 0.9,
            stopLossPrice: 1.1,
          },
        },
        figures: {},
        indicators: {},
        additionalIndicators: {
          trendShiftContext: {
            confirmedFlip: true,
          },
        },
      },
    } as any;

    const summary = summarizeAiTrainDuplicateSignals([
      baseRow,
      {
        ...baseRow,
        signalId: 'signal-2',
      },
      {
        ...baseRow,
        timestamp: baseRow.timestamp + DAY_MS,
      },
    ]);

    expect(summary.groups).toBe(1);
    expect(summary.rows).toBe(2);
    expect(summary.maxGroupSize).toBe(2);
    expect(summary.worstGroups[0]).toMatchObject({
      symbol: '1000BTTUSDT',
      count: 2,
      totalProfit: -20,
    });
  });
});
