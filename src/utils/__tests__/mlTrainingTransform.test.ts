import {
  buildMlTrainingRow,
  trimMlTrainingRowWindows,
} from '../mlTrainingTransform';

test('buildMlTrainingRow: key normalizations and removals', () => {
  const makeArr = (value: number) => Array.from({ length: 5 }, () => value);
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

  const indicators: Record<string, any> = {
    atr: makeArr(2),
    atrPct: makeArr(1.5),
    maFast: makeArr(5),
    maMedium: makeArr(10),
    maSlow: makeArr(15),
    bbUpper: makeArr(12),
    bbMiddle: makeArr(10),
    bbLower: makeArr(8),
    obv: makeArr(-1000),
    smaObv: makeArr(-900),
    macd: makeArr(4),
    macdSignal: makeArr(2),
    macdHistogram: makeArr(1),
    price24hPcnt: makeArr(1),
    price1hPcnt: makeArr(2),
    highPrice1h: makeArr(120),
    lowPrice1h: makeArr(80),
    volume1h: [10, 20, 30, 40, 50],
    highPrice24h: makeArr(140),
    lowPrice24h: makeArr(60),
    volume24h: [5, 10, 15, 20, 25],
    maFast1h: [1, 2, 3, 4, 5],
    price1hPcnt1h: [11, 12, 13, 14, 15],
    maFast4h: [2, 3, 4, 5, 6],
    price1hPcnt4h: [21, 22, 23, 24, 25],
    maFast1d: [3, 4, 5, 6, 7],
    candles15m: candles as unknown as number[],
    btcCandles15m: btcCandles as unknown as number[],
    candles1h: candles.slice(-5) as unknown as number[],
    btcCandles1h: btcCandles.slice(-5) as unknown as number[],
    candles4h: candles.slice(-5) as unknown as number[],
    btcCandles4h: btcCandles.slice(-5) as unknown as number[],
    candles1d: candles.slice(-5) as unknown as number[],
    btcCandles1d: btcCandles.slice(-5) as unknown as number[],
  };

  const signal = {
    symbol: 'ethusdt',
    timestamp: candles[candles.length - 1].timestamp,
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
        alpha: [1, 0.99, 1.01],
        touches: [
          { value: 98, timestamp: 30_000 },
          { value: 105, timestamp: 90_000 },
        ],
      },
    },
  };

  const context = {
    strategyName: 'TrendLine',
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

  const row = buildMlTrainingRow({ signal, context }, { profit: 1 });

  expect(row.OBV_1).toBeUndefined();
  expect(row.TF15M_ALT_OBV_LogRet_1).toBeUndefined();
  expect(row.TF15M_ALT_OBV_LogRet_2).toBe(0);
  expect(row.TF15M_ALT_OBV_LogRet_5).toBe(0);
  expect(row.TF15M_ALT_SMA_OBV_LogRet_1).toBeUndefined();

  expect(row.TF15M_ALT_ATR_1).toBeCloseTo(2 / 101);
  expect(row.TF15M_ALT_ATR_5).toBeCloseTo(2 / 101);
  expect(row.TF15M_ALT_ATR_PCT_1).toBeCloseTo(1.5);
  expect(row.TF15M_ALT_MA_Fast_1).toBeUndefined();
  expect(row.TF15M_ALT_MA_Fast_2).toBe(0);
  expect(row.TF15M_ALT_MA_Medium_1).toBeUndefined();
  expect(row.TF15M_ALT_MA_Medium_2).toBe(0);
  expect(row.TF15M_ALT_MA_Medium_5).toBe(0);
  expect(row.TF15M_ALT_BB_Upper_1).toBeUndefined();
  expect(row.TF15M_ALT_BB_Upper_2).toBe(0);

  expect(row.TF15M_ALT_MACD_1).toBe(0);
  expect(row.TF15M_ALT_MACD_2).toBe(0);
  expect(row.TF15M_ALT_MACD_Signal_1).toBe(0);
  expect(row.TF15M_ALT_MACD_Signal_2).toBe(0);
  expect(row.TF15M_ALT_MACD_Histogram_1).toBe(0);
  expect(row.TF15M_ALT_MACD_Histogram_2).toBe(0);

  expect(row.TF15M_ALT_Volume1h_1_MedianNorm).toBeUndefined();
  expect(row.TF15M_ALT_Volume1h_2_MedianNorm).toBeCloseTo(1);

  expect(row.Candle_Open_1).toBeUndefined();
  expect(row.Alt_OpenRel_1).toBeUndefined();
  expect(row.BTC_CloseRel_1).toBeUndefined();

  expect(row.TF15M_ALT_Ret_1).toBeCloseTo(101 / 100);
  expect(row.TF15M_BTC_Ret_1).toBeCloseTo(200 / 200);
  expect(row.TF15M_RelRet_1).toBeCloseTo(101 / 100 - 1);
  expect(typeof row.TF15M_BTC_ATR_1).toBe('number');
  expect(row.BTC_TF15M_ATR_1).toBeUndefined();
  expect(row.TF1H_ALT_Ret_1).toBeDefined();
  expect(row.TF4H_ALT_Ret_1).toBeDefined();
  expect(row.TF1D_ALT_Ret_1).toBeDefined();

  expect(row.TF15M_AltToBtc_Open_1).toBeUndefined();
  expect(row.TF15M_AltToBtc_Open_2).toBe(0);
  expect(row.TF15M_AltToBtc_Close_1).toBeUndefined();
  expect(row.TF15M_AltToBtc_Close_2).toBe(0);
  expect(row.TF15M_AltToBtc_Close_5).toBe(0);
  expect(row.AltToBtc_CloseRel_1).toBeUndefined();
  expect(row.takeProfitPrice).toBeCloseTo(101 / 105);
  expect(row.stopLossPrice).toBeCloseTo(101 / 99);

  expect(typeof row.TF15M_ALT_HighPrice1h_1).toBe('number');
  expect(typeof row.TF15M_ALT_LowPrice1h_1).toBe('number');
  expect(typeof row.TF15M_ALT_HighPrice24h_1).toBe('number');
  expect(typeof row.TF15M_ALT_LowPrice24h_1).toBe('number');
  expect(row.HIGHS_riskRatio).toBeUndefined();
  expect(row.LOWS_riskRatio).toBeUndefined();
  expect(row.HIGHS_minRiskRatio).toBeUndefined();
  expect(row.LOWS_minRiskRatio).toBeUndefined();

  expect(typeof row.TF15M_ALT_Candle_Body_1).toBe('number');
  expect(Number.isFinite(row.TF15M_ALT_Candle_Body_1 as number)).toBe(true);
  expect(row.TF15M_ALT_Candle_Body_1).not.toBeCloseTo((101 - 100) / 10);
  expect(row.TF15M_ALT_Candle_Range_1).toBeCloseTo((102 - 99) / 10);
  expect(row.TF15M_ALT_Candle_UpperWick_1).toBeCloseTo((102 - 101) / 10);
  expect(row.TF15M_ALT_Candle_LowerWick_1).toBeCloseTo((100 - 99) / 10);

  expect(row.TF15M_ALT_Ret_Mean).toBeCloseTo(1.01);
  expect(row.TF15M_ALT_Ret_Std).toBeCloseTo(0);
  expect(Number.isFinite(row.TF15M_ALT_Ret_Skew as number)).toBe(true);
  expect(Number.isFinite(row.TF15M_ALT_Ret_Kurt as number)).toBe(true);
  const allTf = ['TF15M', 'TF1H', 'TF4H', 'TF1D'] as const;
  const allAssets = ['ALT', 'BTC'] as const;
  for (const tf of allTf) {
    for (const asset of allAssets) {
      expect(typeof row[`${tf}_${asset}_BB_Upper_Mean`]).toBe('number');
      expect(typeof row[`${tf}_${asset}_BB_Upper_Std`]).toBe('number');
      expect(typeof row[`${tf}_${asset}_BB_Upper_Skew`]).toBe('number');
      expect(typeof row[`${tf}_${asset}_BB_Upper_Kurt`]).toBe('number');
      expect(typeof row[`${tf}_${asset}_BB_Middle_Mean`]).toBe('number');
      expect(typeof row[`${tf}_${asset}_BB_Lower_Mean`]).toBe('number');
    }
  }

  expect(row.TF15M_BTC_Ret_Mean).toBeCloseTo(1);
  expect(row.TF15M_BTC_Ret_Std).toBeCloseTo(0);
  expect(row.TF15M_ALT_Price1hPcnt_1).toBeCloseTo(Math.tanh(2 / 10));
  expect(row.TF1H_ALT_MA_Fast_2).toBeCloseTo(0);
  expect(row.TF1H_ALT_Price1hPcnt_1).toBeCloseTo(Math.tanh(11 / 10));
  expect(row.TF4H_ALT_MA_Fast_2).toBeCloseTo(0);
  expect(row.TF4H_ALT_Price1hPcnt_1).toBeCloseTo(Math.tanh(21 / 10));
  expect(row.TF1D_ALT_MA_Fast_2).toBeCloseTo(0);

  expect(row.currentPrice).toBeUndefined();
  expect(typeof row.Ctx_EntryHour).toBe('number');
  expect(typeof row.Ctx_EntryHourSin).toBe('number');
  expect(typeof row.Ctx_EntryHourCos).toBe('number');
  expect(typeof row.Ctx_StopDistance).toBe('number');
  expect(typeof row.Ctx_TakeDistance).toBe('number');
  expect(typeof row.Ctx_RiskAsymmetry).toBe('number');
  expect(typeof row.Regime_ATR_PCT_Last).toBe('number');
  expect(typeof row.Regime_ATR_PCT_Z).toBe('number');
  expect(typeof row.Regime_ATR_PCT_Rank).toBe('number');
  expect(typeof row.Regime_RealizedVol).toBe('number');
  expect(typeof row.Regime_IsHighVol).toBe('number');
  expect(typeof row.TF15M_ALT_ANALYSIS_CLOSE_SLOPE_NORM).toBe('number');
  expect(typeof row.TF1H_ALT_ANALYSIS_CLOSE_SLOPE_NORM).toBe('number');
  expect(typeof row.TF15M_ALT_ANALYSIS_REL_BENCH_NET_RET).toBe('number');
  expect(typeof row.TF15M_BTC_ANALYSIS_CLOSE_NET_RET).toBe('number');
  expect(typeof row.MTF_ALT_TF15M_TF1H_ANALYSIS_TREND_ALIGN_SIGN).toBe(
    'number',
  );
  expect(
    row.MTF_ALT_TF15M_TF1H_ANALYSIS_TREND_ALIGN_SIGN as number,
  ).toBeGreaterThanOrEqual(-1);
  expect(
    row.MTF_ALT_TF15M_TF1H_ANALYSIS_TREND_ALIGN_SIGN as number,
  ).toBeLessThanOrEqual(1);
  expect(Number.isFinite(row.Regime_ATR_PCT_Rank as number)).toBe(true);
  expect(row.Regime_ATR_PCT_Rank as number).toBeGreaterThanOrEqual(0);
  expect(row.Regime_ATR_PCT_Rank as number).toBeLessThanOrEqual(1);
  expect(row.TrendLine_Value_AtEntry).toBeUndefined();
  expect(row.TrendLine_Slope).toBeCloseTo(Math.log1p(10));
  expect(row.TrendLine_Delta_To_Price).toBeCloseTo((101 - 590) / 101);
  expect(row.TrendLine_Alpha_1).toBeCloseTo(1);
  expect(typeof row.TrendLine_Alpha_2).toBe('number');
  expect(Number.isFinite(row.TrendLine_Alpha_2 as number)).toBe(true);
  expect(typeof row.TrendLine_Alpha_4).toBe('number');
  expect(Number.isFinite(row.TrendLine_Alpha_4 as number)).toBe(true);
  expect(row.TOUCHES_VALUE_3).toBe(0);
  expect(row.TOUCHES_TS_3).toBe(0);
  expect(row.TOUCHES_TS_10).toBeUndefined();
  expect(row.POINTS_TS_2).toBeUndefined();
  expect(row.Touches_1).toBeUndefined();
  expect(row.TRENDLINE_minTouches).toBeUndefined();
  expect(row.profit).toBe(1);
  expect(row.symbol).toBe('ETHUSDT');
  expect(row.strategy).toBe('TRENDLINE');
});

