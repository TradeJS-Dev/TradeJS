import {
  Connector,
  Direction,
  Interval,
  Indicator,
  KlineChartData,
  KlineChartItem,
  RuntimeAiAnalysisSnapshot,
  Signal,
  Tp,
  Candle,
  CmcExchangeLiquidityRegime,
  CmcFearGreedClassification,
  CmcFearGreedRegime,
  DerivativesContext,
  MarketFeatureInterval,
  OrderPositionIntent,
} from './trade';
import { StrategyConfig, StrategyCreator } from './backtest';
import { StrategyManifest } from './strategyAdapters';

export interface StrategySignalMetaParams {
  symbol: string;
  interval: Interval;
  direction: Direction;
  timestamp: number;
  isConfigFromBacktest: boolean;
}

export interface StrategySignalPriceParams {
  currentPrice: number;
  takeProfitPrice: number;
  stopLossPrice: number;
  riskRatio: number;
}

export interface StrategyEntryBaseParams {
  qty: number;
}

export interface StrategyEntryTakeProfitsParams {
  takeProfits: Tp[];
}

export interface StrategyEntryRuntimeBaseParams {
  symbol: string;
  direction: Direction;
  timestamp: number;
  currentPrice: number;
}

export type StrategyEntryRuntimeBuilderParams<TExtra extends object = {}> =
  StrategyEntryRuntimeBaseParams & TExtra;

export type StrategyEntrySignalDecisionBuilderParams<
  TPriceFields extends object = StrategySignalPriceParams,
  TExtra extends object = {},
> = StrategySignalMetaParams & StrategyEntryBaseParams & TPriceFields & TExtra;

export type StrategyIndicatorsMap = Signal['indicators'];
export type StrategyAdditionalIndicatorsMap = NonNullable<
  Signal['additionalIndicators']
>;

export interface BuildStrategySignalParams {
  signalId: string;
  strategy: Signal['strategy'];
  symbol: string;
  interval: Signal['interval'];
  direction: Direction;
  timestamp: number;
  prices: Signal['prices'];
  figures?: Signal['figures'];
  indicators?: Signal['indicators'];
  additionalIndicators?: NonNullable<Signal['additionalIndicators']>;
  isConfigFromBacktest?: boolean;
}

export type BuildStrategySignalDraft = Omit<
  BuildStrategySignalParams,
  'signalId'
> & {
  signalId?: string;
};

export interface StrategyEntrySignalContext {
  strategy: Signal['strategy'];
  symbol: Signal['symbol'];
  interval: Signal['interval'];
  direction: Signal['direction'];
  timestamp: Signal['timestamp'];
  prices: Signal['prices'];
  isConfigFromBacktest?: Signal['isConfigFromBacktest'];
}

export interface StrategyAPIEntryParams {
  code?: string;
  direction: Direction;
  figures?: BuildStrategySignalDraft['figures'];
  indicators?: BuildStrategySignalDraft['indicators'];
  additionalIndicators?: BuildStrategySignalDraft['additionalIndicators'];
  signalId?: BuildStrategySignalDraft['signalId'];
  orderPlan: StrategyEntryOrderPlan;
  runtime?: StrategyEntryRuntimeOptions;
}

export interface StrategyAPIExitParams {
  code?: string;
  direction: Direction;
}

export interface StrategyProtectPlan {
  direction: Direction;
  stopLossPrice?: number | null;
  takeProfits?: Tp[];
}

export interface StrategyAPIProtectParams {
  code?: string;
  protectPlan: StrategyProtectPlan;
}

export interface StrategyIndicatorsContext<TIndicators = unknown> {
  indicators: TIndicators | undefined;
  baseContext?: BaseStrategyContextSnapshot;
}

export interface StrategyDecisionPriceContext {
  timestamp: number;
  currentPrice: number;
  candle: Candle;
}

export interface MlCandleIndicatorsSnapshot {
  candles15m: Candle[];
  candles1h: Candle[];
  candles4h: Candle[];
  candles1d: Candle[];
  btcCandles15m: Candle[];
  btcCandles1h: Candle[];
  btcCandles4h: Candle[];
  btcCandles1d: Candle[];
}

export interface BaseRawIndicatorSnapshot {
  trend: {
    maFast: number | null;
    maMedium: number | null;
    maSlow: number | null;
  };
  volatility: {
    atr: number | null;
    atrPct: number | null;
    bbUpper: number | null;
    bbMiddle: number | null;
    bbLower: number | null;
    bbWidthPct: number | null;
  };
  momentum: {
    macd: number | null;
    macdSignal: number | null;
    macdHistogram: number | null;
  };
  volume: {
    volume: number | null;
    turnover: number | null;
    obv: number | null;
    obvSma: number | null;
    volume1h: number | null;
    volume24h: number | null;
  };
  price: {
    prevClose: number | null;
    price1hPct: number | null;
    price24hPct: number | null;
    highPrice1h: number | null;
    lowPrice1h: number | null;
    highPrice24h: number | null;
    lowPrice24h: number | null;
  };
  levels: {
    highLevel: number | null;
    lowLevel: number | null;
  };
  crossAsset: {
    btcCorrelation: number | null;
  };
}

