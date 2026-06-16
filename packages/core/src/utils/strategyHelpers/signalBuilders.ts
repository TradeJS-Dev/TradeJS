import {
  BacktestPriceMode,
  BuildStrategySignalDraft,
  BuildStrategySignalParams,
  Connector,
  Direction,
  KlineChartData,
  Signal,
  StrategyDecision,
  StrategyAPI,
  StrategyAPIExitParams,
  StrategyAPIMarketDataParams,
  StrategyAPIEntryParams,
  StrategyAPIProtectParams,
  StrategyEntrySignalContext,
  StrategyEntryOrderPlan,
  StrategyEntryRuntimeOptions,
  StrategyLastTradeControllerParams,
  StrategyMarketSnapshot,
  StrategyRuntimeAiOptions,
  StrategyRuntimeMlOptions,
  BaseStrategyContextSnapshot,
  BaseContextGateFeatures,
  BaseGateFeatureConfirmation,
  BaseGateFeatureConflict,
  BaseGateFeatureEntryLocation,
  StrategySignalPriceParams,
} from '@tradejs/types';
import {
  calculateRiskRatio,
  getDirectionalTpSlPrices,
  getStrategyMarketSnapshot,
} from './market';
import { createLastTradeController } from './state';
import { uuid } from '../uuid';

type AiRuntimeConfigLike = {
  AI_ENABLED?: boolean;
  AI_MODE?: StrategyRuntimeAiOptions['mode'];
  MIN_AI_QUALITY?: number;
  AI_REPLAY_ANALYSES?: StrategyRuntimeAiOptions['replayAnalyses'];
};

type MlRuntimeConfigLike = {
  ML_ENABLED?: boolean;
  ML_THRESHOLD?: number;
};

const COMPACT_MTF_CANDLE_LIMIT = 3;

type RecordLike = Record<string, unknown>;

const isRecordLike = (value: unknown): value is RecordLike =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const asFiniteNumberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const asStringOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null;

const cloneSignalPayloadDataProperties = (
  value: unknown,
  seen = new WeakMap<object, unknown>(),
): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => cloneSignalPayloadDataProperties(item, seen));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const objectValue = value as Record<string, unknown>;
  const cached = seen.get(objectValue);
  if (cached) {
    return cached;
  }

  const clone: Record<string, unknown> = {};
  seen.set(objectValue, clone);

  for (const [key, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(objectValue),
  )) {
    if (!descriptor.enumerable || !('value' in descriptor)) {
      continue;
    }

    clone[key] = cloneSignalPayloadDataProperties(descriptor.value, seen);
  }

  return clone;
};

const cloneCompactArrayTail = (
  value: unknown,
  limit = COMPACT_MTF_CANDLE_LIMIT,
): BaseStrategyContextSnapshot['mtf']['candles']['m15'] =>
  (Array.isArray(value)
    ? cloneSignalPayloadDataProperties(value.slice(-limit))
    : []) as BaseStrategyContextSnapshot['mtf']['candles']['m15'];

const cloneCompactMtfContext = (
  baseContext: BaseStrategyContextSnapshot,
): BaseStrategyContextSnapshot['mtf'] | undefined => {
  const descriptor = Object.getOwnPropertyDescriptor(baseContext, 'mtf');
  const mtf =
    descriptor && 'get' in descriptor && typeof descriptor.get === 'function'
      ? descriptor.get.call(baseContext)
      : descriptor && 'value' in descriptor
        ? descriptor.value
        : undefined;

  if (!isRecordLike(mtf)) {
    return undefined;
  }

  const candles = isRecordLike(mtf.candles) ? mtf.candles : {};
  const benchmarkCandles = isRecordLike(mtf.benchmarkCandles)
    ? mtf.benchmarkCandles
    : {};

  return {
    compact: true,
    candles: {
      m15: cloneCompactArrayTail(candles.m15),
      h1: cloneCompactArrayTail(candles.h1),
      h4: cloneCompactArrayTail(candles.h4),
      d1: cloneCompactArrayTail(candles.d1),
    },
    benchmarkCandles: {
      m15: cloneCompactArrayTail(benchmarkCandles.m15),
      h1: cloneCompactArrayTail(benchmarkCandles.h1),
      h4: cloneCompactArrayTail(benchmarkCandles.h4),
      d1: cloneCompactArrayTail(benchmarkCandles.d1),
    },
    ...(isRecordLike(mtf.summary)
      ? { summary: cloneSignalPayloadDataProperties(mtf.summary) as any }
      : {}),
  };
};

const toRankBucket = (
  value: number | null,
): 'low' | 'normal' | 'high' | 'extreme' | 'unknown' => {
  if (value == null) return 'unknown';
  if (value >= 95) return 'extreme';
  if (value >= 80) return 'high';
  if (value <= 20) return 'low';
  return 'normal';
};

const toRangePositionBucket = (
  value: number | null,
): 'low' | 'middle' | 'high' | 'unknown' => {
  if (value == null) return 'unknown';
  if (value <= 0.2) return 'low';
  if (value >= 0.8) return 'high';
  return 'middle';
};

const toVolumeBucket = (
  value: number | null,
): 'thin' | 'normal' | 'elevated' | 'spike' | 'unknown' => {
  if (value == null) return 'unknown';
  if (value < 0.8) return 'thin';
  if (value < 1.5) return 'normal';
  if (value < 3) return 'elevated';
  return 'spike';
};

const toVenueSpreadSeverity = (
  value: number | null,
): 'normal' | 'elevated' | 'wide' | 'unknown' => {
  if (value == null) return 'unknown';
  const abs = Math.abs(value);
  if (abs >= 2) return 'wide';
  if (abs >= 1) return 'elevated';
  return 'normal';
};

const toDirectionalAlignment = ({
  direction,
  bullValue,
  bearValue,
  value,
}: {
  direction: Direction | null;
  bullValue: string;
  bearValue: string;
  value: string | null;
}): boolean | null => {
  if (!direction || !value) return null;
  return direction === 'LONG' ? value === bullValue : value === bearValue;
};

