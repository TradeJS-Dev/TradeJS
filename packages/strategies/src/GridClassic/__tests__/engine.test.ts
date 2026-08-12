/** @jest-environment node */

import type { Candle } from '@tradejs/types';
import { config as DEFAULT_CONFIG, type GridClassicConfig } from '../config';
import {
  buildGridClassicDetectorKey,
  createGridClassicEngine,
} from '../engine';

const makeCandle = (
  index: number,
  close: number,
  overrides: Partial<Candle> = {},
): Candle => ({
  timestamp: 1_700_000_000_000 + index * 900_000,
  open: close,
  high: close + 0.4,
  low: close - 0.4,
  close,
  volume: 1_000,
  turnover: close * 1_000,
  ...overrides,
});

const rangeCycle = [100, 103, 105, 103, 100, 97, 95, 97];

const testConfig = {
  ...DEFAULT_CONFIG,
  GRIDCLASSIC_ATR_PERIOD: 3,
  GRIDCLASSIC_PIVOT_LEFT_BARS: 2,
  GRIDCLASSIC_PIVOT_RIGHT_BARS: 2,
  GRIDCLASSIC_LOOKBACK_BARS: 48,
  GRIDCLASSIC_MIN_PIVOTS_PER_SIDE: 2,
  GRIDCLASSIC_MIN_WIDTH_ATR: 3,
  GRIDCLASSIC_MAX_WIDTH_ATR: 30,
  GRIDCLASSIC_MAX_CENTER_SLOPE_ATR_PER_BAR: 0.08,
  GRIDCLASSIC_MAX_BOUNDARY_DIVERGENCE_ATR: 2,
  GRIDCLASSIC_MIN_CONTAINMENT_RATIO: 0.65,
  GRIDCLASSIC_MIN_RANGE_AGE_BARS: 8,
  GRIDCLASSIC_MAX_VOLATILITY_EXPANSION: 0,
  GRIDCLASSIC_EDGE_ZONE_FRACTION: 0.3,
  GRIDCLASSIC_ENTRY_CONFIRMATION: 'either',
  GRIDCLASSIC_MIN_REJECTION_WICK_RATIO: 0.5,
  GRIDCLASSIC_ENTRY_CONFIRMATION_BARS: 0,
  GRIDCLASSIC_MAX_PIVOT_AGE_BARS: 0,
  GRIDCLASSIC_MIN_ALTERNATING_PIVOTS: 0,
  GRIDCLASSIC_RECENT_CONTAINMENT_BARS: 0,
  GRIDCLASSIC_MIN_RECENT_CONTAINMENT_RATIO: 0,
} as GridClassicConfig;

const buildRange = () =>
  Array.from({ length: 6 }, () => rangeCycle)
    .flat()
    .map((close, index) => makeCandle(index, close));

const buildRisingRange = () =>
  Array.from({ length: 6 }, (_, cycle) =>
    rangeCycle.map((close) => close + cycle * 0.25),
  )
    .flat()
    .map((close, index) => makeCandle(index, close));

const project = (
  line: NonNullable<
    ReturnType<
      ReturnType<typeof createGridClassicEngine>['getState']
    >['snapshot']
  >['geometry']['upperLine'],
  timestamp: number,
) => {
  if (!line) throw new Error('expected a causal range line');
  const duration = line.endTimestamp - line.startTimestamp;
  if (duration === 0) return line.endPrice;
  return (
    line.startPrice +
    ((line.endPrice - line.startPrice) * (timestamp - line.startTimestamp)) /
      duration
  );
};

