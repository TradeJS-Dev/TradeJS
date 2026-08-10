import { StrategyConfig } from '@tradejs/types';

export type BreakoutEntryMode = 'breakout' | 'confirmation' | 'retest';

export const config = {
  ML_ENABLED: false,
  MA_FAST: 49,
  MA_MEDIUM: 49,
  MA_SLOW: 99,
  OBV_SMA: 10,
  ATR: 14,
  ATR_PCT_SHORT: 7,
  ATR_PCT_LONG: 30,
  BB: 20,
  BB_STD: 2,
  MACD_FAST: 12,
  MACD_SLOW: 26,
  MACD_SIGNAL: 9,
  LEVEL_LOOKBACK: 20,
  LEVEL_DELAY: 2,
  LIMIT: 100,
  ATR_OPEN: 0.5,
  BREAKOUT_USE_ENGINE: false,
  BREAKOUT_ENGINE_LOOKBACK: 20,
  BREAKOUT_ENGINE_DELAY: 1,
  BREAKOUT_TREND_LOOKBACK: 20,
  BREAKOUT_ENTRY_MODE: 'breakout' as BreakoutEntryMode,
  BREAKOUT_CONFIRMATION_BARS: 1,
  BREAKOUT_RETEST_MAX_BARS: 8,
  BREAKOUT_RETEST_TOLERANCE_ATR: 0.25,
  BREAKOUT_RETEST_TOLERANCE_ATR_LONG: 0.1,
  BREAKOUT_RETEST_TOLERANCE_ATR_SHORT: 0.15,
  BREAKOUT_LONG_ENABLED: true,
  BREAKOUT_SHORT_ENABLED: true,
  BREAKOUT_REQUIRE_FRESH_LEVEL_CROSS: false,
  BREAKOUT_REQUIRE_DIRECTIONAL_BODY: false,
  BREAKOUT_MIN_BODY_ATR: 0,
  BREAKOUT_MIN_VOLUME_REL20: 0,
  BREAKOUT_MIN_ACCEPTANCE_CLOSES: 0,
  BREAKOUT_MAX_DISTANCE_ATR: 0,
  BREAKOUT_MIN_TREND_MOVE_ATR: 0,
  BREAKOUT_MIN_RANGE_ATR: 0,
  BREAKOUT_MIN_RANGE_ATR_LONG: 12,
  BREAKOUT_MIN_RANGE_ATR_SHORT: 20,
  BREAKOUT_MAX_RANGE_ATR: 0,
  BREAKOUT_COOLDOWN_HOURS: 0,
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

export type BreakoutConfig = StrategyConfig & typeof config;
