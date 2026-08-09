/** @jest-environment node */

import type { Candle } from '@tradejs/types';

import { config as DEFAULT_CONFIG } from '../config';
import {
  createMarketFlushReversalEntryEngine,
  MarketFlushReversalEntryCandidate,
  MarketFlushReversalEntryEvent,
} from '../engine';

const makeCandle = ({
  index,
  open,
  high,
  low,
  close,
}: {
  index: number;
  open: number;
  high: number;
  low: number;
  close: number;
}): Candle => ({
  timestamp: 1_700_000_000_000 + index * 60_000,
  open,
  high,
  low,
  close,
  volume: 1_000,
  turnover: close * 1_000,
});

const context = {
  signalDirection: 'SHORT',
  marketPressure: null,
  marketRiskFlags: [],
  marketLiqSpikeRatio: null,
  marketLiqImbalance: null,
  marketFundingZScore: null,
  marketPriceOiDivergenceType: null,
  marketFlushConfirmed: false,
  minMarketLiqSpikeRatio: 1,
  rejectionClosePosition: 0.8,
  rejectionBodyAtr: 0.8,
  rejectionConfirmed: true,
  sweepState: 'swept_high',
  breakoutState: 'failed_high_breakout',
  tailSide: 'upper',
  rangePosition20: 0.9,
  sweepWickPct: 0.4,
  volumeRel20: 2,
  buyPressurePct: 0.2,
  deltaDivergenceVsPrice: 'bearish',
  structureConfirmed: true,
  participationConfirmed: true,
} as const;

const candidate: MarketFlushReversalEntryCandidate = {
  direction: 'SHORT',
  setupTimestamp: 1_700_000_000_000,
  setupPrice: 100,
  referencePrice: 102,
  atr: 2,
  stopLossPrice: 106,
  context: context as any,
};

const event = (
  candle: Candle,
  entryCandidate: MarketFlushReversalEntryCandidate | null = null,
): MarketFlushReversalEntryEvent => ({
  candle,
  candidate: entryCandidate,
});

describe('MarketFlushReversal entry engine', () => {
  it('keeps immediate entry behavior on the setup candle', () => {
    const engine = createMarketFlushReversalEntryEngine({
      config: { ...DEFAULT_CONFIG, MFR_ENTRY_MODE: 'immediate' } as any,
    });
    const candle = makeCandle({
      index: 0,
      open: 103,
      high: 104,
      low: 99,
      close: 100,
    });

    expect(engine.next(event(candle, candidate)).signal).toMatchObject({
      direction: 'SHORT',
      entryMode: 'immediate',
      entryDelayBars: 0,
    });
  });

  it('waits for directional follow-through and rejects an invalidated setup', () => {
    const config = {
      ...DEFAULT_CONFIG,
      MFR_ENTRY_MODE: 'confirmation',
      MFR_CONFIRMATION_BARS: 1,
      MFR_CONFIRMATION_BARS_LONG: undefined,
      MFR_CONFIRMATION_BARS_SHORT: undefined,
      MFR_PENDING_MAX_BARS: 3,
    } as any;
    const confirmed = createMarketFlushReversalEntryEngine({ config });
    const setup = makeCandle({
      index: 0,
      open: 103,
      high: 104,
      low: 99,
      close: 100,
    });
    const followThrough = makeCandle({
      index: 1,
      open: 100,
      high: 101,
      low: 96,
      close: 97,
    });

    expect(confirmed.next(event(setup, candidate)).pending).not.toBeNull();
    expect(confirmed.next(event(followThrough)).signal).toMatchObject({
      entryMode: 'confirmation',
      entryDelayBars: 1,
    });

    const invalidated = createMarketFlushReversalEntryEngine({ config });
    invalidated.next(event(setup, candidate));
    expect(
      invalidated.next(
        event(
          makeCandle({
            index: 1,
            open: 100,
            high: 107,
            low: 99,
            close: 104,
          }),
        ),
      ),
    ).toMatchObject({ pending: null, signal: null });
  });

  it('replays a pending confirmation through the same transition path', () => {
    const config = {
      ...DEFAULT_CONFIG,
      MFR_ENTRY_MODE: 'confirmation',
      MFR_CONFIRMATION_BARS: 2,
      MFR_CONFIRMATION_BARS_LONG: undefined,
      MFR_CONFIRMATION_BARS_SHORT: undefined,
      MFR_PENDING_MAX_BARS: 4,
    } as any;
    const setup = event(
      makeCandle({
        index: 0,
        open: 103,
        high: 104,
        low: 99,
        close: 100,
      }),
      candidate,
    );
    const firstPendingBar = event(
      makeCandle({
        index: 1,
        open: 100,
        high: 101,
        low: 97,
        close: 98,
      }),
    );
    const confirmation = event(
      makeCandle({
        index: 2,
        open: 99,
        high: 100,
        low: 95,
        close: 96,
      }),
    );
    const continuous = createMarketFlushReversalEntryEngine({ config });
    continuous.next(setup);
    expect(continuous.next(firstPendingBar).signal).toBeNull();
    const accepted = continuous.next(confirmation);

    expect(accepted.signal).toMatchObject({
      entryMode: 'confirmation',
      entryDelayBars: 2,
    });
    expect(continuous.next(confirmation)).toEqual(accepted);

    const restored = createMarketFlushReversalEntryEngine({
      config,
      initialEvents: [setup, firstPendingBar],
    });
    expect(restored.next(confirmation)).toEqual(accepted);
  });

  it('applies confirmation maturity independently by direction', () => {
    const config = {
      ...DEFAULT_CONFIG,
      MFR_ENTRY_MODE: 'confirmation',
      MFR_CONFIRMATION_BARS: 1,
      MFR_CONFIRMATION_BARS_LONG: 2,
      MFR_CONFIRMATION_BARS_SHORT: 1,
      MFR_PENDING_MAX_BARS: 3,
    } as any;
    const setup = makeCandle({
      index: 0,
      open: 100,
      high: 102,
      low: 98,
      close: 100,
    });
    const longCandidate = {
      ...candidate,
      direction: 'LONG' as const,
      referencePrice: 98,
      stopLossPrice: 94,
    };
    const longEngine = createMarketFlushReversalEntryEngine({ config });
    longEngine.next(event(setup, longCandidate));
    expect(
      longEngine.next(
        event(
          makeCandle({
            index: 1,
            open: 100,
            high: 103,
            low: 99,
            close: 102,
          }),
        ),
      ).signal,
    ).toBeNull();
    expect(
      longEngine.next(
        event(
          makeCandle({
            index: 2,
            open: 102,
            high: 104,
            low: 101,
            close: 103,
          }),
        ),
      ).signal,
    ).toMatchObject({ direction: 'LONG', entryDelayBars: 2 });

    const shortEngine = createMarketFlushReversalEntryEngine({ config });
    shortEngine.next(event(setup, candidate));
    expect(
      shortEngine.next(
        event(
          makeCandle({
            index: 1,
            open: 100,
            high: 101,
            low: 97,
            close: 98,
          }),
        ),
      ).signal,
    ).toMatchObject({ direction: 'SHORT', entryDelayBars: 1 });
  });
});
