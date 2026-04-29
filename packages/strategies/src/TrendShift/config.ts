import {
  BacktestPriceMode,
  Direction,
  Interval,
  StrategyConfig,
} from '@tradejs/types';

export interface TrendShiftSideConfig {
  enable: boolean;
  direction: Direction;
  TP: number;
  SL: number;
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
  FEE_PERCENT: 0.005,
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
  TRENDSHIFT_MULTIPLICATIVE_FACTOR: 4,
  TRENDSHIFT_SLOPE: 12,
  TRENDSHIFT_ATR_LENGTH: 150,
  TRENDSHIFT_WIDTH_PCT: 75,
  TRENDSHIFT_CONFIRM_FLIP_WITH_CLOSE: true,
  TRENDSHIFT_MIN_FLIP_DISTANCE_ATR: 0.15,
  TRENDSHIFT_EXIT_ON_OPPOSITE_FLIP: true,
  TRENDSHIFT_MAX_FIGURE_POINTS: 180,
  LONG: {
    enable: true,
    direction: 'LONG',
    TP: 2.8,
    SL: 1.1,
    minRiskRatio: 1.6,
  },
  SHORT: {
    enable: true,
    direction: 'SHORT',
    TP: 2.8,
    SL: 1.1,
    minRiskRatio: 1.6,
  },
} as const;

export type TrendShiftConfig = StrategyConfig &
  Omit<typeof config, 'BACKTEST_PRICE_MODE' | 'LONG' | 'SHORT'> & {
    BACKTEST_PRICE_MODE: BacktestPriceMode;
    LONG: TrendShiftSideConfig;
    SHORT: TrendShiftSideConfig;
  };
