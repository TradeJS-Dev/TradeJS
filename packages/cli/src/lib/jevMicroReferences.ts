import type { JevInput } from '@tradejs/types';

/** Arithmetic controls for the current component rubrics; never entry decisions. */
export const microReferenceFeatures = (input: JevInput) => {
  const number = (...keys: string[]): number | null => {
    for (const key of keys) {
      const value = input.features[key];
      if (typeof value === 'number' && Number.isFinite(value)) return value;
    }
    return null;
  };
  const bands = (value: number | null, cuts: number[]) => {
    if (value == null || value < 0) return null;
    const level = cuts.filter((cut) => value >= cut).length;
    return level / 4;
  };
  const ratio = number('setup.retracementRatio');
  const contraction = number(
    'setup.consolidationToImpulseVolumeRatio',
    'setup.flagToPoleVolumeRatio',
  );
  const extension = number('setup.breakoutDistanceAtr');
  const efficiency = number(
    'setup.impulseEfficiencyRatio',
    'setup.poleEfficiencyRatio',
  );
  const body = number('entry.directionalBodyAtr');
  const close = number('entry.directionalCloseLocation');
  const upper = number('geometry.upperR2'),
    lower = number('geometry.lowerR2'),
    divergence = number('geometry.slopeDivergenceRatio');
  const fit = upper != null && lower != null ? Math.min(upper, lower) : null;
  const bias = (key: string) => {
    const value = input.features[key];
    if (!['bull', 'bear'].includes(String(value))) return 0;
    return value === (input.direction === 'LONG' ? 'bull' : 'bear') ? 1 : -1;
  };
  const trend = bias('market.trendBias'),
    swing = bias('market.swingBias');
  return {
    directionalAgreement:
      input.features['market.trendBias'] == null &&
      input.features['market.swingBias'] == null
        ? null
        : (trend + swing + 2) / 4,
    correctionContainment:
      ratio == null || ratio < 0
        ? null
        : (ratio <= 0.2
            ? 4
            : ratio <= 0.4
              ? 3
              : ratio <= 0.65
                ? 2
                : ratio <= 1
                  ? 1
                  : 0) / 4,
    volumeExpansion: bands(number('market.volumeRel20'), [0.5, 0.8, 1.2, 2]),
    volumeContraction:
      contraction == null || contraction < 0
        ? null
        : (contraction <= 0.4
            ? 4
            : contraction <= 0.7
              ? 3
              : contraction <= 0.9
                ? 2
                : contraction <= 1.2
                  ? 1
                  : 0) / 4,
    entryProximity:
      extension == null || extension < 0
        ? null
        : (extension <= 0.2
            ? 4
            : extension <= 0.5
              ? 3
              : extension <= 1
                ? 2
                : extension <= 2
                  ? 1
                  : 0) / 4,
    entryConviction:
      body == null || close == null || close < 0 || close > 1
        ? null
        : (body < 0 && close < 0.25
            ? 0
            : body < 0 || close < 0.5
              ? 1
              : body < 0.2
                ? 2
                : body >= 0.5 && close >= 0.75
                  ? 4
                  : 3) / 4,
    impulsePersistence:
      efficiency == null || efficiency > 1
        ? null
        : bands(efficiency, [0.2, 0.4, 0.6, 0.8]),
    boundaryRegularity:
      fit == null || divergence == null || fit < 0 || fit > 1 || divergence < 0
        ? null
        : (fit < 0.5 || divergence > 0.5
            ? 0
            : fit < 0.7 || divergence > 0.3
              ? 1
              : fit < 0.85 || divergence > 0.15
                ? 2
                : fit >= 0.95 && divergence <= 0.05
                  ? 4
                  : 3) / 4,
  };
};
