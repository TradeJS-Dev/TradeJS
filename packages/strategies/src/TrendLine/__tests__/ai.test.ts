import { trendLineAiAdapter } from '../adapters/ai';

const baseContext = {
  raw: {
    trend: {
      maFast: 102,
      maSlow: 100,
    },
    volatility: {
      atrPct: 1,
    },
  },
  regime: {
    session: {
      sessionPhase: 'europe',
      isOverlap: false,
    },
  },
  participation: {
    volume: {
      volumeRel20: 1.6,
    },
  },
  relative: {
    benchmark: {
      maFast: 102,
      maSlow: 100,
      trendAlignment: 'aligned_bull',
    },
    execution: {
      venueSpreadZScore: 1.2,
    },
  },
  derivatives: {
    summary: {
      directionAligned: true,
      riskFlags: [],
    },
  },
};

describe('trendLineAiAdapter', () => {
  it('copies TrendLine gate features into strategy and base contexts', () => {
    const result = trendLineAiAdapter.buildPayload?.({
      signal: {
        direction: 'LONG',
        prices: {
          currentPrice: 101,
        },
        additionalIndicators: {
          touches: 5,
          distance: 80,
          trendLine: {
            mode: 'highs',
            points: [
              { timestamp: 1_700_000_000_000, value: 100 },
              { timestamp: 1_700_000_900_000, value: 100 },
            ],
          },
        },
      } as any,
      basePayload: {
        figures: {},
        additionalIndicators: {
          baseContext,
        },
      } as any,
    } as any);

    expect(
      (result as any).additionalIndicators.trendlineContext
        .trendLineGateFeatures,
    ).toMatchObject({
      lineMaturity: 'mature',
      breakoutAcceptance: 'clear_break',
      biasAlignment: 'aligned',
      participationState: 'strong',
    });
    expect(
      (result as any).additionalIndicators.baseContext.trendLineGateFeatures,
    ).toMatchObject({
      lineMaturity: 'mature',
      breakoutAcceptance: 'clear_break',
    });
  });
});
