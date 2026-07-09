import { BaseStrategyContextSnapshot } from '@tradejs/types';
import { AdaptiveTrendChannelSignalContext } from './engine';

export type AdaptiveTrendChannelGuardrailContext =
  Partial<AdaptiveTrendChannelSignalContext> & {
    baseContextAvailable: boolean;
    primarySession: string | null;
    trendBias: string | null;
    adaptiveChannelRegime: string | null;
    breakoutState: string | null;
    volumeRel20: number | null;
    rsi: number | null;
    bbWidthRank100: number | null;
    trendFollowState: string | null;
    h4VolatilityState: string | null;
    benchmarkTrendAlignment: string | null;
    cmcExchangeLiquidityAligned: boolean | null;
    cmcExchangeLiquidityStale: boolean | null;
    targetLiqImbalance1h: number | null;
    targetLiqSpikeRatio1h: number | null;
    targetLiqTotal1h: number | null;
    ethFundingRate1h: number | null;
    xrpOpenInterest15m: number | null;
    baseApproveBias: string | null;
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

const isDirectionAligned = ({
  direction,
  bullishValue,
  bearishValue,
  value,
}: {
  direction: unknown;
  bullishValue: string;
  bearishValue: string;
  value: string | null;
}) =>
  direction === 'LONG'
    ? value === bullishValue
    : direction === 'SHORT'
      ? value === bearishValue
      : false;

const MIN_APPROVAL_BREAKOUT_DISTANCE_PCT = 4;
const MIN_SHORT_APPROVAL_BREAKOUT_DISTANCE_PCT = 4.2;
const MIN_HIGH_CONFIDENCE_BREAKOUT_DISTANCE_PCT = 4;
const MIN_APPROVAL_CHANNEL_WIDTH_PCT = 2;
const MIN_HIGH_CONFIDENCE_CHANNEL_WIDTH_PCT = 2;
const MIN_APPROVAL_VOLUME_REL20 = 10;
const MIN_SHORT_APPROVAL_VOLUME_REL20 = 7;
const MAX_SHORT_RECOVERY_TARGET_LIQ_IMBALANCE_1H = -0.97;
const MIN_SHORT_RECOVERY_TARGET_LIQ_SPIKE_RATIO_1H = 5.7;
const MAX_SHORT_RECOVERY_ETH_FUNDING_RATE_1H = 0.0037;
const MIN_XRP_OI_REJECT_BIAS_BLOCK_15M = 250_000_000;
const MAX_APPROVAL_RSI = 75;
const MIN_APPROVAL_BB_WIDTH_RANK_100 = 50;

export const buildAdaptiveTrendChannelGuardrailContext = ({
  signalContext,
  baseContext,
}: {
  signalContext: Partial<AdaptiveTrendChannelSignalContext>;
  baseContext?: BaseStrategyContextSnapshot | null;
}): AdaptiveTrendChannelGuardrailContext => {
  const targetDerivatives1h = baseContext?.derivatives?.intervals?.['1h'];
  const ethDerivatives1h =
    baseContext?.derivatives?.referenceContexts?.['ETHUSDT']?.intervals?.['1h'];
  const xrpDerivatives15m =
    baseContext?.derivatives?.referenceContexts?.['XRPUSDT']?.intervals?.[
      '15m'
    ];
  const targetDerivatives1hStale = targetDerivatives1h?.stale === true;
  const ethDerivatives1hStale = ethDerivatives1h?.stale === true;
  const primarySession = baseContext?.regime?.session?.sessionPhase ?? null;
  const trendBias = baseContext?.regime?.trend?.bias ?? null;
  const adaptiveChannelRegime =
    signalContext.regime === 1
      ? 'bull'
      : signalContext.regime === -1
        ? 'bear'
        : null;
  const breakoutState =
    baseContext?.structure?.localRange?.breakoutState ?? null;
  const volumeRel20 = asFiniteNumber(
    baseContext?.participation?.volume?.volumeRel20,
  );
  const rsi = asFiniteNumber(baseContext?.regime?.momentum?.rsi);
  const bbWidthRank100 = asFiniteNumber(
    baseContext?.regime?.volatility?.percentiles?.bbWidthRank100,
  );
  const trendFollowState =
    baseContext?.regime?.trend?.trendFollow?.state ?? null;
  const h4VolatilityState =
    baseContext?.mtf?.summary?.h4VolatilityState ?? null;
  const benchmarkTrendAlignment =
    baseContext?.relative?.benchmark?.trendAlignment ?? null;
  const cmcExchangeLiquidityAligned =
    typeof baseContext?.gateFeatures?.relative?.cmcExchangeLiquidityAligned ===
    'boolean'
      ? baseContext.gateFeatures.relative.cmcExchangeLiquidityAligned
      : null;
  const cmcExchangeLiquidityStale =
    typeof baseContext?.gateFeatures?.relative?.cmcExchangeLiquidityStale ===
    'boolean'
      ? baseContext.gateFeatures.relative.cmcExchangeLiquidityStale
      : null;
  const baseApproveBias =
    baseContext?.gateFeatures?.decisionHints?.approveBias ?? null;
  const targetLiqImbalance1h = asFiniteNumber(
    targetDerivatives1h?.liqImbalance,
  );
  const targetLiqSpikeRatio1h = asFiniteNumber(
    targetDerivatives1h?.liqSpikeRatio,
  );
  const targetLiqTotal1h = asFiniteNumber(targetDerivatives1h?.liqTotal);
  const ethFundingRate1h = asFiniteNumber(ethDerivatives1h?.fundingRate);
  const xrpOpenInterest15m = asFiniteNumber(xrpDerivatives15m?.openInterest);
  const hardBlockReasons: string[] = [];
  const softBlockReasons: string[] = [];

  if (
    signalContext.signalDirection !== 'LONG' &&
    signalContext.signalDirection !== 'SHORT'
  ) {
    hardBlockReasons.push('missing_direction');
  }
  if ((signalContext.atr ?? 0) <= 0 || (signalContext.halfChannel ?? 0) <= 0) {
    hardBlockReasons.push('missing_channel_width');
  }
  if ((signalContext.channelWidthPct ?? 0) <= 0) {
    hardBlockReasons.push('invalid_channel');
  }
  if (
    xrpOpenInterest15m != null &&
    xrpOpenInterest15m >= MIN_XRP_OI_REJECT_BIAS_BLOCK_15M &&
    baseApproveBias === 'reject'
  ) {
    hardBlockReasons.push('xrp_oi_reject_bias');
  }

  const direction = signalContext.signalDirection;
  const breakoutAligned = isDirectionAligned({
    direction,
    bullishValue: 'above_high_level',
    bearishValue: 'below_low_level',
    value: breakoutState,
  });

  if (volumeRel20 != null && volumeRel20 < 0.8) {
    softBlockReasons.push('thin_participation');
  }

  const breakoutDistancePct = Math.abs(signalContext.breakoutDistancePct ?? 0);
  const channelWidthPct = signalContext.channelWidthPct ?? 0;
  const minApprovalBreakoutDistancePct =
    direction === 'SHORT'
      ? MIN_SHORT_APPROVAL_BREAKOUT_DISTANCE_PCT
      : MIN_APPROVAL_BREAKOUT_DISTANCE_PCT;
  const minApprovalVolumeRel20 =
    direction === 'SHORT'
      ? MIN_SHORT_APPROVAL_VOLUME_REL20
      : MIN_APPROVAL_VOLUME_REL20;
  const cmcExchangeLiquiditySupportsApproval =
    direction === 'LONG' &&
    cmcExchangeLiquidityAligned === true &&
    cmcExchangeLiquidityStale !== true;
  const trendFollowSupportsApproval =
    direction === 'LONG' && trendFollowState === 'bull';
  const longApprovalSetup =
    direction === 'LONG' &&
    breakoutAligned &&
    h4VolatilityState === 'expanded' &&
    cmcExchangeLiquiditySupportsApproval &&
    trendFollowSupportsApproval &&
    breakoutDistancePct >= minApprovalBreakoutDistancePct &&
    channelWidthPct >= MIN_APPROVAL_CHANNEL_WIDTH_PCT &&
    (volumeRel20 ?? 0) >= minApprovalVolumeRel20 &&
    (rsi ?? Number.POSITIVE_INFINITY) <= MAX_APPROVAL_RSI &&
    (bbWidthRank100 ?? 0) >= MIN_APPROVAL_BB_WIDTH_RANK_100;
  const shortRecoverySetup =
    direction === 'SHORT' &&
    targetDerivatives1hStale !== true &&
    ethDerivatives1hStale !== true &&
    targetLiqImbalance1h != null &&
    targetLiqSpikeRatio1h != null &&
    ethFundingRate1h != null &&
    targetLiqImbalance1h <= MAX_SHORT_RECOVERY_TARGET_LIQ_IMBALANCE_1H &&
    targetLiqSpikeRatio1h >= MIN_SHORT_RECOVERY_TARGET_LIQ_SPIKE_RATIO_1H &&
    ethFundingRate1h <= MAX_SHORT_RECOVERY_ETH_FUNDING_RATE_1H;
  const approvalSetup = longApprovalSetup || shortRecoverySetup;
  const highConfidenceSetup =
    longApprovalSetup &&
    breakoutDistancePct >= MIN_HIGH_CONFIDENCE_BREAKOUT_DISTANCE_PCT &&
    channelWidthPct >= MIN_HIGH_CONFIDENCE_CHANNEL_WIDTH_PCT;
  let deterministicQuality = 3;

  if (hardBlockReasons.length > 0) {
    deterministicQuality = 1;
  } else if (highConfidenceSetup) {
    deterministicQuality = 5;
  } else if (approvalSetup) {
    deterministicQuality = 4;
  } else {
    if (direction === 'SHORT') {
      softBlockReasons.push('short_side_disabled');
    }
    if (!breakoutAligned) {
      softBlockReasons.push('breakout_not_aligned');
    }
    if (h4VolatilityState !== 'expanded') {
      softBlockReasons.push('h4_volatility_not_expanded');
    }
    if (cmcExchangeLiquidityStale === true) {
      softBlockReasons.push('cmc_exchange_liquidity_stale');
    }
    if (direction === 'LONG' && cmcExchangeLiquidityAligned !== true) {
      softBlockReasons.push('cmc_exchange_liquidity_not_aligned');
    }
    if (breakoutDistancePct < minApprovalBreakoutDistancePct) {
      softBlockReasons.push('weak_breakout_distance');
    }
    if (channelWidthPct < MIN_APPROVAL_CHANNEL_WIDTH_PCT) {
      softBlockReasons.push('narrow_channel_width');
    }
    if ((volumeRel20 ?? 0) < minApprovalVolumeRel20) {
      softBlockReasons.push('weak_participation');
    }
    if ((rsi ?? Number.POSITIVE_INFINITY) > MAX_APPROVAL_RSI) {
      softBlockReasons.push('overheated_rsi');
    }
    if ((bbWidthRank100 ?? 0) < MIN_APPROVAL_BB_WIDTH_RANK_100) {
      softBlockReasons.push('low_bb_width_rank');
    }
    if (direction === 'LONG' && trendFollowState !== 'bull') {
      softBlockReasons.push('trend_follow_not_bull');
    }
  }

  if (deterministicQuality >= 5 && softBlockReasons.length > 0) {
    deterministicQuality = 4;
  }

  return {
    ...signalContext,
    baseContextAvailable: Boolean(baseContext),
    primarySession,
    trendBias,
    adaptiveChannelRegime,
    breakoutState,
    volumeRel20,
    rsi,
    bbWidthRank100,
    trendFollowState,
    h4VolatilityState,
    benchmarkTrendAlignment,
    cmcExchangeLiquidityAligned,
    cmcExchangeLiquidityStale,
    targetLiqImbalance1h,
    targetLiqSpikeRatio1h,
    targetLiqTotal1h,
    ethFundingRate1h,
    xrpOpenInterest15m,
    baseApproveBias,
    hardBlockReasons,
    softBlockReasons,
    deterministicQuality,
    approvalAllowedNow:
      deterministicQuality >= 4 && hardBlockReasons.length === 0,
  };
};
