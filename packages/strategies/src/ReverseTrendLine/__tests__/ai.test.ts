import { reverseTrendLineAiAdapter } from '../adapters/ai';

const buildBasePayload = (baseContext: Record<string, unknown>) =>
  ({
    figures: {},
    additionalIndicators: {
      baseContext,
    },
  }) as any;

const buildBaseContext = (overrides: Record<string, unknown> = {}) =>
  ({
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
      liquidityTails: {
        activeCount: 0,
      },
    },
    regime: {
      volatility: {
        atrPctZScore: 0.4,
      },
    },
    derivatives: {
      summary: {
        pressure: 'neutral',
        riskFlags: [],
      },
    },
    relative: {
      benchmark: {
        maFast: 101,
        maSlow: 100,
      },
    },
    ...overrides,
  }) as Record<string, unknown>;

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
      basePayload: buildBasePayload(buildBaseContext()),
    } as any);

    expect(
      (result as any).additionalIndicators.reverseTrendlineContext
        .reverseTrendLineGateFeatures,
    ).toMatchObject({
      bounceAcceptance: 'rejection',
      baseContextState: 'clean',
      participationState: 'normal',
      approvalLane: 'watch',
    });
    expect(
      (result as any).additionalIndicators.baseContext
        .reverseTrendLineGateFeatures,
    ).toMatchObject({
      bounceAcceptance: 'rejection',
      baseContextState: 'clean',
      approvalLane: 'watch',
    });
  });

  it('approves only high-score deterministic bounce pockets from the normal ladder', () => {
    const result = reverseTrendLineAiAdapter.buildPayload?.({
      signal: {
        direction: 'SHORT',
        prices: {
          currentPrice: 99.2,
        },
        additionalIndicators: {
          touches: 4,
          distance: 120,
          currentCandle: {
            timestamp: 1_700_000_000_000,
            open: 100.8,
            close: 99.2,
            high: 101,
            low: 99,
          },
          reverseTrendlineTiming: {
            entryTiming: 'ready_rejection',
          },
          trendLine: {
            mode: 'highs',
            points: [
              { timestamp: 1_699_999_100_000, value: 100 },
              { timestamp: 1_700_000_000_000, value: 100 },
            ],
          },
        },
      } as any,
      basePayload: buildBasePayload(
        buildBaseContext({
          raw: {
            trend: {
              maFast: 99,
              maSlow: 100,
            },
            volatility: {
              atrPct: 1,
            },
          },
          relative: {
            benchmark: {
              maFast: 99,
              maSlow: 100,
            },
          },
        }),
      ),
    } as any);

    expect(
      (result as any).additionalIndicators.reverseTrendlineContext,
    ).toMatchObject({
      approvalAllowedNow: true,
      deterministicQuality: 4,
      deterministicRejectionScore: 7,
      approvalBlockReasons: [],
    });
    expect(
      (result as any).additionalIndicators.reverseTrendlineContext
        .reverseTrendLineGateFeatures,
    ).toMatchObject({
      approvalLane: 'high_score_bounce',
      highQualityBouncePocket: true,
    });
  });

  it('keeps old q4 bounce pockets in watch mode when the rejection score is below the strict lane', () => {
    const result = reverseTrendLineAiAdapter.buildPayload?.({
      signal: {
        direction: 'LONG',
        prices: {
          currentPrice: 100.6,
        },
        additionalIndicators: {
          touches: 5,
          distance: 120,
          currentCandle: {
            timestamp: 1_700_000_000_000,
            open: 99.8,
            close: 100.6,
            high: 100.8,
            low: 99.7,
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
      basePayload: buildBasePayload(
        buildBaseContext({
          raw: {
            trend: {
              maFast: 99,
              maSlow: 100,
            },
            volatility: {
              atrPct: 1,
            },
          },
        }),
      ),
    } as any);

    expect(
      (result as any).additionalIndicators.reverseTrendlineContext,
    ).toMatchObject({
      approvalAllowedNow: false,
      deterministicQuality: 4,
      deterministicRejectionScore: 3,
      approvalBlockReasons: ['rejection_score_below_gate'],
    });
    expect(
      (result as any).additionalIndicators.reverseTrendlineContext
        .reverseTrendLineGateFeatures,
    ).toMatchObject({
      approvalLane: 'watch',
      highQualityBouncePocket: true,
    });
  });

  it('recovers the narrowed base-context extreme-volatility pocket', () => {
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
      basePayload: buildBasePayload(
        buildBaseContext({
          gateFeatures: {
            decisionHints: {
              approveBias: 'reject',
              primaryIssue: 'extreme_volatility',
            },
          },
          regime: {
            momentum: {
              upCloseStreak: 2,
            },
            trend: {
              adaptiveChannel: {
                flipUp: false,
              },
            },
            volatility: {
              atrPctZScore: 3,
              percentiles: {
                atrPctRank100: 99,
              },
            },
          },
        }),
      ),
    } as any);

    expect(
      (result as any).additionalIndicators.reverseTrendlineContext,
    ).toMatchObject({
      approvalAllowedNow: true,
      deterministicQuality: 4,
      approvalBlockReasons: [],
    });
    expect(
      (result as any).additionalIndicators.reverseTrendlineContext
        .reverseTrendLineGateFeatures,
    ).toMatchObject({
      approvalLane: 'extreme_volatility_recovery',
      extremeVolatilityRecoveryPocket: true,
    });
  });
});
