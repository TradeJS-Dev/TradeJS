import { FEE_PERCENT } from '@tradejs/core/constants';
import {
  BacktestPriceMode,
  Direction,
  Interval,
  StrategyConfig,
  TrendLineOptions,
} from '@tradejs/types';

export interface ReverseTrendLineModeConfig {
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
  TRENDLINE: {
    minTouches: 4,
    offset: 3,
    epsilon: 0.003,
    epsilonOffset: 0.004,
  } as Partial<TrendLineOptions>,
  REVERSE_TRENDLINE_STOP_BASE_PCT: 1.4,
  REVERSE_TRENDLINE_TARGET_R_MULT: 1.8,
  REVERSE_TRENDLINE_FAILED_BOUNCE_EXIT_PCT: 0.35,
  REVERSE_TRENDLINE_MIN_REJECTION_WICK_PCT: 0,
  REVERSE_TRENDLINE_MIN_REJECTION_STRENGTH_PCT: 0,
  REVERSE_TRENDLINE_MIN_REJECTION_STRENGTH_PCT_LONG: 0.2,
  REVERSE_TRENDLINE_MIN_REJECTION_STRENGTH_PCT_SHORT: 0.1,
  REVERSE_TRENDLINE_MAX_BREAK_ATR_RATIO: 0,
  REVERSE_TRENDLINE_MAX_BREAK_ATR_RATIO_LONG: 0.3,
  REVERSE_TRENDLINE_MAX_BREAK_ATR_RATIO_SHORT: 0,
  REVERSE_TRENDLINE_MAX_BTC_MA_SPREAD_PCT: 0,
  REVERSE_TRENDLINE_MAX_BTC_MA_SPREAD_PCT_LONG: 0,
  REVERSE_TRENDLINE_MAX_BTC_MA_SPREAD_PCT_SHORT: 0.2,
  REVERSE_TRENDLINE_REQUIRE_COIN_BIAS_ALIGNMENT: false,
  REVERSE_TRENDLINE_REQUIRE_BTC_BIAS_ALIGNMENT: false,
  REVERSE_TRENDLINE_ALLOWED_ENTRY_TIMINGS: [
    'ready_rejection',
    'ready_follow_through',
  ] as readonly string[],
  HIGHS: {
    enable: true,
    direction: 'SHORT',
    minRiskRatio: 1.6,
  },
  LOWS: {
    enable: true,
    direction: 'LONG',
    minRiskRatio: 1.6,
  },
} as const;

export type ReverseTrendLineConfig = StrategyConfig &
  Omit<
    typeof config,
    | 'BACKTEST_PRICE_MODE'
    | 'TRENDLINE'
    | 'REVERSE_TRENDLINE_ALLOWED_ENTRY_TIMINGS'
    | 'HIGHS'
    | 'LOWS'
  > & {
    BACKTEST_PRICE_MODE: BacktestPriceMode;
    TRENDLINE: Partial<TrendLineOptions>;
    REVERSE_TRENDLINE_ALLOWED_ENTRY_TIMINGS: readonly string[];
    HIGHS: ReverseTrendLineModeConfig;
    LOWS: ReverseTrendLineModeConfig;
  };
