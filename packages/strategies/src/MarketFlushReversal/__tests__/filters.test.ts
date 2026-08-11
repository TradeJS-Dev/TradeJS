/** @jest-environment node */

import { config as DEFAULT_CONFIG } from '../config';
import { getMarketFlushReversalEntryFilterSkipCode } from '../filters';

const makeEntrySignal = (
  direction: 'LONG' | 'SHORT',
  priceImprovementAtr: number,
) => ({ direction, priceImprovementAtr }) as any;

describe('getMarketFlushReversalEntryFilterSkipCode', () => {
  it('requires a strong entry body for long confirmations', () => {
    expect(
      getMarketFlushReversalEntryFilterSkipCode({
        config: DEFAULT_CONFIG as any,
        entrySignal: makeEntrySignal('LONG', -0.5),
        baseContext: {
          regime: { momentum: { bodyStrength: 0.49 } },
        } as any,
      }),
    ).toBe('MFR_ENTRY_BODY_TOO_WEAK');
  });

  it('requires at least one ATR of follow-through for short confirmations', () => {
    expect(
      getMarketFlushReversalEntryFilterSkipCode({
        config: DEFAULT_CONFIG as any,
        entrySignal: makeEntrySignal('SHORT', -0.99),
      }),
    ).toBe('MFR_CONFIRMATION_DISPLACEMENT_TOO_SMALL');
    expect(
      getMarketFlushReversalEntryFilterSkipCode({
        config: DEFAULT_CONFIG as any,
        entrySignal: makeEntrySignal('SHORT', -1),
      }),
    ).toBeNull();
  });

  it('applies a causal average-turnover floor by direction', () => {
    expect(
      getMarketFlushReversalEntryFilterSkipCode({
        config: {
          ...DEFAULT_CONFIG,
          MFR_MIN_ENTRY_BODY_STRENGTH_LONG: 0,
          MFR_MIN_AVG_TURNOVER_20_LONG: 100_000,
        } as any,
        entrySignal: makeEntrySignal('LONG', -0.5),
        baseContext: {
          candle: { turnover: 50_000 },
          participation: { volume: { turnoverRel20: 1 } },
        } as any,
      }),
    ).toBe('MFR_AVERAGE_TURNOVER_TOO_LOW');
  });
});
