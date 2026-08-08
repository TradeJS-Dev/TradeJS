import type { BaseStrategyContextSnapshot } from '@tradejs/types';
import type { LiquidityZonesConfig } from './config';
import type { LiquidityZonesSignal } from './engine';

const asPositiveThreshold = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export const getLiquidityZonesFilterSkipCode = ({
  signal,
  config,
  baseContext,
}: {
  signal: LiquidityZonesSignal;
  config: LiquidityZonesConfig;
  baseContext?: BaseStrategyContextSnapshot | null;
}): string | null => {
  const breakoutState = baseContext?.structure?.localRange?.breakoutState;
  if (config.LIQUIDITY_ZONES_REQUIRE_RANGE_RECLAIM) {
    const reclaimed =
      signal.direction === 'LONG'
        ? breakoutState === 'inside_range' ||
          breakoutState === 'failed_low_breakout'
        : breakoutState === 'inside_range' ||
          breakoutState === 'failed_high_breakout';
    if (!reclaimed) {
      return 'LIQUIDITY_ZONES_RANGE_NOT_RECLAIMED';
    }
  }

  if (config.LIQUIDITY_ZONES_REQUIRE_SWEEP_RECLAIM) {
    const liquidity = baseContext?.structure?.liquidity;
    const sweepAligned =
      signal.direction === 'LONG'
        ? liquidity?.sweepState === 'swept_low'
        : liquidity?.sweepState === 'swept_high';
    if (!sweepAligned || liquidity?.closeBackInsideRange !== true) {
      return 'LIQUIDITY_ZONES_SWEEP_NOT_RECLAIMED';
    }
  }

  const minRejectionWickScore = asPositiveThreshold(
    config.LIQUIDITY_ZONES_MIN_REJECTION_WICK_SCORE,
  );
  if (minRejectionWickScore != null) {
    const rejectionWickScore = Number(
      baseContext?.structure?.candleQuality?.rejectionWickScore,
    );
    if (
      !Number.isFinite(rejectionWickScore) ||
      rejectionWickScore < minRejectionWickScore
    ) {
      return 'LIQUIDITY_ZONES_REJECTION_WICK_TOO_WEAK';
    }
  }

  const minVolumeRel20 = asPositiveThreshold(
    config.LIQUIDITY_ZONES_MIN_VOLUME_REL20,
  );
  if (minVolumeRel20 != null) {
    const volumeRel20 = Number(baseContext?.participation?.volume?.volumeRel20);
    if (!Number.isFinite(volumeRel20) || volumeRel20 < minVolumeRel20) {
      return 'LIQUIDITY_ZONES_VOLUME_TOO_THIN';
    }
  }

  return null;
};
