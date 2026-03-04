import {
  getTopTickers,
  getVolatilityTickers,
  normalizeTickerData,
} from '@utils/tickers';
import { Ticker } from '@types';

const makeTicker = (overrides: Partial<Ticker>): Ticker => ({
  symbol: 'AAAUSDT',
  lastPrice: 100,
  indexPrice: 100,
  markPrice: 100,
  prevPrice24h: 95,
  price24hPcnt: 0.05,
  highPrice24h: 105,
  lowPrice24h: 90,
  prevPrice1h: 98,
  openInterest: 1,
  openInterestValue: 1_000_000,
  turnover24h: 1_000_000,
  volume24h: 50_000_000,
  fundingRate: 0.0001,
  nextFundingTime: 1,
  predictedDeliveryPrice: '',
  basisRate: '',
  deliveryFeeRate: '',
  deliveryTime: 1,
  ask1Size: 1,
  bid1Price: 99,
  ask1Price: 101,
  bid1Size: 1,
  basis: '',
  preOpenPrice: '',
  preQty: '',
  ...overrides,
});

describe('tickers utils', () => {
  it('getTopTickers filters unsupported symbols and sorts by volume then label', () => {
    const data: Ticker[] = [
      makeTicker({ symbol: 'ETHUSDT', volume24h: 90_000_000 }),
      makeTicker({ symbol: 'BTCUSDT', volume24h: 150_000_000 }),
      makeTicker({ symbol: 'SOLUSDT', volume24h: 120_000_000 }),
      makeTicker({ symbol: 'ETHBTC', volume24h: 999_000_000 }),
      makeTicker({ symbol: 'USDCUSDT', volume24h: 500_000_000 }),
      makeTicker({ symbol: 'XRPUSD', volume24h: 80_000_000 }),
      makeTicker({ symbol: 'SOMEBTCUSDT', volume24h: 200_000_000 }),
      makeTicker({ symbol: 'ADAUSDT', volume24h: 70_000_000 }),
    ];

    const result = getTopTickers(data, 3);

    expect(result.map((item) => item.value)).toEqual([
      'BTCUSDT',
      'ETHUSDT',
      'SOLUSDT',
    ]);
    expect(result[1]?.description).toBe('volume: 90m (#3)');
    expect(result[0]?.label).toBe('BTC');
  });

  it('getVolatilityTickers deduplicates by symbol and caps list to 30', () => {
    const data = Array.from({ length: 40 }, (_, i) => {
      const n = i + 1;
      return makeTicker({
        symbol: `COIN${n}USDT`,
        price24hPcnt: n / 100,
        prevPrice1h: 100,
        lastPrice: 100 + n,
        volume24h: n * 1_000_000,
      });
    });

    const result = getVolatilityTickers(data);

    expect(result).toHaveLength(30);
    expect(new Set(result.map((item) => item.value)).size).toBe(30);
    expect(result.every((item) => item.label.endsWith('USDT'))).toBe(false);
    expect(
      result.every((item) =>
        ['volatility24h', 'volatility1h', 'volume'].includes(item.description || ''),
      ),
    ).toBe(true);
  });

  it('normalizeTickerData converts numeric strings', () => {
    const raw = {
      symbol: 'BTCUSDT',
      lastPrice: '101',
      indexPrice: '100',
      markPrice: '100.5',
      prevPrice24h: '95',
      price24hPcnt: '0.05',
      highPrice24h: '110',
      lowPrice24h: '90',
      prevPrice1h: '99',
      openInterest: '10',
      openInterestValue: '1000',
      turnover24h: '999',
      volume24h: '123456',
      fundingRate: '0.0001',
      nextFundingTime: '1700000000000',
      predictedDeliveryPrice: '0',
      basisRate: '0',
      deliveryFeeRate: '0',
      deliveryTime: '1700000000001',
      ask1Size: '1',
      bid1Price: '100',
      ask1Price: '101',
      bid1Size: '2',
      basis: '0',
      preOpenPrice: '0',
      preQty: '0',
    };

    const ticker = normalizeTickerData(raw);

    expect(ticker.lastPrice).toBe(101);
    expect(ticker.nextFundingTime).toBe(1700000000000);
    expect(ticker.deliveryTime).toBe(1700000000001);
    expect(ticker.symbol).toBe('BTCUSDT');
  });
});
