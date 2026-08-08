import { FEE_PERCENT } from '@tradejs/core/constants';
import {
  BacktestPriceMode,
  Direction,
  Interval,
  StrategyConfig,
} from '@tradejs/types';

export interface CupAndHandleSideConfig {
  enable: boolean;
  direction: Direction;
  minRiskRatio: number;
}

export type CupAndHandleEntryMode = 'breakout' | 'close_acceptance' | 'retest';

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
  CUPHANDLE_PIVOT_LOOKBACK: 3,
  CUPHANDLE_RIM_TOLERANCE_PCT: 15,
  CUPHANDLE_TARGET_DEPTH_PCT: 100,
  CUPHANDLE_STOP_BUFFER_DEPTH_PCT: 5,
  CUPHANDLE_MIN_CUP_DEPTH_PCT: 0.8,
  CUPHANDLE_MIN_CUP_DEPTH_ATR: 2,
  CUPHANDLE_ATR_PERIOD: 14,
  CUPHANDLE_MIN_CUP_BARS: 8,
  CUPHANDLE_MAX_CUP_BARS: 160,
  CUPHANDLE_MIN_CUP_SYMMETRY_RATIO: 0.25,
  CUPHANDLE_MIN_HANDLE_BARS: 2,
  CUPHANDLE_MAX_HANDLE_BARS: 40,
  CUPHANDLE_MIN_HANDLE_DEPTH_RATIO: 0.08,
  CUPHANDLE_MAX_HANDLE_DEPTH_RATIO: 0.5,
  CUPHANDLE_MAX_PATTERN_AGE_BARS: 220,
  CUPHANDLE_MIN_BREAKOUT_DISTANCE_ATR: 0.05,
  CUPHANDLE_MAX_BREAKOUT_DISTANCE_DEPTH_RATIO: 0.35,
  CUPHANDLE_MAX_BREAKOUT_DISTANCE_PCT: 0.8,
  CUPHANDLE_REQUIRE_BREAKOUT_CROSS: false,
  CUPHANDLE_MIN_BREAKOUT_VOLUME_REL20: 0,
  CUPHANDLE_ENTRY_MODE: 'close_acceptance' as CupAndHandleEntryMode,
  CUPHANDLE_CONFIRMATION_MAX_BARS: 2,
  CUPHANDLE_RETEST_MAX_BARS: 4,
  CUPHANDLE_RETEST_TOLERANCE_ATR: 0.25,
  CUPHANDLE_EXIT_ON_OPPOSITE_PATTERN: true,
  LONG: {
    enable: true,
    direction: 'LONG',
    minRiskRatio: 0.7,
  },
  SHORT: {
    enable: true,
    direction: 'SHORT',
    minRiskRatio: 0.7,
  },
} as const;

export type CupAndHandleConfig = StrategyConfig &
  Omit<
    typeof config,
    'BACKTEST_PRICE_MODE' | 'LONG' | 'SHORT' | 'MIN_AI_QUALITY'
  > & {
    BACKTEST_PRICE_MODE: BacktestPriceMode;
    MIN_AI_QUALITY: number;
    CUPHANDLE_ENTRY_MODE: CupAndHandleEntryMode;
    LONG: CupAndHandleSideConfig;
    SHORT: CupAndHandleSideConfig;
  };
