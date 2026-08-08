import type { BaseStrategyContextSnapshot } from '@tradejs/types';
import type { TrendFollowConfig } from './config';
import type { TrendFollowSignal } from './engine';

const asPositiveThreshold = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const isDirectionAligned = ({
  direction,
  bullishValue,
  bearishValue,
  value,
}: {
  direction: TrendFollowSignal['direction'];
  bullishValue: string;
  bearishValue: string;
  value: string | null | undefined;
}) => (direction === 'LONG' ? value === bullishValue : value === bearishValue);

export const getTrendFollowCoreFilterSkipCode = ({
  signal,
  config,
  baseContext,
}: {
  signal: TrendFollowSignal;
  config: TrendFollowConfig;
  baseContext?: BaseStrategyContextSnapshot | null;
}): string | null => {
  const minBreakoutDistancePct = asPositiveThreshold(
    config.TRENDFOLLOW_MIN_BREAKOUT_DISTANCE_PCT,
  );
  if (
    minBreakoutDistancePct != null &&
    signal.breakoutDistancePct < minBreakoutDistancePct
  ) {
    return 'TRENDFOLLOW_BREAKOUT_DISTANCE_TOO_SMALL';
  }

  const maxBreakoutDistancePct = asPositiveThreshold(
    config.TRENDFOLLOW_MAX_BREAKOUT_DISTANCE_PCT,
  );
  if (
    maxBreakoutDistancePct != null &&
    signal.breakoutDistancePct > maxBreakoutDistancePct
  ) {
    return 'TRENDFOLLOW_BREAKOUT_DISTANCE_TOO_EXTENDED';
  }

  const breakoutState = baseContext?.structure?.localRange?.breakoutState;
  if (
    config.TRENDFOLLOW_REQUIRE_STRUCTURE_BREAKOUT &&
    !isDirectionAligned({
      direction: signal.direction,
      bullishValue: 'above_high_level',
      bearishValue: 'below_low_level',
      value: breakoutState,
    })
  ) {
    return 'TRENDFOLLOW_STRUCTURE_BREAKOUT_NOT_CONFIRMED';
  }

  const trendBias = baseContext?.regime?.trend?.bias;
  if (
    config.TRENDFOLLOW_REQUIRE_TREND_ALIGNMENT &&
    !isDirectionAligned({
      direction: signal.direction,
      bullishValue: 'bull',
      bearishValue: 'bear',
      value: trendBias,
    })
  ) {
    return 'TRENDFOLLOW_TREND_NOT_ALIGNED';
  }

  const benchmarkAlignment = baseContext?.relative?.benchmark?.trendAlignment;
  if (
    config.TRENDFOLLOW_REQUIRE_BENCHMARK_ALIGNMENT &&
    !isDirectionAligned({
      direction: signal.direction,
      bullishValue: 'aligned_bull',
      bearishValue: 'aligned_bear',
      value: benchmarkAlignment,
    })
  ) {
    return 'TRENDFOLLOW_BENCHMARK_NOT_ALIGNED';
  }

  const minVolumeRel20 = asPositiveThreshold(
    config.TRENDFOLLOW_MIN_VOLUME_REL20,
  );
  if (minVolumeRel20 != null) {
    const volumeRel20 = Number(baseContext?.participation?.volume?.volumeRel20);
    if (!Number.isFinite(volumeRel20) || volumeRel20 < minVolumeRel20) {
      return 'TRENDFOLLOW_VOLUME_TOO_THIN';
    }
  }

  const minAcceptanceCloses = asPositiveThreshold(
    config.TRENDFOLLOW_MIN_STRUCTURE_ACCEPTANCE_CLOSES,
  );
  if (minAcceptanceCloses != null) {
    const acceptance = baseContext?.structure?.acceptance;
    const continuationCloses = Number(
      signal.direction === 'LONG'
        ? acceptance?.closesAboveHighLevel3
        : acceptance?.closesBelowLowLevel3,
    );
    if (
      !Number.isFinite(continuationCloses) ||
      continuationCloses < minAcceptanceCloses
    ) {
      return 'TRENDFOLLOW_CLOSE_ACCEPTANCE_TOO_WEAK';
    }
  }

  const minBreakoutBodyAtr = asPositiveThreshold(
    config.TRENDFOLLOW_MIN_BREAKOUT_BODY_ATR,
  );
  if (minBreakoutBodyAtr != null) {
    const breakoutBodyAtr = Number(
      baseContext?.structure?.acceptance?.breakoutBodyAtr,
    );
    if (
      !Number.isFinite(breakoutBodyAtr) ||
      breakoutBodyAtr < minBreakoutBodyAtr
    ) {
      return 'TRENDFOLLOW_BREAKOUT_BODY_TOO_SMALL';
    }
  }

  return null;
};
