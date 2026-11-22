import assert from 'node:assert/strict';
import { CORRELATION_WINDOW } from '@tradejs/core/constants';
import {
  createIndicatorCorrelation,
  type IndicatorCorrelation,
} from '@tradejs/core/indicators';
import { round } from '@tradejs/core/math';
import type { KlineChartData } from '@tradejs/types';

export type NativeIndicatorAddon = {
  rollingCorrelation(
    coin: Float64Array,
    btc: Float64Array,
    window: number,
  ): Float64Array;
};

export const createBatchIndicatorCorrelation = (
  addon: NativeIndicatorAddon,
  coin: KlineChartData,
  btc: KlineChartData,
) => {
  const candleMs = 15 * 60_000;
  const start = coin[0].timestamp;
  assert.equal(coin.length, btc.length);
  const coinCloses = new Float64Array(coin.length);
  const btcCloses = new Float64Array(btc.length);
  for (let index = 0; index < coin.length; index += 1) {
    const timestamp = start + index * candleMs;
    assert.ok(
      coin[index].timestamp === timestamp && btc[index].timestamp === timestamp,
    );
    assert.ok(
      Number.isFinite(coin[index].close) && Number.isFinite(btc[index].close),
    );
    coinCloses[index] = coin[index].close;
    btcCloses[index] = btc[index].close;
  }
  const correlations = addon.rollingCorrelation(
    coinCloses,
    btcCloses,
    CORRELATION_WINDOW,
  );
  assert.equal(correlations.length, coin.length);

  const fallback = createIndicatorCorrelation();
  let batchReads = 0;
  let fallbackReads = 0;
  const read: IndicatorCorrelation = (coinWindow, btcWindow) => {
    const timestamp = coinWindow.at(-1)?.timestamp;
    const index = ((timestamp ?? Number.NaN) - start) / candleMs;
    const length = Math.min(index + 1, CORRELATION_WINDOW);
    const firstTimestamp = (timestamp ?? Number.NaN) - (length - 1) * candleMs;
    if (
      Number.isInteger(index) &&
      index >= 0 &&
      index < correlations.length &&
      coinWindow.length === length &&
      btcWindow.length === length &&
      coinWindow[0]?.timestamp === firstTimestamp &&
      btcWindow[0]?.timestamp === firstTimestamp &&
      btcWindow.at(-1)?.timestamp === timestamp
    ) {
      batchReads += 1;
      const correlation = correlations[index];
      return correlation ? round(correlation) : correlation;
    }
    fallbackReads += 1;
    return fallback(coinWindow, btcWindow);
  };
  return { read, usage: () => ({ batchReads, fallbackReads }) };
};
