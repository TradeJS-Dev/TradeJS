import _ from 'lodash';
import { Ticker, Item } from '@types';

type Category = 'volatility24h' | 'volatility1h' | 'volume';

type ResultItem = {
  label: string;
  value: string;
  category: Category;
};

const EXCLUDE_TICKERS = [
  'USDEUSDT',
  'USDCUSDT',
  'USDTUSDT',
  'RLUSDUSDT',
  'PAXGUSDT',
  'XAUTUSDT',
];

export const getVolatilityTickers = (data: Ticker[]): Item[] => {
  const result: ResultItem[] = [];
  const selected = new Set<string>();

  const getBaseSymbol = (symbol: string) => symbol.replace(/(USDT)$/i, '');

  const byVol24h = [...data]
    .map((coin) => ({
      ...coin,
      volatility24h: Math.abs(coin.price24hPcnt),
    }))
    .sort((a, b) => b.volatility24h - a.volatility24h);

  const byVol1h = [...data]
    .map((coin) => {
      const prev1h = coin.prevPrice1h;
      const last = coin.lastPrice;
      const volatility1h = prev1h ? Math.abs((last - prev1h) / prev1h) : 0;
      return {
        ...coin,
        volatility1h,
      };
    })
    .sort((a, b) => b.volatility1h - a.volatility1h);

  const byVolume = [...data]
    .map((coin) => ({
      ...coin,
      volume24hNum: coin.volume24h,
    }))
    .sort((a, b) => b.volume24hNum - a.volume24hNum);

  const addTop = (list: Ticker[], category: Category, limit: number) => {
    for (const coin of list) {
      if (!selected.has(coin.symbol)) {
        selected.add(coin.symbol);
        result.push({
          label: `${getBaseSymbol(coin.symbol)}`,
          value: coin.symbol,
          category,
        });
        if (result.length >= limit) break;
      }
    }
  };

  addTop(byVol24h, 'volatility24h', 10);
  addTop(byVol1h, 'volatility1h', 20);
  addTop(byVolume, 'volume', 30);

  return result
    .slice(0, 30)
    .sort((a, b) =>
      a.category === b.category
        ? a.value.localeCompare(b.value)
        : a.category.localeCompare(b.category),
    )
    .map(({ value, label, category }) => ({
      label,
      value,
      description: category,
    }));
};

export const getTopTickers = (data: Ticker[], topN?: number): Item[] => {
  const scores = data
    .filter(({ symbol }) => {
      if (symbol.includes('BTC') && symbol !== 'BTCUSDT') {
        return false;
      }

      if (symbol.startsWith('USD') || !symbol.endsWith('USDT')) {
        return false;
      }

      if (EXCLUDE_TICKERS.includes(symbol)) {
        return false;
      }

      return true;
    })
    .map((coin) => {
      const vol24h = Math.abs(coin.price24hPcnt);
      const prev1h = coin.prevPrice1h;
      const last = coin.lastPrice;
      const vol1h = prev1h ? Math.abs((last - prev1h) / prev1h) * 100 : 0;

      const volumeMln = coin.volume24h / 1_000_000;
      const openInterestMln = coin.openInterestValue / 1_000_000;
      const fundingRateAbs = Math.abs(coin.fundingRate * 100); // в %

      const score =
        vol24h * 0.4 +
        vol1h * 0.2 +
        volumeMln * 0.2 +
        openInterestMln * 0.1 +
        fundingRateAbs * 0.1;

      return {
        symbol: coin.symbol,
        score,
      };
    });

  const top = _.sortBy(
    scores.map((item, i) => ({
      label: item.symbol.replace(/(USDT)$/i, ''),
      value: item.symbol,
      description: `score #${i + 1}`,
    })),
    'label',
  );

  if (topN) {
    return top.slice(0, topN);
  }

  return top;
};

export const normalizeTickerData = (raw: Record<string, string>): Ticker => ({
  symbol: raw.symbol,
  lastPrice: parseFloat(raw.lastPrice),
  indexPrice: parseFloat(raw.indexPrice),
  markPrice: parseFloat(raw.markPrice),
  prevPrice24h: parseFloat(raw.prevPrice24h),
  price24hPcnt: parseFloat(raw.price24hPcnt),
  highPrice24h: parseFloat(raw.highPrice24h),
  lowPrice24h: parseFloat(raw.lowPrice24h),
  prevPrice1h: parseFloat(raw.prevPrice1h),
  openInterest: parseFloat(raw.openInterest),
  openInterestValue: parseFloat(raw.openInterestValue),
  turnover24h: parseFloat(raw.turnover24h),
  volume24h: parseFloat(raw.volume24h),
  fundingRate: parseFloat(raw.fundingRate),
  nextFundingTime: parseInt(raw.nextFundingTime),
  predictedDeliveryPrice: raw.predictedDeliveryPrice,
  basisRate: raw.basisRate,
  deliveryFeeRate: raw.deliveryFeeRate,
  deliveryTime: parseInt(raw.deliveryTime),
  ask1Size: parseFloat(raw.ask1Size),
  bid1Price: parseFloat(raw.bid1Price),
  ask1Price: parseFloat(raw.ask1Price),
  bid1Size: parseFloat(raw.bid1Size),
  basis: raw.basis,
  preOpenPrice: raw.preOpenPrice,
  preQty: raw.preQty,
});
