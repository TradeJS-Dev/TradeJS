import type { BaseStrategyContextSnapshot } from '@tradejs/types';
import type { DoubleTapConfig } from './config';
import type { DoubleTapPattern } from './engine';
import { resolveDirectionalConfigNumber } from '../shared/directionalConfig';

const asPositiveThreshold = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export const getDoubleTapCoreFilterSkipCode = ({
  config,
  pattern,
  baseContext,
}: {
  config: DoubleTapConfig;
  pattern: DoubleTapPattern;
  baseContext?: BaseStrategyContextSnapshot | null;
}): string | null => {
  const maxConfirmationBars = asPositiveThreshold(
    resolveDirectionalConfigNumber({
      config,
      key: 'DOUBLETAP_MAX_ENTRY_CONFIRMATION_BARS',
      direction: pattern.direction,
      fallback: 0,
    }),
  );
  if (
    maxConfirmationBars != null &&
    pattern.confirmationBars > maxConfirmationBars
  ) {
    return 'DOUBLETAP_CONFIRMATION_TOO_LATE';
  }

  const maxBbWidthPct = asPositiveThreshold(
    resolveDirectionalConfigNumber({
      config,
      key: 'DOUBLETAP_MAX_BB_WIDTH_PCT',
      direction: pattern.direction,
      fallback: 0,
    }),
  );
  if (maxBbWidthPct != null) {
    const bbWidthPct = Number(baseContext?.raw?.volatility?.bbWidthPct);
    if (!Number.isFinite(bbWidthPct) || bbWidthPct > maxBbWidthPct) {
      return 'DOUBLETAP_VOLATILITY_TOO_WIDE';
    }
  }

  return null;
};
