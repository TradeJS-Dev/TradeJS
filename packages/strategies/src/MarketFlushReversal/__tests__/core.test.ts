/** @jest-environment node */

import type { BaseStrategyContextSnapshot } from '@tradejs/types';
import { config as DEFAULT_CONFIG } from '../config';
import { detectMarketFlushReversalSignal } from '../core';

const makeBaseContext = () =>
  ({
    candle: {
      timestamp: 1_700_000_000_000,
      open: 100,
      high: 110,
      low: 90,
      close: 108,
      volume: 1_000,
      turnover: 108_000,
    },
    raw: { volatility: { atr: 10 } },
    structure: {
      localRange: {
        rangePosition20: 0.1,
        breakoutState: 'failed_low_breakout',
      },
      liquidity: { sweepState: 'swept_low', sweepWickPct: 0.4 },
    },
    participation: {
      volume: { volumeRel20: 2 },
      delta: { buyPressurePct: 0.65, deltaDivergenceVsPrice: 'bullish' },
    },
  }) as unknown as BaseStrategyContextSnapshot;

describe('MarketFlushReversal core detector', () => {
  it('requires an ATR-normalized rejection body when configured', () => {
    const baseContext = makeBaseContext();
    const accepted = detectMarketFlushReversalSignal({
      baseContext,
      config: {
        ...DEFAULT_CONFIG,
        MFR_MIN_REJECTION_BODY_ATR: 0.7,
      } as any,
    });
    const rejected = detectMarketFlushReversalSignal({
      baseContext,
      config: {
        ...DEFAULT_CONFIG,
        MFR_MIN_REJECTION_BODY_ATR: 0.81,
      } as any,
    });

    expect(accepted?.signalDirection).toBe('LONG');
    expect(accepted?.rejectionBodyAtr).toBeCloseTo(0.8);
    expect(rejected).toBeNull();
  });
});