test('trimMlTrainingRowWindows keeps only last 5 indexed values', () => {
  const source: Record<string, number | string | null> = {
    TF15M_ALT_ATR_1: 1,
    TF15M_ALT_ATR_2: 2,
    TF15M_ALT_ATR_3: 3,
    TF15M_ALT_ATR_4: 4,
    TF15M_ALT_ATR_5: 5,
    TF15M_ALT_ATR_6: 6,
    TF15M_ALT_ATR_7: 7,
    TF15M_ALT_ATR_8: 8,
    TF15M_ALT_ATR_9: 9,
    TF15M_ALT_ATR_10: 10,
    TOUCHES_TS_1: 11,
    TOUCHES_TS_2: 12,
    TOUCHES_TS_3: 13,
    Regime_RealizedVol: 0.123,
    symbol: 'ETHUSDT',
  };

  const row = trimMlTrainingRowWindows(source, 5);
  expect(row.TF15M_ALT_ATR_1).toBe(6);
  expect(row.TF15M_ALT_ATR_5).toBe(10);
  expect(row.TF15M_ALT_ATR_6).toBeUndefined();
  expect(row.TOUCHES_TS_3).toBe(13);
  expect(row.Regime_RealizedVol).toBe(0.123);
  expect(row.Regime_RealizedVol_5).toBeUndefined();
  expect(row.symbol).toBe('ETHUSDT');
});

