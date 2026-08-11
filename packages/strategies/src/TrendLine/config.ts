import { FEE_PERCENT } from '@tradejs/core/constants';
import {
  BacktestPriceMode,
  Direction,
  Interval,
  StrategyConfig,
  TrendLineOptions,
} from '@tradejs/types';

export interface TrendLineModeConfig {
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
  TRENDLINE: {
    minTouches: 4,
    offset: 3,
    epsilon: 0.003,
    epsilonOffset: 0.004,
  } as Partial<TrendLineOptions>,
  TRENDLINE_STOP_BASE_PCT: 1.6,
  TRENDLINE_TARGET_R_MULT: 2.2,
  TRENDLINE_MIN_BREAK_ATR_RATIO: 0,
  TRENDLINE_MAX_BREAK_ATR_RATIO: 0,
  TRENDLINE_WEAK_BREAK_MAX_ATR_RATIO: 0,
  TRENDLINE_WEAK_BREAK_MIN_VOLUME_REL20: 0,
  TRENDLINE_MIN_VOLUME_REL20: 0,
  TRENDLINE_MIN_VOLUME_REL20_LONG: 1,
  TRENDLINE_MIN_VOLUME_REL20_SHORT: 0,
  TRENDLINE_MAX_BB_WIDTH_PCT: 0,
  TRENDLINE_MAX_BB_WIDTH_PCT_LONG: 0,
  TRENDLINE_MAX_BB_WIDTH_PCT_SHORT: 4,
  TRENDLINE_REQUIRE_SLOPE_ALIGNMENT: false,
  TRENDLINE_REQUIRE_BTC_BIAS_ALIGNMENT: false,
  TRENDLINE_ALLOWED_ENTRY_TIMINGS: [
    'ready_breakout',
    'ready_follow_through',
    'ready_retest',
  ] as readonly string[],
  HIGHS: {
    enable: true,
    direction: 'LONG',
    minRiskRatio: 2,
  },
  LOWS: {
    enable: true,
    direction: 'SHORT',
    minRiskRatio: 2,
  },
} as const;

export type TrendLineConfig = StrategyConfig &
  Omit<
    typeof config,
    | 'BACKTEST_PRICE_MODE'
    | 'TRENDLINE'
    | 'TRENDLINE_ALLOWED_ENTRY_TIMINGS'
    | 'TRENDLINE_MIN_VOLUME_REL20_LONG'
    | 'TRENDLINE_MIN_VOLUME_REL20_SHORT'
    | 'TRENDLINE_MAX_BB_WIDTH_PCT_LONG'
    | 'TRENDLINE_MAX_BB_WIDTH_PCT_SHORT'
    | 'HIGHS'
    | 'LOWS'
  > & {
    BACKTEST_PRICE_MODE: BacktestPriceMode;
    TRENDLINE: Partial<TrendLineOptions>;
    TRENDLINE_ALLOWED_ENTRY_TIMINGS: readonly string[];
    TRENDLINE_MIN_VOLUME_REL20_LONG: number;
    TRENDLINE_MIN_VOLUME_REL20_SHORT: number;
    TRENDLINE_MAX_BB_WIDTH_PCT_LONG: number;
    TRENDLINE_MAX_BB_WIDTH_PCT_SHORT: number;
    HIGHS: TrendLineModeConfig;
    LOWS: TrendLineModeConfig;
  };
