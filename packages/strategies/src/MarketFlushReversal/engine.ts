import type { Candle, Direction } from '@tradejs/types';

import type {
  MarketFlushReversalConfig,
  MarketFlushReversalEntryMode,
} from './config';
import type { MarketFlushReversalSignalContext } from './core';
import { resolveDirectionalConfigNumber } from '../shared/directionalConfig';

export interface MarketFlushReversalEntryCandidate {
  direction: Direction;
  setupTimestamp: number;
  setupPrice: number;
  referencePrice: number;
  atr: number;
  stopLossPrice: number;
  setupSweepExtremePrice?: number | null;
  setupStopAnchorPrice?: number | null;
  context: MarketFlushReversalSignalContext;
}

export interface MarketFlushReversalPendingEntry
  extends MarketFlushReversalEntryCandidate {
  ageBars: number;
}

export interface MarketFlushReversalEntrySignal
  extends MarketFlushReversalEntryCandidate {
  entryMode: MarketFlushReversalEntryMode;
  entryTimestamp: number;
  entryDelayBars: number;
  priceImprovementAtr: number | null;
}

export interface MarketFlushReversalEntryEvent {
  candle: Candle;
  candidate: MarketFlushReversalEntryCandidate | null;
}

export interface MarketFlushReversalEntryEngineState {
  pending: MarketFlushReversalPendingEntry | null;
  signal: MarketFlushReversalEntrySignal | null;
  timestamp: number | null;
}

const cloneCandidate = <T extends MarketFlushReversalEntryCandidate>(
  candidate: T,
): T => ({
  ...candidate,
  context: {
    ...candidate.context,
    marketRiskFlags: [...candidate.context.marketRiskFlags],
  },
});

const cloneState = (
  state: MarketFlushReversalEntryEngineState,
): MarketFlushReversalEntryEngineState => ({
  pending: state.pending == null ? null : cloneCandidate(state.pending),
  signal: state.signal == null ? null : cloneCandidate(state.signal),
  timestamp: state.timestamp,
});

const getOptions = (config: MarketFlushReversalConfig) => ({
  entryMode: config.MFR_ENTRY_MODE ?? 'immediate',
  confirmationBarsLong: Math.max(
    1,
    Math.floor(
      resolveDirectionalConfigNumber({
        config,
        key: 'MFR_CONFIRMATION_BARS',
        direction: 'LONG',
        fallback: 1,
      }),
    ),
  ),
  confirmationBarsShort: Math.max(
    1,
    Math.floor(
      resolveDirectionalConfigNumber({
        config,
        key: 'MFR_CONFIRMATION_BARS',
        direction: 'SHORT',
        fallback: 1,
      }),
    ),
  ),
  pendingMaxBars: Math.max(
    1,
    Math.floor(Number(config.MFR_PENDING_MAX_BARS ?? 4)),
  ),
  requireDirectionalBody: Boolean(
    config.MFR_REQUIRE_DIRECTIONAL_CONFIRMATION_BODY ?? true,
  ),
});

const isFinitePrice = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const isInvalidated = ({
  pending,
  candle,
}: {
  pending: MarketFlushReversalPendingEntry;
  candle: Candle;
}) =>
  pending.direction === 'LONG'
    ? Number(candle.low) <= pending.stopLossPrice
    : Number(candle.high) >= pending.stopLossPrice;

const isDirectionalBody = (direction: Direction, candle: Candle) =>
  direction === 'LONG'
    ? Number(candle.close) > Number(candle.open)
    : Number(candle.close) < Number(candle.open);

const isFollowThrough = (
  pending: MarketFlushReversalPendingEntry,
  candle: Candle,
) =>
  pending.direction === 'LONG'
    ? Number(candle.close) >= pending.setupPrice
    : Number(candle.close) <= pending.setupPrice;

const buildSignal = ({
  pending,
  candle,
  entryMode,
}: {
  pending: MarketFlushReversalPendingEntry;
  candle: Candle;
  entryMode: MarketFlushReversalEntryMode;
}): MarketFlushReversalEntrySignal => ({
  ...cloneCandidate(pending),
  entryMode,
  entryTimestamp: candle.timestamp,
  entryDelayBars: pending.ageBars,
  priceImprovementAtr:
    pending.direction === 'LONG'
      ? (pending.setupPrice - Number(candle.close)) / pending.atr
      : (Number(candle.close) - pending.setupPrice) / pending.atr,
});

export const createMarketFlushReversalEntryEngine = ({
  config,
  initialEvents = [],
}: {
  config: MarketFlushReversalConfig;
  initialEvents?: MarketFlushReversalEntryEvent[];
}) => {
  const options = getOptions(config);
  const state: MarketFlushReversalEntryEngineState = {
    pending: null,
    signal: null,
    timestamp: null,
  };

  const apply = ({ candle, candidate }: MarketFlushReversalEntryEvent) => {
    if (state.timestamp === candle.timestamp) return cloneState(state);
    state.timestamp = candle.timestamp;
    state.signal = null;

    if (options.entryMode === 'immediate') {
      state.pending = null;
      if (candidate) {
        state.signal = {
          ...cloneCandidate(candidate),
          entryMode: 'immediate',
          entryTimestamp: candle.timestamp,
          entryDelayBars: 0,
          priceImprovementAtr: 0,
        };
      }
      return cloneState(state);
    }

    if (state.pending) {
      state.pending.ageBars += 1;
      const pending = state.pending;
      const expired = pending.ageBars > options.pendingMaxBars;
      const bodyAccepted =
        !options.requireDirectionalBody ||
        isDirectionalBody(pending.direction, candle);
      const invalidated = isInvalidated({ pending, candle });
      const confirmationBars =
        pending.direction === 'LONG'
          ? options.confirmationBarsLong
          : options.confirmationBarsShort;
      const confirmed =
        pending.ageBars >= confirmationBars &&
        bodyAccepted &&
        isFollowThrough(pending, candle);

      if (invalidated || expired) {
        state.pending = null;
      } else if (confirmed) {
        state.signal = buildSignal({
          pending,
          candle,
          entryMode: options.entryMode,
        });
        state.pending = null;
      }
    }

    if (
      state.pending == null &&
      state.signal == null &&
      candidate &&
      isFinitePrice(candidate.setupPrice) &&
      isFinitePrice(candidate.referencePrice) &&
      isFinitePrice(candidate.atr) &&
      isFinitePrice(candidate.stopLossPrice)
    ) {
      state.pending = {
        ...cloneCandidate(candidate),
        ageBars: 0,
      };
    }

    return cloneState(state);
  };

  for (const event of initialEvents) apply(event);

  return {
    next: apply,
    getState: () => cloneState(state),
  };
};