test('buildMlTrainingRow: normalization is finite on cross-zero oscillators', () => {
  const oscillating = [-2, -1, -0.5, 0, 0.25, 0.5, 1, 2, -1, 1];
  const candles = Array.from({ length: 10 }, (_, i) => ({
    open: 100 + i,
    close: 100 + i,
    high: 101 + i,
    low: 99 + i,
    volume: 1000 + i,
    timestamp: (i + 1) * 60_000,
  }));
  const signal = {
    symbol: 'BTCUSDT',
    strategy: 'TrendLine',
    direction: 'SHORT',
    interval: 15,
    prices: {
      currentPrice: 100,
      takeProfitPrice: 95,
      stopLossPrice: 102,
      riskRatio: 2,
    },
    indicators: {
      maFast: Array(10).fill(100),
      maMedium: Array(10).fill(100),
      maSlow: Array(10).fill(100),
      atr: Array(10).fill(2),
      atrPct: Array(10).fill(1),
      bbUpper: Array(10).fill(101),
      bbMiddle: Array(10).fill(100),
      bbLower: Array(10).fill(99),
      obv: oscillating,
      smaObv: oscillating,
      macd: oscillating,
      macdSignal: oscillating,
      macdHistogram: oscillating,
      price24hPcnt: oscillating,
      price1hPcnt: oscillating,
      highPrice1h: Array(10).fill(101),
      lowPrice1h: Array(10).fill(99),
      volume1h: Array(10).fill(1000),
      highPrice24h: Array(10).fill(102),
      lowPrice24h: Array(10).fill(98),
      volume24h: Array(10).fill(1500),
      candles15m: candles,
      btcCandles15m: candles,
      candles1h: candles,
      btcCandles1h: candles,
      candles4h: candles,
      btcCandles4h: candles,
      candles1d: candles,
      btcCandles1d: candles,
    },
    figures: {
      trendLine: {
        mode: 'lows',
        distance: 0.1,
        alpha: [1],
        points: [
          { value: 99, timestamp: 60_000 },
          { value: 100, timestamp: 120_000 },
        ],
        touches: [{ value: 99.5, timestamp: 90_000 }],
      },
    },
  };
  const row = buildMlTrainingRow({ signal }, { profit: -1 });
  const numericValues = Object.entries(row)
    .filter(([key]) => key !== 'entryTimestamp')
    .map(([, value]) => value)
    .filter((value): value is number => typeof value === 'number');
  expect(numericValues.length).toBeGreaterThan(100);
  expect(numericValues.every((value) => Number.isFinite(value))).toBe(true);
  expect(Math.max(...numericValues)).toBeLessThan(200);
  expect(Math.min(...numericValues)).toBeGreaterThan(-200);
});