describe('GridClassic engine', () => {
  it('keeps the default detector identity and snapshot surface exact', () => {
    expect(buildGridClassicDetectorKey(DEFAULT_CONFIG)).toBe(
      '{"geometry":{"pivotLeftBars":3,"pivotRightBars":3,"lookbackBars":96,"minPivotsPerSide":3,"minWidthAtr":3,"maxWidthAtr":14,"maxCenterSlopeAtrPerBar":0.015,"maxBoundaryDivergenceAtr":0.8,"minContainmentRatio":0.9,"containmentToleranceAtr":0.2,"breakoutToleranceAtr":0.25,"minRangeAgeBars":32,"maxVolatilityExpansion":1.8},"engine":{"strategyMode":"mean_reversion","atrPeriod":14,"edgeZoneFraction":0.12,"entryConfirmation":"rejection","minRejectionWickRatio":1.5,"maxCandleRangeAtr":3,"maxFigurePoints":180,"entryConfirmationBars":1,"maxPivotAgeBars":0,"minAlternatingPivots":0,"recentContainmentBars":0,"minRecentContainmentRatio":0,"continuationAcceptanceBars":1,"continuationRetestMaxBars":4,"continuationRetestToleranceAtr":0.3,"continuationRequireDirectionalRetest":false}}',
    );
    const engine = createGridClassicEngine({ config: testConfig });
    const snapshot = engine.next(makeCandle(0, 100)).snapshot;

    expect(snapshot).not.toHaveProperty('setupFamily');
    expect(snapshot).not.toHaveProperty('failedBreakoutDirection');
    expect(snapshot).not.toHaveProperty('candidateTimestamp');

    const enabledKey = buildGridClassicDetectorKey({
      ...DEFAULT_CONFIG,
      GRIDCLASSIC_FAILED_BREAKOUT_REVERSAL_ENABLED: true,
    });
    expect(JSON.parse(enabledKey)).toEqual(
      expect.objectContaining({
        failedBreakoutReversal: { enabled: true },
      }),
    );
    expect(enabledKey).not.toBe(buildGridClassicDetectorKey(DEFAULT_CONFIG));
    expect(enabledKey).not.toBe(
      buildGridClassicDetectorKey({
        ...DEFAULT_CONFIG,
        GRIDCLASSIC_FAILED_BREAKOUT_REVERSAL_ENABLED: true,
        GRIDCLASSIC_CONTINUATION_RETEST_MAX_BARS: 2,
      }),
    );
  });

  it('opens LONG and SHORT symmetrically only at confirmed edges', () => {
    const base = buildRange();
    const longEngine = createGridClassicEngine({ config: testConfig });
    const shortEngine = createGridClassicEngine({ config: testConfig });
    base.forEach((candle) => {
      longEngine.next(candle);
      shortEngine.next(candle);
    });
    shortEngine.next(makeCandle(base.length, 100));
    shortEngine.next(makeCandle(base.length + 1, 103));

    const long = longEngine.next(
      makeCandle(base.length, 95.4, {
        open: 96.2,
        high: 96.4,
        low: 94.4,
        close: 95.4,
      }),
    ).snapshot;
    const short = shortEngine.next(
      makeCandle(base.length + 2, 104.6, {
        open: 103.8,
        high: 105.6,
        low: 103.6,
        close: 104.6,
      }),
    ).snapshot;

    expect(long?.geometry.detected).toBe(true);
    expect(long?.entryDirection).toBe('LONG');
    expect(short?.geometry.detected).toBe(true);
    expect(short?.entryDirection).toBe('SHORT');
  });

  it('does not enter in the middle or before the range is confirmed', () => {
    const middleEngine = createGridClassicEngine({ config: testConfig });
    buildRange().forEach((candle) => middleEngine.next(candle));
    const middle = middleEngine.next(makeCandle(48, 100)).snapshot;
    const warmupEngine = createGridClassicEngine({ config: testConfig });
    const warmup = warmupEngine.next(makeCandle(0, 95)).snapshot;

    expect(middle?.entryDirection).toBeNull();
    expect(warmup?.geometry.ready).toBe(false);
    expect(warmup?.entryDirection).toBeNull();
  });

  it('requires a later candle to confirm a failed breakout when configured', () => {
    const engine = createGridClassicEngine({
      config: {
        ...testConfig,
        GRIDCLASSIC_ENTRY_CONFIRMATION_BARS: 1,
      },
    });
    const base = buildRange();
    base.forEach((candle) => engine.next(candle));

    const candidate = engine.next(
      makeCandle(base.length, 95.4, {
        open: 96.2,
        high: 96.4,
        low: 94.4,
        close: 95.4,
      }),
    ).snapshot;
    const confirmed = engine.next(
      makeCandle(base.length + 1, 95.8, {
        open: 95.3,
        high: 96.1,
        low: 95.2,
        close: 95.8,
      }),
    ).snapshot;

    expect(candidate?.entryDirection).toBeNull();
    expect(candidate?.entrySignalStage).toBe('candidate');
    expect(confirmed?.entryDirection).toBe('LONG');
    expect(confirmed?.entrySignalStage).toBe('confirmed');
    expect(confirmed?.entryConfirmationAgeBars).toBe(1);
  });

  it('rejects a range whose opposite pivot has become stale', () => {
    const engine = createGridClassicEngine({
      config: {
        ...testConfig,
        GRIDCLASSIC_MAX_PIVOT_AGE_BARS: 5,
      },
    });
    const base = buildRange();
    base.forEach((candle) => engine.next(candle));
    const stale = engine.next(
      makeCandle(base.length, 95.4, {
        open: 96.2,
        high: 96.4,
        low: 94.4,
        close: 95.4,
      }),
    ).snapshot;

    expect(stale?.geometry.detected).toBe(true);
    expect(stale?.latestHighPivotAgeBars).toBeGreaterThan(5);
    expect(stale?.rangeQualityAccepted).toBe(false);
    expect(stale?.entryDirection).toBeNull();
  });

  it('matches continuous replay with initialCandles plus the last candle', () => {
    const candles = buildRange();
    const continuous = createGridClassicEngine({ config: testConfig });
    const continuousState = candles.reduce(
      (_state, candle) => continuous.next(candle),
      continuous.getState(),
    );
    const resumed = createGridClassicEngine({
      config: testConfig,
      initialCandles: candles.slice(0, -1),
    });
    const resumedState = resumed.next(candles[candles.length - 1]);

    expect(resumedState).toEqual(continuousState);
  });

  it('rebuilds pending two-stage confirmation through the replay path', () => {
    const config = {
      ...testConfig,
      GRIDCLASSIC_ENTRY_CONFIRMATION_BARS: 1,
    };
    const base = buildRange();
    const candles = [
      ...base,
      makeCandle(base.length, 95.4, {
        open: 96.2,
        high: 96.4,
        low: 94.4,
        close: 95.4,
      }),
      makeCandle(base.length + 1, 95.8, {
        open: 95.3,
        high: 96.1,
        low: 95.2,
        close: 95.8,
      }),
    ];
    const continuous = createGridClassicEngine({ config });
    const continuousState = candles.reduce(
      (_state, candle) => continuous.next(candle),
      continuous.getState(),
    );
    const resumed = createGridClassicEngine({
      config,
      initialCandles: candles.slice(0, -1),
    });
    const resumedState = resumed.next(candles.at(-1)!);

    expect(resumedState).toEqual(continuousState);
    expect(resumedState.snapshot?.entryDirection).toBe('LONG');
    expect(resumedState.snapshot?.entrySignalStage).toBe('confirmed');
  });

  it('is idempotent for duplicate timestamps and bounds detector history', () => {
    const engine = createGridClassicEngine({ config: testConfig });
    const candles = Array.from({ length: 20 }, () => rangeCycle)
      .flat()
      .map((close, index) => makeCandle(index, close));
    candles.forEach((candle) => engine.next(candle));
    const before = engine.getState();
    const after = engine.next({
      ...candles[candles.length - 1],
      close: 999,
    });

    expect(after).toEqual(before);
    expect(after.snapshot?.geometry.historySize).toBeLessThanOrEqual(
      testConfig.GRIDCLASSIC_LOOKBACK_BARS,
    );
  });

  it('confirms range breakout continuation only after acceptance and retest', () => {
    const config = {
      ...testConfig,
      GRIDCLASSIC_MODE: 'breakout_continuation' as const,
      GRIDCLASSIC_CONTINUATION_ACCEPTANCE_BARS: 1,
      GRIDCLASSIC_CONTINUATION_RETEST_MAX_BARS: 4,
      GRIDCLASSIC_CONTINUATION_RETEST_TOLERANCE_ATR: 0.1,
    };
    const base = buildRange();
    const engine = createGridClassicEngine({ config });
    base.forEach((candle) => engine.next(candle));

    const breakout = makeCandle(base.length, 107, {
      open: 105,
      high: 107.5,
      low: 104.8,
      close: 107,
    });
    const candidate = engine.next(breakout).snapshot;
    expect(candidate).toEqual(
      expect.objectContaining({
        strategyMode: 'breakout_continuation',
        entryDirection: null,
        entrySignalStage: 'breakout_candidate',
        setupId: expect.stringMatching(/^gridclassic-continuation:LONG:/),
        setupGeometry: expect.objectContaining({ detected: true }),
      }),
    );

    const acceptance = makeCandle(base.length + 1, 107.5, {
      open: 107,
      high: 108,
      low: 106.5,
      close: 107.5,
    });
    expect(engine.next(acceptance).snapshot).toEqual(
      expect.objectContaining({
        entryDirection: null,
        entrySignalStage: 'breakout_accepted',
      }),
    );

    const retest = makeCandle(base.length + 2, 106, {
      open: 105.5,
      high: 106.5,
      low: 105.2,
      close: 106,
    });
    const ready = engine.next(retest);
    expect(ready.snapshot).toEqual(
      expect.objectContaining({
        entryDirection: 'LONG',
        entrySignalStage: 'breakout_retest_confirmed',
        setupId: candidate?.setupId,
        breakoutLevel: candidate?.breakoutLevel,
      }),
    );
    expect(engine.next(retest)).toEqual(ready);
  });

  it('reverses an accepted upper breakout only after a later full reclaim', () => {
    const config = {
      ...testConfig,
      GRIDCLASSIC_MODE: 'breakout_continuation' as const,
      GRIDCLASSIC_CONTINUATION_ACCEPTANCE_BARS: 1,
      GRIDCLASSIC_CONTINUATION_RETEST_MAX_BARS: 2,
      GRIDCLASSIC_CONTINUATION_RETEST_TOLERANCE_ATR: 0.1,
      GRIDCLASSIC_FAILED_BREAKOUT_REVERSAL_ENABLED: true,
    };
    const base = buildRange();
    const engine = createGridClassicEngine({ config });
    base.forEach((candle) => engine.next(candle));

    const candidate = engine.next(
      makeCandle(base.length, 107, {
        open: 105,
        high: 107.5,
        low: 104.8,
        close: 107,
      }),
    ).snapshot;
    const accepted = engine.next(
      makeCandle(base.length + 1, 107.5, {
        open: 107,
        high: 108,
        low: 106.5,
        close: 107.5,
      }),
    ).snapshot;
    const reclaimed = engine.next(
      makeCandle(base.length + 2, 104.8, {
        open: 106.5,
        high: 107,
        low: 104.4,
        close: 104.8,
      }),
    ).snapshot;

    expect(candidate).toEqual(
      expect.objectContaining({
        entryDirection: null,
        entrySignalStage: 'breakout_candidate',
      }),
    );
    expect(accepted).toEqual(
      expect.objectContaining({
        entryDirection: null,
        entrySignalStage: 'breakout_accepted',
      }),
    );
    expect(reclaimed).toEqual(
      expect.objectContaining({
        entryDirection: 'SHORT',
        entrySignalStage: 'failed_breakout_reclaimed',
        setupFamily: 'failed_breakout_reversal',
        failedBreakoutDirection: 'LONG',
        reversalDirection: 'SHORT',
        candidateTimestamp: candidate?.timestamp,
        acceptedTimestamp: accepted?.timestamp,
        reclaimTimestamp: reclaimed?.timestamp,
        reclaimAgeBars: 1,
      }),
    );
    expect(reclaimed?.geometry.detected).toBe(false);
  });

  it('reverses an accepted lower breakout symmetrically', () => {
    const config = {
      ...testConfig,
      GRIDCLASSIC_MODE: 'breakout_continuation' as const,
      GRIDCLASSIC_CONTINUATION_ACCEPTANCE_BARS: 1,
      GRIDCLASSIC_CONTINUATION_RETEST_MAX_BARS: 2,
      GRIDCLASSIC_CONTINUATION_RETEST_TOLERANCE_ATR: 0.1,
      GRIDCLASSIC_FAILED_BREAKOUT_REVERSAL_ENABLED: true,
    };
    const base = buildRange();
    const engine = createGridClassicEngine({ config });
    base.forEach((candle) => engine.next(candle));

    const candidate = engine.next(
      makeCandle(base.length, 93, {
        open: 95,
        high: 95.2,
        low: 92.5,
        close: 93,
      }),
    ).snapshot;
    const accepted = engine.next(
      makeCandle(base.length + 1, 92.5, {
        open: 93,
        high: 93.5,
        low: 92,
        close: 92.5,
      }),
    ).snapshot;
    const reclaimed = engine.next(
      makeCandle(base.length + 2, 95.2, {
        open: 93,
        high: 95.6,
        low: 92.8,
        close: 95.2,
      }),
    ).snapshot;

    expect(candidate?.entrySignalStage).toBe('breakout_candidate');
    expect(accepted?.entrySignalStage).toBe('breakout_accepted');
    expect(reclaimed).toEqual(
      expect.objectContaining({
        entryDirection: 'LONG',
        entrySignalStage: 'failed_breakout_reclaimed',
        setupFamily: 'failed_breakout_reversal',
        failedBreakoutDirection: 'SHORT',
        reversalDirection: 'LONG',
        candidateTimestamp: candidate?.timestamp,
        acceptedTimestamp: accepted?.timestamp,
        reclaimTimestamp: reclaimed?.timestamp,
        reclaimAgeBars: 1,
      }),
    );
  });

  it('requires a reclaim of both the fixed level and projected frozen line', () => {
    const config = {
      ...testConfig,
      GRIDCLASSIC_MODE: 'breakout_continuation' as const,
      GRIDCLASSIC_CONTINUATION_ACCEPTANCE_BARS: 1,
      GRIDCLASSIC_CONTINUATION_RETEST_MAX_BARS: 2,
      GRIDCLASSIC_CONTINUATION_RETEST_TOLERANCE_ATR: 0.1,
      GRIDCLASSIC_CONTINUATION_REQUIRE_DIRECTIONAL_RETEST: true,
      GRIDCLASSIC_FAILED_BREAKOUT_REVERSAL_ENABLED: true,
    };
    const base = buildRisingRange();
    const engine = createGridClassicEngine({ config });
    base.forEach((candle) => engine.next(candle));
    const causalUpper = engine.getState().snapshot?.geometry.upperLine;
    if (!causalUpper) throw new Error('expected a rising upper range line');

    const candidateTimestamp = makeCandle(base.length, 0).timestamp;
    const candidateBoundary = project(causalUpper, candidateTimestamp);
    const candidate = engine.next(
      makeCandle(base.length, candidateBoundary + 2, {
        open: candidateBoundary,
        high: candidateBoundary + 2.5,
        low: candidateBoundary - 0.2,
        close: candidateBoundary + 2,
      }),
    ).snapshot;
    const fixedLevel = candidate?.breakoutLevel;
    const frozenUpper = candidate?.setupGeometry?.upperLine;
    if (fixedLevel == null || !frozenUpper) {
      throw new Error('expected frozen breakout geometry');
    }

    const acceptanceTimestamp = makeCandle(base.length + 1, 0).timestamp;
    const acceptanceBoundary = project(frozenUpper, acceptanceTimestamp);
    engine.next(
      makeCandle(
        base.length + 1,
        Math.max(fixedLevel, acceptanceBoundary) + 1,
        {
          open: Math.max(fixedLevel, acceptanceBoundary) + 0.5,
          high: Math.max(fixedLevel, acceptanceBoundary) + 1.5,
          low: Math.max(fixedLevel, acceptanceBoundary) + 0.2,
          close: Math.max(fixedLevel, acceptanceBoundary) + 1,
        },
      ),
    );

    const partialTimestamp = makeCandle(base.length + 2, 0).timestamp;
    const partialBoundary = project(frozenUpper, partialTimestamp);
    expect(partialBoundary).not.toBeCloseTo(fixedLevel, 8);
    const between = (fixedLevel + partialBoundary) / 2;
    const partial = engine.next(
      makeCandle(base.length + 2, between, {
        open: between + 0.2,
        high: Math.max(fixedLevel, partialBoundary) + 0.5,
        low: between - 0.2,
        close: between,
      }),
    ).snapshot;
    expect(partial?.entryDirection).toBeNull();

    const reclaimTimestamp = makeCandle(base.length + 3, 0).timestamp;
    const reclaimBoundary = project(frozenUpper, reclaimTimestamp);
    const reclaimed = engine.next(
      makeCandle(base.length + 3, Math.min(fixedLevel, reclaimBoundary) - 0.3, {
        open: Math.max(fixedLevel, reclaimBoundary) + 0.2,
        high: Math.max(fixedLevel, reclaimBoundary) + 0.5,
        low: Math.min(fixedLevel, reclaimBoundary) - 0.5,
        close: Math.min(fixedLevel, reclaimBoundary) - 0.3,
      }),
    ).snapshot;

    expect(reclaimed).toEqual(
      expect.objectContaining({
        entryDirection: 'SHORT',
        projectedBreakoutBoundary: expect.closeTo(reclaimBoundary, 8),
        failedBreakoutLevel: fixedLevel,
        reclaimAgeBars: 2,
      }),
    );
  });

  it('waits for a later outside-both close before arming the failure observation', () => {
    const config = {
      ...testConfig,
      GRIDCLASSIC_MODE: 'breakout_continuation' as const,
      GRIDCLASSIC_CONTINUATION_ACCEPTANCE_BARS: 1,
      GRIDCLASSIC_CONTINUATION_RETEST_MAX_BARS: 2,
      GRIDCLASSIC_CONTINUATION_RETEST_TOLERANCE_ATR: 0.1,
      GRIDCLASSIC_CONTINUATION_REQUIRE_DIRECTIONAL_RETEST: true,
      GRIDCLASSIC_FAILED_BREAKOUT_REVERSAL_ENABLED: true,
    };
    const base = buildRisingRange();
    const engine = createGridClassicEngine({ config });
    base.forEach((candle) => engine.next(candle));
    const causalUpper = engine.getState().snapshot?.geometry.upperLine;
    if (!causalUpper) throw new Error('expected a rising upper range line');
    const candidateTimestamp = makeCandle(base.length, 0).timestamp;
    const candidateBoundary = project(causalUpper, candidateTimestamp);
    const candidate = engine.next(
      makeCandle(base.length, candidateBoundary + 2),
    ).snapshot;
    const fixedLevel = candidate?.breakoutLevel;
    const frozenUpper = candidate?.setupGeometry?.upperLine;
    if (fixedLevel == null || !frozenUpper) {
      throw new Error('expected frozen breakout geometry');
    }

    const initialAcceptanceTimestamp = makeCandle(base.length + 1, 0).timestamp;
    const initialProjected = project(frozenUpper, initialAcceptanceTimestamp);
    const between = (fixedLevel + initialProjected) / 2;
    const legacyAccepted = engine.next(
      makeCandle(base.length + 1, between, {
        open: between + 0.1,
        high: initialProjected + 0.2,
        low: between - 0.1,
        close: between,
      }),
    ).snapshot;
    expect(legacyAccepted?.entrySignalStage).toBe('breakout_accepted');
    expect(legacyAccepted?.acceptedTimestamp).toBeNull();

    const laterAcceptanceTimestamp = makeCandle(base.length + 2, 0).timestamp;
    const laterProjected = project(frozenUpper, laterAcceptanceTimestamp);
    const laterAccepted = engine.next(
      makeCandle(base.length + 2, laterProjected + 0.8, {
        open: laterProjected + 0.4,
        high: laterProjected + 1,
        low: laterProjected + 0.3,
        close: laterProjected + 0.8,
      }),
    ).snapshot;
    expect(laterAccepted?.acceptedTimestamp).toBe(laterAcceptanceTimestamp);

    const reclaimTimestamp = makeCandle(base.length + 3, 0).timestamp;
    const reclaimProjected = project(frozenUpper, reclaimTimestamp);
    const reclaimed = engine.next(
      makeCandle(base.length + 3, fixedLevel - 0.3, {
        open: reclaimProjected + 0.2,
        high: reclaimProjected + 0.4,
        low: fixedLevel - 0.5,
        close: fixedLevel - 0.3,
      }),
    ).snapshot;

    expect(reclaimed).toEqual(
      expect.objectContaining({
        entryDirection: 'SHORT',
        acceptedTimestamp: laterAcceptanceTimestamp,
        reclaimAgeBars: 1,
      }),
    );
  });

  it('expires an accepted failure observation after the frozen retest horizon', () => {
    const config = {
      ...testConfig,
      GRIDCLASSIC_MODE: 'breakout_continuation' as const,
      GRIDCLASSIC_CONTINUATION_ACCEPTANCE_BARS: 1,
      GRIDCLASSIC_CONTINUATION_RETEST_MAX_BARS: 2,
      GRIDCLASSIC_CONTINUATION_RETEST_TOLERANCE_ATR: 0.1,
      GRIDCLASSIC_FAILED_BREAKOUT_REVERSAL_ENABLED: true,
    };
    const base = buildRange();
    const engine = createGridClassicEngine({ config });
    base.forEach((candle) => engine.next(candle));
    engine.next(
      makeCandle(base.length, 107, {
        open: 105,
        high: 107.5,
        low: 104.8,
        close: 107,
      }),
    );
    engine.next(
      makeCandle(base.length + 1, 107.5, {
        open: 107,
        high: 108,
        low: 106.5,
        close: 107.5,
      }),
    );
    engine.next(makeCandle(base.length + 2, 108.5));
    engine.next(makeCandle(base.length + 3, 108.25));
    const expiredReclaim = engine.next(
      makeCandle(base.length + 4, 104.8, {
        open: 106.5,
        high: 107,
        low: 104.4,
        close: 104.8,
      }),
    ).snapshot;

    expect(expiredReclaim?.entryDirection).toBeNull();
    expect(expiredReclaim?.entrySignalStage).not.toBe(
      'failed_breakout_reclaimed',
    );
  });

  it('does not replace an accepted failure observation with a newer breakout', () => {
    const config = {
      ...testConfig,
      GRIDCLASSIC_MODE: 'breakout_continuation' as const,
      GRIDCLASSIC_CONTINUATION_ACCEPTANCE_BARS: 1,
      GRIDCLASSIC_CONTINUATION_RETEST_MAX_BARS: 2,
      GRIDCLASSIC_CONTINUATION_RETEST_TOLERANCE_ATR: 0.1,
      GRIDCLASSIC_CONTINUATION_REQUIRE_DIRECTIONAL_RETEST: true,
      GRIDCLASSIC_FAILED_BREAKOUT_REVERSAL_ENABLED: true,
    };
    const base = buildRisingRange();
    const engine = createGridClassicEngine({ config });
    base.forEach((candle) => engine.next(candle));
    const causalUpper = engine.getState().snapshot?.geometry.upperLine;
    if (!causalUpper) throw new Error('expected a rising upper range line');
    const candidateTimestamp = makeCandle(base.length, 0).timestamp;
    const candidateBoundary = project(causalUpper, candidateTimestamp);
    const candidate = engine.next(
      makeCandle(base.length, candidateBoundary + 2),
    ).snapshot;
    const fixedLevel = candidate?.breakoutLevel;
    const frozenUpper = candidate?.setupGeometry?.upperLine;
    if (fixedLevel == null || !frozenUpper || !candidate?.setupId) {
      throw new Error('expected frozen breakout geometry');
    }

    for (const age of [1, 2]) {
      const timestamp = makeCandle(base.length + age, 0).timestamp;
      const projected = project(frozenUpper, timestamp);
      engine.next(makeCandle(base.length + age, (fixedLevel + projected) / 2));
    }
    const acceptanceTimestamp = makeCandle(base.length + 3, 0).timestamp;
    const acceptanceBoundary = project(frozenUpper, acceptanceTimestamp);
    engine.next(
      makeCandle(base.length + 3, acceptanceBoundary + 1, {
        open: acceptanceBoundary + 0.5,
        high: acceptanceBoundary + 1.5,
        low: acceptanceBoundary + 0.3,
        close: acceptanceBoundary + 1,
      }),
    );
    const legacyExpiryTimestamp = makeCandle(base.length + 4, 0).timestamp;
    const legacyExpiryBoundary = project(frozenUpper, legacyExpiryTimestamp);
    engine.next(
      makeCandle(base.length + 4, legacyExpiryBoundary + 1, {
        open: legacyExpiryBoundary + 0.5,
        high: legacyExpiryBoundary + 1.5,
        low: legacyExpiryBoundary + 0.3,
        close: legacyExpiryBoundary + 1,
      }),
    );
    const wouldReplaceTimestamp = makeCandle(base.length + 5, 0).timestamp;
    const wouldReplaceBoundary = project(frozenUpper, wouldReplaceTimestamp);
    const stillFrozen = engine.next(
      makeCandle(base.length + 5, wouldReplaceBoundary + 1, {
        open: wouldReplaceBoundary + 0.5,
        high: wouldReplaceBoundary + 1.5,
        low: wouldReplaceBoundary + 0.3,
        close: wouldReplaceBoundary + 1,
      }),
    ).snapshot;

    expect(stillFrozen).toEqual(
      expect.objectContaining({
        setupId: candidate.setupId,
        candidateTimestamp: candidate.timestamp,
        acceptedTimestamp: acceptanceTimestamp,
        setupFamily: 'failed_breakout_reversal',
      }),
    );
    expect(stillFrozen?.entrySignalStage).not.toBe('breakout_candidate');
  });

  it('rebuilds an accepted failure observation through initialCandles replay', () => {
    const config = {
      ...testConfig,
      GRIDCLASSIC_MODE: 'breakout_continuation' as const,
      GRIDCLASSIC_CONTINUATION_ACCEPTANCE_BARS: 1,
      GRIDCLASSIC_CONTINUATION_RETEST_MAX_BARS: 2,
      GRIDCLASSIC_CONTINUATION_RETEST_TOLERANCE_ATR: 0.1,
      GRIDCLASSIC_FAILED_BREAKOUT_REVERSAL_ENABLED: true,
    };
    const base = buildRange();
    const history = [
      ...base,
      makeCandle(base.length, 107, {
        open: 105,
        high: 107.5,
        low: 104.8,
        close: 107,
      }),
      makeCandle(base.length + 1, 107.5, {
        open: 107,
        high: 108,
        low: 106.5,
        close: 107.5,
      }),
    ];
    const reclaim = makeCandle(base.length + 2, 104.8, {
      open: 106.5,
      high: 107,
      low: 104.4,
      close: 104.8,
    });
    const continuous = createGridClassicEngine({ config });
    history.forEach((item) => continuous.next(item));
    const expected = continuous.next(reclaim);
    expect(continuous.next({ ...reclaim, close: 999 })).toEqual(expected);
    const restored = createGridClassicEngine({
      config,
      initialCandles: history,
    });

    expect(restored.next(reclaim)).toEqual(expected);
    expect(expected.snapshot?.entrySignalStage).toBe(
      'failed_breakout_reclaimed',
    );
  });

  it('keeps the successful legacy continuation retest ahead of reversal', () => {
    const config = {
      ...testConfig,
      GRIDCLASSIC_MODE: 'breakout_continuation' as const,
      GRIDCLASSIC_CONTINUATION_ACCEPTANCE_BARS: 1,
      GRIDCLASSIC_CONTINUATION_RETEST_MAX_BARS: 2,
      GRIDCLASSIC_CONTINUATION_RETEST_TOLERANCE_ATR: 0.1,
      GRIDCLASSIC_FAILED_BREAKOUT_REVERSAL_ENABLED: true,
    };
    const base = buildRange();
    const engine = createGridClassicEngine({ config });
    base.forEach((candle) => engine.next(candle));
    engine.next(
      makeCandle(base.length, 107, {
        open: 105,
        high: 107.5,
        low: 104.8,
        close: 107,
      }),
    );
    engine.next(
      makeCandle(base.length + 1, 107.5, {
        open: 107,
        high: 108,
        low: 106.5,
        close: 107.5,
      }),
    );
    const legacyRetest = engine.next(
      makeCandle(base.length + 2, 106, {
        open: 105.5,
        high: 106.5,
        low: 105.2,
        close: 106,
      }),
    ).snapshot;

    expect(legacyRetest).toEqual(
      expect.objectContaining({
        entryDirection: 'LONG',
        entrySignalStage: 'breakout_retest_confirmed',
        setupFamily: null,
      }),
    );
  });

  it('waits for a directional response on a continuation retest when required', () => {
    const config = {
      ...testConfig,
      GRIDCLASSIC_MODE: 'breakout_continuation' as const,
      GRIDCLASSIC_CONTINUATION_ACCEPTANCE_BARS: 1,
      GRIDCLASSIC_CONTINUATION_RETEST_MAX_BARS: 4,
      GRIDCLASSIC_CONTINUATION_RETEST_TOLERANCE_ATR: 0.1,
      GRIDCLASSIC_CONTINUATION_REQUIRE_DIRECTIONAL_RETEST: true,
    };
    const base = buildRange();
    const engine = createGridClassicEngine({ config });
    base.forEach((candle) => engine.next(candle));
    engine.next(
      makeCandle(base.length, 107, {
        open: 105,
        high: 107.5,
        low: 104.8,
        close: 107,
      }),
    );
    engine.next(
      makeCandle(base.length + 1, 107.5, {
        open: 107,
        high: 108,
        low: 106.5,
        close: 107.5,
      }),
    );

    const weakRetest = engine.next(
      makeCandle(base.length + 2, 106, {
        open: 106.2,
        high: 106.4,
        low: 105.2,
        close: 106,
      }),
    );
    expect(weakRetest.snapshot).toEqual(
      expect.objectContaining({
        entryDirection: null,
        entrySignalStage: 'breakout_accepted',
      }),
    );

    expect(
      engine.next(
        makeCandle(base.length + 3, 106, {
          open: 105.5,
          high: 106.5,
          low: 105.2,
          close: 106,
        }),
      ).snapshot,
    ).toEqual(
      expect.objectContaining({
        entryDirection: 'LONG',
        entrySignalStage: 'breakout_retest_confirmed',
      }),
    );
  });

  it('replays pending continuation state identically', () => {
    const config = {
      ...testConfig,
      GRIDCLASSIC_MODE: 'breakout_continuation' as const,
      GRIDCLASSIC_CONTINUATION_ACCEPTANCE_BARS: 1,
      GRIDCLASSIC_CONTINUATION_RETEST_TOLERANCE_ATR: 0.1,
    };
    const base = buildRange();
    const history = [
      ...base,
      makeCandle(base.length, 107, {
        open: 105,
        high: 107.5,
        low: 104.8,
        close: 107,
      }),
      makeCandle(base.length + 1, 107.5, {
        open: 107,
        high: 108,
        low: 106.5,
        close: 107.5,
      }),
    ];
    const retest = makeCandle(base.length + 2, 106, {
      open: 105.5,
      high: 106.5,
      low: 105.2,
      close: 106,
    });
    const continuous = createGridClassicEngine({ config });
    history.forEach((candle) => continuous.next(candle));
    const expected = continuous.next(retest);
    const restored = createGridClassicEngine({
      config,
      initialCandles: history,
    });

    expect(restored.next(retest)).toEqual(expected);
  });
});
