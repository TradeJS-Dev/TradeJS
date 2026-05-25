import {
  ADX as TechnicalADX,
  ATR as TechnicalATR,
  BollingerBands as TechnicalBollingerBands,
  EMA as TechnicalEMA,
  RSI as TechnicalRSI,
  SMA as TechnicalSMA,
  WMA as TechnicalWMA,
} from 'technicalindicators';

const {
  ADX: FastADX,
  ATR: FastATR,
  BollingerBands: FastBollingerBands,
  EMA: FastEMA,
  RSI: FastRSI,
  SMA: FastSMA,
  WMA: FastWMA,
} = require('fast-technical-indicators') as typeof import('fast-technical-indicators');

const closeSeries = Array.from(
  { length: 120 },
  (_, i) =>
    100 + Math.sin(i / 4) * 5 + Math.cos(i / 9) * 2 + ((i % 13) - 6) * 0.12,
);
const highSeries = closeSeries.map((value, i) => value + 1.1 + (i % 4) * 0.17);
const lowSeries = closeSeries.map((value, i) => value - 1.0 - (i % 5) * 0.13);

const expectNumberSeriesClose = (actual: number[], expected: number[]) => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => {
    expect(value).toBeCloseTo(expected[index], 12);
  });
};

describe('technical indicator library parity', () => {
  it('keeps SMA output equal across libraries', () => {
    expectNumberSeriesClose(
      FastSMA.calculate({ period: 20, values: closeSeries }),
      TechnicalSMA.calculate({ period: 20, values: closeSeries }),
    );
  });

  it('keeps ATR output equal across libraries', () => {
    expectNumberSeriesClose(
      FastATR.calculate({
        period: 14,
        high: highSeries,
        low: lowSeries,
        close: closeSeries,
      }),
      TechnicalATR.calculate({
        period: 14,
        high: highSeries,
        low: lowSeries,
        close: closeSeries,
      }),
    );
  });

  it('keeps RSI and ADX output equal across libraries', () => {
    expectNumberSeriesClose(
      FastRSI.calculate({ period: 14, values: closeSeries }),
      TechnicalRSI.calculate({ period: 14, values: closeSeries }),
    );

    const fastAdx = FastADX.calculate({
      period: 14,
      high: highSeries,
      low: lowSeries,
      close: closeSeries,
    });
    const technicalAdx = TechnicalADX.calculate({
      period: 14,
      high: highSeries,
      low: lowSeries,
      close: closeSeries,
    });
    expect(fastAdx).toHaveLength(technicalAdx.length);
    fastAdx.forEach((value, index) => {
      expect(value.adx).toBeCloseTo(technicalAdx[index].adx, 12);
      expect(value.pdi).toBeCloseTo(technicalAdx[index].pdi, 12);
      expect(value.mdi).toBeCloseTo(technicalAdx[index].mdi, 12);
    });
  });

  it('keeps EMA, WMA and Bollinger Bands output equal across libraries', () => {
    expectNumberSeriesClose(
      FastEMA.calculate({ period: 20, values: closeSeries }),
      TechnicalEMA.calculate({ period: 20, values: closeSeries }),
    );
    expectNumberSeriesClose(
      FastWMA.calculate({ period: 20, values: closeSeries }),
      TechnicalWMA.calculate({ period: 20, values: closeSeries }),
    );

    const fastBands = FastBollingerBands.calculate({
      period: 20,
      stdDev: 3,
      values: closeSeries,
    });
    const technicalBands = TechnicalBollingerBands.calculate({
      period: 20,
      stdDev: 3,
      values: closeSeries,
    });
    expect(fastBands).toHaveLength(technicalBands.length);
    fastBands.forEach((value, index) => {
      expect(value.upper).toBeCloseTo(technicalBands[index].upper, 12);
      expect(value.middle).toBeCloseTo(technicalBands[index].middle, 12);
      expect(value.lower).toBeCloseTo(technicalBands[index].lower, 12);
      expect(value.pb).toBeCloseTo(technicalBands[index].pb, 12);
    });
  });
});
