import {
  StrategyEntryModelFigures,
  StrategyFigureLine,
  StrategyFigurePoints,
} from '@tradejs/types';
import {
  AdaptiveTrendChannelFigureSeries,
  AdaptiveTrendChannelSignal,
} from './engine';

export const buildAdaptiveTrendChannelFigures = ({
  signal,
  series,
  entryTimestamp,
  entryPrice,
  stopLossPrice,
  takeProfitPrice,
}: {
  signal: AdaptiveTrendChannelSignal;
  series: AdaptiveTrendChannelFigureSeries;
  entryTimestamp: number;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
}): StrategyEntryModelFigures => {
  const color = signal.direction === 'LONG' ? '#40d98f' : '#f67171';

  const lines: StrategyFigureLine[] = [
    {
      id: `adaptive-trend-channel-center-${entryTimestamp}`,
      kind: 'adaptive_trend_channel_centerline',
      points: series.centerline,
      color,
      width: 2,
      style: 'solid' as const,
    },
    {
      id: `adaptive-trend-channel-roof-${entryTimestamp}`,
      kind: 'adaptive_trend_channel_roof',
      points: series.roof,
      color: '#f67171',
      width: 1,
      style: 'dashed' as const,
    },
    {
      id: `adaptive-trend-channel-floor-${entryTimestamp}`,
      kind: 'adaptive_trend_channel_floor',
      points: series.floor,
      color: '#40d98f',
      width: 1,
      style: 'dashed' as const,
    },
    {
      id: `adaptive-trend-channel-target-${entryTimestamp}`,
      kind: 'adaptive_trend_channel_target',
      points: [
        { timestamp: signal.timestamp, value: takeProfitPrice },
        { timestamp: entryTimestamp, value: takeProfitPrice },
      ],
      color: '#22c55e',
      width: 1,
      style: 'dashed' as const,
    },
    {
      id: `adaptive-trend-channel-stop-${entryTimestamp}`,
      kind: 'adaptive_trend_channel_stop',
      points: [
        { timestamp: signal.timestamp, value: stopLossPrice },
        { timestamp: entryTimestamp, value: stopLossPrice },
      ],
      color: '#ef4444',
      width: 1,
      style: 'dashed' as const,
    },
  ].filter((line) => line.points.length > 0);

  const points: StrategyFigurePoints[] = [
    {
      id: `adaptive-trend-channel-flip-${entryTimestamp}`,
      kind:
        signal.direction === 'LONG'
          ? 'adaptive_trend_channel_bullish_flip'
          : 'adaptive_trend_channel_bearish_flip',
      points: [
        {
          timestamp: entryTimestamp,
          value: signal.direction === 'LONG' ? signal.floor : signal.roof,
        },
      ],
      color,
      radius: 5,
    },
    {
      id: `adaptive-trend-channel-entry-${entryTimestamp}`,
      kind: 'adaptive_trend_channel_entry',
      points: [{ timestamp: entryTimestamp, value: entryPrice }],
      color,
      radius: 5,
    },
  ];

  return { lines, points };
};