export interface BaseRegimeContext {
  trend: {
    bias: 'bull' | 'bear' | 'neutral';
    maStackScore: number | null;
    priceDistanceToMaFastAtr: number | null;
    priceDistanceToMaSlowAtr: number | null;
    persistence: number | null;
    adx?: {
      adx: number | null;
      diPlus: number | null;
      diMinus: number | null;
      direction: 'bull' | 'bear' | 'neutral' | 'unknown';
      strength: 'weak' | 'developing' | 'strong' | 'unknown';
    };
    maLayers?: {
      bullishLayerCount: number | null;
      bearishLayerCount: number | null;
      stackScore?: number | null;
      trendState?: 'bull' | 'bear' | 'sideways' | 'unknown';
      alignment: 'bull' | 'bear' | 'mixed' | 'unknown';
      fastImpulseBias: 'bull' | 'bear' | 'neutral' | 'unknown';
      macroBias: 'bull' | 'bear' | 'neutral' | 'unknown';
      layerConflict: boolean | null;
      layers: Array<{
        fastPeriod: number;
        slowPeriod: number;
        fast: number | null;
        slow: number | null;
        bias: 'bull' | 'bear' | 'neutral' | 'unknown';
      }>;
    };
    contextMa?: {
      baseline: number | null;
      upperBoundary: number | null;
      lowerBoundary: number | null;
      contextBias: 'bull' | 'bear' | 'neutral' | 'unknown';
      distanceToBoundaryAtr: number | null;
    };
    adaptiveChannel?: {
      centerline: number | null;
      upper: number | null;
      lower: number | null;
      direction: 'bull' | 'bear' | 'neutral' | 'unknown';
      regime?: 'bull' | 'bear' | 'neutral' | 'unknown';
      roof?: number | null;
      floor?: number | null;
      flipUp?: boolean | null;
      flipDown?: boolean | null;
      halfChannelAtr?: number | null;
      centerlineSlope: number | null;
      channelWidthAtr: number | null;
      pricePositionInChannel: number | null;
    };
    trendFollow?: {
      state: 'bull' | 'bear' | 'neutral' | 'unknown';
      lastSignalDirection: Direction | null;
      signalAgeBars: number | null;
      trailStop: number | null;
      distanceToTrailStopAtr: number | null;
      distanceToTrailStopPct: number | null;
      lastPivotHigh: number | null;
      lastPivotLow: number | null;
      breakoutConfirmed: boolean | null;
    };
    psar?: {
      value: number | null;
      direction: 'bull' | 'bear' | 'unknown';
      rawBuySignal: boolean | null;
      rawSellSignal: boolean | null;
      buySignal: boolean | null;
      sellSignal: boolean | null;
      emaFilter: number | null;
      trendLongOk: boolean | null;
      trendShortOk: boolean | null;
      adxOk: boolean | null;
      candleLongOk: boolean | null;
      candleShortOk: boolean | null;
      cooldownOk: boolean | null;
      barsSinceSignal: number | null;
    };
  };
  volatility: {
    atrSlope: number | null;
    atrPctZScore: number | null;
    bbWidthPct: number | null;
    compressionScore: number | null;
    expansionScore: number | null;
    state: 'compressed' | 'normal' | 'expanded' | 'unknown';
    percentiles?: {
      atrPctRank100: number | null;
      bbWidthRank100: number | null;
      realizedVolRank100: number | null;
      rangeExpansionRank20: number | null;
    };
  };
  momentum: {
    roc1h: number | null;
    roc4h: number | null;
    roc1d: number | null;
    rsi?: number | null;
    rsiState?: 'oversold' | 'neutral' | 'overbought' | 'unknown';
    macdHistogramSlope: number | null;
    bodyStrength: number | null;
    closeLocationInRange: number | null;
    upCloseStreak: number | null;
    downCloseStreak: number | null;
  };
  session: {
    sessionPhase: 'asia' | 'europe' | 'us' | 'off_hours';
    sessionWindowPhase: 'opening' | 'active' | 'closing' | 'off_hours';
    isOverlap: boolean;
    minutesFromSessionOpen: number | null;
    minutesToSessionClose: number | null;
    minutesToFundingWindow: number | null;
    fundingWindowNearby: boolean;
    dayOfWeekUtc: 1 | 2 | 3 | 4 | 5 | 6 | 7;
    isWeekdayUtc: boolean;
    isWeekendUtc: boolean;
  };
  memory: {
    recentFalseBreakoutDensity: number | null;
  };
}