const toMtfAlignmentForDirection = ({
  direction,
  mtfAlignment,
}: {
  direction: Direction | null;
  mtfAlignment: string | null;
}): 'aligned' | 'against' | 'mixed' | 'neutral' | 'unknown' => {
  if (!direction || !mtfAlignment || mtfAlignment === 'unknown') {
    return 'unknown';
  }
  if (mtfAlignment === 'mixed') return 'mixed';
  if (mtfAlignment === 'neutral') return 'neutral';
  if (direction === 'LONG') {
    return mtfAlignment === 'aligned_bull'
      ? 'aligned'
      : mtfAlignment === 'aligned_bear'
        ? 'against'
        : 'unknown';
  }
  return mtfAlignment === 'aligned_bear'
    ? 'aligned'
    : mtfAlignment === 'aligned_bull'
      ? 'against'
      : 'unknown';
};

const toRelativeStrengthBucket = ({
  direction,
  value,
}: {
  direction: Direction | null;
  value: number | null;
}):
  | 'strong_against'
  | 'mild_against'
  | 'neutral'
  | 'mild_with'
  | 'strong_with'
  | 'unknown' => {
  if (!direction || value == null) return 'unknown';
  const signed = direction === 'LONG' ? value : -value;
  if (signed <= -3) return 'strong_against';
  if (signed < -1) return 'mild_against';
  if (signed >= 3) return 'strong_with';
  if (signed > 1) return 'mild_with';
  return 'neutral';
};

const toPressureBias = (value: number | null) =>
  value == null
    ? 'unknown'
    : value >= 0.55
      ? 'bull'
      : value <= 0.45
        ? 'bear'
        : 'neutral';

const toBiasAligned = ({
  direction,
  bias,
}: {
  direction: Direction | null;
  bias: 'bull' | 'bear' | 'neutral' | 'unknown';
}) =>
  direction == null || bias === 'unknown' || bias === 'neutral'
    ? null
    : direction === 'LONG'
      ? bias === 'bull'
      : bias === 'bear';

const clampScore = (value: number): number =>
  Math.max(0, Math.min(100, Math.round(value)));

const scoreEvidence = (
  evidence: Array<boolean | null | undefined>,
): number | null => {
  const known = evidence.filter((item) => typeof item === 'boolean');
  if (known.length === 0) return null;

  const positives = known.filter(Boolean).length;
  const negatives = known.length - positives;
  return clampScore(50 + positives * 12 - negatives * 15);
};

const averageScores = (scores: Array<number | null | undefined>) => {
  const known = scores.filter(
    (score): score is number =>
      typeof score === 'number' && Number.isFinite(score),
  );
  if (known.length === 0) return null;
  return clampScore(
    known.reduce((sum, score) => sum + score, 0) / known.length,
  );
};

const pushWhen = <T>(items: T[], condition: boolean, item: T) => {
  if (condition) {
    items.push(item);
  }
};

