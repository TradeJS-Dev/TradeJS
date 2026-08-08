import { Candle, Direction } from '@tradejs/types';
import type { VolumeDivergenceConfig } from './config';

export type VolumeDivergenceAiThresholds = {
  q4DivergenceAmplitudeAtrRatio: number;
  q4ReclaimPct: number;
  q4ConfirmationCandleQuality: number;
  q5DivergenceAmplitudeAtrRatio: number;
  q5ReclaimPct: number;
  q5ConfirmationCandleQuality: number;
};

export type VolumeDivergenceSetupFeatures = {
  atrAbsolute: number | null;
  atrPct: number | null;
  divergenceAmplitudeAtrRatio: number | null;
  reclaimPct: number | null;
  confirmationCandleQuality: number | null;
  confirmationDistancePct: number | null;
  confirmationDistanceAtrRatio: number | null;
};

export type VolumeDivergenceEntryThresholdSnapshot = {
  allowStructureAdvanceEntry: boolean;
  minDivergenceAmplitudeAtrRatio: number;
  minReclaimPct: number;
  minConfirmationCandleQuality: number;
  requireRetest: boolean;
  retestToleranceAtr: number;
  maxRetestBars: number;
  maxConfirmationDistanceAtr: number;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const DEFAULT_VOLUME_DIVERGENCE_ENTRY_THRESHOLDS: VolumeDivergenceEntryThresholdSnapshot =
  {
    allowStructureAdvanceEntry: false,
    minDivergenceAmplitudeAtrRatio: 0.35,
    minReclaimPct: 105,
    minConfirmationCandleQuality: 0.58,
    requireRetest: false,
    retestToleranceAtr: 0.35,
    maxRetestBars: 4,
    maxConfirmationDistanceAtr: 0,
  };

const VOLUME_DIVERGENCE_AI_THRESHOLDS: Record<
  Direction,
  VolumeDivergenceAiThresholds
> = {
  LONG: {
    q4DivergenceAmplitudeAtrRatio: 0.45,
    q4ReclaimPct: 115,
    q4ConfirmationCandleQuality: 0.62,
    q5DivergenceAmplitudeAtrRatio: 0.8,
    q5ReclaimPct: 145,
    q5ConfirmationCandleQuality: 0.8,
  },
  SHORT: {
    q4DivergenceAmplitudeAtrRatio: 0.6,
    q4ReclaimPct: 125,
    q4ConfirmationCandleQuality: 0.7,
    q5DivergenceAmplitudeAtrRatio: 0.95,
    q5ReclaimPct: 160,
    q5ConfirmationCandleQuality: 0.82,
  },
};

export const getVolumeDivergenceEntryThresholds = ({
  ALLOW_STRUCTURE_ADVANCE_ENTRY,
  MIN_DIVERGENCE_AMPLITUDE_ATR_RATIO,
  MIN_RECLAIM_PCT,
  MIN_CONFIRMATION_CANDLE_QUALITY,
}: Pick<
  VolumeDivergenceConfig,
  | 'ALLOW_STRUCTURE_ADVANCE_ENTRY'
  | 'MIN_DIVERGENCE_AMPLITUDE_ATR_RATIO'
  | 'MIN_RECLAIM_PCT'
  | 'MIN_CONFIRMATION_CANDLE_QUALITY'
>): VolumeDivergenceEntryThresholdSnapshot => ({
  allowStructureAdvanceEntry: ALLOW_STRUCTURE_ADVANCE_ENTRY,
  minDivergenceAmplitudeAtrRatio: MIN_DIVERGENCE_AMPLITUDE_ATR_RATIO,
  minReclaimPct: MIN_RECLAIM_PCT,
  minConfirmationCandleQuality: MIN_CONFIRMATION_CANDLE_QUALITY,
  requireRetest: false,
  retestToleranceAtr: 0.35,
  maxRetestBars: 4,
  maxConfirmationDistanceAtr: 0,
});

export const getVolumeDivergenceEntryThresholdsForDirection = ({
  config,
  mode,
}: {
  config: VolumeDivergenceConfig;
  mode: VolumeDivergenceConfig['BULLISH'];
}): VolumeDivergenceEntryThresholdSnapshot => ({
  allowStructureAdvanceEntry: Boolean(config.ALLOW_STRUCTURE_ADVANCE_ENTRY),
  minDivergenceAmplitudeAtrRatio: Math.max(
    0,
    Number(
      mode.minDivergenceAmplitudeAtrRatio ??
        config.MIN_DIVERGENCE_AMPLITUDE_ATR_RATIO,
    ),
  ),
  minReclaimPct: Math.max(
    0,
    Number(mode.minReclaimPct ?? config.MIN_RECLAIM_PCT),
  ),
  minConfirmationCandleQuality: clamp(
    Number(
      mode.minConfirmationCandleQuality ??
        config.MIN_CONFIRMATION_CANDLE_QUALITY,
    ),
    0,
    1,
  ),
  requireRetest: Boolean(mode.requireRetest),
  retestToleranceAtr: Math.max(0, Number(mode.retestToleranceAtr ?? 0.35)),
  maxRetestBars: Math.max(1, Math.floor(Number(mode.maxRetestBars ?? 4))),
  maxConfirmationDistanceAtr: Math.max(
    0,
    Number(mode.maxConfirmationDistanceAtr ?? 0),
  ),
});

export const getVolumeDivergenceAiThresholds = (
  direction: Direction,
): VolumeDivergenceAiThresholds => VOLUME_DIVERGENCE_AI_THRESHOLDS[direction];

export const calculateAverageTrueRange = (
  candles: Candle[],
  period: number,
): number | null => {
  if (!Array.isArray(candles) || candles.length < 2 || period <= 0) {
    return null;
  }

  let total = 0;
  let count = 0;
  const startIndex = Math.max(1, candles.length - period);

  for (let i = startIndex; i < candles.length; i += 1) {
    const candle = candles[i];
    const previousClose = Number(candles[i - 1]?.close);
    const high = Number(candle?.high);
    const low = Number(candle?.low);

    if (
      !Number.isFinite(previousClose) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low)
    ) {
      continue;
    }

    const trueRange = Math.max(
      high - low,
      Math.abs(high - previousClose),
      Math.abs(low - previousClose),
    );

    total += trueRange;
    count += 1;
  }

  return count > 0 ? total / count : null;
};

