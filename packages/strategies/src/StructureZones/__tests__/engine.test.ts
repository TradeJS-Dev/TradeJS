/** @jest-environment node */

import { config as DEFAULT_CONFIG } from '../config';
import { createStructureZonesEngine } from '../engine';

const makeCandle = (
  index: number,
  open: number,
  high: number,
  low: number,
  close: number,
) => ({
  timestamp: 1_700_000_000_000 + index * 60_000,
  dt: new Date(1_700_000_000_000 + index * 60_000).toISOString(),
  open,
  high,
  low,
  close,
  volume: 1_000 + index * 100,
  turnover: close * (1_000 + index * 100),
});

const mirrorCandle = (candle: ReturnType<typeof makeCandle>) => ({
  ...candle,
  open: 200 - candle.open,
  high: 200 - candle.low,
  low: 200 - candle.high,
  close: 200 - candle.close,
});

const makeConfig = (overrides: Record<string, unknown> = {}) =>
  ({
    ...DEFAULT_CONFIG,
    STRUCTURE_ZONES_PIVOT_LENGTH: 2,
    STRUCTURE_ZONES_ATR_LENGTH: 5,
    STRUCTURE_ZONES_MIN_SWING_ATR: 0.1,
    STRUCTURE_ZONES_ZONE_WIDTH_ATR: 0.2,
    STRUCTURE_ZONES_MIN_REACTION_DISTANCE_ATR_LONG: undefined,
    STRUCTURE_ZONES_MIN_REACTION_DISTANCE_ATR_SHORT: undefined,
    ...overrides,
  }) as any;

