import {
  indexReferenceMarkets,
  REFERENCE_MARKET_BASKETS,
  type ReferenceMarketCandle,
} from '../data';

const CLOSE = Date.parse('2026-10-05T20:00:00Z');
const STEP = 4 * 60 * 60_000;

const pair = (
  symbol: string,
  interval = 240,
  end = CLOSE,
  recentVolume = 1,
): ReferenceMarketCandle[] => {
  const step = interval * 60_000;
  return [
    { symbol, interval, timestamp: end - 2 * step, close: 100, volume: 2 },
    {
      symbol,
      interval,
      timestamp: end - step,
      close: 101,
      volume: recentVolume,
    },
  ];
};

it('uses only adjacent fully closed candles and requires complete basket membership', () => {
  const complete = REFERENCE_MARKET_BASKETS.growth.flatMap((symbol) =>
    pair(symbol),
  );
  const future = complete.map((row) => ({
    ...row,
    timestamp: row.timestamp + 2 * STEP,
    close: 999,
  }));
  const asOf = indexReferenceMarkets([...complete, ...future]);
  const expected = indexReferenceMarkets(complete)(CLOSE);
  expect(asOf(CLOSE - 1)).toBeUndefined();
  expect(asOf(CLOSE + 12_345)).toEqual(expected);
  expect(expected?.frames.h4?.growthPct).toBeCloseTo(Math.log(1.01) * 100);
  expect(expected?.frames.h4?.nyCashHoursGrowthPct).toBeCloseTo(
    Math.log(1.01) * 100,
  );
  const incomplete = indexReferenceMarkets(complete.slice(2))(CLOSE)?.frames.h4;
  expect(incomplete?.growthPct).toBeNull();
  expect(incomplete?.returnsPct.AAPLUSDT).toBeUndefined();
});

it('does not carry prior closes through gaps and separates zero volume from a missing return', () => {
  const stocks = REFERENCE_MARKET_BASKETS.growth.flatMap((symbol, index) =>
    pair(symbol, 240, CLOSE, index === 0 ? 0 : 1),
  );
  const sol = pair('SOLUSDT', 60);
  const ctx = indexReferenceMarkets([
    ...stocks,
    ...sol,
    { ...sol[1], timestamp: CLOSE + 3_600_000 },
  ]);
  expect(ctx(CLOSE)?.frames.h4?.growthPct).toBeCloseTo(Math.log(1.01) * 100);
  expect(ctx(CLOSE)?.frames.h4?.nyCashHoursGrowthPct).toBeNull();
  expect(ctx(CLOSE)?.frames.h1?.returnsPct.SOLUSDT).toBeCloseTo(
    Math.log(1.01) * 100,
  );
  expect(ctx(CLOSE + 2 * 3_600_000)?.frames.h1).toBeUndefined();
});

it('uses New York local hours through DST and rejects a candle outside cash hours', () => {
  const winter = Date.parse('2026-11-09T20:00:00Z');
  const overnight = Date.parse('2026-11-10T00:00:00Z');
  const range = [winter, overnight].flatMap((at) =>
    REFERENCE_MARKET_BASKETS.growth.flatMap((symbol) => pair(symbol, 240, at)),
  );
  const read = indexReferenceMarkets(range);
  expect(read(winter)?.frames.h4?.nyCashHoursGrowthPct).not.toBeNull();
  expect(read(overnight)?.frames.h4?.nyCashHoursGrowthPct).toBeNull();
});