export const buildBaseContextGateFeatures = ({
  baseContext,
  direction,
  prices,
}: {
  baseContext: BaseStrategyContextSnapshot;
  direction: Direction | null;
  prices?: StrategySignalPriceParams | null;
}): NonNullable<BaseStrategyContextSnapshot['gateFeatures']> => {
  const mtfSummary = baseContext.mtf?.summary;
  const mtfAlignmentForDirection = toMtfAlignmentForDirection({
    direction,
    mtfAlignment: mtfSummary?.mtfAlignment ?? null,
  });
  const volatility = baseContext.regime?.volatility;
  const volatilityPercentiles = volatility?.percentiles;
  const localRange = baseContext.structure?.localRange;
  const liquidity = baseContext.structure?.liquidity;
  const volume = baseContext.participation?.volume;
  const delta = baseContext.participation?.delta;
  const tradeFlow = baseContext.participation?.tradeFlow;
  const volumeStructure = baseContext.participation?.volumeStructure;
  const relative = baseContext.relative?.benchmark;
  const marketBreadth = baseContext.relative?.marketBreadth;
  const cmcGlobal = baseContext.relative?.cmcGlobal;
  const cmcReferenceAssets = baseContext.relative?.cmcReferenceAssets;
  const cmcExchangeLiquidity = baseContext.relative?.cmcExchangeLiquidity;
  const cmcFearGreed = baseContext.relative?.cmcFearGreed;
  const targetVsBtc = baseContext.relative?.targetVsBtc;
  const targetVsEth = baseContext.relative?.targetVsEth;
  const btcAltRegime = baseContext.relative?.btcAltRegime;
  const referenceTradeFlow = baseContext.relative?.referenceTradeFlow;
  const execution = baseContext.relative?.execution;
  const primaryReferenceSymbol = referenceTradeFlow?.primaryReferenceSymbol;
  const primaryReferenceTradeFlow =
    primaryReferenceSymbol != null
      ? referenceTradeFlow?.tradeFlowBySymbol?.[primaryReferenceSymbol]
      : undefined;
  const atrPctRankBucket = toRankBucket(
    asFiniteNumberOrNull(volatilityPercentiles?.atrPctRank100),
  );
  const bbWidthRankBucket = toRankBucket(
    asFiniteNumberOrNull(volatilityPercentiles?.bbWidthRank100),
  );
  const atrPctZScore = asFiniteNumberOrNull(volatility?.atrPctZScore);
  const breakoutState = localRange?.breakoutState ?? 'unknown';
  const rangePosition20 = asFiniteNumberOrNull(localRange?.rangePosition20);
  const rangePositionBucket = toRangePositionBucket(rangePosition20);
  const breakoutWithDirection = toDirectionalAlignment({
    direction,
    bullValue: 'above_high_level',
    bearValue: 'below_low_level',
    value: breakoutState,
  });
  const failedBreakoutForDirection = toDirectionalAlignment({
    direction,
    bullValue: 'failed_low_breakout',
    bearValue: 'failed_high_breakout',
    value: breakoutState,
  });
  const liquiditySweepForDirection =
    !liquidity || direction == null
      ? null
      : direction === 'LONG'
        ? liquidity?.sweepState === 'swept_low'
        : liquidity?.sweepState === 'swept_high';
  const nearPointOfControl =
    baseContext.participation?.priceVolumeProfile?.nearPointOfControl ?? null;
  const volumeRel20 = asFiniteNumberOrNull(volume?.volumeRel20);
  const buyPressurePct = asFiniteNumberOrNull(delta?.buyPressurePct);
  const tradeFlowBuyPressurePct = asFiniteNumberOrNull(
    tradeFlow?.buyPressurePct,
  );
  const referenceTradeFlowBuyPressurePct = asFiniteNumberOrNull(
    primaryReferenceTradeFlow?.buyPressurePct,
  );
  const deltaDivergenceVsPrice = asStringOrNull(delta?.deltaDivergenceVsPrice);
  const deltaBias =
    deltaDivergenceVsPrice === 'bullish' || deltaDivergenceVsPrice === 'bearish'
      ? deltaDivergenceVsPrice === 'bullish'
        ? 'bull'
        : 'bear'
      : toPressureBias(buyPressurePct);
  const tradeFlowBias = tradeFlow?.stale
    ? 'unknown'
    : toPressureBias(tradeFlowBuyPressurePct);
  const referenceTradeFlowBias = primaryReferenceTradeFlow?.stale
    ? 'unknown'
    : toPressureBias(referenceTradeFlowBuyPressurePct);
  const deltaAligned = toBiasAligned({ direction, bias: deltaBias });
  const tradeFlowAligned = toBiasAligned({
    direction,
    bias: tradeFlowBias,
  });
  const referenceTradeFlowAligned = toBiasAligned({
    direction,
    bias: referenceTradeFlowBias,
  });
  const benchmarkTrendAlignment = relative?.trendAlignment ?? 'unknown';
  const relativeStrength1h = asFiniteNumberOrNull(relative?.relativeStrength1h);
  const relativeStrengthBucket = toRelativeStrengthBucket({
    direction,
    value: relativeStrength1h,
  });
  const benchmarkAligned =
    benchmarkTrendAlignment === 'against_benchmark'
      ? false
      : toDirectionalAlignment({
          direction,
          bullValue: 'aligned_bull',
          bearValue: 'aligned_bear',
          value: benchmarkTrendAlignment,
        });
  const totalUpVolumeShare = asFiniteNumberOrNull(
    volumeStructure?.totalUpVolumeShare,
  );
  const totalDownVolumeShare = asFiniteNumberOrNull(
    volumeStructure?.totalDownVolumeShare,
  );
  const directionalVolumeShare =
    direction === 'LONG'
      ? totalUpVolumeShare
      : direction === 'SHORT'
        ? totalDownVolumeShare
        : null;
  const volumeStructureAligned =
    directionalVolumeShare == null ? null : directionalVolumeShare >= 0.5;
  const marketBreadthReturn = asFiniteNumberOrNull(
    marketBreadth?.equalWeightedReturn,
  );
  const marketBreadthAligned =
    direction == null || marketBreadthReturn == null || marketBreadth?.stale
      ? null
      : direction === 'LONG'
        ? marketBreadthReturn >= 0
        : marketBreadthReturn <= 0;
  const cmcAltLiquidityRegime = cmcGlobal?.altLiquidityRegime ?? 'unknown';
  const cmcAltLiquidityStale =
    typeof cmcGlobal?.stale === 'boolean' ? cmcGlobal.stale : null;
  const cmcAltLiquidityAligned =
    direction == null ||
    cmcAltLiquidityStale === true ||
    cmcAltLiquidityRegime === 'unknown' ||
    cmcAltLiquidityRegime === 'neutral'
      ? null
      : direction === 'LONG'
        ? cmcAltLiquidityRegime === 'alt_friendly'
        : cmcAltLiquidityRegime === 'btc_favored' ||
          cmcAltLiquidityRegime === 'risk_off';
  const cmcEthBtcReferenceRegime =
    cmcReferenceAssets?.referenceLiquidityRegime ?? 'unknown';
  const cmcEthBtcStale =
    typeof cmcReferenceAssets?.stale === 'boolean'
      ? cmcReferenceAssets.stale
      : null;
  const cmcEthBtcAligned =
    direction == null ||
    cmcEthBtcStale === true ||
    cmcEthBtcReferenceRegime === 'unknown' ||
    cmcEthBtcReferenceRegime === 'balanced'
      ? null
      : direction === 'LONG'
        ? cmcEthBtcReferenceRegime === 'eth_led'
        : cmcEthBtcReferenceRegime === 'btc_led' ||
          cmcEthBtcReferenceRegime === 'thin';
  const cmcExchangeLiquidityRegime =
    cmcExchangeLiquidity?.liquidityRegime ?? 'unknown';
  const cmcExchangeLiquidityStale =
    typeof cmcExchangeLiquidity?.stale === 'boolean'
      ? cmcExchangeLiquidity.stale
      : null;
  const cmcExchangeLiquidityVolumeChange24hPct = asFiniteNumberOrNull(
    cmcExchangeLiquidity?.totalVolumeChange24hPct,
  );
  const cmcExchangeLiquidityAligned =
    cmcExchangeLiquidityStale === true ||
    cmcExchangeLiquidityRegime === 'unknown'
      ? null
      : cmcExchangeLiquidityRegime === 'expanding' ||
        cmcExchangeLiquidityRegime === 'balanced' ||
        cmcExchangeLiquidityRegime === 'binance_led';
  const cmcFearGreedRegime = cmcFearGreed?.sentimentRegime ?? 'unknown';
  const cmcFearGreedStale =
    typeof cmcFearGreed?.stale === 'boolean' ? cmcFearGreed.stale : null;
  const cmcFearGreedValue = asFiniteNumberOrNull(cmcFearGreed?.value);
  const cmcFearGreedValueChange24h = asFiniteNumberOrNull(
    cmcFearGreed?.valueChange24h,
  );
  const cmcFearGreedAligned =
    direction == null ||
    cmcFearGreedStale === true ||
    cmcFearGreedRegime === 'unknown' ||
    cmcFearGreedRegime === 'neutral' ||
    cmcFearGreedRegime === 'euphoric'
      ? null
      : direction === 'LONG'
        ? cmcFearGreedRegime === 'risk_on'
        : cmcFearGreedRegime === 'risk_off' ||
          cmcFearGreedRegime === 'capitulation';
  const targetVsBtcRatioReturn24h = asFiniteNumberOrNull(
    targetVsBtc?.ratioReturn24h,
  );
  const targetVsBtcAlpha24h = asFiniteNumberOrNull(targetVsBtc?.alphaVsBtc24h);
  const targetVsBtcBeta20 = asFiniteNumberOrNull(targetVsBtc?.betaToBtc20);
  const targetVsBtcCorrelation20 = asFiniteNumberOrNull(
    targetVsBtc?.correlationToBtc20,
  );
  const targetVsBtcRatioTrend = targetVsBtc?.ratioTrend ?? 'unknown';
  const targetVsBtcDirectionValue =
    targetVsBtcRatioReturn24h ?? targetVsBtcAlpha24h;
  const targetVsBtcAligned =
    direction == null || targetVsBtcDirectionValue == null
      ? null
      : direction === 'LONG'
        ? targetVsBtcDirectionValue >= 0
        : targetVsBtcDirectionValue <= 0;
  const targetVsEthRatioReturn24h = asFiniteNumberOrNull(
    targetVsEth?.ratioReturn24h,
  );
  const targetVsEthAlpha24h = asFiniteNumberOrNull(targetVsEth?.alphaVsEth24h);
  const targetVsEthBeta20 = asFiniteNumberOrNull(targetVsEth?.betaToEth20);
  const targetVsEthCorrelation20 = asFiniteNumberOrNull(
    targetVsEth?.correlationToEth20,
  );
  const targetVsEthRatioTrend = targetVsEth?.ratioTrend ?? 'unknown';
  const targetVsEthDirectionValue =
    targetVsEthRatioReturn24h ?? targetVsEthAlpha24h;
  const targetVsEthAligned =
    direction == null || targetVsEthDirectionValue == null
      ? null
      : direction === 'LONG'
        ? targetVsEthDirectionValue >= 0
        : targetVsEthDirectionValue <= 0;
  const btcAltRegimeValue = btcAltRegime?.regime ?? 'unknown';
  const btcAltRegimeStale =
    typeof btcAltRegime?.stale === 'boolean' ? btcAltRegime.stale : null;
  const btcAltRegimeAligned =
    direction == null ||
    btcAltRegimeStale === true ||
    btcAltRegimeValue === 'unknown' ||
    btcAltRegimeValue === 'neutral' ||
    btcAltRegimeValue === 'mixed'
      ? null
      : direction === 'LONG'
        ? btcAltRegimeValue === 'alt_lead' || btcAltRegimeValue === 'risk_on'
        : btcAltRegimeValue === 'btc_lead' || btcAltRegimeValue === 'risk_off';
  const btcVsAltReturn24h = asFiniteNumberOrNull(
    btcAltRegime?.btcVsAltReturn24h,
  );
  const btcTurnoverShare24h = asFiniteNumberOrNull(
    btcAltRegime?.btcTurnoverShare24h,
  );
  const venueSpreadZScore = asFiniteNumberOrNull(execution?.venueSpreadZScore);
  const venueSpreadSeverity = toVenueSpreadSeverity(venueSpreadZScore);
  const higherTimeframeConflict =
    mtfAlignmentForDirection === 'unknown'
      ? null
      : mtfAlignmentForDirection === 'against' ||
        mtfAlignmentForDirection === 'mixed';
  const extremeVolatilityRisk =
    Math.abs(atrPctZScore ?? 0) >= 2 || atrPctRankBucket === 'extreme';
  const compressionBreakoutSupport =
    (volatility?.state === 'compressed' || bbWidthRankBucket === 'low') &&
    breakoutState !== 'inside_range' &&
    breakoutState !== 'unknown';
  const benchmarkConflict =
    benchmarkAligned === false || relativeStrengthBucket.endsWith('_against');
  const derivativesSummary = baseContext.derivatives?.summary;
  const derivativesDirectionAligned =
    typeof derivativesSummary?.directionAligned === 'boolean'
      ? derivativesSummary.directionAligned
      : null;
  const derivativesRiskFlags = Array.isArray(derivativesSummary?.riskFlags)
    ? derivativesSummary.riskFlags
    : [];
  const derivativesCrowdedForDirection =
    direction === 'LONG'
      ? derivativesRiskFlags.includes('crowded_long')
      : direction === 'SHORT'
        ? derivativesRiskFlags.includes('crowded_short')
        : false;
  const derivativesCrowdedAny =
    derivativesRiskFlags.includes('crowded_long') ||
    derivativesRiskFlags.includes('crowded_short');
  const atr = asFiniteNumberOrNull(baseContext.raw?.volatility?.atr);
  const currentPrice = asFiniteNumberOrNull(prices?.currentPrice);
  const takeProfitPrice = asFiniteNumberOrNull(prices?.takeProfitPrice);
  const stopLossPrice = asFiniteNumberOrNull(prices?.stopLossPrice);
  const stopDistanceAtr =
    direction == null ||
    atr == null ||
    atr <= 0 ||
    currentPrice == null ||
    stopLossPrice == null
      ? null
      : direction === 'LONG'
        ? (currentPrice - stopLossPrice) / atr
        : (stopLossPrice - currentPrice) / atr;
  const tpDistanceAtr =
    direction == null ||
    atr == null ||
    atr <= 0 ||
    currentPrice == null ||
    takeProfitPrice == null
      ? null
      : direction === 'LONG'
        ? (takeProfitPrice - currentPrice) / atr
        : (currentPrice - takeProfitPrice) / atr;
  const entryLocation: BaseGateFeatureEntryLocation =
    breakoutWithDirection === true
      ? direction === 'SHORT'
        ? 'breakdown'
        : 'breakout'
      : rangePosition20 == null
        ? 'unknown'
        : rangePosition20 <= 0.25
          ? 'near_support'
          : rangePosition20 >= 0.75
            ? 'near_resistance'
            : 'mid_range';
  const confirmations: BaseGateFeatureConfirmation[] = [];
  pushWhen(
    confirmations,
    mtfAlignmentForDirection === 'aligned',
    'mtf_aligned',
  );
  pushWhen(confirmations, (volumeRel20 ?? 0) >= 1.5, 'volume_expansion');
  pushWhen(confirmations, deltaAligned === true, 'delta_aligned');
  pushWhen(confirmations, tradeFlowAligned === true, 'trade_flow_aligned');
  pushWhen(
    confirmations,
    referenceTradeFlowAligned === true,
    'reference_trade_flow_aligned',
  );
  pushWhen(
    confirmations,
    marketBreadthAligned === true,
    'market_breadth_aligned',
  );
  pushWhen(
    confirmations,
    cmcAltLiquidityAligned === true,
    'cmc_alt_liquidity_aligned',
  );
  pushWhen(confirmations, cmcEthBtcAligned === true, 'cmc_eth_btc_aligned');
  pushWhen(
    confirmations,
    cmcExchangeLiquidityAligned === true,
    'cmc_exchange_liquidity_aligned',
  );
  pushWhen(
    confirmations,
    cmcFearGreedAligned === true,
    'cmc_fear_greed_aligned',
  );
  pushWhen(confirmations, targetVsBtcAligned === true, 'target_vs_btc_aligned');
  pushWhen(confirmations, targetVsEthAligned === true, 'target_vs_eth_aligned');
  pushWhen(
    confirmations,
    btcAltRegimeAligned === true,
    'btc_alt_regime_aligned',
  );
  pushWhen(confirmations, benchmarkAligned === true, 'benchmark_aligned');
  pushWhen(confirmations, breakoutWithDirection === true, 'breakout_confirmed');
  pushWhen(
    confirmations,
    liquiditySweepForDirection === true,
    'liquidity_sweep_aligned',
  );
  pushWhen(
    confirmations,
    derivativesDirectionAligned === true,
    'derivatives_aligned',
  );
  const conflicts: BaseGateFeatureConflict[] = [];
  pushWhen(conflicts, mtfAlignmentForDirection === 'against', 'mtf_against');
  pushWhen(conflicts, mtfAlignmentForDirection === 'mixed', 'mtf_mixed');
  pushWhen(conflicts, benchmarkAligned === false, 'benchmark_against');
  pushWhen(
    conflicts,
    relativeStrengthBucket.endsWith('_against'),
    'relative_strength_against',
  );
  pushWhen(conflicts, marketBreadthAligned === false, 'market_breadth_against');
  pushWhen(
    conflicts,
    cmcAltLiquidityAligned === false,
    'cmc_alt_liquidity_against',
  );
  pushWhen(conflicts, cmcEthBtcAligned === false, 'cmc_eth_btc_against');
  pushWhen(
    conflicts,
    cmcExchangeLiquidityAligned === false,
    'cmc_exchange_liquidity_against',
  );
  pushWhen(conflicts, cmcFearGreedAligned === false, 'cmc_fear_greed_against');
  pushWhen(conflicts, targetVsBtcAligned === false, 'target_vs_btc_against');
  pushWhen(conflicts, targetVsEthAligned === false, 'target_vs_eth_against');
  pushWhen(conflicts, btcAltRegimeAligned === false, 'btc_alt_regime_against');
  pushWhen(conflicts, deltaAligned === false, 'delta_against');
  pushWhen(conflicts, tradeFlowAligned === false, 'trade_flow_against');
  pushWhen(
    conflicts,
    referenceTradeFlowAligned === false,
    'reference_trade_flow_against',
  );
  pushWhen(conflicts, failedBreakoutForDirection === true, 'failed_breakout');
  pushWhen(conflicts, extremeVolatilityRisk, 'extreme_volatility');
  pushWhen(conflicts, venueSpreadSeverity === 'wide', 'wide_spread');
  pushWhen(
    conflicts,
    derivativesDirectionAligned === false,
    'derivatives_against',
  );
  pushWhen(conflicts, derivativesCrowdedForDirection, 'derivatives_crowded');
  const scores: NonNullable<BaseContextGateFeatures['scores']> = {
    structure: scoreEvidence([
      breakoutWithDirection,
      failedBreakoutForDirection == null
        ? null
        : failedBreakoutForDirection === false,
      liquiditySweepForDirection,
      nearPointOfControl,
    ]),
    participation: scoreEvidence([
      volumeRel20 == null ? null : volumeRel20 >= 1.5,
      deltaAligned,
      tradeFlowAligned,
      referenceTradeFlowAligned,
      volumeStructureAligned,
    ]),
    relative: scoreEvidence([
      benchmarkAligned,
      marketBreadthAligned,
      cmcAltLiquidityAligned,
      cmcEthBtcAligned,
      cmcFearGreedAligned,
      targetVsBtcAligned,
      targetVsEthAligned,
      btcAltRegimeAligned,
      relativeStrengthBucket === 'unknown'
        ? null
        : !relativeStrengthBucket.endsWith('_against'),
    ]),
    mtf: scoreEvidence([
      mtfAlignmentForDirection === 'unknown'
        ? null
        : mtfAlignmentForDirection === 'aligned',
    ]),
    execution: scoreEvidence([
      venueSpreadSeverity === 'unknown' ? null : venueSpreadSeverity !== 'wide',
      cmcExchangeLiquidityAligned,
    ]),
    derivatives: scoreEvidence([derivativesDirectionAligned]),
    totalContext: null,
  };
  scores.totalContext = averageScores([
    scores.structure,
    scores.participation,
    scores.relative,
    scores.mtf,
    scores.execution,
    scores.derivatives,
  ]);
  const volatilityRisk = extremeVolatilityRisk
    ? 'high'
    : atrPctRankBucket === 'high' || bbWidthRankBucket === 'high'
      ? 'medium'
      : atrPctRankBucket === 'unknown' && bbWidthRankBucket === 'unknown'
        ? 'unknown'
        : 'low';
  const liquidityRisk =
    venueSpreadSeverity === 'wide' || cmcExchangeLiquidityAligned === false
      ? 'high'
      : venueSpreadSeverity === 'elevated'
        ? 'medium'
        : venueSpreadSeverity === 'unknown' &&
            cmcExchangeLiquidityAligned == null
          ? 'unknown'
          : 'low';
  const regimeRisk =
    higherTimeframeConflict === true
      ? 'high'
      : mtfAlignmentForDirection === 'neutral' ||
          mtfAlignmentForDirection === 'unknown'
        ? 'medium'
        : 'low';
  const crowdingRisk = derivativesCrowdedForDirection
    ? 'high'
    : derivativesCrowdedAny
      ? 'medium'
      : derivativesSummary
        ? 'low'
        : 'unknown';
  const chaseRisk =
    (direction === 'LONG' &&
      rangePositionBucket === 'high' &&
      breakoutWithDirection !== true) ||
    (direction === 'SHORT' &&
      rangePositionBucket === 'low' &&
      breakoutWithDirection !== true)
      ? 'high'
      : (tpDistanceAtr != null && tpDistanceAtr < 1) ||
          rangePositionBucket === 'high' ||
          rangePositionBucket === 'low'
        ? 'medium'
        : rangePositionBucket === 'unknown'
          ? 'unknown'
          : 'low';
  const primaryIssue = derivativesCrowdedForDirection
    ? 'crowded_derivatives'
    : higherTimeframeConflict === true
      ? 'mtf_conflict'
      : venueSpreadSeverity === 'wide' || cmcExchangeLiquidityAligned === false
        ? 'bad_execution'
        : extremeVolatilityRisk
          ? 'extreme_volatility'
          : benchmarkConflict ||
              marketBreadthAligned === false ||
              cmcAltLiquidityAligned === false ||
              cmcEthBtcAligned === false ||
              cmcFearGreedAligned === false ||
              targetVsBtcAligned === false ||
              targetVsEthAligned === false ||
              btcAltRegimeAligned === false
            ? 'market_context_against'
            : (scores.participation ?? 100) < 45
              ? 'weak_participation'
              : (scores.structure ?? 100) < 45
                ? 'weak_structure'
                : 'none';
  const needsExtraConfirmation =
    conflicts.length > 0 ||
    (scores.totalContext != null && scores.totalContext < 60);
  const approveBias =
    conflicts.length >= 3 ||
    primaryIssue === 'crowded_derivatives' ||
    primaryIssue === 'bad_execution' ||
    primaryIssue === 'mtf_conflict'
      ? 'reject'
      : confirmations.length >= 3 && conflicts.length === 0
        ? 'support'
        : 'neutral';
  const maxReasonableQuality =
    approveBias === 'reject'
      ? 2
      : conflicts.length >= 2 || needsExtraConfirmation
        ? 3
        : approveBias === 'support'
          ? 5
          : 4;

  return {
    direction,
    setup: {
      riskRatio: asFiniteNumberOrNull(prices?.riskRatio),
      rewardToVolatility: tpDistanceAtr,
      stopDistanceAtr,
      tpDistanceAtr,
      entryLocation,
    },
    scores,
    confirmations: {
      count: confirmations.length,
      items: confirmations,
    },
    conflicts: {
      count: conflicts.length,
      items: conflicts,
    },
    risk: {
      regimeRisk,
      liquidityRisk,
      volatilityRisk,
      crowdingRisk,
      chaseRisk,
    },
    decisionHints: {
      approveBias,
      maxReasonableQuality,
      needsExtraConfirmation,
      primaryIssue,
    },
    mtf: {
      alignmentForDirection: mtfAlignmentForDirection,
      higherTimeframeConflict,
      h1TrendBias: mtfSummary?.h1TrendBias ?? 'unknown',
      h4TrendBias: mtfSummary?.h4TrendBias ?? 'unknown',
      d1TrendBias: mtfSummary?.d1TrendBias ?? 'unknown',
      h1RangePosition: asFiniteNumberOrNull(mtfSummary?.h1RangePosition),
      h4VolatilityState: mtfSummary?.h4VolatilityState ?? 'unknown',
    },
    volatility: {
      state: volatility?.state ?? 'unknown',
      atrPctZScore,
      atrPctRankBucket,
      bbWidthRankBucket,
      extremeVolatilityRisk,
      compressionBreakoutSupport,
    },
    structure: {
      breakoutState,
      rangePositionBucket,
      breakoutWithDirection,
      failedBreakoutForDirection,
      liquiditySweepForDirection,
      nearPointOfControl,
    },
    participation: {
      volumeRel20,
      volumeBucket: toVolumeBucket(volumeRel20),
      deltaBias,
      deltaAligned,
      tradeFlowBuyPressurePct,
      tradeFlowAligned,
      referenceTradeFlowBuyPressurePct,
      referenceTradeFlowAligned,
      volumeStructureAligned,
    },
    relative: {
      benchmarkTrendAlignment,
      benchmarkAligned,
      benchmarkConflict,
      relativeStrength1h,
      relativeStrengthBucket,
      marketBreadthReturn,
      marketBreadthAligned,
      marketBreadthStale:
        typeof marketBreadth?.stale === 'boolean' ? marketBreadth.stale : null,
      cmcAltLiquidityRegime,
      cmcAltLiquidityAligned,
      cmcAltLiquidityStale,
      cmcEthBtcReferenceRegime,
      cmcEthBtcAligned,
      cmcEthBtcStale,
      cmcExchangeLiquidityRegime,
      cmcExchangeLiquidityAligned,
      cmcExchangeLiquidityStale,
      cmcExchangeLiquidityVolumeChange24hPct,
      cmcFearGreedValue,
      cmcFearGreedValueChange24h,
      cmcFearGreedRegime,
      cmcFearGreedAligned,
      cmcFearGreedStale,
      targetVsBtcRatioReturn24h,
      targetVsBtcAlpha24h,
      targetVsBtcBeta20,
      targetVsBtcCorrelation20,
      targetVsBtcRatioTrend,
      targetVsBtcAligned,
      targetVsEthRatioReturn24h,
      targetVsEthAlpha24h,
      targetVsEthBeta20,
      targetVsEthCorrelation20,
      targetVsEthRatioTrend,
      targetVsEthAligned,
      btcAltRegime: btcAltRegimeValue,
      btcAltRegimeAligned,
      btcAltRegimeStale,
      btcVsAltReturn24h,
      btcTurnoverShare24h,
    },
    execution: {
      venueSpreadZScore,
      venueSpreadSeverity,
    },
  };
};

