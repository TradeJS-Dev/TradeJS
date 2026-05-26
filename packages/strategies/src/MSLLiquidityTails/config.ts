import { FEE_PERCENT } from '@tradejs/core/constants';
import {
  BacktestPriceMode,
  Direction,
  Interval,
  StrategyConfig,
} from '@tradejs/types';

export interface MSLLiquidityTailsSideConfig {
  enable: boolean;
  direction: Direction;
  minRiskRatio: number;
}

export const config = {
  ENV: 'BACKTEST',
  INTERVAL: '15' as Interval,
  MAKE_ORDERS: true,
  CLOSE_OPPOSITE_POSITIONS: false,
  BACKTEST_PRICE_MODE: 'mid' as const,
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
  MSLTAILS_ATR_LENGTH: 14,
  MSLTAILS_ATR_MULT: 0.8,
  MSLTAILS_MIN_WICK_RATIO: 1.3,
  MSLTAILS_WICK_DOMINANCE: 1.2,
  MSLTAILS_MIN_GAP: 5,
  MSLTAILS_MAX_AGE: 500,
  MSLTAILS_KEEP_BROKEN: true,
  MSLTAILS_REACTION_CLOSE_BEYOND_ZONE: true,
  MSLTAILS_REQUIRE_REACTION_BODY: true,
  MSLTAILS_MAX_RETEST_DISTANCE_PCT: 1.2,
  MSLTAILS_STOP_ATR_BUFFER_MULT: 0.12,
  MSLTAILS_STOP_BUFFER_PCT: 0.03,
  MSLTAILS_TARGET_R_MULT: 2,
  MSLTAILS_EXIT_ON_OPPOSITE_RETEST: true,
  MSLTAILS_MAX_FIGURE_ZONES: 24,
  LONG: {
    enable: true,
    direction: 'LONG',
    minRiskRatio: 1.2,
  },
  SHORT: {
    enable: true,
    direction: 'SHORT',
    minRiskRatio: 1.2,
  },
} as const;

export type MSLLiquidityTailsConfig = StrategyConfig &
  Omit<typeof config, 'BACKTEST_PRICE_MODE' | 'LONG' | 'SHORT'> & {
    BACKTEST_PRICE_MODE: BacktestPriceMode;
    LONG: MSLLiquidityTailsSideConfig;
    SHORT: MSLLiquidityTailsSideConfig;
  };