export interface BaseStructureContext {
  swing?: {
    state: 'trend' | 'range' | 'transition' | 'unknown';
    bias: 'bull' | 'bear' | 'neutral' | 'unknown';
    higherHighCount: number | null;
    higherLowCount: number | null;
    lowerHighCount: number | null;
    lowerLowCount: number | null;
  };
  zones?: {
    support: {
      level: number | null;
      lower: number | null;
      upper: number | null;
      touches: number | null;
      ageBars: number | null;
      volumeShare: number | null;
      distanceAtr: number | null;
    };
    resistance: {
      level: number | null;
      lower: number | null;
      upper: number | null;
      touches: number | null;
      ageBars: number | null;
      volumeShare: number | null;
      distanceAtr: number | null;
    };
    active: {
      side: 'support' | 'resistance' | null;
      priceInZone: boolean | null;
    };
  };
  srZones?: {
    levels: Array<{
      level: number;
      upper: number;
      lower: number;
      strength: number;
      distancePct: number | null;
      side: 'support' | 'resistance';
    }>;
    nearestSupport: {
      level: number | null;
      strength: number | null;
      distanceAtr: number | null;
    };
    nearestResistance: {
      level: number | null;
      strength: number | null;
      distanceAtr: number | null;
    };
    crossedAbove: boolean | null;
    crossedBelow: boolean | null;
  };
  liquidity?: {
    sweepState:
      | 'none'
      | 'swept_high'
      | 'swept_low'
      | 'broken_high'
      | 'broken_low'
      | 'unknown';
    side: 'high' | 'low' | null;
    referenceZoneSide: 'support' | 'resistance' | null;
    sweepHigh20: boolean | null;
    sweepLow20: boolean | null;
    closeBackInsideRange: boolean | null;
    stopRunDirection: 'up' | 'down' | null;
    sweepWickPct: number | null;
  };
  liquidityZones?: {
    activeCount: number;
    nearestSupport: {
      top: number | null;
      bottom: number | null;
      level: number | null;
      ageBars: number | null;
      hitCount: number | null;
      distanceAtr: number | null;
    };
    nearestResistance: {
      top: number | null;
      bottom: number | null;
      level: number | null;
      ageBars: number | null;
      hitCount: number | null;
      distanceAtr: number | null;
    };
    activeRetestDirection: Direction | null;
    retestPenetrationPct: number | null;
    crossedAbove: boolean | null;
    crossedBelow: boolean | null;
  };
  liquidityTails?: {
    activeCount: number;
    nearestBuyPressure: {
      top: number | null;
      bottom: number | null;
      mid: number | null;
      touches: number | null;
      ageBars: number | null;
      distanceAtr: number | null;
    };
    nearestSellPressure: {
      top: number | null;
      bottom: number | null;
      mid: number | null;
      touches: number | null;
      ageBars: number | null;
      distanceAtr: number | null;
    };
    currentTail: {
      side: 'upper' | 'lower' | null;
      wickAtr: number | null;
      wickBodyRatio: number | null;
      dominance: number | null;
    };
    activeRetestDirection: Direction | null;
  };
  structureZones?: {
    state: 'trend' | 'range' | 'transition' | 'unknown';
    bias: 'bull' | 'bear' | 'neutral' | 'unknown';
    support: {
      top: number | null;
      bottom: number | null;
      level: number | null;
      distanceAtr: number | null;
    };
    resistance: {
      top: number | null;
      bottom: number | null;
      level: number | null;
      distanceAtr: number | null;
    };
    acceptAboveResistance: boolean | null;
    acceptBelowSupport: boolean | null;
  };
  pivots?: {
    lastSwingHigh: number | null;
    lastSwingLow: number | null;
    barsSinceSwingHigh: number | null;
    barsSinceSwingLow: number | null;
    swingAmplitudeAtr: number | null;
    pivotDensity20: number | null;
    pivotDensity50: number | null;
  };
  acceptance?: {
    closesAboveHighLevel3: number | null;
    closesBelowLowLevel3: number | null;
    failedAcceptanceBars: number | null;
    acceptanceScore: number | null;
    breakoutBodyAtr: number | null;
  };
  localRange: {
    rangePosition20: number | null;
    distanceToHighLevelAtr: number | null;
    distanceToLowLevelAtr: number | null;
    breakoutState:
      | 'inside_range'
      | 'above_high_level'
      | 'below_low_level'
      | 'failed_high_breakout'
      | 'failed_low_breakout'
      | 'unknown';
    barsSinceBreakout: number | null;
    breakoutRetestQuality: number | null;
  };
  levels: {
    highTouchCount20: number | null;
    lowTouchCount20: number | null;
    dominantTouchCount20: number | null;
  };
  candleQuality: {
    upperWickPct: number | null;
    lowerWickPct: number | null;
    rejectionWickScore: number | null;
  };
}

export interface BaseMarketTradeFlowContext {
  source: 'binance_agg_trades';
  interval: MarketFeatureInterval;
  asOfTs: number | null;
  ageMs: number | null;
  stale: boolean;
  trades: number | null;
  buyPressurePct: number | null;
  buyBaseVolume: number | null;
  sellBaseVolume: number | null;
  buyQuoteVolume: number | null;
  sellQuoteVolume: number | null;
  netBaseDelta: number | null;
  netQuoteDelta: number | null;
}

