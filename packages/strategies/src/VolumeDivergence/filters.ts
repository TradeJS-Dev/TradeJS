import type { Direction } from '@tradejs/types';
import type { VolumeDivergenceConfig } from './config';
import { resolveDirectionalConfigNumber } from '@tradejs/strategy-kit/config';

export const getVolumeDivergenceStrength = ({
  direction,
  currentVolumeNorm,
  previousVolumeNorm,
}: {
  direction: Direction;
  currentVolumeNorm: number;
  previousVolumeNorm: number;
}) =>
  direction === 'LONG'
    ? currentVolumeNorm - previousVolumeNorm
    : previousVolumeNorm - currentVolumeNorm;

export const getVolumeDivergenceCoreFilterSkipCode = ({
  direction,
  currentVolumeNorm,
  previousVolumeNorm,
  config,
}: {
  direction: Direction;
  currentVolumeNorm: number;
  previousVolumeNorm: number;
  config: VolumeDivergenceConfig;
}): string | null => {
  const maxStrength = Math.max(
    0,
    resolveDirectionalConfigNumber({
      config,
      key: 'VOLUME_DIVERGENCE_MAX_STRENGTH',
      direction,
      fallback: 0,
    }),
  );
  if (maxStrength <= 0) return null;

  const strength = getVolumeDivergenceStrength({
    direction,
    currentVolumeNorm,
    previousVolumeNorm,
  });
  return Number.isFinite(strength) && strength <= maxStrength
    ? null
    : 'VOLUME_DIVERGENCE_STRENGTH_TOO_EXTREME';
};
