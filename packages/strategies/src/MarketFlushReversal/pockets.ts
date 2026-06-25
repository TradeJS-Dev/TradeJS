import type { BaseStrategyContextSnapshot, Direction } from '@tradejs/types';
import { toFiniteNumberOrNull } from '../shared/contextStrategy';

export type MarketFlushReversalLongReboundPocketFeatures = {
  targetVsBtcRatioReturn24h: number | null;
  ethVsBtcVolumeRatio: number | null;
  h1RangePosition: number | null;
};

export const MFR_CALIBRATED_LONG_TARGET_VS_BTC_RATIO_RETURN_24H_MAX = -3.3;
export const MFR_CALIBRATED_LONG_ETH_VS_BTC_VOLUME_RATIO_MIN = 0.54;
export const MFR_CALIBRATED_LONG_H1_RANGE_POSITION_MAX = 0.08;

export const getMarketFlushReversalLongReboundPocketFeatures = (
  baseContext: BaseStrategyContextSnapshot | null | undefined,
): MarketFlushReversalLongReboundPocketFeatures => ({
  targetVsBtcRatioReturn24h: toFiniteNumberOrNull(
    baseContext?.relative?.targetVsBtc?.ratioReturn24h,
  ),
  ethVsBtcVolumeRatio: toFiniteNumberOrNull(
    baseContext?.relative?.cmcReferenceAssets?.ethVsBtcVolumeRatio,
  ),
  h1RangePosition: toFiniteNumberOrNull(
    baseContext?.mtf?.summary?.h1RangePosition,
  ),
});

export const isMarketFlushReversalCalibratedLongReboundPocket = ({
  direction,
  targetVsBtcRatioReturn24h,
  ethVsBtcVolumeRatio,
  h1RangePosition,
}: {
  direction: Direction | null;
} & MarketFlushReversalLongReboundPocketFeatures) =>
  direction === 'LONG' &&
  targetVsBtcRatioReturn24h != null &&
  targetVsBtcRatioReturn24h <=
    MFR_CALIBRATED_LONG_TARGET_VS_BTC_RATIO_RETURN_24H_MAX &&
  ((ethVsBtcVolumeRatio != null &&
    ethVsBtcVolumeRatio >= MFR_CALIBRATED_LONG_ETH_VS_BTC_VOLUME_RATIO_MIN) ||
    (h1RangePosition != null &&
      h1RangePosition <= MFR_CALIBRATED_LONG_H1_RANGE_POSITION_MAX));
