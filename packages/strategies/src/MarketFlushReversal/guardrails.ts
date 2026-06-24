import type { BaseStrategyContextSnapshot, Direction } from '@tradejs/types';
import type { MarketFlushReversalSignalContext } from './core';

export type MarketFlushReversalGateFeatures = {
  signalDirection: Direction | null;
  broadMarketPressure: string | null;
  broadMarketRiskFlags: string[];
  broadMarketLiqSpikeRatio: number | null;
  broadMarketLiqImbalance: number | null;
  broadMarketFundingZScore: number | null;
  broadMarketPriceOiDivergenceType: string | null;
  broadMarketFlushDirection: Direction | null;
  broadMarketFlushConfirmed: boolean;
  localStructureConfirmed: boolean;
  localParticipationConfirmed: boolean;
  volumeRel20: number | null;
  sweepWickPct: number | null;
  targetVsBtcRatioReturn24h: number | null;
  ethVsBtcVolumeRatio: number | null;
  h1RangePosition: number | null;
  calibratedLongRebound: boolean;
};

export type MarketFlushReversalGuardrailContext =
  Partial<MarketFlushReversalSignalContext> & {
    baseContextAvailable: boolean;
    marketContextAvailable: boolean;
    marketFlushReversalGateFeatures: MarketFlushReversalGateFeatures;
    approvalBlockReasons: string[];
    structuralHardBlockReasons: string[];
    riskAnnotations: string[];
    deterministicQuality: number;
    approvalAllowedNow: boolean;
  };

const toFiniteNumberOrNull = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter(
        (entry): entry is string =>
          typeof entry === 'string' && entry.trim().length > 0,
      )
    : [];

const maxFinite = (...values: Array<number | null | undefined>) => {
  const finite = values.filter(
    (value): value is number =>
      typeof value === 'number' && Number.isFinite(value),
  );
  return finite.length ? Math.max(...finite) : null;
};

const selectDirectionalImbalance = (
  direction: Direction,
  ...values: Array<number | null | undefined>
) => {
  const finite = values.filter(
    (value): value is number =>
      typeof value === 'number' && Number.isFinite(value),
  );
  if (!finite.length) return null;
  return direction === 'LONG' ? Math.min(...finite) : Math.max(...finite);
};

const getMarketRiskFlags = (
  baseContext: BaseStrategyContextSnapshot | null | undefined,
) => asStringArray(baseContext?.derivatives?.summary?.riskFlags);

const getMarketLiqSpikeRatio = (
  baseContext: BaseStrategyContextSnapshot | null | undefined,
) => {
  const intervals = baseContext?.derivatives?.intervals;
  return maxFinite(
    intervals?.['15m']?.liqSpikeRatio,
    intervals?.['1h']?.liqSpikeRatio,
  );
};

const getDirectionalMarketImbalance = (
  baseContext: BaseStrategyContextSnapshot | null | undefined,
  direction: Direction,
) => {
  const intervals = baseContext?.derivatives?.intervals;
  return selectDirectionalImbalance(
    direction,
    intervals?.['15m']?.liqImbalance,
    intervals?.['1h']?.liqImbalance,
  );
};

const getMarketFundingZScore = (
  baseContext: BaseStrategyContextSnapshot | null | undefined,
) => {
  const intervals = baseContext?.derivatives?.intervals;
  return maxFinite(
    intervals?.['15m']?.fundingZScore,
    intervals?.['1h']?.fundingZScore,
  );
};

const hasBlockingMarketContext = (
  baseContext: BaseStrategyContextSnapshot | null | undefined,
) => {
  const riskFlags = getMarketRiskFlags(baseContext);
  return (
    riskFlags.includes('missing_derivatives') ||
    riskFlags.includes('stale_derivatives')
  );
};

const CALIBRATED_LONG_TARGET_VS_BTC_RATIO_RETURN_24H_MAX = -3.3;
const CALIBRATED_LONG_ETH_VS_BTC_VOLUME_RATIO_MIN = 0.54;
const CALIBRATED_LONG_H1_RANGE_POSITION_MAX = 0.08;