export interface BaseHyperliquidWhaleFlowContext {
  source: 'hyperliquid_trades' | 'hyperliquid_user_fills';
  interval: MarketFeatureInterval;
  asOfTs: number | null;
  windowEndTs: number;
  ageMs: number | null;
  stale: boolean;
  symbol: string;
  trades: number;
  whaleSides: number;
  uniqueWhales: number;
  coveredWhales: number;
  expectedWhales: number;
  coveragePct: number;
  coverageSufficient: boolean;
  buyNotionalUsd: number;
  sellNotionalUsd: number;
  netNotionalUsd: number;
  buySharePct: number | null;
  positionAwareWhaleSides: number;
  positionAwarePct: number;
  longEntryWhales: number;
  shortEntryWhales: number;
  longExitWhales: number;
  shortExitWhales: number;
  longEntryNotionalUsd: number;
  shortEntryNotionalUsd: number;
  longExitNotionalUsd: number;
  shortExitNotionalUsd: number;
  entryNetNotionalUsd: number;
  entryLongSharePct: number | null;
  universeFingerprint: string;
  whaleRegistryFingerprint: string;
}

export interface BaseParticipationContext {
  volume: {
    volumeRel20: number | null;
    turnoverRel20: number | null;
    volumeTrendSlope: number | null;
    obvSlope: number | null;
    effortVsResult: number | null;
  };
  priceVolumeProfile?: {
    pointOfControl: number | null;
    distanceToPointOfControlAtr: number | null;
    pointOfControlVolumeShare: number | null;
    priceAbovePointOfControl: boolean | null;
    nearPointOfControl: boolean | null;
  };
  volumeStructure?: {
    pointOfControl: number | null;
    pocIndex: number | null;
    pointOfControlVolumeShare: number | null;
    pocUpVolumeShare: number | null;
    pocDownVolumeShare: number | null;
    totalUpVolumeShare: number | null;
    totalDownVolumeShare: number | null;
    priceAbovePointOfControl: boolean | null;
    distanceToPointOfControlAtr: number | null;
    rowCount: number;
    calcBars: number;
  };
  delta?: {
    source?: 'ohlcv_proxy' | 'kline_taker_volume' | 'agg_trades' | 'trades';
    buyPressurePct: number | null;
    buyVolume?: number | null;
    sellVolume?: number | null;
    netDelta?: number | null;
    deltaPct?: number | null;
    signedVolume: number | null;
    signedVolumeZScore: number | null;
    deltaSlope: number | null;
    deltaDivergenceVsPrice: 'bullish' | 'bearish' | 'none' | 'unknown';
  };
  tradeFlow?: BaseMarketTradeFlowContext;
  hyperliquidWhales?: BaseHyperliquidWhaleFlowContext;
}

export type BaseMarketBreadthContext = {
  source: 'binance_klines';
  universe: string;
  interval: MarketFeatureInterval;
  asOfTs: number | null;
  ageMs: number | null;
  stale: boolean;
  symbolsCount: number | null;
  advancers: number | null;
  decliners: number | null;
  unchanged: number | null;
  advanceDeclineRatio: number | null;
  pctAboveMa20: number | null;
  pctAboveMa50: number | null;
  equalWeightedReturn: number | null;
  volumeWeightedReturn: number | null;
  dispersion: number | null;
};

export type BaseMarketBreadthsContext = {
  top5?: BaseMarketBreadthContext;
  top10?: BaseMarketBreadthContext;
  top30?: BaseMarketBreadthContext;
  top50?: BaseMarketBreadthContext;
  top100?: BaseMarketBreadthContext;
};

export interface BasePsychologicalLevelWindowContext {
  crossed: boolean | null;
  direction: 'up' | 'down' | 'none' | 'unknown';
  level: number | null;
  levelsCrossed: number | null;
  distanceBeyondLevelBps: number | null;
}

export interface BasePsychologicalLevelAssetContext {
  source: 'aligned_15m_ohlcv';
  stepUsd: number;
  windows: {
    m15: BasePsychologicalLevelWindowContext;
    h1: BasePsychologicalLevelWindowContext;
    h4: BasePsychologicalLevelWindowContext;
  };
}

