export const config = {
  ATR_PERIOD: 14,
  BB_PERIOD: 20,
  BB_STDDEV: 2,
  MA_FAST: 49,
  MA_SLOW: 99,
  LIMIT: 100,
  ATR_OPEN: 0.5,
  ATR_CLOSE: 1.5,
  OBV_SMA_PERIOD: 10,
  BREAKOUT_LOOKBACK: 20,
  REQUIRED_SCORE_LONG: 7,
  REQUIRED_SCORE_SHORT: 7,
  SIGNALS_LONG: {
    VOLATILE: {
      weight: 1,
      required: true,
    },
    SMA_UPTREND: {
      weight: 1,
      required: true,
    },
    OBV_ABOVE_SMA: {
      weight: 1,
      required: true,
    },
    PREV_HIGH_BREAKOUT: {
      weight: 1,
      required: false,
    },
    CLOSE_ABOVE_UPPER_BB: {
      weight: 1,
      required: false,
    },
    CLOSE_ABOVE_HIGH_LEVEL: {
      weight: 1,
      required: false,
    },
    CLOSE_ABOVE_PREV_CLOSE: {
      weight: 1,
      required: false,
    },
  },
  SIGNALS_SHORT: {
    VOLATILE: {
      weight: 1,
      required: true,
    },
    SMA_DOWNTREND: {
      weight: 1,
      required: true,
    },
    OBV_BELOW_SMA: {
      weight: 1,
      required: true,
    },
    PREV_LOW_BREAKDOWN: {
      weight: 1,
      required: false,
    },
    CLOSE_BELOW_LOWER_BB: {
      weight: 1,
      required: false,
    },
    CLOSE_BELOW_LOW_LEVEL: {
      weight: 1,
      required: false,
    },
    CLOSE_BELOW_PREV_CLOSE: {
      weight: 1,
      required: false,
    },
  },
  TP_LONG: [
    { profit: 0.1, rate: 0.25 },
    { profit: 0.15, rate: 0.5 },
  ],
  TP_SHORT: [
    { profit: 0.05, rate: 0.25 },
    { profit: 0.1, rate: 0.5 },
  ],
  SL_LONG: 0.06,
  SL_SHORT: 0.03,
};
