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
      orderBookImbalance: number | null;
      depthLevels: unknown[] | null;
    };
    orderBookDepth: {
      source: string | null;
      available: boolean;
      symbol: string | null;
      stale: boolean | null;
      spreadBps: number | null;
      orderBookImbalance: number | null;
      depthLevels: unknown[] | null;
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
    tradeFlow: {
      source: string | null;
      available: boolean;
      interval: string | null;
      stale: boolean | null;
      trades: number | null;
      buyPressurePct: number | null;
      netBaseDelta: number | null;
      netQuoteDelta: number | null;
    };
  };
  relative: {
    marketBreadth: {
      source: string | null;
      available: boolean;
      universe: string | null;
      interval: string | null;
      stale: boolean | null;
      symbolsCount: number | null;
      advanceDeclineRatio: number | null;
      pctAboveMa20: number | null;
      pctAboveMa50: number | null;
      equalWeightedReturn: number | null;
      volumeWeightedReturn: number | null;
      dispersion: number | null;
    };
    btcDominance: {
      source: string | null;
      available: boolean;
      stale: boolean | null;
      btcDominancePct: number | null;
      btcDominanceChange24hPct: number | null;
      altLiquidityRegime:
        | 'alt_friendly'
        | 'btc_favored'
        | 'neutral'
        | 'unknown'
        | null;
      totalMarketCapUsd: number | null;
      altMarketCapUsd: number | null;
      btcToAltMarketCapRatio: number | null;
      marketCapChangePct24hUsd: number | null;
    };
    marketReferences: {
      source: string | null;
      available: boolean;
      primaryReferenceSymbol: string | null;
      referenceSymbols: string[];
      primaryTradeFlowBuyPressurePct: number | null;
      primaryTradeFlowStale: boolean | null;
      primaryOrderBookImbalance: number | null;
      primaryOrderBookStale: boolean | null;
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
      orderBookImbalance: null,
      depthLevels: null,
    };
  }

  const depthLevels = Array.isArray(targetVenue.depthLevels)
    ? targetVenue.depthLevels
    : null;
  const firstDepthLevel = toRecord(depthLevels?.[0]);

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
    orderBookImbalance: toFiniteNumber(firstDepthLevel?.imbalance),
    depthLevels,
  };
};

