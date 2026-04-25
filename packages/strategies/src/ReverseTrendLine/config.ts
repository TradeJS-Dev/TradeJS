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
  TRENDLINE: {
    minTouches: 4,
    offset: 3,
    epsilon: 0.003,
    epsilonOffset: 0.004,
  } as Partial<TrendLineOptions>,
  HIGHS: {
    enable: true,
    direction: 'SHORT',
    TP: 3.2,
    SL: 1.1,
    minRiskRatio: 1.6,
  },
  LOWS: {
    enable: true,
    direction: 'LONG',
    TP: 3.2,
    SL: 1.1,
    minRiskRatio: 1.6,
  },
} as const;

export type ReverseTrendLineConfig = StrategyConfig &
  Omit<
    typeof config,
    'BACKTEST_PRICE_MODE' | 'TRENDLINE' | 'HIGHS' | 'LOWS'
  > & {
    BACKTEST_PRICE_MODE: BacktestPriceMode;
    TRENDLINE: Partial<TrendLineOptions>;
    HIGHS: ReverseTrendLineModeConfig;
    LOWS: ReverseTrendLineModeConfig;
  };
