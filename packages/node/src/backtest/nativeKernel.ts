import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type { KlineChartData } from '@tradejs/types';

export interface NativeBacktestKernel {
  matchExits(
    long: boolean,
    high: number,
    low: number,
    stop: number,
    targets: Float64Array,
  ): Int32Array;
  netProfit(
    grossProfit: number,
    price: number,
    qty: number,
    feeRate: number,
  ): Float64Array;
  alignTimestamps(left: Float64Array, right: Float64Array): Int32Array;
}

export const loadNativeBacktestKernel = (
  cwd: string,
): NativeBacktestKernel | undefined => {
  const file = process.env.TRADEJS_BACKTEST_NATIVE_KERNEL?.trim();
  if (!file) return undefined;
  const requireAddon = createRequire(resolve(cwd, 'package.json'));
  const kernel: Partial<NativeBacktestKernel> = requireAddon(
    resolve(cwd, file),
  );
  if (
    typeof kernel?.matchExits !== 'function' ||
    typeof kernel.netProfit !== 'function' ||
    typeof kernel.alignTimestamps !== 'function'
  ) {
    throw new TypeError('Invalid TradeJS backtest addon: ' + file);
  }
  return kernel as NativeBacktestKernel;
};

export const alignNativeBacktestCandles = (
  kernel: NativeBacktestKernel,
  coin: KlineChartData,
  btc: KlineChartData,
) => {
  const pairs = kernel.alignTimestamps(
    Float64Array.from(coin, (candle) => candle.timestamp),
    Float64Array.from(btc, (candle) => candle.timestamp),
  );
  const alignedCoinCandles: KlineChartData = [];
  const alignedBtcCandles: KlineChartData = [];
  for (let index = 0; index < pairs.length; index += 2) {
    alignedCoinCandles.push(coin[pairs[index]]);
    alignedBtcCandles.push(btc[pairs[index + 1]]);
  }
  return { alignedCoinCandles, alignedBtcCandles };
};