const cloneBaseContextData = (
  baseContext: BaseStrategyContextSnapshot,
  direction: Direction | null,
  prices?: StrategySignalPriceParams | null,
): BaseStrategyContextSnapshot => {
  const clone = cloneSignalPayloadDataProperties(
    baseContext,
  ) as BaseStrategyContextSnapshot;
  const compactMtf = cloneCompactMtfContext(baseContext);

  if (compactMtf) {
    clone.mtf = compactMtf;
  }

  clone.gateFeatures = buildBaseContextGateFeatures({
    baseContext: clone,
    direction,
    prices,
  });

  return clone;
};

const normalizeAdditionalIndicatorsBaseContext = (
  additionalIndicators: BuildStrategySignalParams['additionalIndicators'],
  direction: Direction | null,
  prices?: StrategySignalPriceParams | null,
): BuildStrategySignalParams['additionalIndicators'] => {
  if (
    !additionalIndicators ||
    typeof additionalIndicators !== 'object' ||
    Array.isArray(additionalIndicators)
  ) {
    return additionalIndicators;
  }

  const baseContext = (
    additionalIndicators as { baseContext?: BaseStrategyContextSnapshot }
  ).baseContext;
  if (baseContext == null) {
    return additionalIndicators;
  }

  return {
    ...(additionalIndicators as Record<string, unknown>),
    baseContext: cloneBaseContextData(baseContext, direction, prices),
  } as BuildStrategySignalParams['additionalIndicators'];
};