const isCalibratedLongReboundPocket = ({
  direction,
  targetVsBtcRatioReturn24h,
  ethVsBtcVolumeRatio,
  h1RangePosition,
}: {
  direction: Direction | null;
  targetVsBtcRatioReturn24h: number | null;
  ethVsBtcVolumeRatio: number | null;
  h1RangePosition: number | null;
}) =>
  direction === 'LONG' &&
  targetVsBtcRatioReturn24h != null &&
  targetVsBtcRatioReturn24h <=
    CALIBRATED_LONG_TARGET_VS_BTC_RATIO_RETURN_24H_MAX &&
  ((ethVsBtcVolumeRatio != null &&
    ethVsBtcVolumeRatio >= CALIBRATED_LONG_ETH_VS_BTC_VOLUME_RATIO_MIN) ||
    (h1RangePosition != null &&
      h1RangePosition <= CALIBRATED_LONG_H1_RANGE_POSITION_MAX));

const getBroadMarketFlushDirection = ({
  baseContext,
  minSpike,
}: {
  baseContext: BaseStrategyContextSnapshot | null | undefined;
  minSpike: number;
}): Direction | null => {
  const pressure = baseContext?.derivatives?.summary?.pressure ?? null;
  const riskFlags = getMarketRiskFlags(baseContext);
  const liqSpikeRatio = getMarketLiqSpikeRatio(baseContext);
  const longImbalance =
    baseContext == null
      ? null
      : getDirectionalMarketImbalance(baseContext, 'LONG');
  const shortImbalance =
    baseContext == null
      ? null
      : getDirectionalMarketImbalance(baseContext, 'SHORT');
  const longFlush =
    pressure === 'long_flush' ||
    riskFlags.includes('long_liquidation_spike') ||
    (liqSpikeRatio != null &&
      liqSpikeRatio >= minSpike &&
      longImbalance != null &&
      longImbalance <= -0.35);
  const shortFlush =
    pressure === 'short_flush' ||
    riskFlags.includes('short_liquidation_spike') ||
    (liqSpikeRatio != null &&
      liqSpikeRatio >= minSpike &&
      shortImbalance != null &&
      shortImbalance >= 0.35);

  if (longFlush === shortFlush || hasBlockingMarketContext(baseContext)) {
    return null;
  }

  return longFlush ? 'LONG' : 'SHORT';
};

