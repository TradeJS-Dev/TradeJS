import { FEE_PERCENT as DEFAULT_FEE_PERCENT } from '../../constants';
import { getTimestamp } from '../timestamp';
import {
  BacktestPriceMode,
  Connector,
  Direction,
  Interval,
  KlineChartData,
  KlineChartItem,
  StrategyMarketSnapshot,
} from '@tradejs/types';

export interface StrategyMarketSnapshotParams {
  env: string;
  connector: Connector;
  symbol: string;
  interval: Interval;
  cachedData: KlineChartData;
  preloadStart: number;
  backtestPriceMode?: BacktestPriceMode;
}

export const getStrategyMarketSnapshot = async ({
  env,
  connector,
  symbol,
  interval,
  cachedData,
  preloadStart,
  backtestPriceMode = 'mid',
}: StrategyMarketSnapshotParams): Promise<StrategyMarketSnapshot> => {
  const fullData =
    env === 'BACKTEST' || env === 'CRON'
      ? cachedData
      : await connector.kline({
          symbol,
          start: preloadStart,
          end: getTimestamp(),
          cacheOnly: false,
          interval,
        });

  const lastCandle = fullData[fullData.length - 1];
  let currentPrice = lastCandle.close;

  if (env === 'BACKTEST') {
    if (backtestPriceMode === 'mid') {
      currentPrice = (lastCandle.open + lastCandle.close) / 2;
    } else if (backtestPriceMode === 'open') {
      currentPrice = lastCandle.open;
    } else if (backtestPriceMode === 'rand') {
      const min = Math.min(lastCandle.low, lastCandle.high);
      const max = Math.max(lastCandle.low, lastCandle.high);
      currentPrice = min + Math.random() * (max - min);
    }
  }

  return {
    fullData,
    lastCandle,
    timestamp: lastCandle.timestamp,
    currentPrice,
  };
};

export const calculateRiskRatio = ({
  direction,
  currentPrice,
  takeProfitPrice,
  stopLossPrice,
}: {
  direction: Direction;
  currentPrice: number;
  takeProfitPrice: number;
  stopLossPrice: number;
}): number => {
  const isLong = direction === 'LONG';

  const reward = isLong
    ? takeProfitPrice - currentPrice
    : currentPrice - takeProfitPrice;
  const risk = isLong
    ? currentPrice - stopLossPrice
    : stopLossPrice - currentPrice;

  return risk > 0 ? reward / risk : 0;
};

export interface DirectionalTpSlPricesParams {
  price: number;
  direction: Direction;
  takeProfitDelta: number;
  stopLossDelta: number;
  unit?: 'percent' | 'ratio';
  maxLossValue?: number;
  feePercent?: number;
}

export interface DirectionalTpSlPricesResult {
  stopLossPrice: number;
  takeProfitPrice: number;
  riskRatio: number;
  qty?: number;
}

export const getDirectionalTpSlPrices = ({
  price,
  direction,
  takeProfitDelta,
  stopLossDelta,
  unit = 'percent',
  maxLossValue,
  feePercent = DEFAULT_FEE_PERCENT,
}: DirectionalTpSlPricesParams): DirectionalTpSlPricesResult => {
  const deltaFactor = unit === 'percent' ? 100 : 1;
  const tp = takeProfitDelta / deltaFactor;
  const sl = stopLossDelta / deltaFactor;
  const isLong = direction === 'LONG';
  const stopLossPrice = isLong ? price * (1 - sl) : price * (1 + sl);
  const takeProfitPrice = isLong ? price * (1 + tp) : price * (1 - tp);
  const riskRatio = calculateRiskRatio({
    direction,
    currentPrice: price,
    takeProfitPrice,
    stopLossPrice,
  });

  const slPercent = unit === 'percent' ? stopLossDelta : stopLossDelta * 100;
  const qty =
    typeof maxLossValue === 'number' &&
    Number.isFinite(maxLossValue) &&
    maxLossValue > 0
      ? maxLossValue / ((price * (slPercent + feePercent)) / 100)
      : undefined;

  return {
    stopLossPrice,
    takeProfitPrice,
    riskRatio,
    qty,
  };
};
