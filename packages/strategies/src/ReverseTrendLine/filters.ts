import type { ReverseTrendLineConfig } from './config';

type ReverseStructuralFilterContext = {
  coinBiasAligned: boolean | null;
  btcBiasAligned: boolean | null;
};

type ReverseTimingFilterContext = {
  entryTiming: string;
  currentRejectionStrengthPct: number | null;
  previousRejectionStrengthPct: number | null;
  currentRejectionWickPct: number | null;
  previousRejectionWickPct: number | null;
};

const asPositiveThreshold = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const getReactionValue = ({
  timingContext,
  currentValue,
  previousValue,
}: {
  timingContext: ReverseTimingFilterContext;
  currentValue: number | null;
  previousValue: number | null;
}) =>
  timingContext.entryTiming === 'ready_follow_through'
    ? previousValue
    : currentValue;

export const getReverseTrendLineCoreFilterSkipCode = ({
  config,
  structuralContext,
  timingContext,
}: {
  config: ReverseTrendLineConfig;
  structuralContext: ReverseStructuralFilterContext;
  timingContext: ReverseTimingFilterContext;
}): string | null => {
  const minRejectionWickPct = asPositiveThreshold(
    config.REVERSE_TRENDLINE_MIN_REJECTION_WICK_PCT,
  );
  const rejectionWickPct = getReactionValue({
    timingContext,
    currentValue: timingContext.currentRejectionWickPct,
    previousValue: timingContext.previousRejectionWickPct,
  });
  if (
    minRejectionWickPct != null &&
    (rejectionWickPct == null || rejectionWickPct < minRejectionWickPct)
  ) {
    return 'REVERSE_TRENDLINE_REJECTION_WICK_TOO_WEAK';
  }

  const minRejectionStrengthPct = asPositiveThreshold(
    config.REVERSE_TRENDLINE_MIN_REJECTION_STRENGTH_PCT,
  );
  const rejectionStrengthPct = getReactionValue({
    timingContext,
    currentValue: timingContext.currentRejectionStrengthPct,
    previousValue: timingContext.previousRejectionStrengthPct,
  });
  if (
    minRejectionStrengthPct != null &&
    (rejectionStrengthPct == null ||
      rejectionStrengthPct < minRejectionStrengthPct)
  ) {
    return 'REVERSE_TRENDLINE_REJECTION_STRENGTH_TOO_WEAK';
  }

  if (
    config.REVERSE_TRENDLINE_REQUIRE_COIN_BIAS_ALIGNMENT &&
    structuralContext.coinBiasAligned !== true
  ) {
    return 'REVERSE_TRENDLINE_COIN_BIAS_NOT_ALIGNED';
  }

  if (
    config.REVERSE_TRENDLINE_REQUIRE_BTC_BIAS_ALIGNMENT &&
    structuralContext.btcBiasAligned !== true
  ) {
    return 'REVERSE_TRENDLINE_BTC_BIAS_NOT_ALIGNED';
  }

  const allowedEntryTimings = Array.isArray(
    config.REVERSE_TRENDLINE_ALLOWED_ENTRY_TIMINGS,
  )
    ? config.REVERSE_TRENDLINE_ALLOWED_ENTRY_TIMINGS
    : [];
  if (
    allowedEntryTimings.length > 0 &&
    !allowedEntryTimings.includes(timingContext.entryTiming)
  ) {
    return 'REVERSE_TRENDLINE_ENTRY_TIMING_NOT_ALLOWED';
  }

  return null;
};
