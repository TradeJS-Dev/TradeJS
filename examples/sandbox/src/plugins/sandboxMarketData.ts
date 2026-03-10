import type {
  Interval,
  KlineChartData,
  KlineRequest,
  Ticker,
} from '@tradejs/core';

export const SANDBOX_TICKER_SYMBOL = 'SANDBOXUSDT';
export const BTC_TICKER_SYMBOL = 'BTCUSDT';

const INTERVAL_TO_MS: Record<string, number> = {
  '1': 60_000,
  '3': 180_000,
  '5': 300_000,
  '15': 900_000,
  '30': 1_800_000,
  '60': 3_600_000,
  '120': 7_200_000,
  '240': 14_400_000,
  '360': 21_600_000,
  '720': 43_200_000,
  D: 86_400_000,
  W: 604_800_000,
  M: 2_592_000_000,
};

const getStepMs = (interval: Interval): number => {
  const byToken = INTERVAL_TO_MS[String(interval)];
  if (Number.isFinite(byToken) && byToken > 0) {
    return byToken;
  }

  const byMinutes = Number(interval);
  if (Number.isFinite(byMinutes) && byMinutes > 0) {
    return byMinutes * 60_000;
  }

  return INTERVAL_TO_MS['15'];
};

const alignToStep = (value: number, stepMs: number): number =>
  Math.floor(value / stepMs) * stepMs;

const getBasePrice = (symbol: string): number => {
  if (symbol.toUpperCase() === BTC_TICKER_SYMBOL) {
    return 30_000;
  }

  return 100;
};

export const buildDeterministicCandles = (
  request: Pick<KlineRequest, 'symbol' | 'interval' | 'start' | 'end'>,
): KlineChartData => {
  const { symbol, interval } = request;
  const stepMs = getStepMs(interval);
  const safeEnd = Number.isFinite(request.end)
    ? Number(request.end)
    : Date.now();

  const fallbackStart = safeEnd - stepMs * (96 * 220);
  const safeStart = Number.isFinite(request.start)
    ? Number(request.start)
    : fallbackStart;

  const start = alignToStep(Math.max(0, safeStart), stepMs);
  const end = alignToStep(Math.max(start, safeEnd), stepMs);

  const basePrice = getBasePrice(symbol);
  const candles: KlineChartData = [];

  let previousClose = basePrice;

  for (
    let timestamp = start, index = 0;
    timestamp <= end;
    timestamp += stepMs, index += 1
  ) {
    const trend = 1 + index * 0.0006;
    const wave = Math.sin(index / 6) * 0.0015;
    const close = basePrice * trend * (1 + wave);
    const open = index === 0 ? close * 0.9996 : previousClose;
    const high = Math.max(open, close) * 1.005;
    const low = Math.min(open, close) * 0.997;
    const volume = 1_000 + index * 2 + (symbol === BTC_TICKER_SYMBOL ? 500 : 0);

    candles.push({
      open,
      high,
      low,
      close,
      volume,
      turnover: close * volume,
      timestamp,
      dt: new Date(timestamp).toISOString(),
    });

    previousClose = close;
  }

  return candles;
};

const createTicker = (
  symbol: string,
  lastPrice: number,
  volume24h: number,
): Ticker => ({
  symbol,
  lastPrice,
  indexPrice: lastPrice,
  markPrice: lastPrice,
  prevPrice24h: lastPrice * 0.99,
  price24hPcnt: 0.01,
  highPrice24h: lastPrice * 1.02,
  lowPrice24h: lastPrice * 0.98,
  prevPrice1h: lastPrice * 0.997,
  openInterest: 0,
  openInterestValue: 0,
  turnover24h: lastPrice * volume24h,
  volume24h,
  fundingRate: 0,
  nextFundingTime: 0,
  predictedDeliveryPrice: '',
  basisRate: '',
  deliveryFeeRate: '',
  deliveryTime: 0,
  ask1Size: 100,
  bid1Price: lastPrice,
  ask1Price: lastPrice,
  bid1Size: 100,
  basis: '',
  preOpenPrice: '',
  preQty: '',
});

export const buildDeterministicTickers = (): Ticker[] => {
  const sandboxLastPrice = 105;
  const btcLastPrice = 31_500;

  return [
    createTicker(SANDBOX_TICKER_SYMBOL, sandboxLastPrice, 90_000_000),
    createTicker(BTC_TICKER_SYMBOL, btcLastPrice, 260_000_000),
  ];
};
