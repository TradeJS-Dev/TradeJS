import type { BaseStrategyContextSnapshot } from '@tradejs/types';
import type { TrendShiftConfig } from './config';

const asPositiveThreshold = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export const getTrendShiftCoreFilterSkipCode = ({
  config,
  baseContext,
}: {
  config: TrendShiftConfig;
  baseContext?: BaseStrategyContextSnapshot | null;
}): string | null => {
  const minBodyStrength = asPositiveThreshold(
    config.TRENDSHIFT_MIN_SIGNAL_BODY_STRENGTH,
  );
  if (minBodyStrength != null) {
    const bodyStrength = Number(baseContext?.regime?.momentum?.bodyStrength);
    if (!Number.isFinite(bodyStrength) || bodyStrength < minBodyStrength) {
      return 'TRENDSHIFT_SIGNAL_BODY_TOO_WEAK';
    }
  }

  const minAdx = asPositiveThreshold(config.TRENDSHIFT_MIN_ADX);
  if (minAdx != null) {
    const adx = Number(baseContext?.regime?.trend?.adx?.adx);
    if (!Number.isFinite(adx) || adx < minAdx) {
      return 'TRENDSHIFT_TREND_STRENGTH_TOO_LOW';
    }
  }

  return null;
};
