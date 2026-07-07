import { Candle } from '@tradejs/types';

type BuildVolumeDivergenceFiguresParams = {
  kind: 'bullish' | 'bearish';
  previousPivotIndex: number;
  currentPivotIndex: number;
  previousPivotLow: number;
  previousPivotHigh: number;
  currentPivotLow: number;
  currentPivotHigh: number;
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
  candleWindow,
}: BuildVolumeDivergenceFiguresParams) => ({
  lines: [
    {
      id: `volume-divergence-price-${kind}`,
      kind: `volume_divergence_${kind}_price`,
      points: [
        {
          timestamp: candleWindow[previousPivotIndex]?.timestamp ?? 0,
          value: kind === 'bullish' ? previousPivotLow : previousPivotHigh,
        },
        {
          timestamp: candleWindow[currentPivotIndex]?.timestamp ?? 0,
          value: kind === 'bullish' ? currentPivotLow : currentPivotHigh,
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
          timestamp: candleWindow[previousPivotIndex]?.timestamp ?? 0,
          value: kind === 'bullish' ? previousPivotLow : previousPivotHigh,
        },
        {
          timestamp: candleWindow[currentPivotIndex]?.timestamp ?? 0,
          value: kind === 'bullish' ? currentPivotLow : currentPivotHigh,
        },
      ],
      color: kind === 'bullish' ? '#22c55e' : '#ef4444',
      radius: 4,
    },
  ],
});
