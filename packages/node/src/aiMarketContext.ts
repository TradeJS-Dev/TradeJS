import type { Signal } from '@tradejs/types';

type SpreadBias = 'coinbase_premium' | 'binance_premium' | 'flat';
type SpreadSeverity = 'normal' | 'elevated' | 'wide';

type BinanceCoinbaseSpreadContext = {
  source: 'payload.additionalIndicators.baseContext.relative.execution.venueSpread';
  indicatorKey: 'payload.additionalIndicators.baseContext.relative.execution.venueSpread';
  available: boolean;
  value: number | null;
  zScore: number | null;
  bps: number | null;
  absBps: number | null;
  bias: SpreadBias | null;
  severity: SpreadSeverity | null;
};

export type AiMarketContext = {
  execution: {
    binanceCoinbaseSpread: BinanceCoinbaseSpreadContext;
    targetVenue: {
      source: string | null;
      available: boolean;
      symbol: string | null;
      bid: number | null;
      ask: number | null;
      mid: number | null;
      spreadBps: number | null;
      topBidQty: number | null;
      topAskQty: number | null;
      stale: boolean | null;
    };
  };
  participation: {
    trueDelta: {
      source: string | null;
      available: boolean;
      buyPressurePct: number | null;
      buyVolume: number | null;
      sellVolume: number | null;
      netDelta: number | null;
      deltaPct: number | null;
      signedVolumeZScore: number | null;
    };
  };
};

const toRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
};

const toFiniteNumber = (value: unknown): number | null => {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : Number.NaN;

  return Number.isFinite(numeric) ? numeric : null;
};

const roundTo = (value: number, decimals: number) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const buildMissingSpreadContext = (): BinanceCoinbaseSpreadContext => ({
  source:
    'payload.additionalIndicators.baseContext.relative.execution.venueSpread',
  indicatorKey:
    'payload.additionalIndicators.baseContext.relative.execution.venueSpread',
  available: false,
  value: null,
  zScore: null,
  bps: null,
  absBps: null,
  bias: null,
  severity: null,
});

const buildSpreadContextFromSignal = (
  signal: Signal,
): BinanceCoinbaseSpreadContext => {
  const baseContext = toRecord(signal.additionalIndicators?.baseContext);
  const relative = toRecord(baseContext?.relative);
  const execution = toRecord(relative?.execution);
  const spread = toFiniteNumber(execution?.venueSpread);
  const zScore = toFiniteNumber(execution?.venueSpreadZScore);

  if (spread == null) {
    return buildMissingSpreadContext();
  }

  const value = roundTo(spread, 8);
  const bps = roundTo(value * 10_000, 2);
  const absBps = Math.abs(bps);
  const bias: SpreadBias =
    absBps < 1 ? 'flat' : bps > 0 ? 'coinbase_premium' : 'binance_premium';
  const severity: SpreadSeverity =
    absBps >= 20 ? 'wide' : absBps >= 5 ? 'elevated' : 'normal';

  return {
    source:
      'payload.additionalIndicators.baseContext.relative.execution.venueSpread',
    indicatorKey:
      'payload.additionalIndicators.baseContext.relative.execution.venueSpread',
    available: true,
    value,
    zScore,
    bps,
    absBps,
    bias,
    severity,
  };
};

const buildTargetVenueContextFromSignal = (signal: Signal) => {
  const baseContext = toRecord(signal.additionalIndicators?.baseContext);
  const relative = toRecord(baseContext?.relative);
  const execution = toRecord(relative?.execution);
  const targetVenue = toRecord(execution?.targetVenue);
  const bid = toFiniteNumber(targetVenue?.bid);
  const ask = toFiniteNumber(targetVenue?.ask);

  if (!targetVenue || (bid == null && ask == null)) {
    return {
      source: null,
      available: false,
      symbol: null,
      bid: null,
      ask: null,
      mid: null,
      spreadBps: null,
      topBidQty: null,
      topAskQty: null,
      stale: null,
    };
  }

  return {
    source: String(targetVenue.source ?? ''),
    available: true,
    symbol: String(targetVenue.symbol ?? signal.symbol),
    bid,
    ask,
    mid: toFiniteNumber(targetVenue.mid),
    spreadBps: toFiniteNumber(targetVenue.spreadBps),
    topBidQty: toFiniteNumber(targetVenue.topBidQty),
    topAskQty: toFiniteNumber(targetVenue.topAskQty),
    stale: typeof targetVenue.stale === 'boolean' ? targetVenue.stale : null,
  };
};

const buildTrueDeltaContextFromSignal = (signal: Signal) => {
  const baseContext = toRecord(signal.additionalIndicators?.baseContext);
  const participation = toRecord(baseContext?.participation);
  const delta = toRecord(participation?.delta);
  const source = String(delta?.source ?? '');
  const isTrueDeltaSource =
    source === 'kline_taker_volume' ||
    source === 'agg_trades' ||
    source === 'trades';

  if (!delta || !isTrueDeltaSource) {
    return {
      source: source || null,
      available: false,
      buyPressurePct: null,
      buyVolume: null,
      sellVolume: null,
      netDelta: null,
      deltaPct: null,
      signedVolumeZScore: null,
    };
  }

  return {
    source,
    available: true,
    buyPressurePct: toFiniteNumber(delta.buyPressurePct),
    buyVolume: toFiniteNumber(delta.buyVolume),
    sellVolume: toFiniteNumber(delta.sellVolume),
    netDelta: toFiniteNumber(delta.netDelta),
    deltaPct: toFiniteNumber(delta.deltaPct),
    signedVolumeZScore: toFiniteNumber(delta.signedVolumeZScore),
  };
};

export const buildAiMarketContext = (signal: Signal): AiMarketContext => ({
  execution: {
    binanceCoinbaseSpread: buildSpreadContextFromSignal(signal),
    targetVenue: buildTargetVenueContextFromSignal(signal),
  },
  participation: {
    trueDelta: buildTrueDeltaContextFromSignal(signal),
  },
});
