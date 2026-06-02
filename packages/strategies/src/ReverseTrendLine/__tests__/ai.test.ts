import { reverseTrendLineAiAdapter } from '../adapters/ai';

describe('reverseTrendLineAiAdapter', () => {
  it('copies ReverseTrendLine gate features into strategy and base contexts', () => {
    const result = reverseTrendLineAiAdapter.buildPayload?.({
      signal: {
        direction: 'LONG',
        prices: {
          currentPrice: 100.2,
        },
        additionalIndicators: {
          touches: 5,
          distance: 120,
          currentCandle: {
            timestamp: 1_700_000_000_000,
            open: 99.8,
            close: 100.2,
            high: 100.4,
            low: 99.6,
          },
          reverseTrendlineTiming: {
            entryTiming: 'ready_rejection',
          },
          trendLine: {
            mode: 'lows',
            points: [
              { timestamp: 1_699_999_100_000, value: 100 },
              { timestamp: 1_700_000_000_000, value: 100 },
            ],
          },
        },
      } as any,
      basePayload: {
        figures: {},
        additionalIndicators: {
          baseContext: {
            raw: {
              trend: {
                maFast: 101,
                maSlow: 100,
              },
              volatility: {
                atrPct: 1,
              },
            },
            participation: {
              volume: {
                volumeRel20: 1.3,
              },
            },
            structure: {
              localRange: {
                rangePosition20: 0.5,
              },
            },
            regime: {
              volatility: {
                atrPctZScore: 0.4,
              },
            },
            derivatives: {
              summary: {
                riskFlags: [],
              },
            },
            relative: {
              benchmark: {
                maFast: 101,
                maSlow: 100,
              },
            },
          },
        },
      } as any,
    } as any);

    expect(
      (result as any).additionalIndicators.reverseTrendlineContext
        .reverseTrendLineGateFeatures,
    ).toMatchObject({
      bounceAcceptance: 'rejection',
      baseContextState: 'clean',
      participationState: 'normal',
    });
    expect(
      (result as any).additionalIndicators.baseContext
        .reverseTrendLineGateFeatures,
    ).toMatchObject({
      bounceAcceptance: 'rejection',
      baseContextState: 'clean',
    });
  });
});
