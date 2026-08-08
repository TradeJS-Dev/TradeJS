import { FEE_PERCENT } from '@tradejs/core/constants';
import {
  BacktestPriceMode,
  Direction,
  Interval,
  StrategyConfig,
} from '@tradejs/types';

export interface TrendFollowSideConfig {
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
  TRENDFOLLOW_PIVOT_LENGTH: 10,
  TRENDFOLLOW_MIN_BARS_BETWEEN_SIGNALS: 0,
  TRENDFOLLOW_ATR_LENGTH: 14,
  TRENDFOLLOW_ATR_MULT: 4,
  TRENDFOLLOW_SIGNAL_OFFSET_ATR: 0.35,
  TRENDFOLLOW_REQUIRE_STRUCTURE_BREAKOUT: false,
  TRENDFOLLOW_REQUIRE_TREND_ALIGNMENT: false,
  TRENDFOLLOW_REQUIRE_BENCHMARK_ALIGNMENT: false,
  TRENDFOLLOW_MIN_VOLUME_REL20: 0,
  TRENDFOLLOW_MIN_STRUCTURE_ACCEPTANCE_CLOSES: 0,
  TRENDFOLLOW_MIN_BREAKOUT_BODY_ATR: 0,
  TRENDFOLLOW_TARGET_R_MULT: 2,
  TRENDFOLLOW_EXIT_ON_TRAIL_STOP: true,
  TRENDFOLLOW_EXIT_ON_OPPOSITE_SIGNAL: true,
  TRENDFOLLOW_MAX_FIGURE_POINTS: 180,
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

export type TrendFollowConfig = StrategyConfig &
  Omit<typeof config, 'BACKTEST_PRICE_MODE' | 'LONG' | 'SHORT'> & {
    BACKTEST_PRICE_MODE: BacktestPriceMode;
    LONG: TrendFollowSideConfig;
    SHORT: TrendFollowSideConfig;
  };