export interface BaseRelativeContext {
  benchmark: {
    maFast: number | null;
    maSlow: number | null;
    bias: 'bull' | 'bear' | 'neutral';
    relativeStrength1h: number | null;
    relativeStrength4h: number | null;
    relativeStrength1d: number | null;
    trendAlignment:
      | 'aligned_bull'
      | 'aligned_bear'
      | 'against_benchmark'
      | 'neutral'
      | 'unknown';
  };
  execution: {
    venueSpread: number | null;
    venueSpreadZScore: number | null;
  };
  targetVsBtc?: {
    source: 'aligned_ohlcv';
    ratioReturn1h: number | null;
    ratioReturn4h: number | null;
    ratioReturn24h: number | null;
    alphaVsBtc1h: number | null;
    alphaVsBtc4h: number | null;
    alphaVsBtc24h: number | null;
    betaToBtc20: number | null;
    correlationToBtc20: number | null;
    ratioTrend: 'up' | 'down' | 'flat' | 'unknown';
  };
  targetVsEth?: {
    source: 'aligned_ohlcv';
    ratioReturn1h: number | null;
    ratioReturn4h: number | null;
    ratioReturn24h: number | null;
    alphaVsEth1h: number | null;
    alphaVsEth4h: number | null;
    alphaVsEth24h: number | null;
    betaToEth20: number | null;
    correlationToEth20: number | null;
    ratioTrend: 'up' | 'down' | 'flat' | 'unknown';
  };
  referencePsychologicalLevels?: {
    BTCUSDT?: BasePsychologicalLevelAssetContext;
    ETHUSDT?: BasePsychologicalLevelAssetContext;
  };
  marketBreadth?: BaseMarketBreadthContext;
  marketBreadths?: BaseMarketBreadthsContext;
  btcAltRegime?: {
    source: 'binance_klines';
    universe: string;
    interval: MarketFeatureInterval;
    asOfTs: number | null;
    ageMs: number | null;
    stale: boolean;
    btcReturn1h: number | null;
    btcReturn4h: number | null;
    btcReturn24h: number | null;
    altBasketReturn1h: number | null;
    altBasketReturn4h: number | null;
    altBasketReturn24h: number | null;
    btcVsAltReturn1h: number | null;
    btcVsAltReturn4h: number | null;
    btcVsAltReturn24h: number | null;
    btcTurnoverShare1h: number | null;
    btcTurnoverShare24h: number | null;
    btcTurnoverShareChange24h: number | null;
    altVolToBtcVol24h: number | null;
    altDispersion24h: number | null;
    regime:
      | 'btc_lead'
      | 'alt_lead'
      | 'risk_off'
      | 'risk_on'
      | 'mixed'
      | 'neutral'
      | 'unknown';
  };
  cmcGlobal?: {
    source: 'coinmarketcap_global';
    interval: '1d';
    asOfTs: number | null;
    ageMs: number | null;
    stale: boolean;
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
      | 'unknown';
  };
  cmcReferenceAssets?: {
    source: 'coinmarketcap_reference_asset';
    interval: '1d';
    asOfTs: number | null;
    ageMs: number | null;
    stale: boolean;
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
      | 'unknown';
  };
  cmcExchangeLiquidity?: {
    source: 'coinmarketcap_exchange_liquidity';
    interval: '1d' | '1h';
    asOfTs: number | null;
    ageMs: number | null;
    stale: boolean;
    exchangesCount: number | null;
    totalVolumeUsd: number | null;
    totalVolumeChange24hPct: number | null;
    binanceVolumeUsd: number | null;
    binanceVolumeShare: number | null;
    topExchangeVolumeShare: number | null;
    liquidityRegime: CmcExchangeLiquidityRegime;
  };
  cmcFearGreed?: {
    source: 'coinmarketcap_fear_greed';
    interval: '1d';
    asOfTs: number | null;
    ageMs: number | null;
    stale: boolean;
    value: number | null;
    valueChange24h: number | null;
    valueChange7d: number | null;
    classification: CmcFearGreedClassification;
    sentimentRegime: CmcFearGreedRegime;
  };
  cmcIndexes?: {
    source: 'coinmarketcap_index';
    interval: '1d';
    asOfTs: number | null;
    ageMs: number | null;
    stale: boolean;
    cmc100Value: number | null;
    cmc100Change24hPct: number | null;
    cmc100TopConstituentSymbol: string | null;
    cmc100TopConstituentWeightPct: number | null;
    cmc20Value: number | null;
    cmc20Change24hPct: number | null;
    cmc20TopConstituentSymbol: string | null;
    cmc20TopConstituentWeightPct: number | null;
    cmc20ToCmc100Ratio: number | null;
    cmc20ToCmc100RatioChange24hPct: number | null;
    indexRegime:
      | 'top20_led'
      | 'large_cap_led'
      | 'risk_off'
      | 'balanced'
      | 'unknown';
  };
  referenceTradeFlow?: {
    source: 'binance_reference_market';
    primaryReferenceSymbol: string;
    referenceSymbols: string[];
    tradeFlowBySymbol: Record<string, BaseMarketTradeFlowContext>;
  };
}

export interface BaseMultiTimeframeContext {
  compact?: boolean;
  candles: {
    m15: Candle[];
    h1: Candle[];
    h4: Candle[];
    d1: Candle[];
  };
  benchmarkCandles: {
    m15: Candle[];
    h1: Candle[];
    h4: Candle[];
    d1: Candle[];
  };
  summary?: {
    h1TrendBias: 'bull' | 'bear' | 'neutral' | 'unknown';
    h4TrendBias: 'bull' | 'bear' | 'neutral' | 'unknown';
    d1TrendBias: 'bull' | 'bear' | 'neutral' | 'unknown';
    h1RangePosition: number | null;
    h4VolatilityState: 'compressed' | 'normal' | 'expanded' | 'unknown';
    mtfAlignment:
      | 'aligned_bull'
      | 'aligned_bear'
      | 'mixed'
      | 'neutral'
      | 'unknown';
  };
}

export type BaseGateFeatureEntryLocation =
  | 'near_support'
  | 'near_resistance'
  | 'mid_range'
  | 'breakout'
  | 'breakdown'
  | 'unknown';

