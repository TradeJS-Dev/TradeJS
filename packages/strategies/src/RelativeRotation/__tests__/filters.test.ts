/** @jest-environment node */

import { config as DEFAULT_CONFIG } from '../config';
import { getRelativeRotationCoreFilterSkipCode } from '../filters';

const makeConfig = (overrides: Record<string, unknown> = {}) =>
  ({ ...DEFAULT_CONFIG, ...overrides }) as any;

const makeSignal = (
  direction: 'LONG' | 'SHORT',
  correlation = 0.8,
  volumeRel20: number | null = 1,
) =>
  ({
    signalDirection: direction,
    targetVsBtcCorrelation20: correlation,
    volumeRel20,
  }) as any;

const makeBaseContext = ({
  diMinus = 25,
  atrRank = 50,
}: {
  diMinus?: number;
  atrRank?: number;
} = {}) =>
  ({
    regime: {
      trend: { adx: { diMinus } },
      volatility: { percentiles: { atrPctRank100: atrRank } },
    },
  }) as any;

describe('getRelativeRotationCoreFilterSkipCode', () => {
  it('requires a correlated, mature pullback for longs', () => {
    expect(
      getRelativeRotationCoreFilterSkipCode({
        signal: makeSignal('LONG'),
        config: makeConfig(),
        baseContext: makeBaseContext({ diMinus: 19 }),
      }),
    ).toBe('RR_PULLBACK_NOT_MATURE');

    expect(
      getRelativeRotationCoreFilterSkipCode({
        signal: makeSignal('LONG', 0.59),
        config: makeConfig(),
        baseContext: makeBaseContext(),
      }),
    ).toBe('RR_TARGET_BTC_CORRELATION_TOO_LOW');
  });

  it('rejects only extreme volatility on the short side', () => {
    expect(
      getRelativeRotationCoreFilterSkipCode({
        signal: makeSignal('SHORT'),
        config: makeConfig(),
        baseContext: makeBaseContext({ atrRank: 81 }),
      }),
    ).toBe('RR_VOLATILITY_RANK_TOO_HIGH');

    expect(
      getRelativeRotationCoreFilterSkipCode({
        signal: makeSignal('SHORT'),
        config: makeConfig(),
        baseContext: makeBaseContext({ atrRank: 80 }),
      }),
    ).toBeNull();
  });

  it('applies directional volume-climax limits independently', () => {
    const config = makeConfig({
      RR_MAX_VOLUME_REL20_LONG: 1.5,
      RR_MAX_VOLUME_REL20_SHORT: 2.5,
    });

    expect(
      getRelativeRotationCoreFilterSkipCode({
        signal: makeSignal('LONG', 0.8, 1.51),
        config,
        baseContext: makeBaseContext(),
      }),
    ).toBe('RR_VOLUME_CLIMAX');

    expect(
      getRelativeRotationCoreFilterSkipCode({
        signal: makeSignal('SHORT', 0.8, 2.51),
        config,
        baseContext: makeBaseContext(),
      }),
    ).toBe('RR_VOLUME_CLIMAX');

    expect(
      getRelativeRotationCoreFilterSkipCode({
        signal: makeSignal('SHORT', 0.8, 2),
        config,
        baseContext: makeBaseContext(),
      }),
    ).toBeNull();
  });

  it('allows a volume ratio exactly at the directional limit', () => {
    expect(
      getRelativeRotationCoreFilterSkipCode({
        signal: makeSignal('LONG', 0.8, 1.5),
        config: makeConfig({ RR_MAX_VOLUME_REL20_LONG: 1.5 }),
        baseContext: makeBaseContext(),
      }),
    ).toBeNull();
  });

  it('keeps the volume-climax filter disabled at zero', () => {
    expect(
      getRelativeRotationCoreFilterSkipCode({
        signal: makeSignal('LONG', 0.8, 100),
        config: makeConfig(),
        baseContext: makeBaseContext(),
      }),
    ).toBeNull();
  });

  it('does not reject unavailable volume data', () => {
    expect(
      getRelativeRotationCoreFilterSkipCode({
        signal: makeSignal('LONG', 0.8, null),
        config: makeConfig({ RR_MAX_VOLUME_REL20_LONG: 1.5 }),
        baseContext: makeBaseContext(),
      }),
    ).toBeNull();
  });
});