test('buildMlTrainingRow: entryTimestamp is sourced only from signal.timestamp', () => {
  const candles = Array.from({ length: 10 }, (_, i) => ({
    open: 100 + i,
    close: 100 + i,
    high: 101 + i,
    low: 99 + i,
    volume: 1000 + i,
    timestamp: (i + 1) * 60_000,
  }));

  const baseSignal = {
    symbol: 'BTCUSDT',
    strategy: 'TrendLine',
    direction: 'LONG',
    interval: 15,
    prices: {
      currentPrice: 100,
      takeProfitPrice: 102,
      stopLossPrice: 99,
      riskRatio: 1.5,
    },
    indicators: {
      candles15m: candles,
      btcCandles15m: candles,
      candles1h: candles,
      btcCandles1h: candles,
      candles4h: candles,
      btcCandles4h: candles,
      candles1d: candles,
      btcCandles1d: candles,
    },
    figures: {},
  };

  const withoutSignalTimestamp = buildMlTrainingRow(
    { signal: baseSignal },
    { profit: 1 },
  );
  expect(withoutSignalTimestamp.entryTimestamp).toBe(0);

  const explicitTimestamp = Date.UTC(2025, 0, 2, 3, 0, 0);
  const withSignalTimestamp = buildMlTrainingRow(
    {
      signal: {
        ...baseSignal,
        timestamp: explicitTimestamp,
      },
    },
    { profit: 1 },
  );
  expect(withSignalTimestamp.entryTimestamp).toBe(explicitTimestamp);
  expect(withSignalTimestamp.Ctx_EntryHour).toBe(3);
});