export const refreshSignalBaseContextGateFeatures = (signal: Signal) => {
  const baseContext = signal.additionalIndicators?.baseContext;
  if (
    !baseContext ||
    typeof baseContext !== 'object' ||
    Array.isArray(baseContext)
  ) {
    return signal;
  }

  signal.additionalIndicators = {
    ...(signal.additionalIndicators ?? {}),
    baseContext: {
      ...(baseContext as BaseStrategyContextSnapshot),
      gateFeatures: buildBaseContextGateFeatures({
        baseContext: baseContext as BaseStrategyContextSnapshot,
        direction: signal.direction,
        prices: signal.prices,
      }),
    },
  };

  return signal;
};

export const mapAiRuntimeFromConfig = <TConfig extends AiRuntimeConfigLike>(
  config: TConfig,
  overrides: Partial<StrategyRuntimeAiOptions> = {},
): StrategyRuntimeAiOptions => ({
  enabled: Boolean(config.AI_ENABLED ?? true),
  mode: config.AI_MODE ?? 'llm',
  minQuality: Number(config.MIN_AI_QUALITY ?? 4),
  replayAnalyses: config.AI_REPLAY_ANALYSES,
  ...overrides,
});

export const mapMlRuntimeFromConfig = <TConfig extends MlRuntimeConfigLike>(
  config: TConfig,
  overrides: Partial<StrategyRuntimeMlOptions> = {},
): StrategyRuntimeMlOptions => ({
  enabled: Boolean(config.ML_ENABLED ?? true),
  mlThreshold: Number(config.ML_THRESHOLD ?? 0),
  ...overrides,
});