const buildOrderBookDepthContextFromSignal = (signal: Signal) => {
  const targetVenue = buildTargetVenueContextFromSignal(signal);
  return {
    source: targetVenue.source,
    available:
      targetVenue.available &&
      targetVenue.source === 'binance_depth_snapshot' &&
      Array.isArray(targetVenue.depthLevels),
    symbol: targetVenue.symbol,
    stale: targetVenue.stale,
    spreadBps: targetVenue.spreadBps,
    orderBookImbalance: targetVenue.orderBookImbalance,
    depthLevels: targetVenue.depthLevels,
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

const buildTradeFlowContextFromSignal = (signal: Signal) => {
  const baseContext = toRecord(signal.additionalIndicators?.baseContext);
  const participation = toRecord(baseContext?.participation);
  const tradeFlow = toRecord(participation?.tradeFlow);

  if (!tradeFlow) {
    return {
      source: null,
      available: false,
      interval: null,
      stale: null,
      trades: null,
      buyPressurePct: null,
      netBaseDelta: null,
      netQuoteDelta: null,
    };
  }

  return {
    source: String(tradeFlow.source ?? ''),
    available: true,
    interval: String(tradeFlow.interval ?? ''),
    stale: typeof tradeFlow.stale === 'boolean' ? tradeFlow.stale : null,
    trades: toFiniteNumber(tradeFlow.trades),
    buyPressurePct: toFiniteNumber(tradeFlow.buyPressurePct),
    netBaseDelta: toFiniteNumber(tradeFlow.netBaseDelta),
    netQuoteDelta: toFiniteNumber(tradeFlow.netQuoteDelta),
  };
};

const buildMarketBreadthContextFromSignal = (signal: Signal) => {
  const baseContext = toRecord(signal.additionalIndicators?.baseContext);
  const relative = toRecord(baseContext?.relative);
  const breadth = toRecord(relative?.marketBreadth);

  if (!breadth) {
    return {
      source: null,
      available: false,
      universe: null,
      interval: null,
      stale: null,
      symbolsCount: null,
      advanceDeclineRatio: null,
      pctAboveMa20: null,
      pctAboveMa50: null,
      equalWeightedReturn: null,
      volumeWeightedReturn: null,
      dispersion: null,
    };
  }

  return {
    source: String(breadth.source ?? ''),
    available: true,
    universe: String(breadth.universe ?? ''),
    interval: String(breadth.interval ?? ''),
    stale: typeof breadth.stale === 'boolean' ? breadth.stale : null,
    symbolsCount: toFiniteNumber(breadth.symbolsCount),
    advanceDeclineRatio: toFiniteNumber(breadth.advanceDeclineRatio),
    pctAboveMa20: toFiniteNumber(breadth.pctAboveMa20),
    pctAboveMa50: toFiniteNumber(breadth.pctAboveMa50),
    equalWeightedReturn: toFiniteNumber(breadth.equalWeightedReturn),
    volumeWeightedReturn: toFiniteNumber(breadth.volumeWeightedReturn),
    dispersion: toFiniteNumber(breadth.dispersion),
  };
};

const buildBtcDominanceContextFromSignal = (signal: Signal) => {
  const baseContext = toRecord(signal.additionalIndicators?.baseContext);
  const relative = toRecord(baseContext?.relative);
  const btcDominance = toRecord(relative?.btcDominance);

  if (!btcDominance) {
    return {
      source: null,
      available: false,
      stale: null,
      btcDominancePct: null,
      btcDominanceChange24hPct: null,
      altLiquidityRegime: null,
      totalMarketCapUsd: null,
      altMarketCapUsd: null,
      btcToAltMarketCapRatio: null,
      marketCapChangePct24hUsd: null,
    };
  }

  return {
    source: String(btcDominance.source ?? ''),
    available: true,
    stale: typeof btcDominance.stale === 'boolean' ? btcDominance.stale : null,
    btcDominancePct: toFiniteNumber(btcDominance.btcDominancePct),
    btcDominanceChange24hPct: toFiniteNumber(
      btcDominance.btcDominanceChange24hPct,
    ),
    altLiquidityRegime:
      typeof btcDominance.altLiquidityRegime === 'string'
        ? (btcDominance.altLiquidityRegime as
            | 'alt_friendly'
            | 'btc_favored'
            | 'neutral'
            | 'unknown')
        : null,
    totalMarketCapUsd: toFiniteNumber(btcDominance.totalMarketCapUsd),
    altMarketCapUsd: toFiniteNumber(btcDominance.altMarketCapUsd),
    btcToAltMarketCapRatio: toFiniteNumber(btcDominance.btcToAltMarketCapRatio),
    marketCapChangePct24hUsd: toFiniteNumber(
      btcDominance.marketCapChangePct24hUsd,
    ),
  };
};

const buildMarketReferencesContextFromSignal = (signal: Signal) => {
  const baseContext = toRecord(signal.additionalIndicators?.baseContext);
  const relative = toRecord(baseContext?.relative);
  const refs = toRecord(relative?.marketReferences);
  const primaryReferenceSymbol =
    typeof refs?.primaryReferenceSymbol === 'string'
      ? refs.primaryReferenceSymbol
      : null;
  const tradeFlowBySymbol = toRecord(refs?.tradeFlowBySymbol);
  const depthBySymbol = toRecord(refs?.depthBySymbol);
  const primaryTradeFlow =
    primaryReferenceSymbol != null
      ? toRecord(tradeFlowBySymbol?.[primaryReferenceSymbol])
      : null;
  const primaryDepth =
    primaryReferenceSymbol != null
      ? toRecord(depthBySymbol?.[primaryReferenceSymbol])
      : null;
  const primaryDepthLevels = Array.isArray(primaryDepth?.depthLevels)
    ? primaryDepth.depthLevels
    : null;
  const primaryDepthLevel = toRecord(primaryDepthLevels?.[0]);

  if (!refs) {
    return {
      source: null,
      available: false,
      primaryReferenceSymbol: null,
      referenceSymbols: [],
      primaryTradeFlowBuyPressurePct: null,
      primaryTradeFlowStale: null,
      primaryOrderBookImbalance: null,
      primaryOrderBookStale: null,
    };
  }

  return {
    source: String(refs.source ?? ''),
    available: true,
    primaryReferenceSymbol,
    referenceSymbols: Array.isArray(refs.referenceSymbols)
      ? refs.referenceSymbols.map(String)
      : [],
    primaryTradeFlowBuyPressurePct: toFiniteNumber(
      primaryTradeFlow?.buyPressurePct,
    ),
    primaryTradeFlowStale:
      typeof primaryTradeFlow?.stale === 'boolean'
        ? primaryTradeFlow.stale
        : null,
    primaryOrderBookImbalance: toFiniteNumber(primaryDepthLevel?.imbalance),
    primaryOrderBookStale:
      typeof primaryDepth?.stale === 'boolean' ? primaryDepth.stale : null,
  };
};

export const buildAiMarketContext = (signal: Signal): AiMarketContext => ({
  execution: {
    binanceCoinbaseSpread: buildSpreadContextFromSignal(signal),
    targetVenue: buildTargetVenueContextFromSignal(signal),
    orderBookDepth: buildOrderBookDepthContextFromSignal(signal),
  },
  participation: {
    trueDelta: buildTrueDeltaContextFromSignal(signal),
    tradeFlow: buildTradeFlowContextFromSignal(signal),
  },
  relative: {
    marketBreadth: buildMarketBreadthContextFromSignal(signal),
    btcDominance: buildBtcDominanceContextFromSignal(signal),
    marketReferences: buildMarketReferencesContextFromSignal(signal),
  },
});
