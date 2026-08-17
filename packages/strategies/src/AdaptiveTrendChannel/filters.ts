import { BaseStrategyContextSnapshot } from '@tradejs/types';
import { AdaptiveTrendChannelConfig } from './config';
import { AdaptiveTrendChannelSignal } from './engine';
import { resolveDirectionalConfigNumber } from '@tradejs/strategy-kit/config';

const asFiniteNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const asPositiveThreshold = (value: unknown): number | null => {
  const parsed = asFiniteNumber(value);
  return parsed != null && parsed > 0 ? parsed : null;
};

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter(
        (entry): entry is string =>
          typeof entry === 'string' && entry.trim().length > 0,
      )
    : [];

const isDirectionAligned = ({
  direction,
  bullishValue,
  bearishValue,
  value,
}: {
  direction: AdaptiveTrendChannelSignal['direction'];
  bullishValue: string;
  bearishValue: string;
  value: string | null | undefined;
}) => (direction === 'LONG' ? value === bullishValue : value === bearishValue);

const getContextAlignmentCount = ({
  signal,
  baseContext,
}: {
  signal: AdaptiveTrendChannelSignal;
  baseContext?: BaseStrategyContextSnapshot | null;
}) => {
  const trendBias = baseContext?.regime?.trend?.bias ?? null;
  const breakoutState =
    baseContext?.structure?.localRange?.breakoutState ?? null;
  const benchmarkTrendAlignment =
    baseContext?.relative?.benchmark?.trendAlignment ?? null;
  const derivativesSummary = baseContext?.derivatives?.summary ?? null;
  const derivativesPressure =
    typeof derivativesSummary?.pressure === 'string'
      ? derivativesSummary.pressure
      : null;
  const derivativesDirectionAligned =
    typeof derivativesSummary?.directionAligned === 'boolean'
      ? derivativesSummary.directionAligned
      : null;
  const derivativesRiskFlags = asStringArray(derivativesSummary?.riskFlags);
  const flushSupport =
    signal.direction === 'LONG'
      ? derivativesRiskFlags.includes('short_liquidation_spike') ||
        derivativesPressure === 'short_flush'
      : derivativesRiskFlags.includes('long_liquidation_spike') ||
        derivativesPressure === 'long_flush';

  return [
    isDirectionAligned({
      direction: signal.direction,
      bullishValue: 'bull',
      bearishValue: 'bear',
      value: trendBias,
    }),
    isDirectionAligned({
      direction: signal.direction,
      bullishValue: 'above_high_level',
      bearishValue: 'below_low_level',
      value: breakoutState,
    }),
    isDirectionAligned({
      direction: signal.direction,
      bullishValue: 'aligned_bull',
      bearishValue: 'aligned_bear',
      value: benchmarkTrendAlignment,
    }),
    derivativesDirectionAligned === true,
    flushSupport,
  ].filter(Boolean).length;
};

export const getAdaptiveTrendChannelFilterSkipCode = ({
  signal,
  config,
  baseContext,
}: {
  signal: AdaptiveTrendChannelSignal;
  config: AdaptiveTrendChannelConfig;
  baseContext?: BaseStrategyContextSnapshot | null;
}): string | null => {
  const breakoutDistancePct = Math.abs(signal.breakoutDistancePct);
  const minBreakoutDistancePct = asPositiveThreshold(
    config.ADAPTIVE_TREND_CHANNEL_MIN_BREAKOUT_DISTANCE_PCT,
  );
  const maxBreakoutDistancePct = asPositiveThreshold(
    config.ADAPTIVE_TREND_CHANNEL_MAX_BREAKOUT_DISTANCE_PCT,
  );
  const minBreakoutDistanceAtr = asPositiveThreshold(
    resolveDirectionalConfigNumber({
      config,
      key: 'ADAPTIVE_TREND_CHANNEL_MIN_BREAKOUT_DISTANCE_ATR',
      direction: signal.direction,
      fallback: 0,
    }),
  );
  const maxBreakoutDistanceAtr = asPositiveThreshold(
    config.ADAPTIVE_TREND_CHANNEL_MAX_BREAKOUT_DISTANCE_ATR,
  );
  const minChannelWidthPct = asPositiveThreshold(
    config.ADAPTIVE_TREND_CHANNEL_MIN_CHANNEL_WIDTH_PCT,
  );
  const maxChannelWidthPct = asPositiveThreshold(
    config.ADAPTIVE_TREND_CHANNEL_MAX_CHANNEL_WIDTH_PCT,
  );
  const minVolumeRel20 = asPositiveThreshold(
    config.ADAPTIVE_TREND_CHANNEL_MIN_VOLUME_REL20,
  );
  const volumeRel20 = asFiniteNumber(
    baseContext?.participation?.volume?.volumeRel20,
  );

  if (
    minBreakoutDistancePct != null &&
    breakoutDistancePct < minBreakoutDistancePct
  ) {
    return 'ADAPTIVE_TREND_CHANNEL_BREAKOUT_TOO_SMALL';
  }

  if (
    maxBreakoutDistancePct != null &&
    breakoutDistancePct > maxBreakoutDistancePct
  ) {
    return 'ADAPTIVE_TREND_CHANNEL_BREAKOUT_TOO_EXTENDED';
  }

  if (
    minBreakoutDistanceAtr != null &&
    signal.breakoutDistanceAtr < minBreakoutDistanceAtr
  ) {
    return 'ADAPTIVE_TREND_CHANNEL_BREAKOUT_ATR_TOO_SMALL';
  }

  if (
    maxBreakoutDistanceAtr != null &&
    signal.breakoutDistanceAtr > maxBreakoutDistanceAtr
  ) {
    return 'ADAPTIVE_TREND_CHANNEL_BREAKOUT_ATR_TOO_EXTENDED';
  }

  if (
    minChannelWidthPct != null &&
    signal.channelWidthPct < minChannelWidthPct
  ) {
    return 'ADAPTIVE_TREND_CHANNEL_CHANNEL_TOO_NARROW';
  }

  if (
    maxChannelWidthPct != null &&
    signal.channelWidthPct > maxChannelWidthPct
  ) {
    return 'ADAPTIVE_TREND_CHANNEL_CHANNEL_TOO_WIDE';
  }

  if (
    minVolumeRel20 != null &&
    volumeRel20 != null &&
    volumeRel20 < minVolumeRel20
  ) {
    return 'ADAPTIVE_TREND_CHANNEL_VOLUME_TOO_THIN';
  }

  if (
    config.ADAPTIVE_TREND_CHANNEL_REQUIRE_CONTEXT_ALIGNMENT &&
    getContextAlignmentCount({ signal, baseContext }) <
      Math.max(
        1,
        Math.floor(
          Number(config.ADAPTIVE_TREND_CHANNEL_MIN_CONTEXT_ALIGNMENTS ?? 1),
        ),
      )
  ) {
    return 'ADAPTIVE_TREND_CHANNEL_CONTEXT_NOT_ALIGNED';
  }

  return null;
};
