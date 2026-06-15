import type {
  CmcFearGreedClassification,
  CmcFearGreedRegime,
  Signal,
} from '@tradejs/types';

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
    targetVsBtc: {
      source: string | null;
      available: boolean;
      ratioReturn1h: number | null;
      ratioReturn4h: number | null;
      ratioReturn24h: number | null;
      alphaVsBtc1h: number | null;
      alphaVsBtc4h: number | null;
      alphaVsBtc24h: number | null;
      betaToBtc20: number | null;
      correlationToBtc20: number | null;
      ratioTrend: 'up' | 'down' | 'flat' | 'unknown' | null;
    };
    btcAltRegime: {
      source: string | null;
      available: boolean;
      universe: string | null;
      interval: string | null;
      stale: boolean | null;
      regime:
        | 'btc_lead'
        | 'alt_lead'
        | 'risk_off'
        | 'risk_on'
        | 'mixed'
        | 'neutral'
        | 'unknown'
        | null;
      btcReturn24h: number | null;
      altBasketReturn24h: number | null;
      btcVsAltReturn24h: number | null;
      btcTurnoverShare24h: number | null;
      btcTurnoverShareChange24h: number | null;
      altVolToBtcVol24h: number | null;
      altDispersion24h: number | null;
    };
    cmcGlobal: {
      source: string | null;
      available: boolean;
      interval: string | null;
      asOfTs: number | null;
      stale: boolean | null;
      totalMarketCapUsd: number | null;
      totalVolumeUsd: number | null;
      totalVolumeReportedUsd: number | null;
      altMarketCapUsd: number | null;
      altVolumeUsd: number | null;
      altVolumeReportedUsd: number | null;
      btcDominancePct: number | null;
      ethDominancePct: number | null;
      btcDominanceChange24hPct: number | null;
      ethDominanceChange24hPct: number | null;
      altMarketCapChange24hPct: number | null;
      altVolumeChange24hPct: number | null;
      activeCryptocurrencies: number | null;
      activeExchanges: number | null;
      activeMarketPairs: number | null;
      altLiquidityRegime:
        | 'alt_friendly'
        | 'btc_favored'
        | 'risk_off'
        | 'neutral'
        | 'unknown'
        | null;
    };
    cmcReferenceAssets: {
      source: string | null;
      available: boolean;
      interval: string | null;
      asOfTs: number | null;
      stale: boolean | null;
      btcMarketCapUsd: number | null;
      ethMarketCapUsd: number | null;
      btcVolumeUsd: number | null;
      ethVolumeUsd: number | null;
      btcVolumeToMarketCap: number | null;
      ethVolumeToMarketCap: number | null;
      ethBtcMarketCapRatio: number | null;
      ethBtcMarketCapRatioChange24hPct: number | null;
      ethVsBtcVolumeRatio: number | null;
      referenceLiquidityRegime:
        | 'btc_led'
        | 'eth_led'
        | 'balanced'
        | 'thin'
        | 'unknown'
        | null;
    };
    cmcMarketBreadth: {
      source: string | null;
      available: boolean;
      universe: string | null;
      interval: string | null;
      asOfTs: number | null;
      stale: boolean | null;
      topAssetsCount: number | null;
      assetsCount: number | null;
      positive24hPct: number | null;
      positive7dPct: number | null;
      avgReturn24hPct: number | null;
      medianReturn24hPct: number | null;
      returnDispersion24hPct: number | null;
      top10MarketCapShare: number | null;
      top25MarketCapShare: number | null;
      btcMarketCapShare: number | null;
      ethMarketCapShare: number | null;
      btcEthMarketCapShare: number | null;
      stablecoinMarketCapShare: number | null;
      stablecoinVolumeShare: number | null;
      breadthRegime:
        | 'risk_on'
        | 'risk_off'
        | 'alt_broadening'
        | 'btc_concentrated'
        | 'mixed'
        | 'neutral'
        | 'unknown'
        | null;
    };
    cmcExchangeLiquidity: {
      source: string | null;
      available: boolean;
      interval: string | null;
      asOfTs: number | null;
      stale: boolean | null;
      exchangesCount: number | null;
      totalVolumeUsd: number | null;
      totalVolumeChange24hPct: number | null;
      binanceVolumeUsd: number | null;
      binanceVolumeShare: number | null;
      topExchangeVolumeShare: number | null;
      liquidityRegime:
        | 'expanding'
        | 'contracting'
        | 'binance_led'
        | 'concentrated'
        | 'balanced'
        | 'thin'
        | 'unknown'
        | null;
    };
    cmcFearGreed: {
      source: string | null;
      available: boolean;
      interval: string | null;
      asOfTs: number | null;
      stale: boolean | null;
      value: number | null;
      valueChange24h: number | null;
      valueChange7d: number | null;
      classification: CmcFearGreedClassification | null;
      sentimentRegime: CmcFearGreedRegime | null;
    };
    referenceTradeFlow: {
      source: string | null;
      available: boolean;
      primaryReferenceSymbol: string | null;
      referenceSymbols: string[];
      primaryTradeFlowBuyPressurePct: number | null;
      primaryTradeFlowStale: boolean | null;
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

const buildTargetVsBtcContextFromSignal = (signal: Signal) => {
  const baseContext = toRecord(signal.additionalIndicators?.baseContext);
  const relative = toRecord(baseContext?.relative);
  const targetVsBtc = toRecord(relative?.targetVsBtc);

  if (!targetVsBtc) {
    return {
      source: null,
      available: false,
      ratioReturn1h: null,
      ratioReturn4h: null,
      ratioReturn24h: null,
      alphaVsBtc1h: null,
      alphaVsBtc4h: null,
      alphaVsBtc24h: null,
      betaToBtc20: null,
      correlationToBtc20: null,
      ratioTrend: null,
    };
  }

  return {
    source: String(targetVsBtc.source ?? ''),
    available: true,
    ratioReturn1h: toFiniteNumber(targetVsBtc.ratioReturn1h),
    ratioReturn4h: toFiniteNumber(targetVsBtc.ratioReturn4h),
    ratioReturn24h: toFiniteNumber(targetVsBtc.ratioReturn24h),
    alphaVsBtc1h: toFiniteNumber(targetVsBtc.alphaVsBtc1h),
    alphaVsBtc4h: toFiniteNumber(targetVsBtc.alphaVsBtc4h),
    alphaVsBtc24h: toFiniteNumber(targetVsBtc.alphaVsBtc24h),
    betaToBtc20: toFiniteNumber(targetVsBtc.betaToBtc20),
    correlationToBtc20: toFiniteNumber(targetVsBtc.correlationToBtc20),
    ratioTrend:
      typeof targetVsBtc.ratioTrend === 'string'
        ? (targetVsBtc.ratioTrend as 'up' | 'down' | 'flat' | 'unknown')
        : null,
  };
};

const buildBtcAltRegimeContextFromSignal = (signal: Signal) => {
  const baseContext = toRecord(signal.additionalIndicators?.baseContext);
  const relative = toRecord(baseContext?.relative);
  const btcAltRegime = toRecord(relative?.btcAltRegime);

  if (!btcAltRegime) {
    return {
      source: null,
      available: false,
      universe: null,
      interval: null,
      stale: null,
      regime: null,
      btcReturn24h: null,
      altBasketReturn24h: null,
      btcVsAltReturn24h: null,
      btcTurnoverShare24h: null,
      btcTurnoverShareChange24h: null,
      altVolToBtcVol24h: null,
      altDispersion24h: null,
    };
  }

  return {
    source: String(btcAltRegime.source ?? ''),
    available: true,
    universe: String(btcAltRegime.universe ?? ''),
    interval: String(btcAltRegime.interval ?? ''),
    stale: typeof btcAltRegime.stale === 'boolean' ? btcAltRegime.stale : null,
    regime:
      typeof btcAltRegime.regime === 'string'
        ? (btcAltRegime.regime as
            | 'btc_lead'
            | 'alt_lead'
            | 'risk_off'
            | 'risk_on'
            | 'mixed'
            | 'neutral'
            | 'unknown')
        : null,
    btcReturn24h: toFiniteNumber(btcAltRegime.btcReturn24h),
    altBasketReturn24h: toFiniteNumber(btcAltRegime.altBasketReturn24h),
    btcVsAltReturn24h: toFiniteNumber(btcAltRegime.btcVsAltReturn24h),
    btcTurnoverShare24h: toFiniteNumber(btcAltRegime.btcTurnoverShare24h),
    btcTurnoverShareChange24h: toFiniteNumber(
      btcAltRegime.btcTurnoverShareChange24h,
    ),
    altVolToBtcVol24h: toFiniteNumber(btcAltRegime.altVolToBtcVol24h),
    altDispersion24h: toFiniteNumber(btcAltRegime.altDispersion24h),
  };
};

const buildCmcGlobalContextFromSignal = (signal: Signal) => {
  const baseContext = toRecord(signal.additionalIndicators?.baseContext);
  const relative = toRecord(baseContext?.relative);
  const cmcGlobal = toRecord(relative?.cmcGlobal);

  if (!cmcGlobal) {
    return {
      source: null,
      available: false,
      interval: null,
      asOfTs: null,
      stale: null,
      totalMarketCapUsd: null,
      totalVolumeUsd: null,
      totalVolumeReportedUsd: null,
      altMarketCapUsd: null,
      altVolumeUsd: null,
      altVolumeReportedUsd: null,
      btcDominancePct: null,
      ethDominancePct: null,
      btcDominanceChange24hPct: null,
      ethDominanceChange24hPct: null,
      altMarketCapChange24hPct: null,
      altVolumeChange24hPct: null,
      activeCryptocurrencies: null,
      activeExchanges: null,
      activeMarketPairs: null,
      altLiquidityRegime: null,
    };
  }

  return {
    source: String(cmcGlobal.source ?? ''),
    available: true,
    interval:
      typeof cmcGlobal.interval === 'string' ? cmcGlobal.interval : null,
    asOfTs: toFiniteNumber(cmcGlobal.asOfTs),
    stale: typeof cmcGlobal.stale === 'boolean' ? cmcGlobal.stale : null,
    totalMarketCapUsd: toFiniteNumber(cmcGlobal.totalMarketCapUsd),
    totalVolumeUsd: toFiniteNumber(cmcGlobal.totalVolumeUsd),
    totalVolumeReportedUsd: toFiniteNumber(cmcGlobal.totalVolumeReportedUsd),
    altMarketCapUsd: toFiniteNumber(cmcGlobal.altMarketCapUsd),
    altVolumeUsd: toFiniteNumber(cmcGlobal.altVolumeUsd),
    altVolumeReportedUsd: toFiniteNumber(cmcGlobal.altVolumeReportedUsd),
    btcDominancePct: toFiniteNumber(cmcGlobal.btcDominancePct),
    ethDominancePct: toFiniteNumber(cmcGlobal.ethDominancePct),
    btcDominanceChange24hPct: toFiniteNumber(
      cmcGlobal.btcDominanceChange24hPct,
    ),
    ethDominanceChange24hPct: toFiniteNumber(
      cmcGlobal.ethDominanceChange24hPct,
    ),
    altMarketCapChange24hPct: toFiniteNumber(
      cmcGlobal.altMarketCapChange24hPct,
    ),
    altVolumeChange24hPct: toFiniteNumber(cmcGlobal.altVolumeChange24hPct),
    activeCryptocurrencies: toFiniteNumber(cmcGlobal.activeCryptocurrencies),
    activeExchanges: toFiniteNumber(cmcGlobal.activeExchanges),
    activeMarketPairs: toFiniteNumber(cmcGlobal.activeMarketPairs),
    altLiquidityRegime:
      typeof cmcGlobal.altLiquidityRegime === 'string'
        ? (cmcGlobal.altLiquidityRegime as
            | 'alt_friendly'
            | 'btc_favored'
            | 'risk_off'
            | 'neutral'
            | 'unknown')
        : null,
  };
};

const buildCmcReferenceAssetsContextFromSignal = (signal: Signal) => {
  const baseContext = toRecord(signal.additionalIndicators?.baseContext);
  const relative = toRecord(baseContext?.relative);
  const cmcReferenceAssets = toRecord(relative?.cmcReferenceAssets);

  if (!cmcReferenceAssets) {
    return {
      source: null,
      available: false,
      interval: null,
      asOfTs: null,
      stale: null,
      btcMarketCapUsd: null,
      ethMarketCapUsd: null,
      btcVolumeUsd: null,
      ethVolumeUsd: null,
      btcVolumeToMarketCap: null,
      ethVolumeToMarketCap: null,
      ethBtcMarketCapRatio: null,
      ethBtcMarketCapRatioChange24hPct: null,
      ethVsBtcVolumeRatio: null,
      referenceLiquidityRegime: null,
    };
  }

  return {
    source: String(cmcReferenceAssets.source ?? ''),
    available: true,
    interval:
      typeof cmcReferenceAssets.interval === 'string'
        ? cmcReferenceAssets.interval
        : null,
    asOfTs: toFiniteNumber(cmcReferenceAssets.asOfTs),
    stale:
      typeof cmcReferenceAssets.stale === 'boolean'
        ? cmcReferenceAssets.stale
        : null,
    btcMarketCapUsd: toFiniteNumber(cmcReferenceAssets.btcMarketCapUsd),
    ethMarketCapUsd: toFiniteNumber(cmcReferenceAssets.ethMarketCapUsd),
    btcVolumeUsd: toFiniteNumber(cmcReferenceAssets.btcVolumeUsd),
    ethVolumeUsd: toFiniteNumber(cmcReferenceAssets.ethVolumeUsd),
    btcVolumeToMarketCap: toFiniteNumber(
      cmcReferenceAssets.btcVolumeToMarketCap,
    ),
    ethVolumeToMarketCap: toFiniteNumber(
      cmcReferenceAssets.ethVolumeToMarketCap,
    ),
    ethBtcMarketCapRatio: toFiniteNumber(
      cmcReferenceAssets.ethBtcMarketCapRatio,
    ),
    ethBtcMarketCapRatioChange24hPct: toFiniteNumber(
      cmcReferenceAssets.ethBtcMarketCapRatioChange24hPct,
    ),
    ethVsBtcVolumeRatio: toFiniteNumber(cmcReferenceAssets.ethVsBtcVolumeRatio),
    referenceLiquidityRegime:
      typeof cmcReferenceAssets.referenceLiquidityRegime === 'string'
        ? (cmcReferenceAssets.referenceLiquidityRegime as
            | 'btc_led'
            | 'eth_led'
            | 'balanced'
            | 'thin'
            | 'unknown')
        : null,
  };
};

const buildCmcMarketBreadthContextFromSignal = (signal: Signal) => {
  const baseContext = toRecord(signal.additionalIndicators?.baseContext);
  const relative = toRecord(baseContext?.relative);
  const cmcMarketBreadth = toRecord(relative?.cmcMarketBreadth);

  if (!cmcMarketBreadth) {
    return {
      source: null,
      available: false,
      universe: null,
      interval: null,
      asOfTs: null,
      stale: null,
      topAssetsCount: null,
      assetsCount: null,
      positive24hPct: null,
      positive7dPct: null,
      avgReturn24hPct: null,
      medianReturn24hPct: null,
      returnDispersion24hPct: null,
      top10MarketCapShare: null,
      top25MarketCapShare: null,
      btcMarketCapShare: null,
      ethMarketCapShare: null,
      btcEthMarketCapShare: null,
      stablecoinMarketCapShare: null,
      stablecoinVolumeShare: null,
      breadthRegime: null,
    };
  }

  return {
    source: String(cmcMarketBreadth.source ?? ''),
    available: true,
    universe:
      typeof cmcMarketBreadth.universe === 'string'
        ? cmcMarketBreadth.universe
        : null,
    interval:
      typeof cmcMarketBreadth.interval === 'string'
        ? cmcMarketBreadth.interval
        : null,
    asOfTs: toFiniteNumber(cmcMarketBreadth.asOfTs),
    stale:
      typeof cmcMarketBreadth.stale === 'boolean'
        ? cmcMarketBreadth.stale
        : null,
    topAssetsCount: toFiniteNumber(cmcMarketBreadth.topAssetsCount),
    assetsCount: toFiniteNumber(cmcMarketBreadth.assetsCount),
    positive24hPct: toFiniteNumber(cmcMarketBreadth.positive24hPct),
    positive7dPct: toFiniteNumber(cmcMarketBreadth.positive7dPct),
    avgReturn24hPct: toFiniteNumber(cmcMarketBreadth.avgReturn24hPct),
    medianReturn24hPct: toFiniteNumber(cmcMarketBreadth.medianReturn24hPct),
    returnDispersion24hPct: toFiniteNumber(
      cmcMarketBreadth.returnDispersion24hPct,
    ),
    top10MarketCapShare: toFiniteNumber(cmcMarketBreadth.top10MarketCapShare),
    top25MarketCapShare: toFiniteNumber(cmcMarketBreadth.top25MarketCapShare),
    btcMarketCapShare: toFiniteNumber(cmcMarketBreadth.btcMarketCapShare),
    ethMarketCapShare: toFiniteNumber(cmcMarketBreadth.ethMarketCapShare),
    btcEthMarketCapShare: toFiniteNumber(cmcMarketBreadth.btcEthMarketCapShare),
    stablecoinMarketCapShare: toFiniteNumber(
      cmcMarketBreadth.stablecoinMarketCapShare,
    ),
    stablecoinVolumeShare: toFiniteNumber(
      cmcMarketBreadth.stablecoinVolumeShare,
    ),
    breadthRegime:
      typeof cmcMarketBreadth.breadthRegime === 'string'
        ? (cmcMarketBreadth.breadthRegime as
            | 'risk_on'
            | 'risk_off'
            | 'alt_broadening'
            | 'btc_concentrated'
            | 'mixed'
            | 'neutral'
            | 'unknown')
        : null,
  };
};

const buildCmcExchangeLiquidityContextFromSignal = (signal: Signal) => {
  const baseContext = toRecord(signal.additionalIndicators?.baseContext);
  const relative = toRecord(baseContext?.relative);
  const cmcExchangeLiquidity = toRecord(relative?.cmcExchangeLiquidity);

  if (!cmcExchangeLiquidity) {
    return {
      source: null,
      available: false,
      interval: null,
      asOfTs: null,
      stale: null,
      exchangesCount: null,
      totalVolumeUsd: null,
      totalVolumeChange24hPct: null,
      binanceVolumeUsd: null,
      binanceVolumeShare: null,
      topExchangeVolumeShare: null,
      liquidityRegime: null,
    };
  }

  return {
    source: String(cmcExchangeLiquidity.source ?? ''),
    available: true,
    interval:
      typeof cmcExchangeLiquidity.interval === 'string'
        ? cmcExchangeLiquidity.interval
        : null,
    asOfTs: toFiniteNumber(cmcExchangeLiquidity.asOfTs),
    stale:
      typeof cmcExchangeLiquidity.stale === 'boolean'
        ? cmcExchangeLiquidity.stale
        : null,
    exchangesCount: toFiniteNumber(cmcExchangeLiquidity.exchangesCount),
    totalVolumeUsd: toFiniteNumber(cmcExchangeLiquidity.totalVolumeUsd),
    totalVolumeChange24hPct: toFiniteNumber(
      cmcExchangeLiquidity.totalVolumeChange24hPct,
    ),
    binanceVolumeUsd: toFiniteNumber(cmcExchangeLiquidity.binanceVolumeUsd),
    binanceVolumeShare: toFiniteNumber(cmcExchangeLiquidity.binanceVolumeShare),
    topExchangeVolumeShare: toFiniteNumber(
      cmcExchangeLiquidity.topExchangeVolumeShare,
    ),
    liquidityRegime:
      typeof cmcExchangeLiquidity.liquidityRegime === 'string'
        ? (cmcExchangeLiquidity.liquidityRegime as
            | 'expanding'
            | 'contracting'
            | 'binance_led'
            | 'concentrated'
            | 'balanced'
            | 'thin'
            | 'unknown')
        : null,
  };
};

const buildCmcFearGreedContextFromSignal = (signal: Signal) => {
  const baseContext = toRecord(signal.additionalIndicators?.baseContext);
  const relative = toRecord(baseContext?.relative);
  const cmcFearGreed = toRecord(relative?.cmcFearGreed);

  if (!cmcFearGreed) {
    return {
      source: null,
      available: false,
      interval: null,
      asOfTs: null,
      stale: null,
      value: null,
      valueChange24h: null,
      valueChange7d: null,
      classification: null,
      sentimentRegime: null,
    };
  }

  return {
    source: String(cmcFearGreed.source ?? ''),
    available: true,
    interval:
      typeof cmcFearGreed.interval === 'string' ? cmcFearGreed.interval : null,
    asOfTs: toFiniteNumber(cmcFearGreed.asOfTs),
    stale: typeof cmcFearGreed.stale === 'boolean' ? cmcFearGreed.stale : null,
    value: toFiniteNumber(cmcFearGreed.value),
    valueChange24h: toFiniteNumber(cmcFearGreed.valueChange24h),
    valueChange7d: toFiniteNumber(cmcFearGreed.valueChange7d),
    classification:
      typeof cmcFearGreed.classification === 'string'
        ? (cmcFearGreed.classification as CmcFearGreedClassification)
        : null,
    sentimentRegime:
      typeof cmcFearGreed.sentimentRegime === 'string'
        ? (cmcFearGreed.sentimentRegime as CmcFearGreedRegime)
        : null,
  };
};

const buildReferenceTradeFlowContextFromSignal = (signal: Signal) => {
  const baseContext = toRecord(signal.additionalIndicators?.baseContext);
  const relative = toRecord(baseContext?.relative);
  const refs = toRecord(relative?.referenceTradeFlow);
  const primaryReferenceSymbol =
    typeof refs?.primaryReferenceSymbol === 'string'
      ? refs.primaryReferenceSymbol
      : null;
  const tradeFlowBySymbol = toRecord(refs?.tradeFlowBySymbol);
  const primaryTradeFlow =
    primaryReferenceSymbol != null
      ? toRecord(tradeFlowBySymbol?.[primaryReferenceSymbol])
      : null;

  if (!refs) {
    return {
      source: null,
      available: false,
      primaryReferenceSymbol: null,
      referenceSymbols: [],
      primaryTradeFlowBuyPressurePct: null,
      primaryTradeFlowStale: null,
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
  };
};

export const buildAiMarketContext = (signal: Signal): AiMarketContext => ({
  execution: {
    binanceCoinbaseSpread: buildSpreadContextFromSignal(signal),
  },
  participation: {
    trueDelta: buildTrueDeltaContextFromSignal(signal),
    tradeFlow: buildTradeFlowContextFromSignal(signal),
  },
  relative: {
    marketBreadth: buildMarketBreadthContextFromSignal(signal),
    targetVsBtc: buildTargetVsBtcContextFromSignal(signal),
    btcAltRegime: buildBtcAltRegimeContextFromSignal(signal),
    cmcGlobal: buildCmcGlobalContextFromSignal(signal),
    cmcReferenceAssets: buildCmcReferenceAssetsContextFromSignal(signal),
    cmcMarketBreadth: buildCmcMarketBreadthContextFromSignal(signal),
    cmcExchangeLiquidity: buildCmcExchangeLiquidityContextFromSignal(signal),
    cmcFearGreed: buildCmcFearGreedContextFromSignal(signal),
    referenceTradeFlow: buildReferenceTradeFlowContextFromSignal(signal),
  },
});
