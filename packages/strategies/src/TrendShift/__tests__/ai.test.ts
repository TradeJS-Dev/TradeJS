/** @jest-environment node */

import { trendShiftAiAdapter } from '../adapters/ai';

const makePayload = (context: Record<string, unknown>) =>
  ({
    signal: {
      symbol: 'TESTUSDT',
      signalId: 'signal-1',
      interval: '15',
      direction: 'LONG',
      timestamp: 1_700_000_000_000,
      strategy: 'TrendShift',
      prices: {
        currentPrice: 100,
        takeProfitPrice: 103,
        stopLossPrice: 99,
      },
    },
    figures: {},
    indicators: {},
    additionalIndicators: {
      trendShiftContext: context,
    },
  }) as any;

describe('trendShiftAiAdapter', () => {
  it('approves strong confirmed flips', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload({
        signalDirection: 'LONG',
        confirmedFlip: true,
        bullFlip: true,
        flipDistanceOk: true,
        closeVsAvgPct: 0.3,
        avgSlopePct: 0.11,
        distanceAtrRatio: 0.95,
        coinBiasAligned: true,
      }),
      analysis: {
        direction: 'LONG',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: 'LONG',
      quality: 5,
      approved: true,
    });
  });

  it('rejects ordinary q4 flips as watch-only', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload({
        signalDirection: 'LONG',
        confirmedFlip: true,
        bullFlip: true,
        flipDistanceOk: true,
        closeVsAvgPct: 0.08,
        avgSlopePct: 0.05,
        distanceAtrRatio: 0.5,
        coinBiasAligned: true,
      }),
      analysis: {
        direction: 'LONG',
        quality: 5,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 4,
      approved: false,
    });
  });

  it('approves q5-strength flips even with coin bias conflict', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload({
        signalDirection: 'LONG',
        confirmedFlip: true,
        bullFlip: true,
        flipDistanceOk: true,
        closeVsAvgPct: 2.6,
        avgSlopePct: 2.8,
        distanceAtrRatio: 0.85,
        coinBiasAligned: false,
      }),
      analysis: {
        direction: 'LONG',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: 'LONG',
      quality: 5,
      approved: true,
    });
  });

  it('rejects weak flips even with coin bias conflict', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload({
        signalDirection: 'LONG',
        confirmedFlip: true,
        bullFlip: true,
        flipDistanceOk: false,
        closeVsAvgPct: 0.02,
        avgSlopePct: 0.01,
        distanceAtrRatio: 0.2,
        coinBiasAligned: false,
      }),
      analysis: {
        direction: 'LONG',
        quality: 5,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      approved: false,
    });
    expect((result as any).quality).toBe(2);
  });
});