test('buildMlTrainingRow: short higher-timeframe candle windows stay aligned after trim', () => {
  const candle = (timestamp: number, open: number, close: number) => ({
    open,
    close,
    high: Math.max(open, close) + 1,
    low: Math.min(open, close) - 1,
    volume: 100,
    timestamp,
  });

  const candles15m = Array.from({ length: 50 }, (_, i) =>
    candle(1_700_000_000_000 + i * 900_000, 100 + i, 101 + i),
  );
  const btcCandles15m = Array.from({ length: 50 }, (_, i) =>
    candle(1_700_000_000_000 + i * 900_000, 200 + i, 201 + i),
  );
  const candles1h = [
    candle(1_700_000_000_000, 10, 11),
    candle(1_700_003_600_000, 11, 12),
    candle(1_700_007_200_000, 12, 13),
  ];
  const btcCandles1h = [
    candle(1_700_000_000_000, 20, 21),
    candle(1_700_003_600_000, 21, 22),
    candle(1_700_007_200_000, 22, 23),
  ];

  const signal = {
    signalId: 'short-tf',
    strategy: 'TrendLine',
    symbol: 'ETHUSDT',
    direction: 'LONG',
    interval: '15',
    timestamp: candles15m[candles15m.length - 1].timestamp,
    prices: {
      currentPrice: 150,
      takeProfitPrice: 160,
      stopLossPrice: 140,
      riskRatio: 1.2,
    },
    indicators: {
      candles15m,
      btcCandles15m,
      candles1h,
      btcCandles1h,
    },
    figures: {},
  };

  const fullRow = buildMlTrainingRow({ signal }, { profit: 1 });
  const row = trimMlTrainingRowWindows(fullRow, 5);

  expect((row.TF1H_ALT_Ret_5 as number) || 0).toBeGreaterThan(0);
  expect((row.TF1H_ALT_Candle_Range_5 as number) || 0).toBeGreaterThan(0);
});

