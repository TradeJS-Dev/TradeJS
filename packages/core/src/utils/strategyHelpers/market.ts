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
  Ticker,
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

const getTopOfBookTargetVenue = async ({
  connector,
  symbol,
}: {
  connector: Connector;
  symbol: string;
}): Promise<StrategyMarketSnapshot['targetVenue']> => {
  if (connector.getTopOfBookTicker) {
    try {
      const topOfBook = await connector.getTopOfBookTicker(symbol);
      if (topOfBook) {
        const bid = Number.isFinite(topOfBook.bidPrice)
          ? topOfBook.bidPrice
          : null;
        const ask = Number.isFinite(topOfBook.askPrice)
          ? topOfBook.askPrice
          : null;
        const mid = bid != null && ask != null ? (bid + ask) / 2 : null;
        const spreadBps =
          bid != null && ask != null && mid != null && mid > 0
            ? ((ask - bid) / mid) * 10_000
            : null;

        return {
          source: 'ticker_top_of_book',
          venue: null,
          symbol: topOfBook.symbol || symbol,
          bid,
          ask,
          mid,
          spreadBps,
          topBidQty: Number.isFinite(topOfBook.bidQty)
            ? topOfBook.bidQty
            : null,
          topAskQty: Number.isFinite(topOfBook.askQty)
            ? topOfBook.askQty
            : null,
          snapshotTimestamp: topOfBook.timestamp ?? Date.now(),
          stale: false,
        };
      }
    } catch {
      return null;
    }
  }

  let tickers: Ticker[] = [];
  try {
    tickers = await connector.getTickers();
  } catch {
    return null;
  }

  const ticker = tickers.find((item) => item.symbol === symbol);
  if (!ticker) {
    return null;
  }

  const bid = Number.isFinite(ticker.bid1Price) ? ticker.bid1Price : null;
  const ask = Number.isFinite(ticker.ask1Price) ? ticker.ask1Price : null;
  const mid = bid != null && ask != null ? (bid + ask) / 2 : null;
  const spreadBps =
    bid != null && ask != null && mid != null && mid > 0
      ? ((ask - bid) / mid) * 10_000
      : null;

  return {
    source: 'ticker_top_of_book',
    venue: null,
    symbol,
    bid,
    ask,
    mid,
    spreadBps,
    topBidQty: Number.isFinite(ticker.bid1Size) ? ticker.bid1Size : null,
    topAskQty: Number.isFinite(ticker.ask1Size) ? ticker.ask1Size : null,
    snapshotTimestamp: Date.now(),
    stale: false,
  };
};

export const resolveBacktestExecutionPrice = (
  candle: KlineChartItem,
  backtestPriceMode: BacktestPriceMode = 'open',
) => {
  if (backtestPriceMode === 'mid') {
    return (candle.open + candle.close) / 2;
  }
  if (backtestPriceMode === 'open') {
    return candle.open;
  }
  return candle.close;
};

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
    env === 'BACKTEST' || env === 'CRON' || env === 'PARITY'
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
    currentPrice = resolveBacktestExecutionPrice(lastCandle, backtestPriceMode);
  }

  return {
    fullData,
    lastCandle,
    timestamp: lastCandle.timestamp,
    currentPrice,
    targetVenue:
      env === 'BACKTEST' || env === 'PARITY'
        ? null
        : await getTopOfBookTargetVenue({ connector, symbol }),
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