export const buildMarketFlushReversalGuardrailContext = ({
  signalContext,
  baseContext,
}: {
  signalContext: Partial<MarketFlushReversalSignalContext>;
  baseContext?: BaseStrategyContextSnapshot | null;
}): MarketFlushReversalGuardrailContext => {
  const direction =
    signalContext.signalDirection === 'LONG' ||
    signalContext.signalDirection === 'SHORT'
      ? signalContext.signalDirection
      : null;
  const minMarketLiqSpikeRatio =
    toFiniteNumberOrNull(signalContext.minMarketLiqSpikeRatio) ?? 2;
  const marketRiskFlags = getMarketRiskFlags(baseContext);
  const marketContextAvailable =
    baseContext?.derivatives != null &&
    !marketRiskFlags.includes('missing_derivatives');
  const broadMarketFlushDirection = getBroadMarketFlushDirection({
    baseContext,
    minSpike: minMarketLiqSpikeRatio,
  });
  const broadMarketLiqImbalance =
    direction == null
      ? null
      : getDirectionalMarketImbalance(baseContext, direction);
  const broadMarketFlushConfirmed =
    direction != null && broadMarketFlushDirection === direction;
  const localStructureConfirmed = signalContext.structureConfirmed === true;
  const localParticipationConfirmed =
    signalContext.participationConfirmed === true;
  const volumeRel20 = toFiniteNumberOrNull(signalContext.volumeRel20);
  const sweepWickPct = toFiniteNumberOrNull(signalContext.sweepWickPct);
  const targetVsBtcRatioReturn24h = toFiniteNumberOrNull(
    baseContext?.relative?.targetVsBtc?.ratioReturn24h,
  );
  const ethVsBtcVolumeRatio = toFiniteNumberOrNull(
    baseContext?.relative?.cmcReferenceAssets?.ethVsBtcVolumeRatio,
  );
  const h1RangePosition = toFiniteNumberOrNull(
    baseContext?.mtf?.summary?.h1RangePosition,
  );
  const calibratedLongRebound = isCalibratedLongReboundPocket({
    direction,
    targetVsBtcRatioReturn24h,
    ethVsBtcVolumeRatio,
    h1RangePosition,
  });
  const approvalBlockReasons: string[] = [];
  const riskAnnotations: string[] = [];

  if (direction == null) approvalBlockReasons.push('missing_direction');
  if (!localStructureConfirmed) {
    approvalBlockReasons.push('local_structure_not_confirmed');
  }
  if (!localParticipationConfirmed) {
    approvalBlockReasons.push('local_participation_not_confirmed');
  }
  if (!marketContextAvailable) {
    approvalBlockReasons.push('missing_broad_market_derivatives');
  }
  if (marketRiskFlags.includes('stale_derivatives')) {
    approvalBlockReasons.push('stale_broad_market_derivatives');
  }
  if (marketContextAvailable && broadMarketFlushDirection == null) {
    approvalBlockReasons.push('no_broad_market_flush');
  }
  if (
    direction != null &&
    broadMarketFlushDirection != null &&
    broadMarketFlushDirection !== direction
  ) {
    approvalBlockReasons.push('broad_market_flush_direction_mismatch');
  }
  if (direction === 'SHORT') {
    approvalBlockReasons.push('short_flush_rebound_pocket_not_validated');
  }
  if (direction === 'LONG' && !calibratedLongRebound) {
    approvalBlockReasons.push('calibrated_long_rebound_missing');
  }

  if (signalContext.marketFlushConfirmed !== true) {
    riskAnnotations.push('market_flush_not_available_at_core_time');
  }

  const approvalAllowedNow = approvalBlockReasons.length === 0;
  const deterministicQuality = !approvalAllowedNow
    ? marketContextAvailable &&
      localStructureConfirmed &&
      localParticipationConfirmed
      ? 3
      : 2
    : 5;
  const marketFlushReversalGateFeatures: MarketFlushReversalGateFeatures = {
    signalDirection: direction,
    broadMarketPressure: baseContext?.derivatives?.summary?.pressure ?? null,
    broadMarketRiskFlags: marketRiskFlags,
    broadMarketLiqSpikeRatio: getMarketLiqSpikeRatio(baseContext),
    broadMarketLiqImbalance,
    broadMarketFundingZScore: getMarketFundingZScore(baseContext),
    broadMarketPriceOiDivergenceType:
      baseContext?.derivatives?.summary?.priceOiDivergenceType ?? null,
    broadMarketFlushDirection,
    broadMarketFlushConfirmed,
    localStructureConfirmed,
    localParticipationConfirmed,
    volumeRel20,
    sweepWickPct,
    targetVsBtcRatioReturn24h,
    ethVsBtcVolumeRatio,
    h1RangePosition,
    calibratedLongRebound,
  };

  return {
    ...signalContext,
    marketPressure: marketFlushReversalGateFeatures.broadMarketPressure,
    marketRiskFlags,
    marketLiqSpikeRatio:
      marketFlushReversalGateFeatures.broadMarketLiqSpikeRatio,
    marketLiqImbalance: broadMarketLiqImbalance,
    marketFundingZScore:
      marketFlushReversalGateFeatures.broadMarketFundingZScore,
    marketPriceOiDivergenceType:
      marketFlushReversalGateFeatures.broadMarketPriceOiDivergenceType,
    marketFlushConfirmed: broadMarketFlushConfirmed,
    minMarketLiqSpikeRatio,
    baseContextAvailable: baseContext != null,
    marketContextAvailable,
    marketFlushReversalGateFeatures,
    approvalBlockReasons,
    structuralHardBlockReasons: approvalBlockReasons,
    riskAnnotations,
    deterministicQuality,
    approvalAllowedNow,
  };
};