test('buildMlTrainingRow: drops last candle/indicator element before feature build', () => {
  const candle = (timestamp: number, open: number, close: number) => ({
    open,
    close,
    high: Math.max(open, close) + 1,
    low: Math.min(open, close) - 1,
    volume: 100,
    timestamp,
  });

  const candles15m = [
    candle(1_700_000_000_000, 100, 101),
    candle(1_700_000_900_000, 101, 102),
    candle(1_700_001_800_000, 1, 10), // extreme last bar; should be ignored
  ];
  const btcCandles15m = [
    candle(1_700_000_000_000, 200, 201),
    candle(1_700_000_900_000, 201, 202),
    candle(1_700_001_800_000, 2, 20), // extreme last bar; should be ignored
  ];

  const signal = {
    signalId: 'drop-last',
    strategy: 'TrendLine',
    symbol: 'ETHUSDT',
    direction: 'LONG',
    interval: '15',
    timestamp: candles15m[candles15m.length - 1].timestamp,
    prices: {
      currentPrice: 150,
      takeProfitPrice: 160,
      stopLossPrice: 140,
      riskRatio: 1.2,
    },
    indicators: {
      candles15m,
      btcCandles15m,
      price1hPcnt: [1, 2, 999], // extreme last value; should be ignored
      maFast: [100, 101, 102],
      maMedium: [100, 101, 102],
      maSlow: [100, 101, 102],
      atr: [1, 1, 1],
      atrPct: [1, 1, 1],
      bbUpper: [1, 1, 1],
      bbMiddle: [1, 1, 1],
      bbLower: [1, 1, 1],
      obv: [1, 2, 3],
      smaObv: [1, 2, 3],
      macd: [1, 2, 3],
      macdSignal: [1, 2, 3],
      macdHistogram: [1, 2, 3],
      price24hPcnt: [1, 2, 3],
      highPrice1h: [100, 101, 102],
      lowPrice1h: [90, 91, 92],
      volume1h: [100, 110, 120],
      highPrice24h: [110, 111, 112],
      lowPrice24h: [80, 81, 82],
      volume24h: [200, 210, 220],
    },
    figures: {
      trendLine: {
        mode: 'lows',
        distance: 0.1,
        alpha: [1, 2, 3],
        points: [
          { value: 99, timestamp: 1_700_000_000_000 },
          { value: 100, timestamp: 1_700_000_900_000 },
        ],
        touches: [{ value: 99.5, timestamp: 1_700_000_450_000 }],
      },
    },
  };

  const row = buildMlTrainingRow({ signal }, { profit: 1 });

  // The last indicator value (999) is removed, so tail keeps value 2.
  expect(row.TF15M_ALT_Price1hPcnt_49).toBeCloseTo(Math.tanh(2 / 10));
  // The extreme last candle is removed, so tail alt return is from 101 -> 102.
  expect(row.TF15M_ALT_Ret_49).toBeCloseTo(102 / 101);
  // POINTS_* are not indicator/candle series and must stay intact.
  expect(typeof row.POINTS_TS_1).toBe('number');
});