export type BaseGateFeatureScoreKey =
  | 'structure'
  | 'participation'
  | 'relative'
  | 'mtf'
  | 'execution'
  | 'derivatives'
  | 'totalContext';

export type BaseGateFeatureConfirmation =
  | 'mtf_aligned'
  | 'volume_expansion'
  | 'delta_aligned'
  | 'trade_flow_aligned'
  | 'hyperliquid_whales_aligned'
  | 'reference_trade_flow_aligned'
  | 'market_breadth_aligned'
  | 'cmc_alt_liquidity_aligned'
  | 'cmc_eth_btc_aligned'
  | 'cmc_exchange_liquidity_aligned'
  | 'cmc_fear_greed_aligned'
  | 'cmc_index_aligned'
  | 'target_vs_btc_aligned'
  | 'target_vs_eth_aligned'
  | 'btc_alt_regime_aligned'
  | 'benchmark_aligned'
  | 'breakout_confirmed'
  | 'liquidity_sweep_aligned'
  | 'derivatives_aligned';

export type BaseGateFeatureConflict =
  | 'mtf_against'
  | 'mtf_mixed'
  | 'benchmark_against'
  | 'relative_strength_against'
  | 'market_breadth_against'
  | 'cmc_alt_liquidity_against'
  | 'cmc_eth_btc_against'
  | 'cmc_exchange_liquidity_against'
  | 'cmc_fear_greed_against'
  | 'cmc_index_against'
  | 'target_vs_btc_against'
  | 'target_vs_eth_against'
  | 'btc_alt_regime_against'
  | 'delta_against'
  | 'trade_flow_against'
  | 'hyperliquid_whales_against'
  | 'reference_trade_flow_against'
  | 'failed_breakout'
  | 'extreme_volatility'
  | 'wide_spread'
  | 'derivatives_against'
  | 'derivatives_crowded';

export type BaseGateFeatureRiskLevel = 'low' | 'medium' | 'high' | 'unknown';

export type BaseGateFeatureApproveBias = 'support' | 'neutral' | 'reject';

export type BaseGateFeaturePrimaryIssue =
  | 'none'
  | 'mtf_conflict'
  | 'weak_structure'
  | 'weak_participation'
  | 'bad_execution'
  | 'market_context_against'
  | 'extreme_volatility'
  | 'crowded_derivatives';

export interface BaseContextGateFeatures {
  setup?: {
    rewardToVolatility: number | null;
    stopDistanceAtr: number | null;
    tpDistanceAtr: number | null;
    entryLocation: BaseGateFeatureEntryLocation;
  };
  scores?: Pick<
    Record<BaseGateFeatureScoreKey, number | null>,
    'structure' | 'participation' | 'execution' | 'totalContext'
  >;
  conflicts?: {
    count: number;
  };
  risk?: {
    liquidityRisk: BaseGateFeatureRiskLevel;
  };
  decisionHints?: {
    approveBias: BaseGateFeatureApproveBias;
    primaryIssue: BaseGateFeaturePrimaryIssue;
  };
  mtf?: {
    higherTimeframeConflict: boolean | null;
  };
  volatility?: {
    state: 'compressed' | 'normal' | 'expanded' | 'unknown';
    atrPctRankBucket: 'low' | 'normal' | 'high' | 'extreme' | 'unknown';
    bbWidthRankBucket: 'low' | 'normal' | 'high' | 'extreme' | 'unknown';
  };
  participation?: {
    volumeStructureAligned: boolean | null;
  };
  relative?: {
    benchmarkConflict: boolean;
    marketBreadthReturn: number | null;
    marketBreadthStale: boolean | null;
    cmcExchangeLiquidityAligned: boolean | null;
    cmcExchangeLiquidityStale: boolean | null;
    cmcExchangeLiquidityVolumeChange24hPct: number | null;
    cmcFearGreedValue: number | null;
    cmcFearGreedValueChange24h: number | null;
    cmcFearGreedStale: boolean | null;
    cmc20ToCmc100RatioChange24hPct: number | null;
    btcAltRegime:
      | 'btc_lead'
      | 'alt_lead'
      | 'risk_off'
      | 'risk_on'
      | 'mixed'
      | 'neutral'
      | 'unknown';
    btcAltRegimeStale: boolean | null;
    btcVsAltReturn24h: number | null;
  };
}

export interface BaseStrategyContextSnapshot {
  candle: Candle;
  prevCandle: Candle | null;
  raw: BaseRawIndicatorSnapshot;
  regime: BaseRegimeContext;
  structure: BaseStructureContext;
  participation: BaseParticipationContext;
  relative: BaseRelativeContext;
  derivatives?: DerivativesContext | null;
  mtf: BaseMultiTimeframeContext;
  gateFeatures?: BaseContextGateFeatures;
}

