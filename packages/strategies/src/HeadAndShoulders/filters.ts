import type { BaseStrategyContextSnapshot, Direction } from '@tradejs/types';
import type { HeadAndShouldersConfig } from './config';
import type { HeadAndShouldersPattern } from './engine';
import { resolveDirectionalConfigNumber } from '@tradejs/strategy-kit/config';

const asPositiveThreshold = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export const getHeadAndShouldersCoreFilterSkipCode = ({
  pattern,
  config,
  baseContext,
}: {
  pattern: HeadAndShouldersPattern;
  config: HeadAndShouldersConfig;
  baseContext?: BaseStrategyContextSnapshot | null;
}): string | null => {
  const direction: Direction = pattern.direction;
  const minBodyStrength = asPositiveThreshold(
    resolveDirectionalConfigNumber({
      config,
      key: 'HEADSHOULDERS_MIN_SIGNAL_BODY_STRENGTH',
      direction,
      fallback: 0,
    }),
  );
  if (minBodyStrength != null) {
    const bodyStrength = Number(baseContext?.regime?.momentum?.bodyStrength);
    if (!Number.isFinite(bodyStrength) || bodyStrength < minBodyStrength) {
      return 'HEADSHOULDERS_SIGNAL_BODY_TOO_WEAK';
    }
  }

  const minHeadHeightAtr = asPositiveThreshold(
    resolveDirectionalConfigNumber({
      config,
      key: 'HEADSHOULDERS_MIN_ENTRY_HEAD_HEIGHT_ATR',
      direction,
      fallback: 0,
    }),
  );
  if (
    minHeadHeightAtr != null &&
    (!Number.isFinite(pattern.headHeightAtr) ||
      pattern.headHeightAtr < minHeadHeightAtr)
  ) {
    return 'HEADSHOULDERS_HEAD_TOO_SHALLOW_AT_ENTRY';
  }

  return null;
};
