import { config as DEFAULT_CONFIG } from '../config';
import { buildTrendlineRiskPlan } from '../risk';

const makeStructuralContext = (overrides: Record<string, unknown> = {}) =>
  ({
    atrPct: 1,
    priceVsLinePctAbs: 0.8,
    breakVsAtrRatio: 1,
    touches: 5,
    distance: 180,
    ...overrides,
  }) as any;

const makeTimingContext = (overrides: Record<string, unknown> = {}) =>
  ({
    entryTiming: 'ready_breakout',
    retestConfirmed: false,
    ...overrides,
  }) as any;

describe('buildTrendlineRiskPlan', () => {
  it('builds tighter retest plans than fresh breakout plans for the same short setup', () => {
    const structuralContext = makeStructuralContext();
    const breakoutPlan = buildTrendlineRiskPlan({
      direction: 'SHORT',
      modeConfig: DEFAULT_CONFIG.LOWS,
      baseStopLossDelta: DEFAULT_CONFIG.TRENDLINE_STOP_BASE_PCT,
      baseTargetRiskRatio: DEFAULT_CONFIG.TRENDLINE_TARGET_R_MULT,
      structuralContext,
      timingContext: makeTimingContext({
        entryTiming: 'ready_breakout',
      }),
    });
    const retestPlan = buildTrendlineRiskPlan({
      direction: 'SHORT',
      modeConfig: DEFAULT_CONFIG.LOWS,
      baseStopLossDelta: DEFAULT_CONFIG.TRENDLINE_STOP_BASE_PCT,
      baseTargetRiskRatio: DEFAULT_CONFIG.TRENDLINE_TARGET_R_MULT,
      structuralContext,
      timingContext: makeTimingContext({
        entryTiming: 'ready_retest',
        retestConfirmed: true,
      }),
    });

    expect(retestPlan.stopLossDelta).toBeLessThan(breakoutPlan.stopLossDelta);
    expect(retestPlan.targetRiskRatio).toBeLessThan(
      breakoutPlan.targetRiskRatio,
    );
    expect(retestPlan.takeProfitDelta).toBeLessThan(
      breakoutPlan.takeProfitDelta,
    );
  });

  it('widens stop and lowers target RR for overextended short breakouts', () => {
    const compactPlan = buildTrendlineRiskPlan({
      direction: 'SHORT',
      modeConfig: DEFAULT_CONFIG.LOWS,
      baseStopLossDelta: DEFAULT_CONFIG.TRENDLINE_STOP_BASE_PCT,
      baseTargetRiskRatio: DEFAULT_CONFIG.TRENDLINE_TARGET_R_MULT,
      structuralContext: makeStructuralContext({
        priceVsLinePctAbs: 2.4,
        atrPct: 0.5,
        breakVsAtrRatio: 4.8,
        distance: 220,
      }),
      timingContext: makeTimingContext(),
    });
    const overextendedPlan = buildTrendlineRiskPlan({
      direction: 'SHORT',
      modeConfig: DEFAULT_CONFIG.LOWS,
      baseStopLossDelta: DEFAULT_CONFIG.TRENDLINE_STOP_BASE_PCT,
      baseTargetRiskRatio: DEFAULT_CONFIG.TRENDLINE_TARGET_R_MULT,
      structuralContext: makeStructuralContext({
        priceVsLinePctAbs: 2.4,
        atrPct: 0.5,
        breakVsAtrRatio: 4.8,
        distance: 650,
      }),
      timingContext: makeTimingContext(),
    });

    expect(overextendedPlan.stopLossDelta).toBeGreaterThan(
      compactPlan.stopLossDelta,
    );
    expect(overextendedPlan.targetRiskRatio).toBeLessThan(
      compactPlan.targetRiskRatio,
    );
  });

  it('keeps long fresh breakouts on a higher RR ladder than comparable shorts', () => {
    const structuralContext = makeStructuralContext({
      priceVsLinePctAbs: 1.1,
      atrPct: 0.9,
      breakVsAtrRatio: 1.25,
      touches: 6,
      distance: 200,
    });
    const longPlan = buildTrendlineRiskPlan({
      direction: 'LONG',
      modeConfig: DEFAULT_CONFIG.HIGHS,
      baseStopLossDelta: DEFAULT_CONFIG.TRENDLINE_STOP_BASE_PCT,
      baseTargetRiskRatio: DEFAULT_CONFIG.TRENDLINE_TARGET_R_MULT,
      structuralContext,
      timingContext: makeTimingContext(),
    });
    const shortPlan = buildTrendlineRiskPlan({
      direction: 'SHORT',
      modeConfig: DEFAULT_CONFIG.LOWS,
      baseStopLossDelta: DEFAULT_CONFIG.TRENDLINE_STOP_BASE_PCT,
      baseTargetRiskRatio: DEFAULT_CONFIG.TRENDLINE_TARGET_R_MULT,
      structuralContext,
      timingContext: makeTimingContext(),
    });

    expect(longPlan.targetRiskRatio).toBeGreaterThan(shortPlan.targetRiskRatio);
    expect(longPlan.takeProfitDelta).toBeGreaterThan(0);
    expect(shortPlan.takeProfitDelta).toBeGreaterThan(0);
  });
});