export interface BaseIndicatorsHistorySnapshot {
  maFast?: number[];
  maMedium?: number[];
  maSlow?: number[];
  atr?: number[];
  atrPct?: number[];
  bbUpper?: number[];
  bbMiddle?: number[];
  bbLower?: number[];
  obv?: number[];
  smaObv?: number[];
  macd?: number[];
  macdSignal?: number[];
  macdHistogram?: number[];
  price24hPcnt?: number[];
  price1hPcnt?: number[];
  highPrice1h?: number[];
  lowPrice1h?: number[];
  volume1h?: number[];
  highPrice24h?: number[];
  lowPrice24h?: number[];
  volume24h?: number[];
  highLevel?: number[];
  lowLevel?: number[];
  prevClose?: number[];
  correlation?: number[];
  spread?: number[];
}

export type IndicatorsHistorySnapshot = Record<string, number[] | Candle[]> &
  BaseIndicatorsHistorySnapshot &
  Partial<MlCandleIndicatorsSnapshot> & {
    baseContext?: BaseStrategyContextSnapshot;
  };

export interface IndicatorSnapshot {
  maFast: number;
  maMedium: number;
  maSlow: number;
  atr: number;
  atrPct: number | null;
  bbUpper: number;
  bbMiddle: number;
  bbLower: number;
  obv: number;
  smaObv: number;
  macd: number | undefined;
  macdSignal: number | undefined;
  macdHistogram: number | undefined;
  price24hPcnt: number;
  price1hPcnt: number;
  highPrice1h: number | null;
  lowPrice1h: number | null;
  volume1h: number | null;
  highPrice24h: number | null;
  lowPrice24h: number | null;
  volume24h: number | null;
  candle: Candle;
  prevCandle: Candle | null;
  highLevel: number | null;
  lowLevel: number | null;
  correlation: number;
  spread: number | null;
  baseContext?: BaseStrategyContextSnapshot;
}

export interface StrategyDirectionalTpSlParams {
  price: number;
  direction: Direction;
  takeProfitDelta: number;
  stopLossDelta: number;
  unit?: 'percent' | 'ratio';
  maxLossValue?: number;
  feePercent?: number;
}

export interface StrategyDirectionalTpSlResult {
  stopLossPrice: number;
  takeProfitPrice: number;
  riskRatio: number;
  qty?: number;
}

export interface StrategyLastTradeController {
  isInCooldown: (timestamp: number) => boolean;
  markTrade: (timestamp: number) => void;
  getLastTradeTimestamp: () => number | null;
}

export interface StrategyLastTradeControllerParams {
  env?: string;
  enabled?: boolean;
  cooldownMs?: number;
}

export type StrategySharedReplayStateGetter = <TState>(
  key: string | undefined,
  createState: () => TState,
) => TState;

export interface StrategyStateControllerOptions<TState, TSnapshot = TState> {
  sharedReplay?: boolean;
  configKey?: string;
  monotonic?: boolean;
  snapshot?: (state: TState) => TSnapshot;
  hash?: (snapshot: TSnapshot) => string;
}

export interface StrategyStateController<
  TState,
  TResult = unknown,
  TSnapshot = unknown,
> {
  get: () => TState;
  set: (state: TState) => void;
  update: (fn: (state: TState) => void) => TState;
  oncePerTimestamp: (
    timestamp: number,
    compute: (state: TState) => TResult,
  ) => TResult;
  snapshot: () => TSnapshot;
  hash: () => string;
}

export interface StrategyAPI<
  TIndicators = IndicatorsHistorySnapshot | Record<string, unknown>,
> {
  skip: (code: string) => Extract<StrategyDecision, { kind: 'skip' }>;
  entry: (
    params: StrategyAPIEntryParams,
  ) => Promise<Extract<StrategyDecision, { kind: 'entry' }>>;
  exit: (
    params: StrategyAPIExitParams,
  ) => Promise<Extract<StrategyDecision, { kind: 'exit' }>>;
  protect: (
    params: StrategyAPIProtectParams,
  ) => Extract<StrategyDecision, { kind: 'protect' }>;
  getCurrentIndicatorsContext: () => StrategyIndicatorsContext<TIndicators>;
  getBaseContext: () => BaseStrategyContextSnapshot | undefined;
  getDecisionBaseContext: () => Promise<
    BaseStrategyContextSnapshot | undefined
  >;
  getDecisionPriceContext: () => Promise<StrategyDecisionPriceContext>;
  getCurrentPosition: () => ReturnType<Connector['getPosition']>;
  getDirectionalTpSlPrices: (
    params: StrategyDirectionalTpSlParams,
  ) => StrategyDirectionalTpSlResult;
  createLastTradeController: (
    params?: StrategyLastTradeControllerParams,
  ) => StrategyLastTradeController;
  createStateController: <TState, TResult = unknown, TSnapshot = TState>(
    key: string,
    createState: () => TState,
    options?: StrategyStateControllerOptions<TState, TSnapshot>,
  ) => StrategyStateController<TState, TResult, TSnapshot>;
}

export interface StrategyIndicatorsState<
  TNext = unknown,
  TSnapshot = Record<string, any> | undefined,
