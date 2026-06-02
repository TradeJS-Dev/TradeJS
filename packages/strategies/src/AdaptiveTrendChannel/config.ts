import { FEE_PERCENT } from '@tradejs/core/constants';
import {
  BacktestPriceMode,
  Direction,
  Interval,
  StrategyConfig,
} from '@tradejs/types';

export interface AdaptiveTrendChannelSideConfig {
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
  ADAPTIVE_TREND_CHANNEL_REGRESSION_BARS: 7,
  ADAPTIVE_TREND_CHANNEL_ENVELOPE_BARS: 2,
  ADAPTIVE_TREND_CHANNEL_ATR_STRETCH: 2,
  ADAPTIVE_TREND_CHANNEL_VOLATILITY_LOOKBACK: 100,
  ADAPTIVE_TREND_CHANNEL_TARGET_R_MULT: 2,
  ADAPTIVE_TREND_CHANNEL_MIN_BREAKOUT_DISTANCE_PCT: 0,
  ADAPTIVE_TREND_CHANNEL_MAX_BREAKOUT_DISTANCE_PCT: 0,
  ADAPTIVE_TREND_CHANNEL_MIN_CHANNEL_WIDTH_PCT: 0,
  ADAPTIVE_TREND_CHANNEL_MAX_CHANNEL_WIDTH_PCT: 0,
  ADAPTIVE_TREND_CHANNEL_MIN_VOLUME_REL20: 0,
  ADAPTIVE_TREND_CHANNEL_REQUIRE_CONTEXT_ALIGNMENT: false,
  ADAPTIVE_TREND_CHANNEL_EXIT_ON_OPPOSITE_FLIP: true,
  ADAPTIVE_TREND_CHANNEL_EXIT_ON_CHANNEL_BREAK: true,
  ADAPTIVE_TREND_CHANNEL_MAX_FIGURE_POINTS: 180,
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

export type AdaptiveTrendChannelConfig = StrategyConfig &
  Omit<typeof config, 'BACKTEST_PRICE_MODE' | 'LONG' | 'SHORT'> & {
    BACKTEST_PRICE_MODE: BacktestPriceMode;
    LONG: AdaptiveTrendChannelSideConfig;
    SHORT: AdaptiveTrendChannelSideConfig;
  };
