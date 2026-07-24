import { buildAiMarketContext } from '../aiMarketContext';

const breadth = (size: number) => ({
  source: 'binance_klines',
  universe: `binance_top${size}_usdt_test`,
  interval: '15m',
  asOfTs: 1,
  ageMs: 0,
  stale: false,
  symbolsCount: size,
  advancers: size - 10,
  decliners: 10,
  unchanged: 0,
  advanceDeclineRatio: (size - 10) / 10,
  pctAboveMa20: 0.6,
  pctAboveMa50: 0.5,
  equalWeightedReturn: size / 10_000,
  volumeWeightedReturn: size / 9_000,
  dispersion: 0.01,
});

describe('buildAiMarketContext', () => {
  it('exports all five fixed Binance breadth indicators', () => {
    const top30 = breadth(30);
    const context = buildAiMarketContext({
      additionalIndicators: {
        baseContext: {
          relative: {
            marketBreadth: top30,
            marketBreadths: {
              top5: breadth(5),
              top10: breadth(10),
              top30,
              top50: breadth(50),
              top100: breadth(100),
            },
          },
        },
      },
    } as any);

    expect(context.relative.marketBreadths).toMatchObject({
      top5: {
        available: true,
        symbolsCount: 5,
        equalWeightedReturn: 0.0005,
      },
      top10: {
        available: true,
        symbolsCount: 10,
        equalWeightedReturn: 0.001,
      },
      top30: {
        available: true,
        symbolsCount: 30,
        equalWeightedReturn: 0.003,
      },
      top50: {
        available: true,
        symbolsCount: 50,
        equalWeightedReturn: 0.005,
      },
      top100: {
        available: true,
        symbolsCount: 100,
        equalWeightedReturn: 0.01,
      },
    });
    expect(context.relative.marketBreadth).toMatchObject({
      available: true,
      symbolsCount: 30,
    });
  });
});
