/** @jest-environment node */

import type { BaseStrategyContextSnapshot } from '@tradejs/types';
import { config as DEFAULT_CONFIG } from '../config';
import { detectVolatilityCompressionBreakoutSignal } from '../core';

const makeBaseContext = () =>
  ({
    candle: {
      timestamp: 1_700_000_000_000,
      open: 103,
      high: 106,
      low: 102,
      close: 105,
      volume: 1_000,
      turnover: 105_000,
    },
    raw: {
      levels: { highLevel: 104 },
      volatility: { atr: 2 },
    },
    regime: {
      volatility: {
        state: 'compressed',
        percentiles: {
          atrPctRank100: 20,
          bbWidthRank100: 20,
          rangeExpansionRank20: 80,
        },
      },
    },
    structure: {
      localRange: { breakoutState: 'above_high_level' },
      acceptance: { breakoutBodyAtr: 1, closesAboveHighLevel3: 1 },
    },
    participation: { volume: { volumeRel20: 2 } },
  }) as unknown as BaseStrategyContextSnapshot;

describe('VolatilityCompressionBreakout core detector', () => {
  it('rejects an entry stretched too far beyond the breakout level', () => {
    const baseContext = makeBaseContext();
    const accepted = detectVolatilityCompressionBreakoutSignal({
      baseContext,
      config: {
        ...DEFAULT_CONFIG,
        VCB_MAX_BREAKOUT_DISTANCE_ATR: 0.5,
      } as any,
    });
    const rejected = detectVolatilityCompressionBreakoutSignal({
      baseContext,
      config: {
        ...DEFAULT_CONFIG,
        VCB_MAX_BREAKOUT_DISTANCE_ATR: 0.49,
      } as any,
    });

    expect(accepted?.signalDirection).toBe('LONG');
    expect(accepted?.breakoutLevel).toBe(104);
    expect(accepted?.breakoutDistanceAtr).toBeCloseTo(0.5);
    expect(rejected).toBeNull();
  });
});
