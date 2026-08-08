import { FEE_PERCENT } from '@tradejs/core/constants';
import {
  BacktestPriceMode,
  Direction,
  Interval,
  StrategyConfig,
} from '@tradejs/types';

export interface HeadAndShouldersSideConfig {
  enable: boolean;
  direction: Direction;
  minRiskRatio: number;
}

export type HeadAndShouldersEntryMode =
  | 'breakout'
  | 'close_acceptance'
  | 'retest';

export const config = {
  ENV: 'BACKTEST',
  INTERVAL: '15' as Interval,
  MAKE_ORDERS: true,
  CLOSE_OPPOSITE_POSITIONS: false,
  BACKTEST_PRICE_MODE: 'open' as const,
  AI_ENABLED: false,
  AI_MODE: 'llm' as const,
  ML_ENABLED: false,
  ML_THRESHOLD: 0.1,
  MIN_AI_QUALITY: 4,
  FEE_PERCENT,
  MAX_LOSS_VALUE: 10,
  MA_FAST: 14,
  MA_MEDIUM: 49,
  MA_SLOW: 50,
  OBV_SMA: 10,
  ATR: 14,
  ATR_PCT_SHORT: 7,
  ATR_PCT_LONG: 30,
  BB: 20,
  BB_STD: 2,
  MACD_FAST: 12,
  MACD_SLOW: 26,
  MACD_SIGNAL: 9,
  HEADSHOULDERS_PIVOT_LOOKBACK: 3,
  HEADSHOULDERS_SHOULDER_TOLERANCE_PCT: 15,
  HEADSHOULDERS_MIN_HEAD_PROMINENCE_RATIO: 0.2,
  HEADSHOULDERS_TARGET_HEIGHT_PCT: 100,
  HEADSHOULDERS_STOP_BUFFER_HEIGHT_PCT: 5,
  HEADSHOULDERS_MIN_HEAD_HEIGHT_PCT: 0.8,
  HEADSHOULDERS_MIN_HEAD_HEIGHT_ATR: 2.5,
  HEADSHOULDERS_ATR_PERIOD: 14,
  HEADSHOULDERS_MIN_PATTERN_BARS: 8,
  HEADSHOULDERS_MAX_PATTERN_BARS: 180,
  HEADSHOULDERS_MIN_PATTERN_SYMMETRY_RATIO: 0.45,
  HEADSHOULDERS_MAX_NECKLINE_SLOPE_RATIO: 0.2,
  HEADSHOULDERS_MAX_PATTERN_AGE_BARS: 220,
  HEADSHOULDERS_MIN_BREAKOUT_DISTANCE_ATR: 0.2,
  HEADSHOULDERS_MAX_BREAKOUT_DISTANCE_HEIGHT_RATIO: 0.35,
  HEADSHOULDERS_MAX_BREAKOUT_DISTANCE_PCT: 0.8,
  HEADSHOULDERS_REQUIRE_BREAKOUT_CROSS: false,
  HEADSHOULDERS_ENTRY_MODE: 'close_acceptance' as HeadAndShouldersEntryMode,
  HEADSHOULDERS_CONFIRMATION_MAX_BARS: 2,
  HEADSHOULDERS_RETEST_MAX_BARS: 4,
  HEADSHOULDERS_RETEST_TOLERANCE_ATR: 0.25,
  HEADSHOULDERS_EXIT_ON_OPPOSITE_PATTERN: true,
  LONG: {
    enable: false,
    direction: 'LONG',
    minRiskRatio: 0.7,
  },
  SHORT: {
    enable: true,
    direction: 'SHORT',
    minRiskRatio: 0.7,
  },
} as const;

export type HeadAndShouldersConfig = StrategyConfig &
  Omit<
    typeof config,
    'BACKTEST_PRICE_MODE' | 'LONG' | 'SHORT' | 'MIN_AI_QUALITY'
  > & {
    BACKTEST_PRICE_MODE: BacktestPriceMode;
    MIN_AI_QUALITY: number;
    HEADSHOULDERS_ENTRY_MODE: HeadAndShouldersEntryMode;
    LONG: HeadAndShouldersSideConfig;
    SHORT: HeadAndShouldersSideConfig;
  };
