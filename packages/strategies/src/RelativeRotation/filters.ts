import type { BaseStrategyContextSnapshot } from '@tradejs/types';
import type { RelativeRotationConfig } from './config';
import type { RelativeRotationSignalContext } from './contracts';
import { resolveDirectionalConfigNumber } from '../shared/directionalConfig';

const asPositiveThreshold = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export const getRelativeRotationCoreFilterSkipCode = ({
  signal,
  config,
  baseContext,
}: {
  signal: RelativeRotationSignalContext;
  config: RelativeRotationConfig;
  baseContext: BaseStrategyContextSnapshot;
}): string | null => {
  const direction = signal.signalDirection;
  const minDiMinus = asPositiveThreshold(
    resolveDirectionalConfigNumber({
      config,
      key: 'RR_MIN_ADX_DI_MINUS',
      direction,
      fallback: 0,
    }),
  );
  if (minDiMinus != null) {
    const diMinus = Number(baseContext.regime?.trend?.adx?.diMinus);
    if (!Number.isFinite(diMinus) || diMinus < minDiMinus) {
      return 'RR_PULLBACK_NOT_MATURE';
    }
  }

  const minTargetBtcCorrelation = asPositiveThreshold(
    resolveDirectionalConfigNumber({
      config,
      key: 'RR_MIN_TARGET_BTC_CORRELATION',
      direction,
      fallback: 0,
    }),
  );
  if (
    minTargetBtcCorrelation != null &&
    (signal.targetVsBtcCorrelation20 == null ||
      signal.targetVsBtcCorrelation20 < minTargetBtcCorrelation)
  ) {
    return 'RR_TARGET_BTC_CORRELATION_TOO_LOW';
  }

  const maxAtrPctRank100 = asPositiveThreshold(
    resolveDirectionalConfigNumber({
      config,
      key: 'RR_MAX_ATR_PCT_RANK100',
      direction,
      fallback: 0,
    }),
  );
  if (maxAtrPctRank100 != null) {
    const atrPctRank100 = Number(
      baseContext.regime?.volatility?.percentiles?.atrPctRank100,
    );
    if (!Number.isFinite(atrPctRank100) || atrPctRank100 > maxAtrPctRank100) {
      return 'RR_VOLATILITY_RANK_TOO_HIGH';
    }
  }

  const maxVolumeRel20 = asPositiveThreshold(
    resolveDirectionalConfigNumber({
      config,
      key: 'RR_MAX_VOLUME_REL20',
      direction,
      fallback: 0,
    }),
  );
  if (
    maxVolumeRel20 != null &&
    signal.volumeRel20 != null &&
    Number.isFinite(signal.volumeRel20) &&
    signal.volumeRel20 > maxVolumeRel20
  ) {
    return 'RR_VOLUME_CLIMAX';
  }

  return null;
};
