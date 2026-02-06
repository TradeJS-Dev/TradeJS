import 'dotenv/config';

import { fetchMlThreshold } from '@utils/mlGrpc';
import { Signal, TrendLine } from '@types';
import { config as DEFAULT_CONFIG } from '@src/strategy/TrendLine/config';

const now = Date.now();
const INTERVAL_MIN = 15;
const CANDLES = 50;

const makeSeries = (len: number, base: number, step = 0.1) =>
  Array.from({ length: len }, (_, i) => base + i * step);

const makeCandles = (startPrice: number, startTs: number) => {
  const candles = [] as Array<{
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    turnover: number;
    timestamp: number;
    dt: string;
  }>;

  let price = startPrice;
  for (let i = 0; i < CANDLES; i += 1) {
    const ts = startTs + i * INTERVAL_MIN * 60_000;
    const delta = (i % 2 === 0 ? 1 : -1) * (0.2 + i * 0.01);
    const open = price;
    const close = price + delta;
    const high = Math.max(open, close) + 0.15;
    const low = Math.min(open, close) - 0.15;
    const volume = 1000 + i * 10;
    candles.push({
      open,
      high,
      low,
      close,
      volume,
      turnover: volume * close,
      timestamp: ts,
      dt: new Date(ts).toISOString(),
    });
    price = close;
  }

  return candles;
};

const buildTrendline = (entryTs: number, price: number): TrendLine => ({
  id: 'mock-trendline',
  mode: 'lows',
  distance: 0.75,
  touches: [
    { timestamp: entryTs - 6 * INTERVAL_MIN * 60_000, value: price * 0.985 },
    { timestamp: entryTs - 3 * INTERVAL_MIN * 60_000, value: price * 0.99 },
  ],
  points: [
    { timestamp: entryTs - 12 * INTERVAL_MIN * 60_000, value: price * 0.98 },
    { timestamp: entryTs - 2 * INTERVAL_MIN * 60_000, value: price * 0.995 },
  ],
});

const main = async () => {
  const startTs = now - CANDLES * INTERVAL_MIN * 60_000;
  const candles = makeCandles(120, startTs);
  const btcCandles = makeCandles(42000, startTs);

  const lastCandle = candles[candles.length - 1];
  const currentPrice = lastCandle.close;

  const signal: Signal = {
    signalId: 'mock-signal',
    symbol: 'ETHUSDT',
    interval: String(INTERVAL_MIN) as any,
    strategy: 'TRENDLINE',
    direction: 'LONG',
    timestamp: lastCandle.timestamp,
    figures: {
      trendLine: buildTrendline(lastCandle.timestamp, currentPrice),
    },
    prices: {
      currentPrice,
      takeProfitPrice: currentPrice * 1.03,
      stopLossPrice: currentPrice * 0.99,
      riskRatio: 2.2,
    },
    indicators: {
      correlation: 0.18,
      touches: 6,
      distance: 0.7,
      atr: makeSeries(10, 1.2, 0.02),
      atrPct: makeSeries(10, 1.05, 0.005),
      maFast: makeSeries(10, currentPrice * 0.995, 0.01),
      maMedium: makeSeries(10, currentPrice * 1.0, 0.005),
      maSlow: makeSeries(10, currentPrice * 1.01, 0.002),
      bbUpper: makeSeries(10, currentPrice * 1.02, 0.01),
      bbMiddle: makeSeries(10, currentPrice, 0.005),
      bbLower: makeSeries(10, currentPrice * 0.98, 0.01),
      obv: makeSeries(10, 2000, 50),
      macd: makeSeries(10, 0.2, 0.01),
      macdSignal: makeSeries(10, 0.18, 0.01),
      macdHistogram: makeSeries(10, 0.02, 0.005),
      price24hPcnt: makeSeries(10, 1.2, 0.05),
      price1hPcnt: makeSeries(10, 0.2, 0.02),
      prevPrice24hPcnt: makeSeries(10, 1.1, 0.04),
      prevPrice1hPcnt: makeSeries(10, 0.18, 0.02),
      highPrice1h: makeSeries(10, currentPrice * 1.01, 0.01),
      lowPrice1h: makeSeries(10, currentPrice * 0.99, 0.01),
      volume1h: makeSeries(10, 1200, 30),
      highPrice24h: makeSeries(10, currentPrice * 1.03, 0.02),
      lowPrice24h: makeSeries(10, currentPrice * 0.97, 0.02),
      volume24h: makeSeries(10, 8000, 200),
      prevHighPrice1h: makeSeries(10, currentPrice * 1.005, 0.01),
      prevLowPrice1h: makeSeries(10, currentPrice * 0.995, 0.01),
      prevVolume1h: makeSeries(10, 1100, 25),
      prevHighPrice24h: makeSeries(10, currentPrice * 1.02, 0.02),
      prevLowPrice24h: makeSeries(10, currentPrice * 0.98, 0.02),
      prevVolume24h: makeSeries(10, 7800, 180),
    },
  };

  const { TRENDLINE, HIGHS, LOWS, ML_THRESHOLD } = DEFAULT_CONFIG;

  const mlResult = await fetchMlThreshold(signal, {
    strategyName: 'TrendLine',
    strategyConfig: {
      TRENDLINE_CONFIG: TRENDLINE,
      HIGHS,
      LOWS,
    },
    symbol: signal.symbol,
    candles: candles.slice(-50),
    btcCandles: btcCandles.slice(-50),
    ML_THRESHOLD,
  });

  if (!mlResult) {
    console.log('ML result is null (check ml-infer or ML_GRPC_ADDRESS).');
    return;
  }

  console.log('ML result:', mlResult);
};

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('test-ml failed:', err);
  process.exit(1);
});
