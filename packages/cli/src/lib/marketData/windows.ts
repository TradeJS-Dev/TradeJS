import { alignSortedCandlesByTimestamp } from '@tradejs/core/indicators';
import type { KlineChartData } from '@tradejs/types';

export const resolveOpenTimestamp = (timestamp: number, intervalMs: number) =>
  Number.isFinite(intervalMs) && intervalMs > 0
    ? Math.floor(timestamp / intervalMs) * intervalMs
    : timestamp;

export const getClosedCandlesForInterval = <T extends { timestamp: number }>(
  candles: T[],
  currentTimestamp: number,
  intervalMs: number,
) => {
  const currentOpenTimestamp = resolveOpenTimestamp(
    currentTimestamp,
    intervalMs,
  );
  return candles.filter((candle) => candle.timestamp < currentOpenTimestamp);
};

export const splitCandlesForReplayWindow = (
  candles: KlineChartData,
  start: number,
  preloadStart: number,
) => {
  const prevData: KlineChartData = [];
  const replayData: KlineChartData = [];

  for (const candle of candles) {
    if (candle.timestamp < preloadStart) {
      continue;
    }

    if (candle.timestamp < start) {
      prevData.push(candle);
      continue;
    }

    replayData.push(candle);
  }

  return { prevData, replayData };
};

export const alignSymbolWithBtcReference = (
  symbolCandles: KlineChartData,
  btcCandles: KlineChartData,
) => alignSortedCandlesByTimestamp(symbolCandles, btcCandles);
