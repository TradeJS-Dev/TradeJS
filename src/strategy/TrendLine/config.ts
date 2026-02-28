import {
  BacktestPriceMode,
  Direction,
  Interval,
  StrategyConfig,
  TrendLineOptions,
} from '@types';

export interface TrendLineModeConfig {
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
  ML_ENABLED: false,
  ML_THRESHOLD: 0.1,
  MIN_AI_QUALITY: 3,
  FEE_PERCENT: 0.005,
  MAX_LOSS_VALUE: 10,
  MAX_CORRELATION: 0.45,
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
  HIGHS: {
    enable: true,
    direction: 'LONG',
    TP: 4,
    SL: 1.3,
    minRiskRatio: 2,
  },
  LOWS: {
    enable: true,
    direction: 'SHORT',
    TP: 4,
    SL: 1.3,
    minRiskRatio: 2,
  },
} as const;

export type TrendLineConfig = StrategyConfig &
  Omit<
    typeof config,
    'BACKTEST_PRICE_MODE' | 'TRENDLINE' | 'HIGHS' | 'LOWS'
  > & {
    BACKTEST_PRICE_MODE: BacktestPriceMode;
    TRENDLINE: Partial<TrendLineOptions>;
    HIGHS: TrendLineModeConfig;
    LOWS: TrendLineModeConfig;
  };
