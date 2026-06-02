import { FEE_PERCENT } from '@tradejs/core/constants';
import {
  BacktestPriceMode,
  Direction,
  Interval,
  StrategyConfig,
} from '@tradejs/types';

export interface DoubleTapSideConfig {
  enable: boolean;
  direction: Direction;
  minRiskRatio: number;
}

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
  MIN_AI_QUALITY: 3,
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
  DOUBLETAP_PIVOT_LENGTH: 35,
  DOUBLETAP_PIVOT_TOLERANCE_PCT: 12,
  DOUBLETAP_TARGET_FIB_PCT: 180,
  DOUBLETAP_STOP_FIB_PCT: 0,
  DOUBLETAP_MIN_PATTERN_HEIGHT_PCT: 0.2,
  DOUBLETAP_MAX_BREAKOUT_DISTANCE_PCT: 0.8,
  DOUBLETAP_EXIT_ON_OPPOSITE_PATTERN: true,
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

export type DoubleTapConfig = StrategyConfig &
  Omit<typeof config, 'BACKTEST_PRICE_MODE' | 'LONG' | 'SHORT'> & {
    BACKTEST_PRICE_MODE: BacktestPriceMode;
    LONG: DoubleTapSideConfig;
    SHORT: DoubleTapSideConfig;
  };
