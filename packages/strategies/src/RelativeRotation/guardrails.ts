import type { BaseStrategyContextSnapshot, Direction } from '@tradejs/types';
import type { RelativeRotationSignalContext } from './core';

export type RelativeRotationGuardrailContext = Omit<
  Partial<RelativeRotationSignalContext>,
  'signalDirection'
> & {
  signalDirection: Direction | null;
  baseContextAvailable: boolean;
  targetVsBtcRatioReturn1h: number | null;
  targetVsBtcAlpha1h: number | null;
  targetVsEthAligned: boolean | null;
  trendBias: string | null;
  distanceToLowLevelAtr: number | null;
  adxDiMinus: number | null;
  price1hPct: number | null;
  marketBreadthDispersion: number | null;
  altBasketReturn1h: number | null;
  btcVsAltReturn1h: number | null;
  btcTurnoverShare24h: number | null;
  cmcFearGreedValueChange7d: number | null;
  cmcFearGreedStale: boolean | null;
  minutesToFundingWindow: number | null;
  contextConflictCount: number | null;
  totalContextScore: number | null;
  hardBlockReasons: string[];
  softBlockReasons: string[];
  deterministicQuality: number;
  approvalAllowedNow: boolean;
};

const asFiniteNumber = (value: unknown): number | null => {
  if (value == null || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const asDirection = (value: unknown): Direction | null =>
  value === 'LONG' || value === 'SHORT' ? value : null;

const SHORT_BREAKDOWN_DISTANCE_TO_LOW_MAX_ATR = -2.75;
const SHORT_ADX_DI_MINUS_MAX = 50;
const SHORT_HOURLY_PRICE_CHANGE_MAX_PCT = -5;
const SHORT_BREADTH_RECOVERY_DISPERSION_MIN = 0.0085;
const SHORT_BREADTH_RECOVERY_ALT_RETURN_1H_MIN = -0.015;
const SHORT_BTC_VS_ALT_RETURN_1H_MIN = -0.001;
const SHORT_BTC_TURNOVER_SHARE_24H_MIN = 0.25;
const SHORT_FEAR_GREED_CHANGE_7D_MIN = -12;
const SHORT_MINUTES_TO_NEXT_FUNDING_MAX = 435;

const isTrendAligned = ({
  direction,
  trend,
}: {
  direction: Direction | null;
  trend: string | null | undefined;
}): boolean | null => {
  if (!direction || !trend || trend === 'unknown' || trend === 'flat') {
    return null;
  }

  return direction === 'LONG' ? trend === 'up' : trend === 'down';
};

export const buildRelativeRotationGuardrailContext = ({
  signalContext,
  baseContext,
}: {
  signalContext: Partial<RelativeRotationSignalContext>;
  baseContext?: BaseStrategyContextSnapshot | null;
}): RelativeRotationGuardrailContext => {
  const signalDirection = asDirection(signalContext.signalDirection);
  const targetVsBtc = baseContext?.relative?.targetVsBtc;
  const targetVsEth = baseContext?.relative?.targetVsEth;
  const targetVsBtcRatioReturn1h = asFiniteNumber(targetVsBtc?.ratioReturn1h);
  const targetVsBtcAlpha1h = asFiniteNumber(targetVsBtc?.alphaVsBtc1h);
  const targetVsBtcAlpha24h =
    asFiniteNumber(signalContext.targetVsBtcAlpha24h) ??
    asFiniteNumber(targetVsBtc?.alphaVsBtc24h);
  const targetVsBtcRatioReturn24h =
    asFiniteNumber(signalContext.targetVsBtcRatioReturn24h) ??
    asFiniteNumber(targetVsBtc?.ratioReturn24h);
  const targetVsEthAlpha24h =
    asFiniteNumber(signalContext.targetVsEthAlpha24h) ??
    asFiniteNumber(targetVsEth?.alphaVsEth24h);
  const targetVsEthRatioReturn24h =
    asFiniteNumber(signalContext.targetVsEthRatioReturn24h) ??
    asFiniteNumber(targetVsEth?.ratioReturn24h);
  const targetVsEthRatioTrend =
    signalContext.targetVsEthRatioTrend ?? targetVsEth?.ratioTrend ?? null;
  const targetVsEthAligned = isTrendAligned({
    direction: signalDirection,
    trend: targetVsEthRatioTrend,
  });
  const btcAltRegime =
    signalContext.btcAltRegime ??
    baseContext?.relative?.btcAltRegime?.regime ??
    null;
  const marketBreadthReturn =
    asFiniteNumber(signalContext.marketBreadthReturn) ??
    asFiniteNumber(baseContext?.relative?.marketBreadth?.equalWeightedReturn);
  const volumeRel20 =
    asFiniteNumber(signalContext.volumeRel20) ??
    asFiniteNumber(baseContext?.participation?.volume?.volumeRel20);
  const trendBias = baseContext?.regime?.trend?.bias ?? null;
  const distanceToLowLevelAtr = asFiniteNumber(
    baseContext?.structure?.localRange?.distanceToLowLevelAtr,
  );
  const adxDiMinus = asFiniteNumber(baseContext?.regime?.trend?.adx?.diMinus);
  const price1hPct = asFiniteNumber(baseContext?.raw?.price?.price1hPct);
  const marketBreadthDispersion = asFiniteNumber(
    baseContext?.relative?.marketBreadth?.dispersion,
  );
  const altBasketReturn1h = asFiniteNumber(
    baseContext?.relative?.btcAltRegime?.altBasketReturn1h,
  );
  const btcVsAltReturn1h = asFiniteNumber(
    baseContext?.relative?.btcAltRegime?.btcVsAltReturn1h,
  );
  const btcTurnoverShare24h = asFiniteNumber(
    baseContext?.relative?.btcAltRegime?.btcTurnoverShare24h,
  );
  const cmcFearGreedValueChange7d = asFiniteNumber(
    baseContext?.relative?.cmcFearGreed?.valueChange7d,
  );
  const cmcFearGreedStale =
    typeof baseContext?.relative?.cmcFearGreed?.stale === 'boolean'
      ? baseContext.relative.cmcFearGreed.stale
      : null;
  const minutesToFundingWindow = asFiniteNumber(
    baseContext?.regime?.session?.minutesToFundingWindow,
  );
  const contextConflictCount = asFiniteNumber(
    baseContext?.gateFeatures?.conflicts?.count,
  );
  const totalContextScore = asFiniteNumber(
    baseContext?.gateFeatures?.scores?.totalContext,
  );
  const hardBlockReasons: string[] = [];
  const softBlockReasons: string[] = [];

  if (!signalDirection) {
    hardBlockReasons.push('missing_direction');
  }
  if (
    targetVsBtcRatioReturn1h == null ||
    targetVsBtcAlpha24h == null ||
    targetVsBtcRatioReturn24h == null
  ) {
    hardBlockReasons.push('missing_target_vs_btc_context');
  }
  if (distanceToLowLevelAtr == null) {
    hardBlockReasons.push('missing_distance_to_low_level_atr');
  }
  if (adxDiMinus == null) {
    hardBlockReasons.push('missing_adx_di_minus');
  }
  if (price1hPct == null) {
    hardBlockReasons.push('missing_price_1h_pct');
  }
  if (btcVsAltReturn1h == null) {
    hardBlockReasons.push('missing_btc_vs_alt_return_1h');
  }
  if (btcTurnoverShare24h == null) {
    hardBlockReasons.push('missing_btc_turnover_share_24h');
  }
  if (cmcFearGreedValueChange7d == null) {
    hardBlockReasons.push('missing_cmc_fear_greed_change_7d');
  }
  if (cmcFearGreedStale == null) {
    hardBlockReasons.push('missing_cmc_fear_greed_freshness');
  } else if (cmcFearGreedStale) {
    hardBlockReasons.push('stale_cmc_fear_greed_context');
  }
  if (minutesToFundingWindow == null) {
    hardBlockReasons.push('missing_minutes_to_funding_window');
  }
  if (signalDirection && signalDirection !== 'SHORT') {
    softBlockReasons.push('long_direction_not_validated');
  }
  if (
    distanceToLowLevelAtr != null &&
    distanceToLowLevelAtr > SHORT_BREAKDOWN_DISTANCE_TO_LOW_MAX_ATR
  ) {
    softBlockReasons.push('insufficient_breakdown_distance');
  }
  if (adxDiMinus != null && adxDiMinus > SHORT_ADX_DI_MINUS_MAX) {
    softBlockReasons.push('adx_di_minus_above_stable_range');
  }
  if (price1hPct != null && price1hPct > SHORT_HOURLY_PRICE_CHANGE_MAX_PCT) {
    softBlockReasons.push('insufficient_hourly_downside_impulse');
  }
  if (
    cmcFearGreedValueChange7d != null &&
    cmcFearGreedValueChange7d < SHORT_FEAR_GREED_CHANGE_7D_MIN
  ) {
    softBlockReasons.push('fear_greed_7d_drop_below_stable_range');
  }

  const stableShortBreakdown =
    signalDirection === 'SHORT' &&
    distanceToLowLevelAtr != null &&
    distanceToLowLevelAtr <= SHORT_BREAKDOWN_DISTANCE_TO_LOW_MAX_ATR &&
    adxDiMinus != null &&
    adxDiMinus <= SHORT_ADX_DI_MINUS_MAX &&
    price1hPct != null &&
    price1hPct <= SHORT_HOURLY_PRICE_CHANGE_MAX_PCT &&
    cmcFearGreedValueChange7d != null &&
    cmcFearGreedValueChange7d >= SHORT_FEAR_GREED_CHANGE_7D_MIN &&
    cmcFearGreedStale === false;
  const stableBreadthRecovery =
    signalDirection === 'SHORT' &&
    marketBreadthDispersion != null &&
    marketBreadthDispersion >= SHORT_BREADTH_RECOVERY_DISPERSION_MIN &&
    price1hPct != null &&
    price1hPct <= SHORT_HOURLY_PRICE_CHANGE_MAX_PCT &&
    altBasketReturn1h != null &&
    altBasketReturn1h >= SHORT_BREADTH_RECOVERY_ALT_RETURN_1H_MIN &&
    cmcFearGreedValueChange7d != null &&
    cmcFearGreedValueChange7d >= SHORT_FEAR_GREED_CHANGE_7D_MIN &&
    cmcFearGreedStale === false;
  if (stableBreadthRecovery) {
    softBlockReasons.length = 0;
  }
  const stableBtcMarketLeadership =
    btcVsAltReturn1h != null &&
    btcVsAltReturn1h >= SHORT_BTC_VS_ALT_RETURN_1H_MIN &&
    btcTurnoverShare24h != null &&
    btcTurnoverShare24h >= SHORT_BTC_TURNOVER_SHARE_24H_MIN;
  const outsidePostFundingCooldown =
    minutesToFundingWindow != null &&
    minutesToFundingWindow <= SHORT_MINUTES_TO_NEXT_FUNDING_MAX;
  if (
    btcVsAltReturn1h != null &&
    btcVsAltReturn1h < SHORT_BTC_VS_ALT_RETURN_1H_MIN
  ) {
    softBlockReasons.push('btc_vs_alt_return_1h_below_stable_range');
  }
  if (
    btcTurnoverShare24h != null &&
    btcTurnoverShare24h < SHORT_BTC_TURNOVER_SHARE_24H_MIN
  ) {
    softBlockReasons.push('btc_turnover_share_24h_below_stable_range');
  }
  if (
    minutesToFundingWindow != null &&
    minutesToFundingWindow > SHORT_MINUTES_TO_NEXT_FUNDING_MAX
  ) {
    softBlockReasons.push('post_funding_cooldown_active');
  }
  const deterministicQuality =
    hardBlockReasons.length > 0
      ? 1
      : (stableShortBreakdown || stableBreadthRecovery) &&
          stableBtcMarketLeadership &&
          outsidePostFundingCooldown
        ? 4
        : 3;

  return {
    ...signalContext,
    signalDirection,
    baseContextAvailable: Boolean(baseContext),
    targetVsBtcRatioReturn1h,
    targetVsBtcAlpha1h,
    targetVsBtcAlpha24h,
    targetVsBtcRatioReturn24h,
    targetVsEthAlpha24h,
    targetVsEthRatioReturn24h,
    targetVsEthRatioTrend,
    targetVsEthAligned,
    btcAltRegime,
    marketBreadthReturn,
    volumeRel20,
    trendBias,
    distanceToLowLevelAtr,
    adxDiMinus,
    price1hPct,
    marketBreadthDispersion,
    altBasketReturn1h,
    btcVsAltReturn1h,
    btcTurnoverShare24h,
    cmcFearGreedValueChange7d,
    cmcFearGreedStale,
    minutesToFundingWindow,
    contextConflictCount,
    totalContextScore,
    hardBlockReasons,
    softBlockReasons,
    deterministicQuality,
    approvalAllowedNow:
      deterministicQuality >= 4 && hardBlockReasons.length === 0,
  };
};
