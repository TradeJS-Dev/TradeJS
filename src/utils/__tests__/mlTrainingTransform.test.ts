import { buildMlTrainingRow } from '../mlTrainingTransform';

type IndicatorMap = Record<string, number[]>;

test('buildMlTrainingRow: key normalizations and removals', () => {
  const makeArr = (value: number) => Array.from({ length: 10 }, () => value);
  const indicators: IndicatorMap = {
    atr: makeArr(2),
    atrPct: makeArr(1.5),
    maFast: makeArr(5),
    maMedium: makeArr(10),
    maSlow: makeArr(15),
    bbUpper: makeArr(12),
    bbMiddle: makeArr(10),
    bbLower: makeArr(8),
    obv: makeArr(1000),
    macd: makeArr(4),
    macdSignal: makeArr(2),
    macdHistogram: makeArr(1),
    price24hPcnt: makeArr(1),
    price1hPcnt: makeArr(2),
    highPrice1h: makeArr(120),
    lowPrice1h: makeArr(80),
    volume1h: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
    highPrice24h: makeArr(140),
    lowPrice24h: makeArr(60),
    volume24h: [5, 10, 15, 20, 25, 30, 35, 40, 45, 50],
  };

  const candles = Array.from({ length: 50 }, (_, i) => ({
    open: 100,
    close: 101,
    high: 102,
    low: 99,
    volume: 1000 + i,
    timestamp: i * 60_000,
  }));

  const btcCandles = Array.from({ length: 50 }, (_, i) => ({
    open: 200,
    close: 200,
    high: 201,
    low: 199,
    volume: 2000 + i,
    timestamp: i * 60_000,
  }));

  const signal = {
    direction: 'LONG',
    interval: 1,
    prices: {
      currentPrice: 101,
      takeProfitPrice: 105,
      stopLossPrice: 99,
      riskRatio: 2,
    },
    indicators,
    figures: {
      trendLine: {
        mode: 'highs',
        distance: 0.5,
        points: [
          { value: 100, timestamp: 0 },
          { value: 110, timestamp: 60_000 },
        ],
        touches: [
          { value: 98, timestamp: 30_000 },
          { value: 105, timestamp: 90_000 },
        ],
      },
    },
  };

  const context = {
    strategyConfig: {
      TRENDLINE_CONFIG: {
        minTouches: 2,
        offset: 0.1,
        epsilon: 0.2,
        epsilonOffset: 0.3,
      },
      HIGHS: {
        enable: true,
        direction: 'LONG',
        TP: 1,
        SL: 2,
        minRiskRatio: 1.5,
      },
      LOWS: {
        enable: false,
        direction: 'SHORT',
        TP: 1,
        SL: 2,
        minRiskRatio: 1.5,
      },
    },
  };

  const row = buildMlTrainingRow(
    { signal, context, candles, btcCandles },
    { profit: 1 },
  );

  expect(row.OBV_1).toBeUndefined();
  expect(row.OBV_Log1p_1).toBeCloseTo(Math.log1p(1000));

  expect(row.ATR_1).toBeCloseTo(2 / 10);
  expect(row.ATR_PCT_1).toBeCloseTo(1.5);
  expect(row.MA_Fast_1).toBeCloseTo(5 / 10);
  expect(row.BB_Upper_1).toBeCloseTo(12 / 10);

  expect(row.MACD_1).toBeCloseTo(4 / 2);
  expect(row.MACD_Signal_1).toBeCloseTo(2 / 2);
  expect(row.MACD_Histogram_1).toBeCloseTo(1 / 2);

  expect(row.Volume1h_1_MedianNorm).toBeCloseTo(1);
  expect(row.Volume1h_2_MedianNorm).toBeCloseTo(20 / 15);

  expect(row.Candle_Open_1).toBeUndefined();
  expect(row.Alt_OpenRel_1).toBeUndefined();
  expect(row.BTC_CloseRel_1).toBeUndefined();

  expect(row.AltRet_1).toBeCloseTo(101 / 100);
  expect(row.BtcRet_1).toBeCloseTo(200 / 200);
  expect(row.RelRet_1).toBeCloseTo(101 / 100 - 1);

  expect(row.AltToBtc_CloseRel_1).toBeCloseTo(101 / 200 / (101 / 200));

  expect(row.HighPrice1h_1).toBeCloseTo(120 / 10);
  expect(row.LowPrice1h_1).toBeCloseTo(80 / 10);
  expect(row.HighPrice24h_1).toBeCloseTo(140 / 10);
  expect(row.LowPrice24h_1).toBeCloseTo(60 / 10);

  expect(row.Candle_Body_1).toBeCloseTo((101 - 100) / 10);
  expect(row.Candle_Range_1).toBeCloseTo((102 - 99) / 10);
  expect(row.Candle_UpperWick_1).toBeCloseTo((102 - 101) / 10);
  expect(row.Candle_LowerWick_1).toBeCloseTo((100 - 99) / 10);

  expect(row.AltRet_Mean10).toBeCloseTo(1.01);
  expect(row.AltRet_Std10).toBeCloseTo(0);
  expect(row.AltRet_Skew10).toBeCloseTo(0);
  expect(row.AltRet_Kurt10).toBeCloseTo(0);

  expect(row.BtcRet_Mean10).toBeCloseTo(1);
  expect(row.BtcRet_Std10).toBeCloseTo(0);

  expect(row.TrendLine_Value_AtEntry).toBeCloseTo(590);
  expect(row.TrendLine_Slope).toBeCloseTo(10);
  expect(row.TrendLine_Delta_To_Price).toBeCloseTo((101 - 590) / 101);
  expect(row.profit).toBe(1);
});
