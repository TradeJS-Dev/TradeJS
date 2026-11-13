import type { KlineChartData } from '@tradejs/types';
import { findCandleIndex } from './trades';

export interface ChartReplay {
  candles: KlineChartData;
  index: number;
}

export const startChartReplay = (
  candles: KlineChartData,
  timestamp: number,
): ChartReplay | null => {
  if (!candles.length) return null;
  const index = Math.min(
    candles.length - 1,
    findCandleIndex(candles, timestamp),
  );
  return { candles: [...candles], index };
};

export const stepChartReplay = (
  replay: ChartReplay,
  step: number,
): ChartReplay => ({
  ...replay,
  index: Math.min(replay.candles.length - 1, Math.max(0, replay.index + step)),
});