test('buildMlTrainingRow + trim: final window keeps dropped-last tail without _49/_50 keys', () => {
  const candle = (timestamp: number, open: number, close: number) => ({
    open,
    close,
    high: Math.max(open, close) + 1,
    low: Math.min(open, close) - 1,
    volume: 100,
    timestamp,
  });

  const candles15m = [
    candle(1_700_000_000_000, 100, 101),
    candle(1_700_000_900_000, 101, 102),
    candle(1_700_001_800_000, 1, 10), // extreme last bar; should be ignored
  ];
  const btcCandles15m = [
    candle(1_700_000_000_000, 200, 201),
    candle(1_700_000_900_000, 201, 202),
    candle(1_700_001_800_000, 2, 20), // extreme last bar; should be ignored
  ];

  const signal = {
    signalId: 'drop-last-trimmed',
    strategy: 'TrendLine',
    symbol: 'ETHUSDT',
    direction: 'LONG',
    interval: '15',
    timestamp: candles15m[candles15m.length - 1].timestamp,
    prices: {
      currentPrice: 150,
      takeProfitPrice: 160,
      stopLossPrice: 140,
      riskRatio: 1.2,
    },
    indicators: {
      candles15m,
      btcCandles15m,
      price1hPcnt: [1, 2, 999], // extreme last value; should be ignored
      maFast: [100, 101, 102],
      maMedium: [100, 101, 102],
      maSlow: [100, 101, 102],
      atr: [1, 1, 1],
      atrPct: [1, 1, 1],
      bbUpper: [1, 1, 1],
      bbMiddle: [1, 1, 1],
      bbLower: [1, 1, 1],
      obv: [1, 2, 3],
      smaObv: [1, 2, 3],
      macd: [1, 2, 3],
      macdSignal: [1, 2, 3],
      macdHistogram: [1, 2, 3],
      price24hPcnt: [1, 2, 3],
      highPrice1h: [100, 101, 102],
      lowPrice1h: [90, 91, 92],
      volume1h: [100, 110, 120],
      highPrice24h: [110, 111, 999],
      lowPrice24h: [80, 81, 1],
      volume24h: [200, 210, 220],
    },
    figures: {
      trendLine: {
        mode: 'lows',
        distance: 0.1,
        alpha: [1, 2, 3],
        points: [
          { value: 99, timestamp: 1_700_000_000_000 },
          { value: 100, timestamp: 1_700_000_900_000 },
        ],
        touches: [{ value: 99.5, timestamp: 1_700_000_450_000 }],
      },
    },
  };

  const fullRow = buildMlTrainingRow({ signal }, { profit: 1 });
  const row = trimMlTrainingRowWindows(fullRow, 5);

  expect(row.TF15M_ALT_Price1hPcnt_5).toBeCloseTo(Math.tanh(2 / 10));
  expect(row.TF15M_ALT_Ret_5).toBeCloseTo(102 / 101);
  expect(row.TF15M_ALT_Price1hPcnt_49).toBeUndefined();
  expect(row.TF15M_ALT_Ret_49).toBeUndefined();
  expect(row.Ctx_DistanceTo24hRange).toBeCloseTo(30 / 101);
  expect(Object.keys(row).some((key) => /_(49|50)$/.test(key))).toBe(false);
});

test('trimMlTrainingRowWindows: keeps grouped suffix windows independent', () => {
  const source: Record<string, number | string | null> = {
    TF15M_ALT_Volume1h_45_MedianNorm: 0,
    TF15M_ALT_Volume1h_46_MedianNorm: 1,
    TF15M_ALT_Volume1h_47_MedianNorm: 2,
    TF15M_ALT_Volume1h_48_MedianNorm: 3,
    TF15M_ALT_Volume1h_49_MedianNorm: 4,
    TF15M_ALT_Volume1h_50_MedianNorm: 5,
    TF15M_ALT_Volume1h_49: 11,
    TF15M_ALT_Volume1h_50: 12,
  };

  const row = trimMlTrainingRowWindows(source, 5);

  expect(row.TF15M_ALT_Volume1h_1_MedianNorm).toBe(1);
  expect(row.TF15M_ALT_Volume1h_5_MedianNorm).toBe(5);
  expect(row.TF15M_ALT_Volume1h_6_MedianNorm).toBeUndefined();
  expect(row.TF15M_ALT_Volume1h_49_MedianNorm).toBeUndefined();
  expect(row.TF15M_ALT_Volume1h_49).toBe(11);
  expect(row.TF15M_ALT_Volume1h_50).toBe(12);
});