export const buildStrategySignal = ({
  signalId,
  strategy,
  symbol,
  interval,
  direction,
  timestamp,
  prices,
  figures = {},
  indicators = {},
  additionalIndicators,
  isConfigFromBacktest,
}: BuildStrategySignalParams): Signal => {
  const indicatorsRecord =
    indicators && typeof indicators === 'object' ? indicators : {};
  const baseContext = (
    indicatorsRecord as { baseContext?: BaseStrategyContextSnapshot }
  ).baseContext;
  const normalizedIndicators =
    baseContext == null
      ? indicators
      : Object.fromEntries(
          Object.entries(indicatorsRecord).filter(
            ([key]) => key !== 'baseContext',
          ),
        );
  const mergedAdditionalIndicators =
    baseContext == null
      ? additionalIndicators
      : {
          ...(additionalIndicators ?? {}),
          baseContext:
            (
              additionalIndicators as {
                baseContext?: BaseStrategyContextSnapshot;
              }
            )?.baseContext ?? baseContext,
        };
  const normalizedAdditionalIndicators =
    normalizeAdditionalIndicatorsBaseContext(
      mergedAdditionalIndicators,
      direction,
      prices,
    );

  return {
    signalId,
    strategy,
    symbol,
    interval,
    direction,
    timestamp,
    figures,
    prices,
    indicators: normalizedIndicators,
    additionalIndicators: normalizedAdditionalIndicators,
    isConfigFromBacktest,
  };
};

