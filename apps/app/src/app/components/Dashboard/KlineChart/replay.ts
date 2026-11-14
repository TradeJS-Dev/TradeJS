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
  const first = candles[0];
  const last = candles.at(-1);
  if (
    !first ||
    !last ||
    !Number.isFinite(timestamp) ||
    timestamp < first.timestamp ||
    timestamp > last.timestamp
  )
    return null;
  const index = findCandleIndex(candles, timestamp);
  return { candles: [...candles], index };
};

export const stepChartReplay = (
  replay: ChartReplay,
  step: number,
): ChartReplay => ({
  ...replay,
  index: Math.min(replay.candles.length - 1, Math.max(0, replay.index + step)),
});
