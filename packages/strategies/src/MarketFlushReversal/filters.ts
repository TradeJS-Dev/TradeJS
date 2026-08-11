import type { BaseStrategyContextSnapshot } from '@tradejs/types';
import type { MarketFlushReversalConfig } from './config';
import type { MarketFlushReversalEntrySignal } from './engine';
import { getAverageTurnover20 } from '../shared/baseContext';
import { resolveDirectionalConfigNumber } from '../shared/directionalConfig';

const asPositiveThreshold = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export const getMarketFlushReversalEntryFilterSkipCode = ({
  config,
  entrySignal,
  baseContext,
}: {
  config: MarketFlushReversalConfig;
  entrySignal: MarketFlushReversalEntrySignal;
  baseContext?: BaseStrategyContextSnapshot | null;
}): string | null => {
  const minBodyStrength = asPositiveThreshold(
    resolveDirectionalConfigNumber({
      config,
      key: 'MFR_MIN_ENTRY_BODY_STRENGTH',
      direction: entrySignal.direction,
      fallback: 0,
    }),
  );
  if (minBodyStrength != null) {
    const bodyStrength = Number(baseContext?.regime?.momentum?.bodyStrength);
    if (!Number.isFinite(bodyStrength) || bodyStrength < minBodyStrength) {
      return 'MFR_ENTRY_BODY_TOO_WEAK';
    }
  }

  const minConfirmationDisplacementAtr = asPositiveThreshold(
    resolveDirectionalConfigNumber({
      config,
      key: 'MFR_MIN_CONFIRMATION_DISPLACEMENT_ATR',
      direction: entrySignal.direction,
      fallback: 0,
    }),
  );
  if (minConfirmationDisplacementAtr != null) {
    const displacementAtr = -Number(entrySignal.priceImprovementAtr);
    if (
      !Number.isFinite(displacementAtr) ||
      displacementAtr < minConfirmationDisplacementAtr
    ) {
      return 'MFR_CONFIRMATION_DISPLACEMENT_TOO_SMALL';
    }
  }

  const minAverageTurnover20 = asPositiveThreshold(
    resolveDirectionalConfigNumber({
      config,
      key: 'MFR_MIN_AVG_TURNOVER_20',
      direction: entrySignal.direction,
      fallback: 0,
    }),
  );
  if (minAverageTurnover20 != null) {
    const averageTurnover20 = getAverageTurnover20(baseContext);
    if (averageTurnover20 == null || averageTurnover20 < minAverageTurnover20) {
      return 'MFR_AVERAGE_TURNOVER_TOO_LOW';
    }
  }

  return null;
};