> {
  isInitialized: () => boolean;
  setCurrentBar: (
    candle: KlineChartData[number],
    btcCandle: KlineChartData[number],
    ethCandle?: KlineChartData[number],
  ) => void;
  updateReferenceData?: (params: {
    btcBinanceData?: KlineChartData;
    btcCoinbaseData?: KlineChartData;
  }) => void;
  onBar: (
    candle?: KlineChartData[number],
    btcCandle?: KlineChartData[number],
    ethCandle?: KlineChartData[number],
  ) => void;
  next: (
    candle: KlineChartData[number],
    btcCandle: KlineChartData[number],
    ethCandle?: KlineChartData[number],
  ) => TNext;
  ensureInitializedWithCurrentBar: () => {
    snapshot: (options?: { compact?: boolean; limit?: number }) => TSnapshot;
  };
  snapshot: (options?: { compact?: boolean; limit?: number }) => TSnapshot;
  latestSnapshot?: () => TNext;
  latestNumber: <K extends Extract<keyof NonNullable<TSnapshot>, string>>(
    key: K,
  ) => number | undefined;
}

export interface StrategyRuntimeMlOptions {
  enabled?: boolean;
  modelKey?: string;
  strategyConfig?: StrategyConfig;
  mlThreshold?: number;
}

export type StrategyAiMode = 'gate' | 'llm';

export interface StrategyRuntimeAiOptions {
  enabled?: boolean;
  mode?: StrategyAiMode;
  minQuality?: number;
  replayAnalyses?: RuntimeAiAnalysisSnapshot[];
}

export interface StrategyEntryRuntimeOptions {
  ml?: StrategyRuntimeMlOptions;
  ai?: StrategyRuntimeAiOptions;
  beforePlaceOrder?: () => Promise<void>;
}

export interface StrategyEntryOrderPlan {
  qty: number;
  stopLossPrice: number;
  takeProfits: Tp[];
  positionIntent?: OrderPositionIntent;
}

export interface StrategyClosePlan {
  price: number;
  timestamp: number;
  direction: Direction;
}

export type StrategyDecision =
  | {
      kind: 'skip';
      code: string;
    }
  | {
      kind: 'entry';
      code: string;
      entryContext: StrategyEntrySignalContext;
      orderPlan: StrategyEntryOrderPlan;
      signal?: Signal;
      runtime?: StrategyEntryRuntimeOptions;
    }
  | {
      kind: 'exit';
      code: string;
      closePlan: StrategyClosePlan;
    }
  | {
      kind: 'protect';
      code: string;
      protectPlan: StrategyProtectPlan;
    };

export interface CreateStrategyCoreParams<
  TConfig extends StrategyConfig,
  TIndicatorsState extends StrategyIndicatorsState = StrategyIndicatorsState,
> {
  userName: string;
  symbol: string;
  config: TConfig;
  isConfigFromBacktest: boolean;
  connector: Connector;
  data: KlineChartData;
  btcData: KlineChartData;
  ethData?: KlineChartData;
  loadPineScriptFile: (fileNameOrPath: string, fallback?: string) => string;
  strategyApi: StrategyAPI<
    TIndicatorsState extends StrategyIndicatorsState<any, infer TSnapshot>
      ? TSnapshot
      : never
  >;
  indicatorsState: TIndicatorsState;
  sharedReplayKey?: string;
  getSharedReplayState?: StrategySharedReplayStateGetter;
}

export type StrategyCoreRunner = (
  candle: KlineChartItem,
  btcCandle: KlineChartItem,
) => Promise<StrategyDecision> | StrategyDecision;

export type CreateStrategyCore<
  TConfig extends StrategyConfig,
  TSnapshot extends Record<string, any> | undefined =
    | Record<string, any>
    | undefined,
  TNext = unknown,
> = (
  params: CreateStrategyCoreParams<
    TConfig,
    StrategyIndicatorsState<TNext, TSnapshot>
  >,
) => Promise<StrategyCoreRunner> | StrategyCoreRunner;

export interface StrategyRegistryEntry {
  manifest: StrategyManifest;
  creator: StrategyCreator;
}

export interface StrategyPluginDefinition {
  strategyEntries: StrategyRegistryEntry[];
}

export interface IndicatorPluginComputeParams {
  candle: Candle;
  btcCandle?: Candle;
  data: Candle[];
  btcData: Candle[];
  baseResult: Partial<IndicatorSnapshot>;
}

export interface IndicatorPluginFigureRenderer {
  key: string;
  title?: string;
  type?: 'line' | 'bar';
  color?: string;
  lineWidth?: number;
  dashed?: boolean;
  constant?: number;
}

export interface IndicatorPluginRenderer {
  indicatorName?: string;
  shortName?: string;
  paneId?: string;
  minHeight?: number;
  figures: IndicatorPluginFigureRenderer[];
}

export interface IndicatorPluginEntry {
  indicator: Indicator;
  historyKey?: string;
  compute?: (params: IndicatorPluginComputeParams) => number | null | undefined;
  renderer?: IndicatorPluginRenderer;
}

export interface IndicatorPluginDefinition {
  indicatorEntries: IndicatorPluginEntry[];
}