describe('StructureZones engine', () => {
  it('builds support and resistance zones from confirmed swings', () => {
    const engine = createStructureZonesEngine({ config: makeConfig() });
    const candles = [
      makeCandle(0, 100, 102, 98, 100),
      makeCandle(1, 101, 104, 99, 102),
      makeCandle(2, 102, 110, 100, 108),
      makeCandle(3, 108, 106, 101, 103),
      makeCandle(4, 103, 105, 96, 99),
      makeCandle(5, 99, 104, 94, 96),
      makeCandle(6, 96, 103, 95, 101),
      makeCandle(7, 101, 105, 97, 103),
    ];

    const states = candles.map((candle) => engine.next(candle as any));
    const latest = states[states.length - 1].snapshot;

    expect(latest?.resistanceZone?.level).toBe(110);
    expect(latest?.supportZone?.level).toBe(94);
    expect(latest?.marketState).toBe('Range');
  });

  it('keeps absolute swing indexes after the rolling candle buffer trims history', () => {
    const engine = createStructureZonesEngine({ config: makeConfig() });
    for (let index = 0; index < 40; index += 1) {
      engine.next(makeCandle(index, 100, 101, 99, 100) as any);
    }

    const base = 40;
    const candles = [
      makeCandle(base, 100, 102, 98, 100),
      makeCandle(base + 1, 101, 104, 99, 102),
      makeCandle(base + 2, 102, 110, 100, 108),
      makeCandle(base + 3, 108, 106, 101, 103),
      makeCandle(base + 4, 103, 105, 96, 99),
      makeCandle(base + 5, 99, 104, 94, 96),
      makeCandle(base + 6, 96, 103, 95, 101),
      makeCandle(base + 7, 101, 105, 97, 103),
    ];

    const states = candles.map((candle) => engine.next(candle as any));
    const latest = states[states.length - 1].snapshot;

    expect(latest?.lastHigh?.index).toBe(base + 2);
    expect(latest?.lastLow?.index).toBe(base + 5);
    expect(latest?.resistanceZone?.level).toBe(110);
    expect(latest?.supportZone?.level).toBe(94);
  });

  it('emits only one reaction for the same zone setup', () => {
    const engine = createStructureZonesEngine({ config: makeConfig() });
    const candles = [
      makeCandle(0, 100, 102, 98, 100),
      makeCandle(1, 101, 104, 99, 102),
      makeCandle(2, 102, 110, 100, 108),
      makeCandle(3, 108, 106, 101, 103),
      makeCandle(4, 103, 105, 96, 99),
      makeCandle(5, 99, 104, 94, 96),
      makeCandle(6, 96, 103, 95, 101),
      makeCandle(7, 101, 105, 97, 103),
    ];
    candles.forEach((candle) => engine.next(candle as any));

    const firstReaction = engine.next(makeCandle(8, 95, 98, 94.5, 97) as any);
    const repeatedReaction = engine.next(
      makeCandle(9, 95.5, 106, 94.5, 97.5) as any,
    );

    expect(firstReaction.signal?.kind).toBe('support_reaction');
    expect(firstReaction.signal?.direction).toBe('LONG');
    expect(repeatedReaction.signal).toBeNull();
  });

  it('keeps zero confirmation bars as the exact immediate control', () => {
    const engine = createStructureZonesEngine({
      config: makeConfig({
        STRUCTURE_ZONES_PENDING_CONFIRMATION_MAX_BARS: 0,
      }),
    });
    const candles = [
      makeCandle(0, 100, 102, 98, 100),
      makeCandle(1, 101, 104, 99, 102),
      makeCandle(2, 102, 110, 100, 108),
      makeCandle(3, 108, 106, 101, 103),
      makeCandle(4, 103, 105, 96, 99),
      makeCandle(5, 99, 104, 94, 96),
      makeCandle(6, 96, 103, 95, 101),
      makeCandle(7, 101, 105, 97, 103),
    ];
    candles.forEach((candle) => engine.next(candle as any));

    const immediate = engine.next(makeCandle(8, 95, 98, 94.5, 97) as any);

    expect(immediate.signal).toMatchObject({
      direction: 'LONG',
      kind: 'support_reaction',
      timestamp: 1_700_000_000_000 + 8 * 60_000,
      close: 97,
    });
    expect(immediate.signal).not.toHaveProperty('confirmation');
    expect(immediate).not.toHaveProperty('pendingConfirmation');
    expect(engine.getState()).not.toHaveProperty('pendingConfirmation');
  });

  it('waits for a later support retest and confirms from frozen geometry', () => {
    const engine = createStructureZonesEngine({
      config: makeConfig({
        STRUCTURE_ZONES_PENDING_CONFIRMATION_MAX_BARS: 3,
      }),
    });
    const candles = [
      makeCandle(0, 100, 102, 98, 100),
      makeCandle(1, 101, 104, 99, 102),
      makeCandle(2, 102, 110, 100, 108),
      makeCandle(3, 108, 106, 101, 103),
      makeCandle(4, 103, 105, 96, 99),
      makeCandle(5, 99, 104, 94, 96),
      makeCandle(6, 96, 103, 95, 101),
      makeCandle(7, 101, 105, 97, 103),
    ];
    candles.forEach((candle) => engine.next(candle as any));

    const candidateCandle = makeCandle(8, 95, 98, 94.5, 97);
    const candidate = engine.next(candidateCandle as any);
    const frozenTop = candidate.pendingConfirmation?.signal.zone.top;
    const candidateSwingPoints = candidate.swingPoints.map((point) => ({
      ...point,
    }));

    expect(candidate.signal).toBeNull();
    expect(candidate.pendingConfirmation).toMatchObject({
      setupId: `support_reaction:${candles[5].timestamp}`,
      candidateTimestamp: candidateCandle.timestamp,
      ageBars: 0,
      signal: {
        direction: 'LONG',
        kind: 'support_reaction',
      },
    });
    expect(frozenTop).toBeDefined();

    const confirmationCandle = makeCandle(
      9,
      Number(frozenTop) + 0.8,
      Number(frozenTop) + 1,
      Number(frozenTop) - 0.2,
      Number(frozenTop) + 0.5,
    );
    const confirmed = engine.next(confirmationCandle as any);

    expect(confirmed.signal).toMatchObject({
      direction: 'LONG',
      kind: 'support_reaction',
      zone: { top: frozenTop },
      timestamp: confirmationCandle.timestamp,
      close: confirmationCandle.close,
      confirmation: {
        setupId: `support_reaction:${candles[5].timestamp}`,
        candidateTimestamp: candidateCandle.timestamp,
        confirmationTimestamp: confirmationCandle.timestamp,
        confirmationAge: 1,
        mode: 'support_retest_hold',
        boundary: frozenTop,
        candidateClose: candidateCandle.close,
        confirmationClose: confirmationCandle.close,
        held: true,
      },
    });
    expect(confirmed.signalSwingPoints).toEqual(candidateSwingPoints);
    expect(confirmed.signalSwingPoints).not.toBe(confirmed.swingPoints);
    expect(confirmed.pendingConfirmation).toBeNull();
  });

  it('confirms a resistance failed reclaim for SHORT', () => {
    const engine = createStructureZonesEngine({
      config: makeConfig({
        STRUCTURE_ZONES_PENDING_CONFIRMATION_MAX_BARS: 3,
      }),
    });
    const candles = [
      makeCandle(0, 100, 102, 98, 100),
      makeCandle(1, 101, 104, 99, 102),
      makeCandle(2, 102, 110, 100, 108),
      makeCandle(3, 108, 106, 101, 103),
      makeCandle(4, 103, 105, 96, 99),
      makeCandle(5, 99, 104, 94, 96),
      makeCandle(6, 96, 103, 95, 101),
      makeCandle(7, 101, 105, 97, 103),
    ].map(mirrorCandle);
    candles.forEach((candle) => engine.next(candle as any));
    const candidateCandle = mirrorCandle(makeCandle(8, 95, 98, 94.5, 97));
    const candidate = engine.next(candidateCandle as any);
    const frozenBottom = Number(
      candidate.pendingConfirmation?.signal.zone.bottom,
    );

    expect(candidate.signal).toBeNull();
    expect(candidate.pendingConfirmation).toMatchObject({
      setupId: `resistance_reaction:${candles[5].timestamp}`,
      signal: {
        direction: 'SHORT',
        kind: 'resistance_reaction',
      },
    });

    const confirmationCandle = makeCandle(
      9,
      frozenBottom - 0.4,
      frozenBottom + 0.2,
      frozenBottom - 1,
      frozenBottom - 0.5,
    );
    const confirmed = engine.next(confirmationCandle as any);

    expect(confirmed.signal).toMatchObject({
      direction: 'SHORT',
      kind: 'resistance_reaction',
      zone: { bottom: frozenBottom },
      confirmation: {
        confirmationAge: 1,
        mode: 'resistance_failed_reclaim',
        boundary: frozenBottom,
        held: true,
      },
    });
  });

  it('rebuilds an armed candidate through initialCandles and confirms without a current raw reaction', () => {
    const config = makeConfig({
      STRUCTURE_ZONES_PENDING_CONFIRMATION_MAX_BARS: 3,
    });
    const history = [
      makeCandle(0, 100, 102, 98, 100),
      makeCandle(1, 101, 104, 99, 102),
      makeCandle(2, 102, 110, 100, 108),
      makeCandle(3, 108, 106, 101, 103),
      makeCandle(4, 103, 105, 96, 99),
      makeCandle(5, 99, 104, 94, 96),
      makeCandle(6, 96, 103, 95, 101),
      makeCandle(7, 101, 105, 97, 103),
      makeCandle(8, 95, 98, 94.5, 97),
    ];
    const continuous = createStructureZonesEngine({ config });
    history.forEach((candle) => continuous.next(candle as any));
    const frozenTop = Number(
      continuous.getState().pendingConfirmation?.signal.zone.top,
    );
    const confirmation = makeCandle(
      9,
      frozenTop + 0.4,
      frozenTop + 1,
      frozenTop - 0.2,
      frozenTop + 0.5,
    );
    const expected = continuous.next(confirmation as any);
    const restored = createStructureZonesEngine({
      config,
      initialCandles: history as any,
    });
    const actual = restored.next(confirmation as any);
    const control = createStructureZonesEngine({
      config: makeConfig({
        STRUCTURE_ZONES_PENDING_CONFIRMATION_MAX_BARS: 0,
      }),
      initialCandles: history as any,
    });

    expect(actual).toEqual(expected);
    expect(actual.signal?.confirmation?.confirmationAge).toBe(1);
    expect(control.next(confirmation as any).signal).toBeNull();
  });

  it('expires an untouched pending reaction at the configured bar limit', () => {
    const engine = createStructureZonesEngine({
      config: makeConfig({
        STRUCTURE_ZONES_PENDING_CONFIRMATION_MAX_BARS: 1,
      }),
    });
    const candles = [
      makeCandle(0, 100, 102, 98, 100),
      makeCandle(1, 101, 104, 99, 102),
      makeCandle(2, 102, 110, 100, 108),
      makeCandle(3, 108, 106, 101, 103),
      makeCandle(4, 103, 105, 96, 99),
      makeCandle(5, 99, 104, 94, 96),
      makeCandle(6, 96, 103, 95, 101),
      makeCandle(7, 101, 105, 97, 103),
    ];
    candles.forEach((candle) => engine.next(candle as any));
    const candidate = engine.next(makeCandle(8, 95, 98, 94.5, 97) as any);
    const frozenTop = Number(candidate.pendingConfirmation?.signal.zone.top);

    const expired = engine.next(
      makeCandle(
        9,
        frozenTop + 1,
        frozenTop + 2,
        frozenTop + 0.5,
        frozenTop + 1,
      ),
    );

    expect(expired.signal).toBeNull();
    expect(expired.pendingConfirmation).toBeNull();
  });

  it('cancels a failed support hold without replacing the consumed setup', () => {
    const engine = createStructureZonesEngine({
      config: makeConfig({
        STRUCTURE_ZONES_PENDING_CONFIRMATION_MAX_BARS: 3,
      }),
    });
    const candles = [
      makeCandle(0, 100, 102, 98, 100),
      makeCandle(1, 101, 104, 99, 102),
      makeCandle(2, 102, 110, 100, 108),
      makeCandle(3, 108, 106, 101, 103),
      makeCandle(4, 103, 105, 96, 99),
      makeCandle(5, 99, 104, 94, 96),
      makeCandle(6, 96, 103, 95, 101),
      makeCandle(7, 101, 105, 97, 103),
    ];
    candles.forEach((candle) => engine.next(candle as any));
    const candidate = engine.next(makeCandle(8, 95, 98, 94.5, 97) as any);
    const frozenTop = Number(candidate.pendingConfirmation?.signal.zone.top);

    const failed = engine.next(
      makeCandle(
        9,
        frozenTop + 0.2,
        frozenTop + 0.5,
        frozenTop - 0.3,
        frozenTop - 0.1,
      ) as any,
    );
    const laterHold = engine.next(
      makeCandle(
        10,
        frozenTop + 0.2,
        frozenTop + 1,
        frozenTop - 0.2,
        frozenTop + 0.5,
      ) as any,
    );

    expect(failed.signal).toBeNull();
    expect(failed.pendingConfirmation).toBeNull();
    expect(laterHold.signal).toBeNull();
    expect(laterHold.pendingConfirmation).toBeNull();
  });

  it('cancels when price closes beyond the frozen stop-side zone boundary', () => {
    const engine = createStructureZonesEngine({
      config: makeConfig({
        STRUCTURE_ZONES_PENDING_CONFIRMATION_MAX_BARS: 3,
      }),
    });
    const candles = [
      makeCandle(0, 100, 102, 98, 100),
      makeCandle(1, 101, 104, 99, 102),
      makeCandle(2, 102, 110, 100, 108),
      makeCandle(3, 108, 106, 101, 103),
      makeCandle(4, 103, 105, 96, 99),
      makeCandle(5, 99, 104, 94, 96),
      makeCandle(6, 96, 103, 95, 101),
      makeCandle(7, 101, 105, 97, 103),
    ];
    candles.forEach((candle) => engine.next(candle as any));
    const candidate = engine.next(makeCandle(8, 95, 98, 94.5, 97) as any);
    const frozenBottom = Number(
      candidate.pendingConfirmation?.signal.zone.bottom,
    );

    const invalidated = engine.next(
      makeCandle(
        9,
        frozenBottom - 0.2,
        frozenBottom - 0.1,
        frozenBottom - 1,
        frozenBottom - 0.5,
      ) as any,
    );

    expect(invalidated.signal).toBeNull();
    expect(invalidated.pendingConfirmation).toBeNull();
  });

  it('does not confirm against a frozen zone after its source pivot changes', () => {
    const engine = createStructureZonesEngine({
      config: makeConfig({
        STRUCTURE_ZONES_PENDING_CONFIRMATION_MAX_BARS: 3,
      }),
    });
    const candles = [
      makeCandle(0, 100, 102, 98, 100),
      makeCandle(1, 101, 104, 99, 102),
      makeCandle(2, 102, 110, 100, 108),
      makeCandle(3, 108, 106, 101, 103),
      makeCandle(4, 103, 105, 96, 99),
      makeCandle(5, 99, 104, 94, 96),
      makeCandle(6, 96, 103, 95, 101),
      makeCandle(7, 101, 105, 97, 103),
    ];
    candles.forEach((candle) => engine.next(candle as any));
    const candidate = engine.next(makeCandle(8, 95, 98, 94.5, 97) as any);
    const frozenTop = Number(candidate.pendingConfirmation?.signal.zone.top);
    engine.next(
      makeCandle(
        9,
        frozenTop + 1,
        frozenTop + 2,
        frozenTop + 0.5,
        frozenTop + 1,
      ) as any,
    );

    const changedZone = engine.next(
      makeCandle(
        10,
        frozenTop + 0.3,
        frozenTop + 1,
        frozenTop - 0.1,
        frozenTop + 0.4,
      ) as any,
    );

    expect(changedZone.snapshot?.supportZone?.sourcePivotTimestamp).toBe(
      candidate.pendingConfirmation?.candidateTimestamp,
    );
    expect(changedZone.signal).toBeNull();
    expect(changedZone.pendingConfirmation).toBeNull();
  });

  it('counts distinct touch episodes and can keep only the first touch', () => {
    const candles = [
      makeCandle(0, 100, 102, 98, 100),
      makeCandle(1, 101, 104, 99, 102),
      makeCandle(2, 102, 110, 100, 108),
      makeCandle(3, 108, 106, 101, 103),
      makeCandle(4, 103, 105, 96, 99),
      makeCandle(5, 99, 104, 94, 96),
      makeCandle(6, 96, 103, 94.8, 101),
      makeCandle(7, 101, 105, 97, 103),
      makeCandle(8, 97, 98, 95.4, 95),
      makeCandle(9, 100, 104, 99, 102),
    ];
    const firstTouchOnly = createStructureZonesEngine({
      config: makeConfig({ STRUCTURE_ZONES_MAX_TOUCH_ORDINAL: 1 }),
      initialCandles: candles as any,
    });
    const firstTwoTouches = createStructureZonesEngine({
      config: makeConfig({ STRUCTURE_ZONES_MAX_TOUCH_ORDINAL: 2 }),
      initialCandles: candles as any,
    });
    const secondTouch = makeCandle(10, 95, 98, 95.4, 97) as any;

    expect(firstTouchOnly.next(secondTouch).signal).toBeNull();
    expect(firstTwoTouches.next(secondTouch).signal).toMatchObject({
      kind: 'support_reaction',
      touchOrdinal: 2,
    });
  });
});
