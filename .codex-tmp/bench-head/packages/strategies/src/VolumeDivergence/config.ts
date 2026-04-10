import {
  BacktestPriceMode,
  Direction,
  Interval,
  StrategyConfig,
} from '@tradejs/types';

export interface VolumeDivergenceModeConfig {
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
  NORMALIZATION_LENGTH: 1000,
  PIVOT_LOOKBACK_LEFT: 21,
  PIVOT_LOOKBACK_RIGHT: 5,
  MAX_BARS_BETWEEN_PIVOTS: 60,
  MIN_BARS_BETWEEN_PIVOTS: 5,
  BULLISH: {
    enable: true,
    direction: 'LONG',
    TP: 4,
    SL: 1.3,
    minRiskRatio: 2,
  },
  BEARISH: {
    enable: true,
    direction: 'SHORT',
    TP: 4,
    SL: 1.3,
    minRiskRatio: 2,
  },
} as const;

export type VolumeDivergenceConfig = StrategyConfig &
  Omit<typeof config, 'BACKTEST_PRICE_MODE' | 'BULLISH' | 'BEARISH'> & {
    BACKTEST_PRICE_MODE: BacktestPriceMode;
    BULLISH: VolumeDivergenceModeConfig;
    BEARISH: VolumeDivergenceModeConfig;
  };