interface BuildEntrySignalDecisionParams {
  code: string;
  entryContext: StrategyEntrySignalContext;
  figures?: BuildStrategySignalDraft['figures'];
  indicators?: BuildStrategySignalDraft['indicators'];
  additionalIndicators?: BuildStrategySignalDraft['additionalIndicators'];
  signalId?: BuildStrategySignalDraft['signalId'];
  orderPlan: StrategyEntryOrderPlan;
  runtime?: StrategyEntryRuntimeOptions;
}

export const buildEntrySignalDecision = <
  TFigures extends
    BuildStrategySignalDraft['figures'] = BuildStrategySignalDraft['figures'],
  TIndicators extends
    BuildStrategySignalDraft['indicators'] = BuildStrategySignalDraft['indicators'],
  TAdditional extends
    BuildStrategySignalDraft['additionalIndicators'] = BuildStrategySignalDraft['additionalIndicators'],
>({
  code,
  entryContext,
  figures,
  indicators,
  additionalIndicators,
  signalId,
  orderPlan,
  runtime,
}: Omit<
  BuildEntrySignalDecisionParams,
  'figures' | 'indicators' | 'additionalIndicators'
> & {
  figures?: TFigures;
  indicators?: TIndicators;
  additionalIndicators?: TAdditional;
}): StrategyDecision => ({
  kind: 'entry',
  code,
  entryContext,
  signal: buildStrategySignal({
    signalId: signalId ?? uuid(),
    strategy: entryContext.strategy,
    symbol: entryContext.symbol,
    interval: entryContext.interval,
    direction: entryContext.direction,
    timestamp: entryContext.timestamp,
    prices: entryContext.prices,
    figures,
    indicators,
    additionalIndicators,
    isConfigFromBacktest: entryContext.isConfigFromBacktest,
  }),
  orderPlan,
  runtime,
});