export const getConfirmationCandleQuality = ({
  candle,
  direction,
}: {
  candle: Candle;
  direction: Direction;
}) => {
  const high = Number(candle.high);
  const low = Number(candle.low);
  const open = Number(candle.open);
  const close = Number(candle.close);

  if (
    !Number.isFinite(high) ||
    !Number.isFinite(low) ||
    !Number.isFinite(open) ||
    !Number.isFinite(close)
  ) {
    return null;
  }

  const range = Math.max(high - low, 1e-9);
  const bodyPct = clamp(Math.abs(close - open) / range, 0, 1);
  const closeLocation =
    direction === 'LONG'
      ? clamp((close - low) / range, 0, 1)
      : clamp((high - close) / range, 0, 1);

  return closeLocation * 0.7 + bodyPct * 0.3;
};

const calculateAtrPct = ({
  atrAbsolute,
  currentPrice,
}: {
  atrAbsolute: number | null;
  currentPrice: number;
}) =>
  atrAbsolute != null && currentPrice > 0
    ? (atrAbsolute / currentPrice) * 100
    : null;

const calculateDivergenceAmplitudeAtrRatio = ({
  direction,
  atrAbsolute,
  currentPivotLow,
  previousPivotLow,
  currentPivotHigh,
  previousPivotHigh,
}: {
  direction: Direction;
  atrAbsolute: number | null;
  currentPivotLow: number;
  previousPivotLow: number;
  currentPivotHigh: number;
  previousPivotHigh: number;
}) => {
  const divergenceAmplitude =
    direction === 'LONG'
      ? previousPivotLow - currentPivotLow
      : currentPivotHigh - previousPivotHigh;

  return atrAbsolute != null && atrAbsolute > 0 && divergenceAmplitude > 0
    ? divergenceAmplitude / atrAbsolute
    : null;
};

const calculateReclaimPct = ({
  direction,
  currentPrice,
  currentPivotLow,
  currentPivotHigh,
}: {
  direction: Direction;
  currentPrice: number;
  currentPivotLow: number;
  currentPivotHigh: number;
}) => {
  const reclaimRange = currentPivotHigh - currentPivotLow;
  const reclaimProgress =
    direction === 'LONG'
      ? currentPrice - currentPivotLow
      : currentPivotHigh - currentPrice;

  return reclaimRange > 0 ? (reclaimProgress / reclaimRange) * 100 : null;
};

const calculateConfirmationDistancePct = ({
  direction,
  currentPrice,
  currentPivotLow,
  currentPivotHigh,
}: {
  direction: Direction;
  currentPrice: number;
  currentPivotLow: number;
  currentPivotHigh: number;
}) => {
  const confirmationPrice =
    direction === 'LONG' ? currentPivotHigh : currentPivotLow;

  if (!(confirmationPrice > 0)) {
    return null;
  }

  return direction === 'LONG'
    ? ((currentPrice - confirmationPrice) / confirmationPrice) * 100
    : ((confirmationPrice - currentPrice) / confirmationPrice) * 100;
};

export const buildVolumeDivergenceSetupFeatures = ({
  candles,
  currentCandle,
  direction,
  currentPrice,
  currentPivotLow,
  previousPivotLow,
  currentPivotHigh,
  previousPivotHigh,
  atrPeriod,
}: {
  candles: Candle[];
  currentCandle: Candle;
  direction: Direction;
  currentPrice: number;
  currentPivotLow: number;
  previousPivotLow: number;
  currentPivotHigh: number;
  previousPivotHigh: number;
  atrPeriod: number;
}): VolumeDivergenceSetupFeatures => {
  const atrAbsolute = calculateAverageTrueRange(candles, atrPeriod);
  const atrPct = calculateAtrPct({ atrAbsolute, currentPrice });
  const divergenceAmplitudeAtrRatio = calculateDivergenceAmplitudeAtrRatio({
    direction,
    atrAbsolute,
    currentPivotLow,
    previousPivotLow,
    currentPivotHigh,
    previousPivotHigh,
  });
  const reclaimPct = calculateReclaimPct({
    direction,
    currentPrice,
    currentPivotLow,
    currentPivotHigh,
  });
  const confirmationCandleQuality = getConfirmationCandleQuality({
    candle: currentCandle,
    direction,
  });
  const confirmationDistancePct = calculateConfirmationDistancePct({
    direction,
    currentPrice,
    currentPivotLow,
    currentPivotHigh,
  });
  const confirmationPrice =
    direction === 'LONG' ? currentPivotHigh : currentPivotLow;
  const confirmationDistanceAtrRatio =
    atrAbsolute != null && atrAbsolute > 0
      ? Math.abs(currentPrice - confirmationPrice) / atrAbsolute
      : null;

  return {
    atrAbsolute,
    atrPct,
    divergenceAmplitudeAtrRatio,
    reclaimPct,
    confirmationCandleQuality,
    confirmationDistancePct,
    confirmationDistanceAtrRatio,
  };
};
