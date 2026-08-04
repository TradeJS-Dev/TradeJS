import {
  evaluateHyperliquidWhaleStructure,
  rankHyperliquidStructuralWhales,
} from '../lib/hyperliquidWhaleSelection';

const dayMs = 86_400_000;

describe('hyperliquidWhaleSelection', () => {
  it('clusters sliced fills while retaining the raw-fill frequency guard', () => {
    const result = evaluateHyperliquidWhaleStructure({
      address: '0x1111111111111111111111111111111111111111',
      accountValueUsd: 1_000_000,
      calibrationFromMs: 0,
      calibrationToMs: 7 * dayMs,
      top30Symbols: new Set(['BTC']),
      fills: [
        { coin: 'BTC', side: 'B', px: 100, sz: 10, time: dayMs },
        { coin: 'BTC', side: 'B', px: 100, sz: 20, time: dayMs + 30_000 },
        { coin: 'BTC', side: 'A', px: 110, sz: 10, time: 2 * dayMs },
      ],
    });

    expect(result).toMatchObject({
      rawFills: 3,
      directionalExecutions: 2,
      activeDays: 2,
      top30NotionalShare: 1,
      eligible: true,
    });
    expect(result.medianNotionalUsd).toBe(2_050);
  });

  it('rejects a high-frequency wallet and ranks deterministically without outcome metrics', () => {
    const base = {
      accountValueUsd: 1_000_000,
      rawFills: 10,
      rawFillsPerDay: 2,
      directionalExecutions: 5,
      directionalExecutionsPerDay: 1,
      activeDays: 3,
      medianNotionalUsd: 50_000,
      medianInterExecutionMinutes: 60,
      top30NotionalShare: 1,
      eligible: true,
    };
    const ranked = rankHyperliquidStructuralWhales([
      {
        ...base,
        address: '0x2222222222222222222222222222222222222222',
        score: 20,
      },
      {
        ...base,
        address: '0x1111111111111111111111111111111111111111',
        score: 20,
      },
      {
        ...base,
        address: '0x3333333333333333333333333333333333333333',
        score: 100,
        rawFillsPerDay: 100,
        eligible: false,
      },
    ]);

    expect(ranked.map((row) => row.address)).toEqual([
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
    ]);
  });
});
