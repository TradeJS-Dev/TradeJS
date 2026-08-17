import type { BaseStrategyContextSnapshot } from '@tradejs/types';
import type { StructureZonesConfig } from './config';
import type { StructureZonesSignal } from './engine';
import { resolveDirectionalConfigNumber } from '@tradejs/strategy-kit/config';

const asPositiveThreshold = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export const getStructureZonesCoreFilterSkipCode = ({
  signal,
  config,
  baseContext,
}: {
  signal: StructureZonesSignal;
  config: StructureZonesConfig;
  baseContext?: BaseStrategyContextSnapshot | null;
}): string | null => {
  const maxAtrPctRank100 = asPositiveThreshold(
    config.STRUCTURE_ZONES_MAX_ATR_PCT_RANK100,
  );
  if (maxAtrPctRank100 != null) {
    const atrPctRank100 = Number(
      baseContext?.regime?.volatility?.percentiles?.atrPctRank100,
    );
    if (!Number.isFinite(atrPctRank100) || atrPctRank100 > maxAtrPctRank100) {
      return 'STRUCTURE_ZONES_VOLATILITY_RANK_TOO_HIGH';
    }
  }

  const minReactionCloseDistancePct = asPositiveThreshold(
    resolveDirectionalConfigNumber({
      config,
      key: 'STRUCTURE_ZONES_MIN_REACTION_CLOSE_DISTANCE_PCT',
      direction: signal.direction,
      fallback: 0,
    }),
  );
  if (
    minReactionCloseDistancePct != null &&
    (!Number.isFinite(signal.reactionCloseDistancePct) ||
      signal.reactionCloseDistancePct < minReactionCloseDistancePct)
  ) {
    return 'STRUCTURE_ZONES_REACTION_TOO_SHALLOW';
  }

  const minTrendPersistence = asPositiveThreshold(
    resolveDirectionalConfigNumber({
      config,
      key: 'STRUCTURE_ZONES_MIN_TREND_PERSISTENCE',
      direction: signal.direction,
      fallback: 0,
    }),
  );
  if (minTrendPersistence != null) {
    const persistence = Number(baseContext?.regime?.trend?.persistence);
    if (!Number.isFinite(persistence) || persistence < minTrendPersistence) {
      return 'STRUCTURE_ZONES_TREND_NOT_PERSISTENT';
    }
  }

  return null;
};
