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
