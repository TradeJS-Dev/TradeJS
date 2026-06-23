import { FEE_PERCENT } from '@tradejs/core/constants';
import {
  BacktestPriceMode,
  Direction,
  Interval,
  StrategyConfig,
} from '@tradejs/types';

export interface RelativeRotationSideConfig {
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
  LEVEL_LOOKBACK: 20,
  LEVEL_DELAY: 2,
  RR_MIN_ALPHA_24H: 0.8,
  RR_MIN_RATIO_RETURN_24H: 0.4,
  RR_MIN_RELATIVE_STRENGTH_1H: 0.15,
  RR_MIN_VOLUME_REL20: 0.8,
  RR_REQUIRE_RATIO_TREND: true,
  RR_REQUIRE_BTC_ALT_REGIME_ALIGNMENT: false,
  RR_STOP_ATR_MULT: 1.6,
  RR_STOP_BUFFER_PCT: 0.05,
  RR_TARGET_R_MULT: 2.5,
  RR_EXIT_ON_OPPOSITE_ROTATION: true,
  LONG: {
    enable: true,
    direction: 'LONG',
    minRiskRatio: 1.5,
  },
  SHORT: {
    enable: true,
    direction: 'SHORT',
    minRiskRatio: 1.5,
  },
} as const;

export type RelativeRotationConfig = StrategyConfig &
  Omit<typeof config, 'BACKTEST_PRICE_MODE' | 'LONG' | 'SHORT'> & {
    BACKTEST_PRICE_MODE: BacktestPriceMode;
    LONG: RelativeRotationSideConfig;
    SHORT: RelativeRotationSideConfig;
  };
