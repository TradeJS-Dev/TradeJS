import {
  KlineChartData,
  StrategyEntryModelFigures,
  StrategyFigurePoint,
} from '@tradejs/types';

interface BuildMaStrategyFiguresParams {
  candles: KlineChartData;
  maFast: number[];
  maSlow: number[];
  crossTimestamp: number;
  crossPrice: number;
  crossKind: 'bullish' | 'bearish';
}

const toLinePoints = (
  candles: KlineChartData,
  values: number[],
  limit = 120,
): StrategyFigurePoint[] => {
  const points: StrategyFigurePoint[] = [];
  const seriesOffset = Math.max(0, candles.length - values.length);
  const start = Math.max(0, values.length - limit);

  for (let i = start; i < values.length; i += 1) {
    const candle = candles[seriesOffset + i];
    const value = values[i];
    if (!candle || !Number.isFinite(value)) continue;
    points.push({
      timestamp: candle.timestamp,
      value,
    });
  }

  return points;
};

export const buildMaStrategyFigures = ({
  candles,
  maFast,
  maSlow,
  crossTimestamp,
  crossPrice,
  crossKind,
}: BuildMaStrategyFiguresParams): StrategyEntryModelFigures => ({
  lines: [
    {
      id: 'ma-fast',
      kind: 'ma_fast',
      points: toLinePoints(candles, maFast),
      color: '#22d3ee',
      width: 2,
      style: 'solid',
    },
    {
      id: 'ma-slow',
      kind: 'ma_slow',
      points: toLinePoints(candles, maSlow),
      color: '#f59e0b',
      width: 2,
      style: 'solid',
    },
  ],
  points: [
    {
      id: `ma-cross-${crossTimestamp}`,
      kind: 'ma_cross',
      points: [
        {
          timestamp: crossTimestamp,
          value: crossPrice,
        },
      ],
      color: crossKind === 'bullish' ? '#22c55e' : '#ef4444',
      radius: 4,
    },
  ],
});