interface CreateStrategyAPIParams {
  strategy: Signal['strategy'];
  symbol: Signal['symbol'];
  interval: Signal['interval'];
  env: string;
  connector: Connector;
  cachedData: KlineChartData;
  indicatorsState?: {
    next: (
      candle: KlineChartData[number],
      btcCandle: KlineChartData[number],
      ethCandle?: KlineChartData[number],
    ) => unknown;
  };
  preloadStart?: number;
  backtestPriceMode?: BacktestPriceMode;
  isConfigFromBacktest?: Signal['isConfigFromBacktest'];
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const toDefaultEntryCode = (strategy: string, direction: Direction) =>
  `${strategy
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toUpperCase()}_${direction}_ENTRY`;

const toDefaultExitCode = (strategy: string, direction: Direction) =>
  `${strategy
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toUpperCase()}_${direction}_EXIT`;

const toDefaultProtectCode = (strategy: string, direction: Direction) =>
  `${strategy
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toUpperCase()}_${direction}_PROTECT`;

const resolveTakeProfitPrice = ({
  direction,
  takeProfits,
}: {
  direction: Direction;
  takeProfits: StrategyEntryOrderPlan['takeProfits'];
}): number => {
  if (!Array.isArray(takeProfits) || takeProfits.length === 0) {
    throw new Error('strategyApi.entry requires at least one takeProfit');
  }

  const prices = takeProfits
    .map((tp) => tp?.price)
    .filter((price): price is number => isFiniteNumber(price));

  if (prices.length === 0) {
    throw new Error('strategyApi.entry requires finite takeProfit prices');
  }

  return direction === 'LONG' ? Math.max(...prices) : Math.min(...prices);
};

export const createStrategyAPI = ({
  strategy,
  symbol,
  interval,
  env,
  connector,
  cachedData,
  indicatorsState,
  preloadStart,
  isConfigFromBacktest,
}: CreateStrategyAPIParams): StrategyAPI => {
  const isBacktestEnv = env === 'BACKTEST';
  const barCache = {
    timestamp: null as number | null,
    currentPosition: undefined as
      | Promise<Awaited<ReturnType<Connector['getPosition']>>>
      | undefined,
    marketDataByKey: new Map<string, Promise<StrategyMarketSnapshot>>(),
  };
  const getCurrentBarTimestamp = () => {
    const lastCandle = cachedData[cachedData.length - 1];
    return typeof lastCandle?.timestamp === 'number'
      ? lastCandle.timestamp
      : null;
  };
  const ensureBarCache = () => {
    if (!isBacktestEnv) {
      return;
    }

    const currentBarTimestamp = getCurrentBarTimestamp();
    if (barCache.timestamp === currentBarTimestamp) {
      return;
    }

    barCache.timestamp = currentBarTimestamp;
    barCache.currentPosition = undefined;
    barCache.marketDataByKey.clear();
  };
  const getCurrentPosition = () => {
    if (!isBacktestEnv) {
      return connector.getPosition(symbol);
    }

    ensureBarCache();
    if (!barCache.currentPosition) {
      barCache.currentPosition = connector.getPosition(symbol);
    }

    return barCache.currentPosition;
  };
  const isPositionExists = async () => {
    const position = await getCurrentPosition();
    return Boolean(
      position && typeof position.qty === 'number' && position.qty > 0,
    );
  };

  const getMarketData = async (
    params: StrategyAPIMarketDataParams = {},
  ): Promise<StrategyMarketSnapshot> => {
    const resolvedPreloadStart = params.preloadStart ?? preloadStart;

    if (typeof resolvedPreloadStart !== 'number') {
      throw new Error('strategyApi.getMarketData requires preloadStart');
    }

    if (!isBacktestEnv) {
      return getStrategyMarketSnapshot({
        env,
        connector,
        symbol,
        interval,
        cachedData,
        preloadStart: resolvedPreloadStart,
      });
    }

    ensureBarCache();

    const cacheKey = String(resolvedPreloadStart);
    let snapshot = barCache.marketDataByKey.get(cacheKey);
    if (!snapshot) {
      snapshot = getStrategyMarketSnapshot({
        env,
        connector,
        symbol,
        interval,
        cachedData,
        preloadStart: resolvedPreloadStart,
      });
      barCache.marketDataByKey.set(cacheKey, snapshot);
    }

    return snapshot;
  };

  return {
    skip: (code) => ({ kind: 'skip', code }),
    entry: async ({
      code,
      direction,
      figures,
      indicators,
      additionalIndicators,
      signalId,
      orderPlan,
      runtime,
    }: StrategyAPIEntryParams) => {
      const marketData = await getMarketData();
      const currentPrice = marketData.currentPrice;
      const timestamp = marketData.timestamp;
      const stopLossPrice = orderPlan.stopLossPrice;
      const takeProfitPrice = resolveTakeProfitPrice({
        direction,
        takeProfits: orderPlan.takeProfits,
      });

      if (!isFiniteNumber(stopLossPrice)) {
        throw new Error(
          'strategyApi.entry requires finite orderPlan.stopLossPrice',
        );
      }

      const resolvedCode =
        code ?? toDefaultEntryCode(String(strategy), direction);
      const riskRatio = calculateRiskRatio({
        direction,
        currentPrice,
        takeProfitPrice,
        stopLossPrice,
      });

      return buildEntrySignalDecision({
        code: resolvedCode,
        entryContext: {
          strategy,
          symbol,
          interval,
          direction,
          timestamp,
          prices: {
            currentPrice,
            takeProfitPrice,
            stopLossPrice,
            riskRatio,
          },
          isConfigFromBacktest,
        },
        figures,
        indicators,
        additionalIndicators,
        signalId,
        orderPlan,
        runtime,
      }) as Extract<StrategyDecision, { kind: 'entry' }>;
    },
    exit: async ({
      code,
      direction,
      price,
      timestamp,
    }: StrategyAPIExitParams) => {
      const marketData = await getMarketData();
      return {
        kind: 'exit',
        code: code ?? toDefaultExitCode(String(strategy), direction),
        closePlan: {
          price: price ?? marketData.currentPrice,
          timestamp: timestamp ?? marketData.timestamp,
          direction,
        },
      } as Extract<StrategyDecision, { kind: 'exit' }>;
    },
    protect: ({ code, protectPlan }: StrategyAPIProtectParams) =>
      ({
        kind: 'protect',
        code:
          code ?? toDefaultProtectCode(String(strategy), protectPlan.direction),
        protectPlan,
      }) as Extract<StrategyDecision, { kind: 'protect' }>,
    getMarketData,
    nextIndicators: (candle, btcCandle, ethCandle) =>
      ethCandle == null
        ? indicatorsState?.next(candle, btcCandle)
        : indicatorsState?.next(candle, btcCandle, ethCandle),
    getCurrentPosition,
    isCurrentPositionExists: isPositionExists,
    getDirectionalTpSlPrices: (params) => getDirectionalTpSlPrices(params),
    createLastTradeController: (params?: StrategyLastTradeControllerParams) =>
      createLastTradeController({
        env,
        ...params,
      }),
  };
};
