/** @jest-environment node */

import { config as DEFAULT_CONFIG } from '../config';
import { getLiquidityZonesFilterSkipCode } from '../filters';

const makeConfig = (overrides: Record<string, unknown> = {}) =>
  ({ ...DEFAULT_CONFIG, ...overrides }) as any;

const makeSignal = (direction: 'LONG' | 'SHORT' = 'LONG') =>
  ({ direction, reactionCloseDistancePct: 0.25 }) as any;

describe('getLiquidityZonesFilterSkipCode', () => {
  it('keeps the default core filters permissive', () => {
    expect(
      getLiquidityZonesFilterSkipCode({
        signal: makeSignal(),
        config: makeConfig(),
      }),
    ).toBeNull();
  });

  it('can require a directional range reclaim', () => {
    const config = makeConfig({
      LIQUIDITY_ZONES_REQUIRE_RANGE_RECLAIM: true,
    });

    expect(
      getLiquidityZonesFilterSkipCode({
        signal: makeSignal('LONG'),
        config,
        baseContext: {
          structure: { localRange: { breakoutState: 'below_low_level' } },
        } as any,
      }),
    ).toBe('LIQUIDITY_ZONES_RANGE_NOT_RECLAIMED');

    expect(
      getLiquidityZonesFilterSkipCode({
        signal: makeSignal('LONG'),
        config,
        baseContext: {
          structure: { localRange: { breakoutState: 'failed_low_breakout' } },
        } as any,
      }),
    ).toBeNull();
  });

  it('can require a swept level that closed back inside the range', () => {
    expect(
      getLiquidityZonesFilterSkipCode({
        signal: makeSignal('SHORT'),
        config: makeConfig({
          LIQUIDITY_ZONES_REQUIRE_SWEEP_RECLAIM: true,
        }),
        baseContext: {
          structure: {
            liquidity: {
              sweepState: 'swept_high',
              closeBackInsideRange: true,
            },
          },
        } as any,
      }),
    ).toBeNull();
  });

  it('supports rejection-wick and volume thresholds', () => {
    const config = makeConfig({
      LIQUIDITY_ZONES_MIN_REJECTION_WICK_SCORE: 0.5,
      LIQUIDITY_ZONES_MIN_VOLUME_REL20: 1,
    });

    expect(
      getLiquidityZonesFilterSkipCode({
        signal: makeSignal(),
        config,
        baseContext: {
          structure: { candleQuality: { rejectionWickScore: 0.4 } },
          participation: { volume: { volumeRel20: 1.2 } },
        } as any,
      }),
    ).toBe('LIQUIDITY_ZONES_REJECTION_WICK_TOO_WEAK');

    expect(
      getLiquidityZonesFilterSkipCode({
        signal: makeSignal(),
        config,
        baseContext: {
          structure: { candleQuality: { rejectionWickScore: 0.6 } },
          participation: { volume: { volumeRel20: 0.8 } },
        } as any,
      }),
    ).toBe('LIQUIDITY_ZONES_VOLUME_TOO_THIN');
  });

  it('rejects extended long reactions while keeping shorts permissive', () => {
    expect(
      getLiquidityZonesFilterSkipCode({
        signal: {
          ...makeSignal('LONG'),
          reactionCloseDistancePct: 0.81,
        },
        config: makeConfig(),
      }),
    ).toBe('LIQUIDITY_ZONES_REACTION_TOO_EXTENDED');

    expect(
      getLiquidityZonesFilterSkipCode({
        signal: {
          ...makeSignal('SHORT'),
          reactionCloseDistancePct: 2,
        },
        config: makeConfig(),
      }),
    ).toBeNull();
  });
});
