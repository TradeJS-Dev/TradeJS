import type { Candle, StrategyEntryModelFigures } from '@tradejs/types';
import {
  buildEntryEvidenceAnnotation,
  formatFigureMetric,
} from '@tradejs/strategy-kit/figures';

type BuildVolumeDivergenceFiguresParams = {
  kind: 'bullish' | 'bearish';
  previousPivotIndex: number;
  currentPivotIndex: number;
  previousPivotLow: number;
  previousPivotHigh: number;
  currentPivotLow: number;
  currentPivotHigh: number;
  previousPivotVolumeNorm: number;
  currentPivotVolumeNorm: number;
  barsBetweenPivotConfirmations: number;
  entryTiming: string;
  candleWindow: Candle[];
};

export const buildVolumeDivergenceFigures = ({
  kind,
  previousPivotIndex,
  currentPivotIndex,
  previousPivotLow,
  previousPivotHigh,
  currentPivotLow,
  currentPivotHigh,
  previousPivotVolumeNorm,
  currentPivotVolumeNorm,
  barsBetweenPivotConfirmations,
  entryTiming,
  candleWindow,
}: BuildVolumeDivergenceFiguresParams): StrategyEntryModelFigures => {
  const direction = kind === 'bullish' ? 'LONG' : 'SHORT';
  const previousTimestamp = candleWindow[previousPivotIndex]?.timestamp ?? 0;
  const currentTimestamp = candleWindow[currentPivotIndex]?.timestamp ?? 0;
  const previousPrice =
    kind === 'bullish' ? previousPivotLow : previousPivotHigh;
  const currentPrice = kind === 'bullish' ? currentPivotLow : currentPivotHigh;
  const priceShape = kind === 'bullish' ? 'lower low' : 'higher high';
  const volumeShape =
    kind === 'bullish' ? 'higher normalized volume' : 'lower normalized volume';

  return {
    lines: [
      {
        id: `volume-divergence-price-${kind}`,
        kind: `volume_divergence_${kind}_price`,
        points: [
          {
            timestamp: previousTimestamp,
            value: previousPrice,
          },
          {
            timestamp: currentTimestamp,
            value: currentPrice,
          },
        ],
        color: kind === 'bullish' ? '#22c55e' : '#ef4444',
        width: 2,
        style: 'dashed' as const,
      },
    ],
    points: [
      {
        id: `volume-divergence-pivots-${kind}`,
        kind: `volume_divergence_${kind}_pivots`,
        points: [
          {
            timestamp: previousTimestamp,
            value: previousPrice,
          },
          {
            timestamp: currentTimestamp,
            value: currentPrice,
          },
        ],
        color: kind === 'bullish' ? '#22c55e' : '#ef4444',
        radius: 4,
      },
    ],
    annotations: [
      buildEntryEvidenceAnnotation({
        idPrefix: 'volume-divergence',
        kind: `volume_divergence_${kind}_entry_evidence`,
        direction,
        entryTimestamp: currentTimestamp,
        entryPrice: currentPrice,
        title: `${kind === 'bullish' ? 'Bullish' : 'Bearish'} volume divergence`,
        items: [
          `Price: ${formatFigureMetric(previousPrice)} → ${formatFigureMetric(currentPrice)} (${priceShape})`,
          `Normalized volume: ${formatFigureMetric(previousPivotVolumeNorm)} → ${formatFigureMetric(currentPivotVolumeNorm)}`,
          `Evidence: ${volumeShape}`,
          `Pivot confirmations: ${barsBetweenPivotConfirmations} bars`,
          `Entry timing: ${entryTiming.replaceAll('_', ' ')}`,
        ],
      }),
    ],
  };
};
